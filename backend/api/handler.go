// Package api wires the notes store to HTTP handlers and exposes a small
// REST surface consumed by the Next.js frontend. All note/bookmark/folder
// routes are scoped under /api/vaults/{vaultId}/... so multiple vaults can
// coexist. Every route except login, setup and invite links needs a
// session; vaults are reachable only by members of the vault's space.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"maps"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"

	"nexote/accounts"
	"nexote/notes"
)

// Handler holds the dependencies shared across all routes.
type Handler struct {
	Registry *notes.VaultRegistry
	Spaces   *notes.SpaceRegistry
	Accounts *accounts.Store
	Events   *hub
	GitSync  *notes.GitSync

	home       string
	origin     *url.URL
	webAuthn   *webauthn.WebAuthn
	ceremonies *accounts.Ceremonies

	// setupMu serializes creating the first admin and redeeming invites;
	// setupCode must be entered to create the first admin ("" once set up).
	setupMu   sync.Mutex
	setupCode string

	// personal caches each user's journal and home stores, one Store per
	// directory like the registry's vault stores.
	storesMu sync.Mutex
	personal map[string]*notes.Store

	// colMu guards collectionsReady: spaces whose collections (built-ins,
	// folders, Collections vault) were ensured since start.
	colMu            sync.Mutex
	collectionsReady map[string]bool
}

// Config wires the API to its storage.
type Config struct {
	// Home is $NEXOTE_HOME.
	Home     string
	Registry *notes.VaultRegistry
	Spaces   *notes.SpaceRegistry
	Accounts *accounts.Store
	// Origin is the browser-facing origin (NEXOTE_PUBLIC_URL): passkeys are
	// bound to its host, invite links point at it and changing requests
	// must come from it.
	Origin *url.URL
}

// New creates the API handler. While no account exists it generates the
// setup code needed to create the first admin (see SetupCode).
func New(cfg Config) (*Handler, error) {
	wa, err := accounts.NewWebAuthn(cfg.Origin)
	if err != nil {
		return nil, fmt.Errorf("passkeys: %w", err)
	}
	h := &Handler{
		Registry:         cfg.Registry,
		Spaces:           cfg.Spaces,
		Accounts:         cfg.Accounts,
		Events:           newHub(),
		home:             cfg.Home,
		origin:           cfg.Origin,
		webAuthn:         wa,
		ceremonies:       accounts.NewCeremonies(),
		personal:         map[string]*notes.Store{},
		collectionsReady: map[string]bool{},
	}
	hasUsers, err := cfg.Accounts.HasUsers()
	if err != nil {
		return nil, err
	}
	if !hasUsers {
		h.setupCode = newSetupCode()
	}
	return h, nil
}

// Routes returns an http.Handler serving the /api/* REST surface with CORS,
// preflight handling and session authentication applied.
func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()

	// Accounts: login, first-time setup and invite links work without a
	// session (see authenticate); everything else needs one.
	mux.HandleFunc("GET /api/auth/status", h.authStatus)
	mux.HandleFunc("POST /api/auth/setup/begin", h.setupBegin)
	mux.HandleFunc("POST /api/auth/setup/finish", h.setupFinish)
	mux.HandleFunc("POST /api/auth/login/begin", h.loginBegin)
	mux.HandleFunc("POST /api/auth/login/finish", h.loginFinish)
	mux.HandleFunc("POST /api/auth/logout", h.logout)
	mux.HandleFunc("GET /api/auth/invites/{token}", h.inviteInfo)
	mux.HandleFunc("POST /api/auth/invites/{token}/begin", h.inviteBegin)
	mux.HandleFunc("POST /api/auth/invites/{token}/finish", h.inviteFinish)

	// The logged-in account
	mux.HandleFunc("GET /api/me", h.getMe)
	mux.HandleFunc("PATCH /api/me", h.updateMe)
	mux.HandleFunc("POST /api/me/passkeys/begin", h.addPasskeyBegin)
	mux.HandleFunc("POST /api/me/passkeys/finish", h.addPasskeyFinish)
	mux.HandleFunc("PATCH /api/me/passkeys/{id}", h.renamePasskey)
	mux.HandleFunc("DELETE /api/me/passkeys/{id}", h.removePasskey)
	mux.HandleFunc("PUT /api/me/avatar", h.setMyAvatar)
	mux.HandleFunc("DELETE /api/me/avatar", h.removeMyAvatar)
	mux.HandleFunc("GET /api/me/prefs", h.getMyPrefs)
	mux.HandleFunc("PATCH /api/me/prefs", h.updateMyPrefs)
	mux.HandleFunc("GET /api/users", h.listDirectory)
	mux.HandleFunc("GET /api/users/{id}/avatar", h.getUserAvatar)

	// Administration (admins only)
	mux.HandleFunc("GET /api/admin/users", h.adminListUsers)
	mux.HandleFunc("PATCH /api/admin/users/{id}", h.adminUpdateUser)
	mux.HandleFunc("POST /api/admin/users/{id}/recovery", h.adminCreateRecovery)
	mux.HandleFunc("GET /api/admin/invites", h.adminListInvites)
	mux.HandleFunc("POST /api/admin/invites", h.adminCreateInvite)
	mux.HandleFunc("DELETE /api/admin/invites/{id}", h.adminDeleteInvite)

	// Spaces and their members
	mux.HandleFunc("GET /api/spaces", h.listSpaces)
	mux.HandleFunc("POST /api/spaces", h.createSpaceRoute)
	mux.HandleFunc("PATCH /api/spaces/{id}", h.updateSpace)
	mux.HandleFunc("DELETE /api/spaces/{id}", h.deleteSpace)
	mux.HandleFunc("GET /api/spaces/{id}/members", h.listMembers)
	mux.HandleFunc("PUT /api/spaces/{id}/members/{userId}", h.setMember)
	mux.HandleFunc("DELETE /api/spaces/{id}/members/{userId}", h.removeMember)

	// Vault management
	mux.HandleFunc("GET /api/vaults", h.listVaults)
	mux.HandleFunc("POST /api/vaults", h.createVault)
	mux.HandleFunc("PUT /api/vaults/{id}", h.renameVault)
	mux.HandleFunc("PATCH /api/vaults/{id}", h.setVaultIcon)
	mux.HandleFunc("DELETE /api/vaults/{id}", h.deleteVault)

	// Collection management (per space: ?space=<id>)
	mux.HandleFunc("GET /api/collections", h.listCollections)
	mux.HandleFunc("POST /api/collections", h.createCollection)
	mux.HandleFunc("PUT /api/collections/{id}", h.updateCollection)
	mux.HandleFunc("PATCH /api/collections/{id}/pin", h.setCollectionPinned)
	mux.HandleFunc("PATCH /api/collections/{id}/hidden", h.setCollectionHidden)
	mux.HandleFunc("DELETE /api/collections/{id}", h.deleteCollection)

	// Change notification stream (Server-Sent Events)
	mux.HandleFunc("GET /api/events", h.streamEvents)

	// Vault-scoped note routes
	mux.HandleFunc("GET /api/vaults/{vaultId}/notes", h.listNotes)
	mux.HandleFunc("GET /api/vaults/{vaultId}/search", h.searchVault)
	mux.HandleFunc("POST /api/vaults/{vaultId}/notes", h.createNote)
	mux.HandleFunc("POST /api/vaults/{vaultId}/notes/copy", h.copyNote)
	mux.HandleFunc("POST /api/vaults/{vaultId}/notes/move", h.moveNote)
	mux.HandleFunc("GET /api/vaults/{vaultId}/notes/{id}", h.getNote)
	mux.HandleFunc("PUT /api/vaults/{vaultId}/notes/{id}", h.updateNote)
	mux.HandleFunc("DELETE /api/vaults/{vaultId}/notes/{id}", h.deleteNote)

	// Vault-scoped note history routes
	mux.HandleFunc("GET /api/vaults/{vaultId}/notes/{id}/history", h.listNoteHistory)
	mux.HandleFunc("GET /api/vaults/{vaultId}/notes/{id}/history/{ts}", h.getNoteHistoryVersion)
	mux.HandleFunc("POST /api/vaults/{vaultId}/notes/{id}/history/{ts}/restore", h.restoreNoteHistoryVersion)

	// Vault-scoped folder routes
	mux.HandleFunc("POST /api/vaults/{vaultId}/folders", h.createFolder)
	mux.HandleFunc("PUT /api/vaults/{vaultId}/folders/label", h.setFolderLabel)
	mux.HandleFunc("PUT /api/vaults/{vaultId}/folders/{path...}", h.renameFolder)
	mux.HandleFunc("DELETE /api/vaults/{vaultId}/folders/{path...}", h.deleteFolder)

	// Vault-scoped image routes
	mux.HandleFunc("POST /api/vaults/{vaultId}/notes/{id}/images", h.uploadImage)
	mux.HandleFunc("GET /api/vaults/{vaultId}/images", h.listImages)
	mux.HandleFunc("GET /api/vaults/{vaultId}/images/{path...}", h.getImage)
	mux.HandleFunc("DELETE /api/vaults/{vaultId}/images/{path...}", h.deleteImage)

	// Vault-scoped bookmark routes
	mux.HandleFunc("GET /api/vaults/{vaultId}/bookmarks", h.listBookmarks)
	mux.HandleFunc("POST /api/vaults/{vaultId}/bookmarks", h.addBookmark)
	mux.HandleFunc("DELETE /api/vaults/{vaultId}/bookmarks/{id}", h.removeBookmark)

	// Vault-scoped shortcut routes
	mux.HandleFunc("GET /api/vaults/{vaultId}/shortcuts", h.listShortcuts)
	mux.HandleFunc("POST /api/vaults/{vaultId}/shortcuts", h.addShortcut)
	mux.HandleFunc("DELETE /api/vaults/{vaultId}/shortcuts/{id}", h.removeShortcut)

	// Vault-scoped tag routes
	mux.HandleFunc("GET /api/vaults/{vaultId}/tags", h.listTags)
	mux.HandleFunc("POST /api/vaults/{vaultId}/notes/{id}/tags", h.addTag)
	mux.HandleFunc("DELETE /api/vaults/{vaultId}/notes/{id}/tags/{tag...}", h.removeTag)
	mux.HandleFunc("POST /api/vaults/{vaultId}/tags/rename", h.renameTag)
	mux.HandleFunc("DELETE /api/vaults/{vaultId}/tags/{tag...}", h.deleteTag)

	// Journal routes (vault-independent, always available)
	mux.HandleFunc("GET /api/journal/daily", h.journalDaily)
	mux.HandleFunc("GET /api/journal/notes", h.journalListNotes)
	mux.HandleFunc("GET /api/journal/notes/{id}", h.journalGetNote)
	mux.HandleFunc("PUT /api/journal/notes/{id}", h.journalUpdateNote)
	mux.HandleFunc("DELETE /api/journal/notes/{id}", h.journalDeleteNote)

	// Journal note history routes (vault-independent)
	mux.HandleFunc("GET /api/journal/notes/{id}/history", h.journalListNoteHistory)
	mux.HandleFunc("GET /api/journal/notes/{id}/history/{ts}", h.journalGetNoteHistoryVersion)
	mux.HandleFunc("POST /api/journal/notes/{id}/history/{ts}/restore", h.journalRestoreNoteHistoryVersion)

	// Task routes (vault-independent, scans all vaults)
	mux.HandleFunc("GET /api/tasks", h.listTasks)
	mux.HandleFunc("PUT /api/tasks", h.toggleTask)

	// AI proxy routes (vault-independent, forward to OpenAI-compatible APIs)
	mux.HandleFunc("POST /api/ai/chat", h.aiChat)
	mux.HandleFunc("POST /api/ai/test", h.aiTest)
	mux.HandleFunc("POST /api/ai/transcribe", h.aiTranscribe)

	// Git sync routes (vault-independent, operate on $NEXOTE_HOME root)
	mux.HandleFunc("GET /api/search", h.searchGlobal)
	mux.HandleFunc("GET /api/git/config", h.getGitConfig)
	mux.HandleFunc("PUT /api/git/config", h.setGitConfig)
	mux.HandleFunc("POST /api/git/init", h.gitInit)
	mux.HandleFunc("GET /api/git/status", h.gitStatus)
	mux.HandleFunc("POST /api/git/push", h.gitPush)
	mux.HandleFunc("POST /api/git/pull", h.gitPull)
	mux.HandleFunc("GET /api/git/log", h.gitLog)

	// Metadata lookup routes (vault-independent, proxy Discogs + Books)
	mux.HandleFunc("GET /api/metadata/config", h.getMetadataConfig)
	mux.HandleFunc("PUT /api/metadata/config", h.setMetadataConfig)
	mux.HandleFunc("GET /api/metadata/discogs/release", h.discogsRelease)
	mux.HandleFunc("GET /api/metadata/discogs/search", h.discogsSearch)
	mux.HandleFunc("GET /api/metadata/book", h.bookLookup)
	mux.HandleFunc("GET /api/metadata/book/search", h.bookSearch)
	mux.HandleFunc("POST /api/metadata/cover", h.metadataCover)

	return h.cors(h.authenticate(mux))
}

// cors allows the Next.js dev server (and any local client) to call the API
// during development.
func (h *Handler) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- Vault management ---

// vaultPayload is a vault as clients see it, with the user's role in the
// vault's space. Only admins (who run the server) see its folder on disk.
type vaultPayload struct {
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Icon    string          `json:"icon,omitempty"`
	Type    string          `json:"type,omitempty"`
	SpaceID string          `json:"spaceId"`
	Role    notes.SpaceRole `json:"role"`
	Path    string          `json:"path,omitempty"`
}

func toVaultPayload(v notes.VaultMeta, role notes.SpaceRole) vaultPayload {
	return vaultPayload{ID: v.ID, Name: v.Name, Icon: v.Icon, Type: v.Type, SpaceID: v.SpaceID, Role: role}
}

// publishVaults tells a space's members its vaults or collections changed.
func (h *Handler) publishVaults(spaceID string) {
	if s, err := h.Spaces.Get(spaceID); err == nil {
		h.publishSpaces(spaceID, memberIDs(s))
	}
}

// listVaults returns the vaults of every space the user belongs to.
func (h *Handler) listVaults(w http.ResponseWriter, r *http.Request) {
	vaults, roles, err := h.accessibleVaults(currentUser(r), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	out := make([]vaultPayload, 0, len(vaults))
	for _, v := range vaults {
		p := toVaultPayload(v, roles[v.SpaceID])
		if currentUser(r).Role == accounts.RoleAdmin {
			p.Path = v.Path
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string][]vaultPayload{"vaults": out})
}

func (h *Handler) createVault(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name    string `json:"name"`
		Icon    string `json:"icon"`
		SpaceID string `json:"spaceId"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	space, role, err := h.spaceAccess(currentUser(r), in.SpaceID, notes.SpaceEditor)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	vault, err := h.Registry.Create(in.Name, in.Icon, space.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishSpaces(space.ID, memberIDs(space))
	writeJSON(w, http.StatusCreated, toVaultPayload(vault, role))
}

func (h *Handler) setVaultIcon(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Icon string `json:"icon"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if _, err := h.vaultAccess(currentUser(r), id, notes.SpaceEditor); err != nil {
		h.writeRegistryError(w, err)
		return
	}
	vault, err := h.Registry.SetIcon(id, in.Icon)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	h.publishVaults(vault.SpaceID)
	role, _ := h.Spaces.RoleOf(vault.SpaceID, currentUser(r).ID)
	writeJSON(w, http.StatusOK, toVaultPayload(vault, role))
}

func (h *Handler) renameVault(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Name string `json:"name"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if _, err := h.vaultAccess(currentUser(r), id, notes.SpaceEditor); err != nil {
		h.writeRegistryError(w, err)
		return
	}
	vault, err := h.Registry.Rename(id, in.Name)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	h.publishVaults(vault.SpaceID)
	role, _ := h.Spaces.RoleOf(vault.SpaceID, currentUser(r).ID)
	writeJSON(w, http.StatusOK, toVaultPayload(vault, role))
}

// deleteVault deletes a vault and its notes. Only owners may, and a space
// keeps at least one vault for notes.
func (h *Handler) deleteVault(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	vault, err := h.vaultAccess(currentUser(r), id, notes.SpaceOwner)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	siblings, err := h.Registry.ListSpace(vault.SpaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	regular := 0
	for _, v := range siblings {
		if v.Type != notes.VaultTypeCollections {
			regular++
		}
	}
	if vault.Type != notes.VaultTypeCollections && regular <= 1 {
		writeError(w, http.StatusConflict, errors.New("a space needs at least one vault"))
		return
	}
	if err := h.Registry.Delete(id); err != nil {
		h.writeRegistryError(w, err)
		return
	}
	h.publishVaults(vault.SpaceID)
	w.WriteHeader(http.StatusNoContent)
}

// --- Collections (one set per space, ?space=<id>) ---

func (h *Handler) listCollections(w http.ResponseWriter, r *http.Request) {
	cr, _, err := h.spaceCollections(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	cols, err := cr.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]notes.CollectionMeta{"collections": cols})
}

func (h *Handler) createCollection(w http.ResponseWriter, r *http.Request) {
	cr, store, err := h.spaceCollections(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	var in struct {
		Name   string                  `json:"name"`
		Icon   string                  `json:"icon"`
		Fields []notes.CollectionField `json:"fields"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	col, err := cr.Create(in.Name, in.Icon, in.Fields)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	// Create a matching folder in the Collections vault so the collection
	// shows up in the sidebar tree even before any items are added.
	if col.Name != "" {
		if ferr := store.CreateFolder(col.Name); ferr != nil {
			log.Printf("create collection folder: %v", ferr)
		}
	}
	h.publishVaults(r.URL.Query().Get("space"))
	writeJSON(w, http.StatusCreated, col)
}

func (h *Handler) updateCollection(w http.ResponseWriter, r *http.Request) {
	cr, store, err := h.spaceCollections(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	var in struct {
		Name   string                  `json:"name"`
		Icon   string                  `json:"icon"`
		Fields []notes.CollectionField `json:"fields"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	old, err := cr.Get(id)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	col, err := cr.Update(id, in.Name, in.Icon, in.Fields)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	spaceID := r.URL.Query().Get("space")
	// The items live in a folder named like the collection: a rename moves
	// it, so old and new items stay together (and a delete finds them all).
	if old.Name != "" && col.Name != old.Name {
		if ferr := store.RenameFolder(old.Name, col.Name); ferr != nil {
			log.Printf("rename collection folder %q: %v", old.Name, ferr)
			_ = store.CreateFolder(col.Name)
		}
		if vaultID := h.collectionsVaultID(spaceID); vaultID != "" {
			h.publishTree(r, vaultID)
		}
	}
	h.publishVaults(spaceID)
	writeJSON(w, http.StatusOK, col)
}

func (h *Handler) setCollectionPinned(w http.ResponseWriter, r *http.Request) {
	cr, _, err := h.spaceCollections(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	var in struct {
		Pinned bool `json:"pinned"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	col, err := cr.SetPinned(id, in.Pinned)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	h.publishVaults(r.URL.Query().Get("space"))
	writeJSON(w, http.StatusOK, col)
}

func (h *Handler) setCollectionHidden(w http.ResponseWriter, r *http.Request) {
	cr, _, err := h.spaceCollections(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	var in struct {
		Hidden bool `json:"hidden"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	col, err := cr.SetHidden(id, in.Hidden)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	h.publishVaults(r.URL.Query().Get("space"))
	writeJSON(w, http.StatusOK, col)
}

// deleteCollection removes a collection with its items (the notes in its
// folder of the Collections vault). Built-ins are refused: they would come
// back, empty, on the next start — they can be hidden instead.
func (h *Handler) deleteCollection(w http.ResponseWriter, r *http.Request) {
	cr, store, err := h.spaceCollections(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	col, err := cr.Get(id)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	if col.BuiltIn {
		writeError(w, http.StatusBadRequest, errors.New("built-in collections can be hidden, not deleted"))
		return
	}
	if err := cr.Delete(id); err != nil {
		h.writeRegistryError(w, err)
		return
	}
	spaceID := r.URL.Query().Get("space")
	// Older data may have two collections sharing a name (renames weren't
	// checked): their folder stays while another collection still uses it.
	shared := false
	if rest, err := cr.List(); err == nil {
		for _, c := range rest {
			shared = shared || strings.EqualFold(c.Name, col.Name)
		}
	}
	if col.Name != "" && !shared {
		if ferr := store.DeleteFolder(col.Name); ferr != nil {
			log.Printf("delete collection folder %q: %v", col.Name, ferr)
		}
		if vaultID := h.collectionsVaultID(spaceID); vaultID != "" {
			h.publishTree(r, vaultID)
		}
	}
	h.publishVaults(spaceID)
	w.WriteHeader(http.StatusNoContent)
}

// --- Notes ---

func (h *Handler) listNotes(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	result, err := store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// SearchHit extends a note search result with which vault owns it.
type SearchHit struct {
	notes.SearchEntry
	VaultID   string `json:"vaultId"`
	VaultName string `json:"vaultName"`
}

func (h *Handler) searchVault(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	q := r.URL.Query().Get("q")
hits, err := store.Search(q, 20)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": hits})
}

// searchGlobal runs q over the user's vaults (one space with ?space=, else
// all of them) and their journal, and returns ranked hits with vault
// attribution — used by the command palette.
func (h *Handler) searchGlobal(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	all := []SearchHit{}
	vaults, _, err := h.accessibleVaults(currentUser(r), r.URL.Query().Get("space"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	for _, v := range vaults {
		store, err := h.Registry.Store(v.ID)
		if err != nil {
			continue
		}
		hits, err := store.Search(q, 20)
		if err != nil {
			continue
		}
		for _, hit := range hits {
			all = append(all, SearchHit{
				SearchEntry: hit,
				VaultID:     v.ID,
				VaultName:   v.Name,
			})
		}
	}
	if journal, err := h.journal(r); err == nil {
		if hits, err := journal.Search(q, 10); err == nil {
			for _, hit := range hits {
				all = append(all, SearchHit{
					SearchEntry: hit,
					VaultID:     "journal",
					VaultName:   "Journal",
				})
			}
		}
	}
	// Title matches first, then most recently updated.
	sort.Slice(all, func(i, j int) bool {
		if all[i].Match != all[j].Match {
			return all[i].Match == "title"
		}
		return all[i].UpdatedAt.After(all[j].UpdatedAt)
	})
	writeJSON(w, http.StatusOK, map[string]any{"results": all})
}

func (h *Handler) createNote(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	var in notes.CreateInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	vaultID := r.PathValue("vaultId")
	// Text from the user's own stores (a memo made into a note) may show
	// images only they can load; copy those into this vault.
	if _, personal := personalVaults[vaultID]; !personal {
		for kind := range personalVaults {
			if !strings.Contains(in.Body, "/api/vaults/"+kind+"/images/") {
				continue
			}
			src, err := h.personalStore(currentUser(r).ID, kind)
			if err != nil {
				continue
			}
			if in.Body, err = src.CopyImagesTo(in.Body, kind, store, vaultID); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
		}
	}
	doc, err := store.Create(in)
	switch {
	case errors.Is(err, notes.ErrInvalidID):
		writeError(w, http.StatusBadRequest, err)
		return
	case errors.Is(err, notes.ErrExists):
		writeError(w, http.StatusConflict, err)
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	writeJSON(w, http.StatusCreated, toPayload(doc))
}

func (h *Handler) copyNote(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	var in struct {
		ID string `json:"id"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := store.Copy(in.ID)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	writeJSON(w, http.StatusCreated, toPayload(doc))
}

func (h *Handler) moveNote(w http.ResponseWriter, r *http.Request) {
	srcVaultId := r.PathValue("vaultId")
	var in struct {
		ID         string  `json:"id"`
		DstVaultId string  `json:"dstVaultId"`
		DstPath    *string `json:"dstPath,omitempty"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	user := currentUser(r)
	src, err := h.storeFor(user, srcVaultId, notes.SpaceEditor)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	dst, err := h.storeFor(user, in.DstVaultId, notes.SpaceEditor)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	doc, err := notes.MoveNote(src, in.ID, dst, in.DstVaultId, in.DstPath)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	h.publishTree(r, srcVaultId)
	h.publishTree(r, in.DstVaultId)
	writeJSON(w, http.StatusCreated, toPayload(doc))
}

func (h *Handler) getNote(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	doc, err := store.Get(id)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) updateNote(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	var in notes.UpdateInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	before, beforeErr := store.Get(id)
	doc, err := store.Update(id, in)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	vaultID := r.PathValue("vaultId")
	h.publishNote(r, vaultID, id, doc.Meta.UpdatedAt)
	if beforeErr != nil || listVisibleChange(before.Meta, doc.Meta) {
		h.publishTree(r, vaultID)
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

// listVisibleChange reports whether an update changed what note lists show
// (title, folder, tags, gallery fields…), not just the body.
func listVisibleChange(a, b notes.Meta) bool {
	return a.Title != b.Title || a.Path != b.Path || a.Icon != b.Icon || a.Cover != b.Cover ||
		a.Collection != b.Collection || a.Type != b.Type || a.Artist != b.Artist ||
		a.Year != b.Year || a.Genre != b.Genre ||
		!slices.Equal(a.Tags, b.Tags) || !maps.Equal(a.Fields, b.Fields) ||
		(a.Wantlist == nil) != (b.Wantlist == nil) ||
		(a.Wantlist != nil && *a.Wantlist != *b.Wantlist)
}

func (h *Handler) deleteNote(w http.ResponseWriter, r *http.Request) {
	store, bookmarks, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	if err := store.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	vaultID := r.PathValue("vaultId")
	if _, personal := personalVaults[vaultID]; personal {
		_ = bookmarks.Remove(id)
		_ = notes.NewShortcuts(store.Dir, currentUser(r).ID).Remove(id)
	} else {
		_ = h.Registry.ForgetNote(vaultID, id)
	}
	h.publishTree(r, vaultID)
	w.WriteHeader(http.StatusNoContent)
}

// --- Note history ---

func (h *Handler) listNoteHistory(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	versions, err := store.ListHistory(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]notes.HistoryVersion{"versions": versions})
}

func (h *Handler) getNoteHistoryVersion(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	ts, err := parseHistoryTS(r.PathValue("ts"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := store.GetHistoryVersion(id, ts)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) restoreNoteHistoryVersion(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	ts, err := parseHistoryTS(r.PathValue("ts"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := store.RestoreHistoryVersion(id, ts)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	h.publishNote(r, r.PathValue("vaultId"), id, doc.Meta.UpdatedAt)
	writeJSON(w, http.StatusOK, toPayload(doc))
}

// --- Folders ---

func (h *Handler) createFolder(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	var in struct {
		Path string `json:"path"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := store.CreateFolder(in.Path); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	writeJSON(w, http.StatusCreated, map[string]string{"path": in.Path})
}

func (h *Handler) deleteFolder(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	folderPath := r.PathValue("path")
	if err := store.DeleteFolder(folderPath); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	w.WriteHeader(http.StatusNoContent)
}

// setFolderLabel stores (or clears) the Finder-style color label of a
// folder. Body: {path, color} — empty color clears the label.
func (h *Handler) setFolderLabel(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	var in struct {
		Path  string `json:"path"`
		Color string `json:"color"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := store.LabelFolder(in.Path, in.Color); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) renameFolder(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	oldPath := r.PathValue("path")
	var in struct {
		NewPath string `json:"newPath"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if in.NewPath == "" {
		writeError(w, http.StatusBadRequest, errors.New("newPath is required"))
		return
	}
	if err := store.RenameFolder(oldPath, in.NewPath); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	writeJSON(w, http.StatusOK, map[string]string{"path": in.NewPath})
}

// --- Images and PDFs (files embedded in notes) ---

// maxImageBytes caps image uploads at 20MB, maxPDFBytes PDFs at 50MB.
const (
	maxImageBytes = 20 << 20
	maxPDFBytes   = 50 << 20
)

// imageMimeByExt maps image extensions to their Content-Type. Used as a
// fallback when http.DetectContentType can't identify the format (e.g. svg).
var imageMimeByExt = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg":  "image/svg+xml",
	".bmp":  "image/bmp",
}

func (h *Handler) uploadImage(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPDFBytes+(1<<20))
	if err := r.ParseMultipartForm(maxImageBytes); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid upload: %w", err))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("missing file: %w", err))
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("empty file"))
		return
	}
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(header.Filename)), ".")
	if ext == "" {
		writeError(w, http.StatusBadRequest, errors.New("file has no extension"))
		return
	}
	var meta notes.ImageMeta
	if ext == "pdf" {
		if len(data) > maxPDFBytes {
			writeError(w, http.StatusRequestEntityTooLarge, errors.New("PDFs can be up to 50 MB"))
			return
		}
		meta, err = store.SavePDF(r.PathValue("id"), header.Filename, r.PathValue("vaultId"), data)
	} else {
		if len(data) > maxImageBytes {
			writeError(w, http.StatusRequestEntityTooLarge, errors.New("images can be up to 20 MB"))
			return
		}
		meta, err = store.SaveImage(r.PathValue("id"), ext, r.PathValue("vaultId"), data)
	}
	if errors.Is(err, notes.ErrInvalidPDF) {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, meta)
}

func (h *Handler) listImages(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	images, err := store.ListImages(r.PathValue("vaultId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]notes.ImageMeta{"images": images})
}

func (h *Handler) getImage(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	data, err := store.ReadImage(r.PathValue("path"))
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	name := r.PathValue("path")
	if notes.IsPDFName(name) {
		// Shown in the editor's PDF viewer (an iframe of this origin) and
		// opened in a tab. Not sandboxed like images: browsers refuse to run
		// their PDF viewer in a sandbox. nosniff keeps a fake "PDF" from being
		// read as HTML; uploads are checked for the %PDF- signature.
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": filepath.Base(name)}))
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(data)
		return
	}
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		if m, ok := imageMimeByExt[strings.ToLower(filepath.Ext(name))]; ok {
			contentType = m
		} else {
			contentType = "application/octet-stream"
		}
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-cache")
	// Uploaded files come from any member of a space: never let one run as
	// a page of this origin (an SVG with script opened directly).
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}

func (h *Handler) deleteImage(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	if err := store.DeleteImage(r.PathValue("path")); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Bookmarks ---

func (h *Handler) listBookmarks(w http.ResponseWriter, r *http.Request) {
	_, bookmarks, err := h.resolveStoreAs(r, notes.SpaceViewer)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	ids, err := bookmarks.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]string{"bookmarks": ids})
}

func (h *Handler) addBookmark(w http.ResponseWriter, r *http.Request) {
	_, bookmarks, err := h.resolveStoreAs(r, notes.SpaceViewer)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	var in struct {
		ID string `json:"id"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := bookmarks.Add(in.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) removeBookmark(w http.ResponseWriter, r *http.Request) {
	_, bookmarks, err := h.resolveStoreAs(r, notes.SpaceViewer)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	if err := bookmarks.Remove(id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Shortcuts ---

func (h *Handler) listShortcuts(w http.ResponseWriter, r *http.Request) {
	shortcuts, err := h.shortcuts(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	ids, err := shortcuts.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]string{"shortcuts": ids})
}

func (h *Handler) addShortcut(w http.ResponseWriter, r *http.Request) {
	shortcuts, err := h.shortcuts(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	var in struct {
		ID string `json:"id"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := shortcuts.Add(in.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) removeShortcut(w http.ResponseWriter, r *http.Request) {
	shortcuts, err := h.shortcuts(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	if err := shortcuts.Remove(id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Error helpers ---

func (h *Handler) writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, notes.ErrNotFound) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if errors.Is(err, notes.ErrConflict) {
		writeError(w, http.StatusConflict, err)
		return
	}
	if isForbidden(err) {
		writeError(w, http.StatusForbidden, err)
		return
	}
	writeError(w, http.StatusInternalServerError, err)
}

func (h *Handler) writeRegistryError(w http.ResponseWriter, err error) {
	if errors.Is(err, notes.ErrNotFound) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if isForbidden(err) {
		writeError(w, http.StatusForbidden, err)
		return
	}
	writeError(w, http.StatusBadRequest, err)
}

// Payload is the JSON shape returned for a single note.
type Payload struct {
	ID         string            `json:"id"`
	Title      string            `json:"title"`
	Path       string            `json:"path"`
	CreatedAt  string            `json:"createdAt"`
	UpdatedAt  string            `json:"updatedAt"`
	Tags       []string          `json:"tags"`
	Body       string            `json:"body"`
	Type       string            `json:"type,omitempty"`
	Artist     string            `json:"artist,omitempty"`
	Year       int               `json:"year,omitempty"`
	Genre      string            `json:"genre,omitempty"`
	Wantlist   *bool             `json:"wantlist,omitempty"`
	Cover       string            `json:"cover,omitempty"`
	Icon        string            `json:"icon,omitempty"`
	Collection  string            `json:"collection,omitempty"`
	Fields     map[string]string `json:"fields,omitempty"`
	Pinned     bool              `json:"pinned,omitempty"`
	Priority   int               `json:"priority,omitempty"`
	Status     string            `json:"status,omitempty"`
}

func toPayload(d notes.Document) Payload {
	return Payload{
		ID:         d.Meta.ID,
		Title:      d.Meta.Title,
		Path:       d.Meta.Path,
		CreatedAt:  d.Meta.CreatedAt.Format(timeRFC3339Millis),
		UpdatedAt:  d.Meta.UpdatedAt.Format(timeRFC3339Millis),
		Tags:       d.Meta.Tags,
		Body:       d.Body,
		Type:       d.Meta.Type,
		Artist:     d.Meta.Artist,
		Year:       d.Meta.Year,
		Genre:      d.Meta.Genre,
		Wantlist:   d.Meta.Wantlist,
		Cover:      d.Meta.Cover,
		Icon:       d.Meta.Icon,
		Collection: d.Meta.Collection,
		Fields:     d.Meta.Fields,
		Pinned:     d.Meta.Pinned,
		Priority:   d.Meta.Priority,
		Status:     d.Meta.Status,
	}
}

const timeRFC3339Millis = "2006-01-02T15:04:05.000Z07:00"

func decodeBody(r *http.Request, dst any) error {
	if r.Body == nil {
		return nil
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write json: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		msg = http.StatusText(status)
	}
	writeJSON(w, status, map[string]string{"error": msg})
}

// --- Journal handlers (vault-independent, each user has their own) ---

func (h *Handler) journalDaily(w http.ResponseWriter, r *http.Request) {
	journal, err := h.journal(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	// Optional ?date=YYYY-MM-DD opens-or-creates that day's note; the client
	// sends its local date so "today" follows the user's timezone.
	doc, err := journal.Daily(r.URL.Query().Get("date"))
	if errors.Is(err, notes.ErrInvalidDate) {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) journalListNotes(w http.ResponseWriter, r *http.Request) {
	journal, err := h.journal(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	list, err := journal.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *Handler) journalGetNote(w http.ResponseWriter, r *http.Request) {
	journal, err := h.journal(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	id := r.PathValue("id")
	doc, err := journal.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) journalUpdateNote(w http.ResponseWriter, r *http.Request) {
	journal, err := h.journal(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	id := r.PathValue("id")
	var in notes.UpdateInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := journal.Update(id, in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishNote(r, "journal", id, doc.Meta.UpdatedAt)
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) journalDeleteNote(w http.ResponseWriter, r *http.Request) {
	journal, err := h.journal(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	id := r.PathValue("id")
	if err := journal.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.publishTree(r, "journal")
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) journalListNoteHistory(w http.ResponseWriter, r *http.Request) {
	journal, err := h.journal(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	id := r.PathValue("id")
	versions, err := journal.ListHistory(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]notes.HistoryVersion{"versions": versions})
}

func (h *Handler) journalGetNoteHistoryVersion(w http.ResponseWriter, r *http.Request) {
	journal, err := h.journal(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	id := r.PathValue("id")
	ts, err := parseHistoryTS(r.PathValue("ts"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := journal.GetHistoryVersion(id, ts)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) journalRestoreNoteHistoryVersion(w http.ResponseWriter, r *http.Request) {
	journal, err := h.journal(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	id := r.PathValue("id")
	ts, err := parseHistoryTS(r.PathValue("ts"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := journal.RestoreHistoryVersion(id, ts)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	h.publishNote(r, "journal", id, doc.Meta.UpdatedAt)
	writeJSON(w, http.StatusOK, toPayload(doc))
}

// parseHistoryTS parses a history version identifier. It accepts either the
// nanosecond integer used as the snapshot filename, or the RFC3339 timestamp
// string the frontend sends back from the history list.
func parseHistoryTS(s string) (int64, error) {
	if ts, err := strconv.ParseInt(s, 10, 64); err == nil && ts > 0 {
		return ts, nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UnixNano(), nil
	}
	return 0, errors.New("invalid history timestamp")
}

// --- Tags ---

func (h *Handler) listTags(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	tags, err := store.TagIndex()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

func (h *Handler) addTag(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	var in struct {
		Tag string `json:"tag"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := store.AddTag(id, in.Tag)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) removeTag(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	id := r.PathValue("id")
	tag := r.PathValue("tag")
	doc, err := store.RemoveTag(id, tag)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) renameTag(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	var in struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	count, err := store.RenameTag(in.From, in.To)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	writeJSON(w, http.StatusOK, map[string]int{"renamed": count})
}

func (h *Handler) deleteTag(w http.ResponseWriter, r *http.Request) {
	store, _, err := h.resolveStore(r)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	tag := r.PathValue("tag")
	count, err := store.DeleteTag(tag)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishTree(r, r.PathValue("vaultId"))
	writeJSON(w, http.StatusOK, map[string]int{"removed": count})
}

// --- Tasks ---

// TaskPayload is a task annotated with vault info, returned by GET /api/tasks.
type TaskPayload struct {
	VaultID    string `json:"vaultId"`
	VaultName  string `json:"vaultName"`
	NoteID     string `json:"noteId"`
	NoteTitle  string `json:"noteTitle"`
	Text       string `json:"text"`
	Checked    bool   `json:"checked"`
	Line       int    `json:"line"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

// listTasks collects checkboxes from the user's vaults (one space with
// ?space=, else all of them) and their journal.
func (h *Handler) listTasks(w http.ResponseWriter, r *http.Request) {
	vaults, _, err := h.accessibleVaults(currentUser(r), r.URL.Query().Get("space"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	var result []TaskPayload
	appendTasks := func(vaultID, vaultName string, store *notes.Store) {
		tasks, err := store.Tasks()
		if err != nil {
			return
		}
		for _, t := range tasks {
			result = append(result, TaskPayload{
				VaultID:   vaultID,
				VaultName: vaultName,
				NoteID:    t.NoteID,
				NoteTitle: t.NoteTitle,
				Text:      t.Text,
				Checked:   t.Checked,
				Line:      t.Line,
				CreatedAt: t.CreatedAt.Format(timeRFC3339Millis),
				UpdatedAt: t.UpdatedAt.Format(timeRFC3339Millis),
			})
		}
	}
	for _, v := range vaults {
		store, err := h.Registry.Store(v.ID)
		if err != nil {
			continue
		}
		appendTasks(v.ID, v.Name, store)
	}
	// The journal is a separate store, not a vault — its checkboxes belong in
	// the tasks overview too (the "journal" pseudo vault id fills the rest).
	if journal, err := h.journal(r); err == nil {
		appendTasks("journal", "Journal", journal)
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": result})
}

func (h *Handler) toggleTask(w http.ResponseWriter, r *http.Request) {
	var in struct {
		VaultID string `json:"vaultId"`
		NoteID  string `json:"noteId"`
		Line    int    `json:"line"`
		Checked bool   `json:"checked"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	store, err := h.storeFor(currentUser(r), in.VaultID, notes.SpaceEditor)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	doc, err := store.SetTaskChecked(in.NoteID, in.Line, in.Checked)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	// Broadcast so open clients refresh (mirrors journalUpdateNote).
	h.publishNote(r, in.VaultID, in.NoteID, doc.Meta.UpdatedAt)
	writeJSON(w, http.StatusOK, toPayload(doc))
}

// --- Git sync handlers (admins only: the backup covers the whole server) ---

func (h *Handler) getGitConfig(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if h.GitSync == nil {
		writeJSON(w, http.StatusOK, notes.DefaultGitConfig)
		return
	}
	writeJSON(w, http.StatusOK, h.GitSync.Config())
}

func (h *Handler) setGitConfig(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var cfg notes.GitConfig
	if err := decodeBody(r, &cfg); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	// Persist to git.json at the registry root.
	root := h.Registry.Root()
	if err := notes.SaveGitConfig(root, cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	// Hot-apply: create/update the live GitSync, attach it to every store
	// (vaults + personal journals/home stores), and auto-init the repo when
	// enabling — so the toggle takes effect immediately without a restart.
	if h.GitSync != nil {
		h.GitSync.SetConfig(cfg)
	} else {
		h.GitSync = notes.NewGitSync(root, cfg)
	}
	// The registry attaches the hook to every vault store it hands out.
	h.Registry.SetGitSync(h.GitSync)
	h.storesMu.Lock()
	for _, s := range h.personal {
		s.SetGitSync(h.GitSync)
	}
	h.storesMu.Unlock()
	if cfg.Enabled {
		// Lazily init the repo (no-op if it already exists) so the first
		// auto-commit after enabling has a repo to commit into.
		_ = h.GitSync.InitRepo()
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *Handler) gitInit(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if h.GitSync == nil {
		writeError(w, http.StatusBadRequest, errors.New("git sync not configured"))
		return
	}
	if err := h.GitSync.InitRepo(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) gitStatus(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if h.GitSync == nil {
		writeJSON(w, http.StatusOK, notes.GitStatusInfo{Enabled: false, HasRepo: false})
		return
	}
	info, err := h.GitSync.Status()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (h *Handler) gitPush(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if h.GitSync == nil {
		writeError(w, http.StatusBadRequest, errors.New("git sync not configured"))
		return
	}
	var creds notes.GitCredentials
	_ = decodeBody(r, &creds)
	if err := h.GitSync.Push(r.Context(), creds); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) gitPull(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if h.GitSync == nil {
		writeError(w, http.StatusBadRequest, errors.New("git sync not configured"))
		return
	}
	var creds notes.GitCredentials
	_ = decodeBody(r, &creds)
	if err := h.GitSync.Pull(r.Context(), creds); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	// A pull may have changed spaces.json under the cached registry.
	if err := h.Spaces.Reload(); err != nil {
		log.Printf("reload spaces after pull: %v", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) gitLog(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if h.GitSync == nil {
		writeJSON(w, http.StatusOK, []notes.GitCommitLog{})
		return
	}
	limit := 10
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	log, err := h.GitSync.Log(limit)
	if err != nil {
		writeJSON(w, http.StatusOK, []notes.GitCommitLog{})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"commits": log})
}
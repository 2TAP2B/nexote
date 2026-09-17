// Package api wires the notes store to HTTP handlers and exposes a small
// REST surface consumed by the Next.js frontend. All note/bookmark/folder
// routes are scoped under /api/vaults/{vaultId}/... so multiple vaults can
// coexist.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"nexote/notes"
)

// Handler holds the dependencies shared across all routes.
type Handler struct {
	Registry          *notes.VaultRegistry
	Collections       *notes.CollectionRegistry
	CollectionsStore  *notes.Store
	JournalStore      *notes.Store
	Events            *hub
	GitSync           *notes.GitSync
}

// New creates a Handler backed by the given vault registry. The journal
// store is created at <registryRoot>/../journal (i.e. ~/.nexote/journal).
func New(r *notes.VaultRegistry, journalDir string, collectionsDir string) *Handler {
	js, err := notes.NewStore(journalDir)
	if err != nil {
		log.Printf("journal store: %v", err)
	}
	cr, err := notes.NewCollectionRegistry(collectionsDir)
	if err != nil {
		log.Printf("collections registry: %v", err)
	}
	return &Handler{Registry: r, Collections: cr, JournalStore: js, Events: newHub()}
}

// Routes returns an http.Handler serving the /api/* REST surface with CORS
// and preflight handling applied.
func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()

	// Vault management
	mux.HandleFunc("GET /api/vaults", h.listVaults)
	mux.HandleFunc("POST /api/vaults", h.createVault)
	mux.HandleFunc("PUT /api/vaults/{id}", h.renameVault)
	mux.HandleFunc("PATCH /api/vaults/{id}", h.setVaultIcon)
	mux.HandleFunc("DELETE /api/vaults/{id}", h.deleteVault)

	// Collection management
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

	// Git sync routes (vault-independent, operate on $NEXOTE_HOME root)
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

	return h.cors(mux)
}

// cors allows the Next.js dev server (and any local client) to call the API
// during development.
func (h *Handler) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// resolveStore returns the store + bookmarks for the vault in the path.
func (h *Handler) resolveStore(r *http.Request) (*notes.Store, *notes.Bookmarks, error) {
	vaultId := r.PathValue("vaultId")
	// The journal is a vault-independent store. It uses the pseudo-vault id
	// "journal" so the image routes (which need a vault id for URLs) work for
	// journal notes too. Real vault ids never collide with this literal.
	if vaultId == "journal" {
		if h.JournalStore == nil {
			return nil, nil, notes.ErrNotFound
		}
		return h.JournalStore, nil, nil
	}
	store, err := h.Registry.Store(vaultId)
	if err != nil {
		return nil, nil, err
	}
	bookmarks, err := h.Registry.Bookmarks(vaultId)
	if err != nil {
		return nil, nil, err
	}
	return store, bookmarks, nil
}

// --- Vault management ---

func (h *Handler) listVaults(w http.ResponseWriter, r *http.Request) {
	vaults, err := h.Registry.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]notes.VaultMeta{"vaults": vaults})
}

func (h *Handler) createVault(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Icon string `json:"icon"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	vault, err := h.Registry.Create(in.Name, in.Icon)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	// Attach git sync to the new vault's store if git is enabled.
	if h.GitSync != nil {
		if store, err := h.Registry.Store(vault.ID); err == nil {
			store.SetGitSync(h.GitSync)
		}
	}
	writeJSON(w, http.StatusCreated, vault)
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
	vault, err := h.Registry.SetIcon(id, in.Icon)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, vault)
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
	vault, err := h.Registry.Rename(id, in.Name)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, vault)
}

func (h *Handler) deleteVault(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.Registry.Delete(id); err != nil {
		h.writeRegistryError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Collections ---

func (h *Handler) listCollections(w http.ResponseWriter, r *http.Request) {
	if h.Collections == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("collections not available"))
		return
	}
	cols, err := h.Collections.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]notes.CollectionMeta{"collections": cols})
}

func (h *Handler) createCollection(w http.ResponseWriter, r *http.Request) {
	if h.Collections == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("collections not available"))
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
	col, err := h.Collections.Create(in.Name, in.Icon, in.Fields)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	// Create a matching folder in the Collections vault so the collection
	// shows up in the sidebar tree even before any items are added.
	if h.CollectionsStore != nil && col.Name != "" {
		if ferr := h.CollectionsStore.CreateFolder(col.Name); ferr != nil {
			log.Printf("create collection folder: %v", ferr)
		}
	}
	writeJSON(w, http.StatusCreated, col)
}

func (h *Handler) updateCollection(w http.ResponseWriter, r *http.Request) {
	if h.Collections == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("collections not available"))
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
	col, err := h.Collections.Update(id, in.Name, in.Icon, in.Fields)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, col)
}

func (h *Handler) setCollectionPinned(w http.ResponseWriter, r *http.Request) {
	if h.Collections == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("collections not available"))
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
	col, err := h.Collections.SetPinned(id, in.Pinned)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, col)
}

func (h *Handler) setCollectionHidden(w http.ResponseWriter, r *http.Request) {
	if h.Collections == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("collections not available"))
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
	col, err := h.Collections.SetHidden(id, in.Hidden)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, col)
}

func (h *Handler) deleteCollection(w http.ResponseWriter, r *http.Request) {
	if h.Collections == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("collections not available"))
		return
	}
	id := r.PathValue("id")
	if err := h.Collections.Delete(id); err != nil {
		h.writeRegistryError(w, err)
		return
	}
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
	doc, err := store.Create(in)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
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
	writeJSON(w, http.StatusCreated, toPayload(doc))
}

func (h *Handler) moveNote(w http.ResponseWriter, r *http.Request) {
	srcVaultId := r.PathValue("vaultId")
	var in struct {
		ID         string `json:"id"`
		DstVaultId string `json:"dstVaultId"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := h.Registry.MoveNote(srcVaultId, in.ID, in.DstVaultId)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
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
	doc, err := store.Update(id, in)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	h.publishNote(r.PathValue("vaultId"), id, doc.Meta.UpdatedAt)
	writeJSON(w, http.StatusOK, toPayload(doc))
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
	_ = bookmarks.Remove(id)
	if shortcuts, err := h.Registry.Shortcuts(r.PathValue("vaultId")); err == nil {
		_ = shortcuts.Remove(id)
	}
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
	h.publishNote(r.PathValue("vaultId"), id, doc.Meta.UpdatedAt)
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
	writeJSON(w, http.StatusOK, map[string]string{"path": in.NewPath})
}

// --- Images ---

// maxImageBytes caps uploads at 20MB.
const maxImageBytes = 20 << 20

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
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes)
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
	meta, err := store.SaveImage(r.PathValue("id"), ext, r.PathValue("vaultId"), data)
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
	mime := http.DetectContentType(data)
	if !strings.HasPrefix(mime, "image/") {
		if m, ok := imageMimeByExt[strings.ToLower(filepath.Ext(r.PathValue("path")))]; ok {
			mime = m
		} else {
			mime = "application/octet-stream"
		}
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "no-cache")
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
	_, bookmarks, err := h.resolveStore(r)
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
	_, bookmarks, err := h.resolveStore(r)
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
	_, bookmarks, err := h.resolveStore(r)
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
	shortcuts, err := h.Registry.Shortcuts(r.PathValue("vaultId"))
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
	shortcuts, err := h.Registry.Shortcuts(r.PathValue("vaultId"))
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
	shortcuts, err := h.Registry.Shortcuts(r.PathValue("vaultId"))
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
	writeError(w, http.StatusInternalServerError, err)
}

func (h *Handler) writeRegistryError(w http.ResponseWriter, err error) {
	if errors.Is(err, notes.ErrNotFound) {
		writeError(w, http.StatusNotFound, err)
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
	Cover      string            `json:"cover,omitempty"`
	Collection string            `json:"collection,omitempty"`
	Fields     map[string]string `json:"fields,omitempty"`
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
		Collection: d.Meta.Collection,
		Fields:     d.Meta.Fields,
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

// --- Journal handlers (vault-independent) ---

func (h *Handler) journalDaily(w http.ResponseWriter, r *http.Request) {
	if h.JournalStore == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("journal store not available"))
		return
	}
	doc, err := h.JournalStore.Daily()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) journalListNotes(w http.ResponseWriter, r *http.Request) {
	if h.JournalStore == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("journal store not available"))
		return
	}
	list, err := h.JournalStore.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *Handler) journalGetNote(w http.ResponseWriter, r *http.Request) {
	if h.JournalStore == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("journal store not available"))
		return
	}
	id := r.PathValue("id")
	doc, err := h.JournalStore.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) journalUpdateNote(w http.ResponseWriter, r *http.Request) {
	if h.JournalStore == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("journal store not available"))
		return
	}
	id := r.PathValue("id")
	var in notes.UpdateInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := h.JournalStore.Update(id, in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.publishNote("journal", id, doc.Meta.UpdatedAt)
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) journalDeleteNote(w http.ResponseWriter, r *http.Request) {
	if h.JournalStore == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("journal store not available"))
		return
	}
	id := r.PathValue("id")
	if err := h.JournalStore.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) journalListNoteHistory(w http.ResponseWriter, r *http.Request) {
	if h.JournalStore == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("journal store not available"))
		return
	}
	id := r.PathValue("id")
	versions, err := h.JournalStore.ListHistory(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]notes.HistoryVersion{"versions": versions})
}

func (h *Handler) journalGetNoteHistoryVersion(w http.ResponseWriter, r *http.Request) {
	if h.JournalStore == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("journal store not available"))
		return
	}
	id := r.PathValue("id")
	ts, err := parseHistoryTS(r.PathValue("ts"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := h.JournalStore.GetHistoryVersion(id, ts)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) journalRestoreNoteHistoryVersion(w http.ResponseWriter, r *http.Request) {
	if h.JournalStore == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("journal store not available"))
		return
	}
	id := r.PathValue("id")
	ts, err := parseHistoryTS(r.PathValue("ts"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := h.JournalStore.RestoreHistoryVersion(id, ts)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	h.publishNote("journal", id, doc.Meta.UpdatedAt)
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

func (h *Handler) listTasks(w http.ResponseWriter, r *http.Request) {
	vaults, err := h.Registry.List()
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
	if h.JournalStore != nil {
		appendTasks("journal", "Journal", h.JournalStore)
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
	// "journal" is a pseudo vault id handled separately from the registry.
	var store *notes.Store
	if in.VaultID == "journal" {
		if h.JournalStore == nil {
			writeError(w, http.StatusNotImplemented, errors.New("journal store not configured"))
			return
		}
		store = h.JournalStore
	} else {
		s, err := h.Registry.Store(in.VaultID)
		if err != nil {
			h.writeRegistryError(w, err)
			return
		}
		store = s
	}
	doc, err := store.SetTaskChecked(in.NoteID, in.Line, in.Checked)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	// Broadcast so open clients refresh (mirrors journalUpdateNote).
	h.publishNote(in.VaultID, in.NoteID, doc.Meta.UpdatedAt)
	writeJSON(w, http.StatusOK, toPayload(doc))
}

// --- Git sync handlers ---

func (h *Handler) getGitConfig(w http.ResponseWriter, r *http.Request) {
	if h.GitSync == nil {
		writeJSON(w, http.StatusOK, notes.DefaultGitConfig)
		return
	}
	writeJSON(w, http.StatusOK, h.GitSync.Config())
}

func (h *Handler) setGitConfig(w http.ResponseWriter, r *http.Request) {
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
	// (vaults + journal + collections), and auto-init the repo when enabling —
	// so the toggle takes effect immediately without a backend restart.
	if h.GitSync != nil {
		h.GitSync.SetConfig(cfg)
	} else {
		h.GitSync = notes.NewGitSync(root, cfg)
	}
	if vaults, err := h.Registry.List(); err == nil {
		for _, v := range vaults {
			if store, err := h.Registry.Store(v.ID); err == nil {
				store.SetGitSync(h.GitSync)
			}
		}
	}
	if h.JournalStore != nil {
		h.JournalStore.SetGitSync(h.GitSync)
	}
	if h.CollectionsStore != nil {
		h.CollectionsStore.SetGitSync(h.GitSync)
	}
	if cfg.Enabled {
		// Lazily init the repo (no-op if it already exists) so the first
		// auto-commit after enabling has a repo to commit into.
		_ = h.GitSync.InitRepo()
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *Handler) gitInit(w http.ResponseWriter, r *http.Request) {
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
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) gitLog(w http.ResponseWriter, r *http.Request) {
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
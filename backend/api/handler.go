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
	"strings"

	"nexote/notes"
)

// Handler holds the dependencies shared across all routes.
type Handler struct {
	Registry     *notes.VaultRegistry
	JournalStore *notes.Store
}

// New creates a Handler backed by the given vault registry. The journal
// store is created at <registryRoot>/../journal (i.e. ~/.nexote/journal).
func New(r *notes.VaultRegistry, journalDir string) *Handler {
	js, err := notes.NewStore(journalDir)
	if err != nil {
		log.Printf("journal store: %v", err)
	}
	return &Handler{Registry: r, JournalStore: js}
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

	// Vault-scoped note routes
	mux.HandleFunc("GET /api/vaults/{vaultId}/notes", h.listNotes)
	mux.HandleFunc("POST /api/vaults/{vaultId}/notes", h.createNote)
	mux.HandleFunc("POST /api/vaults/{vaultId}/notes/copy", h.copyNote)
	mux.HandleFunc("POST /api/vaults/{vaultId}/notes/move", h.moveNote)
	mux.HandleFunc("GET /api/vaults/{vaultId}/notes/{id}", h.getNote)
	mux.HandleFunc("PUT /api/vaults/{vaultId}/notes/{id}", h.updateNote)
	mux.HandleFunc("DELETE /api/vaults/{vaultId}/notes/{id}", h.deleteNote)

	// Vault-scoped folder routes
	mux.HandleFunc("POST /api/vaults/{vaultId}/folders", h.createFolder)
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

	// Task routes (vault-independent, scans all vaults)
	mux.HandleFunc("GET /api/tasks", h.listTasks)
	mux.HandleFunc("PUT /api/tasks", h.toggleTask)

	// AI proxy routes (vault-independent, forward to OpenAI-compatible APIs)
	mux.HandleFunc("POST /api/ai/chat", h.aiChat)
	mux.HandleFunc("POST /api/ai/test", h.aiTest)

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
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Path      string   `json:"path"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
	Tags      []string `json:"tags"`
	Body      string   `json:"body"`
}

func toPayload(d notes.Document) Payload {
	return Payload{
		ID:        d.Meta.ID,
		Title:     d.Meta.Title,
		Path:       d.Meta.Path,
		CreatedAt: d.Meta.CreatedAt.Format(timeRFC3339Millis),
		UpdatedAt: d.Meta.UpdatedAt.Format(timeRFC3339Millis),
		Tags:      d.Meta.Tags,
		Body:      d.Body,
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
	for _, v := range vaults {
		store, err := h.Registry.Store(v.ID)
		if err != nil {
			continue
		}
		tasks, err := store.Tasks()
		if err != nil {
			continue
		}
		for _, t := range tasks {
			result = append(result, TaskPayload{
				VaultID:   v.ID,
				VaultName: v.Name,
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
	store, err := h.Registry.Store(in.VaultID)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	doc, err := store.SetTaskChecked(in.NoteID, in.Line, in.Checked)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}
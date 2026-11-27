package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"nexote/notes"
)

// The server's sync API for paired devices (bearer token, see
// authenticate). Every route wraps one sync primitive for the device's
// user. Errors carry a "code" next to the usual "error" text, so the app
// can tell a stale expectation ("conflict", retried next round) from a
// change the server won't make ("refused", left as it is).
//
//	GET    /api/sync/structure                        → SyncStructure
//	PUT    /api/sync/prefs                            {key: value} → 204
//	PUT    /api/sync/spaces/{id}                      SyncSpace → 204
//	DELETE /api/sync/spaces/{id}                      → 204
//	PUT    /api/sync/vaults/{id}                      SyncVault → 204
//	DELETE /api/sync/vaults/{id}                      → 204
//	PUT    /api/sync/spaces/{id}/collections/{col}    notes.CollectionMeta → 204
//	DELETE /api/sync/spaces/{id}/collections/{col}    → 204
//	GET    /api/sync/scopes/{scope}                   → SyncManifest
//	GET    /api/sync/scopes/{scope}/notes/{id}        → SyncNote
//	PUT    /api/sync/scopes/{scope}/notes/{id}        {"note": SyncNote, "expect": hash} → SyncNoteInfo
//	DELETE /api/sync/scopes/{scope}/notes/{id}?expect=hash → 204
//	GET    /api/sync/scopes/{scope}/attachments/{path...} → bytes
//	PUT    /api/sync/scopes/{scope}/attachments/{path...} bytes → 204
//	DELETE /api/sync/scopes/{scope}/attachments/{path...} → 204
//	POST   /api/sync/scopes/{scope}/folders           SyncFolderChange → 204
//	PUT    /api/sync/scopes/{scope}/lists             SyncLists → 204
//	POST   /api/sync/done                             → {"lastSyncAt": time}

// maxSyncAttachment bounds an uploaded attachment (PDFs may be 50 MB).
const maxSyncAttachment = 64 << 20

func (h *Handler) syncRoutes(mux *http.ServeMux) {
	route := func(pattern string, fn http.HandlerFunc) { mux.HandleFunc(pattern, h.serverOnly(fn)) }
	route("GET /api/sync/structure", h.syncStructureRoute)
	route("PUT /api/sync/prefs", h.syncPrefsRoute)
	route("PUT /api/sync/spaces/{id}", h.syncPutSpaceRoute)
	route("DELETE /api/sync/spaces/{id}", h.syncDeleteSpaceRoute)
	route("PUT /api/sync/vaults/{id}", h.syncPutVaultRoute)
	route("DELETE /api/sync/vaults/{id}", h.syncDeleteVaultRoute)
	route("PUT /api/sync/spaces/{id}/collections/{col}", h.syncPutCollectionRoute)
	route("DELETE /api/sync/spaces/{id}/collections/{col}", h.syncDeleteCollectionRoute)
	route("GET /api/sync/scopes/{scope}", h.syncManifestRoute)
	route("GET /api/sync/scopes/{scope}/notes/{id}", h.syncGetNoteRoute)
	route("PUT /api/sync/scopes/{scope}/notes/{id}", h.syncPutNoteRoute)
	route("DELETE /api/sync/scopes/{scope}/notes/{id}", h.syncDeleteNoteRoute)
	route("GET /api/sync/scopes/{scope}/attachments/{path...}", h.syncGetAttachmentRoute)
	route("PUT /api/sync/scopes/{scope}/attachments/{path...}", h.syncPutAttachmentRoute)
	route("DELETE /api/sync/scopes/{scope}/attachments/{path...}", h.syncDeleteAttachmentRoute)
	route("POST /api/sync/scopes/{scope}/folders", h.syncFoldersRoute)
	route("PUT /api/sync/scopes/{scope}/lists", h.syncListsRoute)
	route("POST /api/sync/done", h.syncDoneRoute)
}

// writeSyncError maps a primitive's error to a status and code.
func writeSyncError(w http.ResponseWriter, err error) {
	status, code := http.StatusInternalServerError, ""
	switch {
	case errors.Is(err, ErrSyncConflict):
		status, code = http.StatusConflict, "conflict"
	case errors.Is(err, ErrSyncRefused):
		status, code = http.StatusConflict, "refused"
	case errors.Is(err, ErrSyncUnreadable):
		status, code = http.StatusUnprocessableEntity, "unreadable"
	case errors.Is(err, notes.ErrNotFound):
		status, code = http.StatusNotFound, "not-found"
	case errors.Is(err, notes.ErrInvalidID):
		status, code = http.StatusBadRequest, "invalid"
	}
	writeJSON(w, status, map[string]string{"error": err.Error(), "code": code})
}

func syncDone(w http.ResponseWriter, err error) {
	if err != nil {
		writeSyncError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func syncDecode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSyncAttachment)).Decode(dst); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error(), "code": "invalid"})
		return false
	}
	return true
}

func (h *Handler) syncStructureRoute(w http.ResponseWriter, r *http.Request) {
	s, err := h.SyncStructure(currentUser(r).ID)
	if err != nil {
		writeSyncError(w, err)
		return
	}
	s.Device = &SyncDevice{LastSyncAt: currentDevice(r).LastSyncAt}
	writeJSON(w, http.StatusOK, s)
}

func (h *Handler) syncPrefsRoute(w http.ResponseWriter, r *http.Request) {
	var prefs map[string]string
	if syncDecode(w, r, &prefs) {
		syncDone(w, h.SyncPutPrefs(currentUser(r).ID, prefs))
	}
}

func (h *Handler) syncPutSpaceRoute(w http.ResponseWriter, r *http.Request) {
	var in SyncSpace
	if syncDecode(w, r, &in) {
		in.ID = r.PathValue("id")
		syncDone(w, h.SyncPutSpace(currentUser(r).ID, in))
	}
}

func (h *Handler) syncDeleteSpaceRoute(w http.ResponseWriter, r *http.Request) {
	syncDone(w, h.SyncDeleteSpace(currentUser(r).ID, r.PathValue("id")))
}

func (h *Handler) syncPutVaultRoute(w http.ResponseWriter, r *http.Request) {
	var in SyncVault
	if syncDecode(w, r, &in) {
		in.ID = r.PathValue("id")
		syncDone(w, h.SyncPutVault(currentUser(r).ID, in))
	}
}

func (h *Handler) syncDeleteVaultRoute(w http.ResponseWriter, r *http.Request) {
	syncDone(w, h.SyncDeleteVault(currentUser(r).ID, r.PathValue("id")))
}

func (h *Handler) syncPutCollectionRoute(w http.ResponseWriter, r *http.Request) {
	var col notes.CollectionMeta
	if syncDecode(w, r, &col) {
		col.ID = r.PathValue("col")
		syncDone(w, h.SyncPutCollection(currentUser(r).ID, r.PathValue("id"), col))
	}
}

func (h *Handler) syncDeleteCollectionRoute(w http.ResponseWriter, r *http.Request) {
	syncDone(w, h.SyncDeleteCollection(currentUser(r).ID, r.PathValue("id"), r.PathValue("col")))
}

func (h *Handler) syncManifestRoute(w http.ResponseWriter, r *http.Request) {
	m, err := h.SyncManifest(currentUser(r).ID, r.PathValue("scope"))
	if err != nil {
		writeSyncError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (h *Handler) syncGetNoteRoute(w http.ResponseWriter, r *http.Request) {
	n, err := h.SyncGetNote(currentUser(r).ID, r.PathValue("scope"), r.PathValue("id"))
	if err != nil {
		writeSyncError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, n)
}

func (h *Handler) syncPutNoteRoute(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Note   SyncNote `json:"note"`
		Expect string   `json:"expect"`
	}
	if !syncDecode(w, r, &in) {
		return
	}
	in.Note.Meta.ID = r.PathValue("id")
	info, err := h.SyncPutNote(currentUser(r).ID, r.PathValue("scope"), in.Note, in.Expect)
	if err != nil {
		writeSyncError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (h *Handler) syncDeleteNoteRoute(w http.ResponseWriter, r *http.Request) {
	syncDone(w, h.SyncDeleteNote(currentUser(r).ID, r.PathValue("scope"), r.PathValue("id"), r.URL.Query().Get("expect")))
}

func (h *Handler) syncGetAttachmentRoute(w http.ResponseWriter, r *http.Request) {
	data, err := h.SyncReadAttachment(currentUser(r).ID, r.PathValue("scope"), r.PathValue("path"))
	if err != nil {
		writeSyncError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	_, _ = w.Write(data)
}

func (h *Handler) syncPutAttachmentRoute(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxSyncAttachment))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error(), "code": "invalid"})
		return
	}
	syncDone(w, h.SyncWriteAttachment(currentUser(r).ID, r.PathValue("scope"), r.PathValue("path"), data))
}

func (h *Handler) syncDeleteAttachmentRoute(w http.ResponseWriter, r *http.Request) {
	syncDone(w, h.SyncDeleteAttachment(currentUser(r).ID, r.PathValue("scope"), r.PathValue("path")))
}

func (h *Handler) syncFoldersRoute(w http.ResponseWriter, r *http.Request) {
	var in SyncFolderChange
	if syncDecode(w, r, &in) {
		syncDone(w, h.SyncChangeFolders(currentUser(r).ID, r.PathValue("scope"), in))
	}
}

func (h *Handler) syncListsRoute(w http.ResponseWriter, r *http.Request) {
	var in SyncLists
	if syncDecode(w, r, &in) {
		syncDone(w, h.SyncPutLists(currentUser(r).ID, r.PathValue("scope"), in))
	}
}

// syncDoneRoute records that the device finished a sync (shown in the
// server's device list).
func (h *Handler) syncDoneRoute(w http.ResponseWriter, r *http.Request) {
	at, err := h.Accounts.TouchDeviceSync(currentUser(r).ID, currentDevice(r).ID)
	if err != nil {
		writeAccountError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]time.Time{"lastSyncAt": at})
}

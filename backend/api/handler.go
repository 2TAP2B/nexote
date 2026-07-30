// Package api wires the notes store to HTTP handlers and exposes a small
// REST surface consumed by the Next.js frontend.
package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"nexote/notes"
)

// Handler holds the dependencies shared across all routes.
type Handler struct {
	Store *notes.Store
}

// New creates a Handler backed by the given store.
func New(s *notes.Store) *Handler {
	return &Handler{Store: s}
}

// Routes returns an http.Handler serving the /api/* REST surface with CORS
// and preflight handling applied.
func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/notes", h.list)
	mux.HandleFunc("POST /api/notes", h.create)
	mux.HandleFunc("POST /api/folders", h.createFolder)
	mux.HandleFunc("DELETE /api/folders/{path...}", h.deleteFolder)
	mux.HandleFunc("GET /api/notes/daily", h.daily)
	mux.HandleFunc("GET /api/notes/{id}", h.get)
	mux.HandleFunc("PUT /api/notes/{id}", h.update)
	mux.HandleFunc("DELETE /api/notes/{id}", h.delete)

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

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	result, err := h.Store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var in notes.CreateInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := h.Store.Create(in)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, toPayload(doc))
}

func (h *Handler) createFolder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := h.Store.CreateFolder(in.Path); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"path": in.Path})
}

func (h *Handler) deleteFolder(w http.ResponseWriter, r *http.Request) {
	folderPath := r.PathValue("path")
	if err := h.Store.DeleteFolder(folderPath); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) daily(w http.ResponseWriter, r *http.Request) {
	doc, err := h.Store.Daily()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	doc, err := h.Store.Get(id)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in notes.UpdateInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	doc, err := h.Store.Update(id, in)
	if err != nil {
		h.writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPayload(doc))
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.Store.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, notes.ErrNotFound) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeError(w, http.StatusInternalServerError, err)
}

// Payload is the JSON shape returned for a single note.
type Payload struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Path      string `json:"path"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	Body      string `json:"body"`
}

func toPayload(d notes.Document) Payload {
	return Payload{
		ID:        d.Meta.ID,
		Title:     d.Meta.Title,
		Path:      d.Meta.Path,
		CreatedAt: d.Meta.CreatedAt.Format(timeRFC3339Millis),
		UpdatedAt: d.Meta.UpdatedAt.Format(timeRFC3339Millis),
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
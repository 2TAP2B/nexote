package serversync

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync"
)

// Handler serves the page's routes: GET and DELETE /api/local/sync, POST
// /api/local/sync/pair. The engine mounts it behind its secret cookie.
func (s *Service) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/local/sync", s.handleStatus)
	mux.HandleFunc("DELETE /api/local/sync", s.handleDisconnect)
	mux.HandleFunc("POST /api/local/sync/pair", s.handlePair)
	return mux
}

func (s *Service) handleStatus(w http.ResponseWriter, r *http.Request) {
	c, err := s.status(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, statusBody(c))
}

func (s *Service) handlePair(w http.ResponseWriter, r *http.Request) {
	var in pairInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("The request isn't valid JSON."))
		return
	}
	c, err := s.pair(r.Context(), in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, statusBody(c))
}

func (s *Service) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	if err := s.disconnect(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, statusBody(nil))
}

type disconnectedStatus struct {
	Connected bool `json:"connected"`
}

type statusUser struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type connectedStatus struct {
	Connected bool       `json:"connected"`
	Server    string     `json:"server"`
	User      statusUser `json:"user"`
	Device    Device     `json:"device"`
	Revoked   bool       `json:"revoked"`
}

// statusBody is the page's view of a connection (nil: none). The token
// never leaves the engine.
func statusBody(c *credentials) any {
	if c == nil {
		return disconnectedStatus{}
	}
	return connectedStatus{
		Connected: true,
		Server:    c.Server,
		User:      statusUser{Username: c.User.Username, DisplayName: c.User.DisplayName},
		Device:    c.Device,
		Revoked:   c.Revoked,
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

// MemoryHost keeps secrets in memory: for tests and engines started without
// a host, where a connection only lasts as long as the process.
type MemoryHost struct {
	name    string
	mu      sync.Mutex
	secrets map[string]string
}

// NewMemoryHost returns an empty MemoryHost naming the device deviceName.
func NewMemoryHost(deviceName string) *MemoryHost {
	return &MemoryHost{name: deviceName, secrets: map[string]string{}}
}

// LoadSecret implements Host.
func (h *MemoryHost) LoadSecret(name string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.secrets[name], nil
}

// SaveSecret implements Host.
func (h *MemoryHost) SaveSecret(name, value string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if value == "" {
		delete(h.secrets, name)
	} else {
		h.secrets[name] = value
	}
	return nil
}

// DeviceName implements Host.
func (h *MemoryHost) DeviceName() string { return h.name }

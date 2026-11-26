package engine

import (
	"encoding/json"
	"encoding/pem"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"nexote/engine/serversync"
)

const pairToken = "device-token-that-must-stay-out-of-the-folder"

// pairingServer is a minimal Nexote server for one device: it accepts one
// code, answers hello for its token and records unpairing.
func pairingServer(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	var mu sync.Mutex
	var unpaired []string
	used := false
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/pair", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Code, Name, Platform string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		mu.Lock()
		defer mu.Unlock()
		if used || in.Code != "ABCD-EFGH-JKMN-PQRS" || in.Platform != "android" {
			http.Error(w, `{"error":"This code is invalid or has expired. Create a new one on the server."}`, http.StatusBadRequest)
			return
		}
		used = true
		_ = json.NewEncoder(w).Encode(map[string]any{
			"token":  pairToken,
			"device": map[string]string{"id": "d1", "name": in.Name},
			"user":   map[string]string{"id": "u1", "username": "alice", "displayName": "Alice"},
		})
	})
	mux.HandleFunc("GET /api/sync/hello", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+pairToken {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"device": map[string]string{"id": "d1", "name": "Test phone"},
			"user":   map[string]string{"id": "u1", "username": "alice", "displayName": "Alice"},
		})
	})
	mux.HandleFunc("DELETE /api/sync/device", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		unpaired = append(unpaired, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		w.WriteHeader(http.StatusNoContent)
	})
	srv := httptest.NewTLSServer(mux)
	t.Cleanup(srv.Close)
	return srv, &unpaired
}

func TestPairingKeepsCredentialsInTheHost(t *testing.T) {
	srv, unpaired := pairingServer(t)
	home := t.TempDir()
	host := serversync.NewMemoryHost("Test phone")
	ca := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw}))
	e, err := Start(Config{Home: home, Secret: testSecret, Web: testWeb, Host: host, UserCAs: ca})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Stop)

	link := `{"link":"` + srv.URL + `/pair#ABCD-EFGH-JKMN-PQRS"}`
	origin := map[string]string{"Origin": e.url(""), "Content-Type": "application/json"}
	foreign := map[string]string{"Origin": "http://evil.example", "Content-Type": "application/json"}

	expectStatus(t, request(t, e, "GET", "/api/local/sync", "", "", nil), http.StatusForbidden, "status without the cookie")
	expectStatus(t, request(t, e, "POST", "/api/local/sync/pair", "", link, origin), http.StatusForbidden, "pair without the cookie")
	expectStatus(t, request(t, e, "POST", "/api/local/sync/pair", testSecret, link, foreign), http.StatusForbidden, "pair from another origin")
	if res := get(t, e, "/api/local/sync"); res.status != http.StatusOK || strings.TrimSpace(res.body) != `{"connected":false}` {
		t.Fatalf("before pairing: %d %s", res.status, res.body)
	}

	res := request(t, e, "POST", "/api/local/sync/pair", testSecret, link, origin)
	expectStatus(t, res, http.StatusOK, "pair")
	if strings.Contains(res.body, pairToken) {
		t.Error("the token reached the page")
	}
	var state struct {
		Connected bool   `json:"connected"`
		Server    string `json:"server"`
		Revoked   bool   `json:"revoked"`
		Device    struct {
			ID string `json:"id"`
		} `json:"device"`
	}
	if err := json.Unmarshal([]byte(res.body), &state); err != nil || !state.Connected || state.Server != srv.URL || state.Device.ID != "d1" || state.Revoked {
		t.Fatalf("pair: %s (%v)", res.body, err)
	}

	if saved, _ := host.LoadSecret("sync"); !strings.Contains(saved, pairToken) || !strings.Contains(saved, srv.URL) {
		t.Errorf("host secret %q, want the connection", saved)
	}
	err = filepath.WalkDir(home, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := os.ReadFile(path)
		if err == nil && strings.Contains(string(data), pairToken) {
			t.Errorf("the token is in the data folder: %s", path)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	res = request(t, e, "DELETE", "/api/local/sync", testSecret, "", origin)
	expectStatus(t, res, http.StatusOK, "disconnect")
	if strings.TrimSpace(res.body) != `{"connected":false}` {
		t.Errorf("disconnect: %s", res.body)
	}
	if len(*unpaired) != 1 || (*unpaired)[0] != pairToken {
		t.Errorf("server unpaired %v", *unpaired)
	}
	if saved, _ := host.LoadSecret("sync"); saved != "" {
		t.Errorf("host still holds %q", saved)
	}
}

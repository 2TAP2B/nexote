package serversync

import (
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testCode    = "ABCD-EFGH-JKMN-PQRS"
	invalidCode = "This code is invalid or has expired. Create a new one on the server."
)

// fakeServer implements the parts of a Nexote server's API a device uses:
// pairing, hello and unpairing.
type fakeServer struct {
	*httptest.Server
	mu          sync.Mutex
	codes       map[string]bool
	tokens      map[string]string // token → device id
	names       []string
	platforms   []string
	hellos      int
	unpaired    []string
	helloStatus int // answer every hello with this status when set
}

func newFakeServer(t *testing.T, useTLS bool) *fakeServer {
	t.Helper()
	f := &fakeServer{codes: map[string]bool{testCode: true}, tokens: map[string]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/pair", f.pair)
	mux.HandleFunc("GET /api/sync/hello", f.hello)
	mux.HandleFunc("DELETE /api/sync/device", f.unpair)
	if useTLS {
		f.Server = httptest.NewTLSServer(mux)
	} else {
		f.Server = httptest.NewServer(mux)
	}
	t.Cleanup(f.Close)
	return f
}

// caPEM is the fake server's certificate, to trust as a user CA.
func (f *fakeServer) caPEM() string {
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: f.Certificate().Raw}))
}

func (f *fakeServer) addCode(code string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.codes[code] = true
}

func (f *fakeServer) revokeAll() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tokens = map[string]string{}
}

func (f *fakeServer) helloCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hellos
}

func (f *fakeServer) pair(w http.ResponseWriter, r *http.Request) {
	var in pairRequest
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.codes[in.Code] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, `{"error":%q}`, invalidCode)
		return
	}
	delete(f.codes, in.Code)
	f.names = append(f.names, in.Name)
	f.platforms = append(f.platforms, in.Platform)
	n := len(f.names)
	token, device := fmt.Sprintf("token-%d-secret", n), fmt.Sprintf("dev%d", n)
	f.tokens[token] = device
	_ = json.NewEncoder(w).Encode(pairResponse{
		Token:  token,
		Device: Device{ID: device, Name: in.Name},
		User:   User{ID: "u1", Username: "alice", DisplayName: "Alice"},
		Origin: f.URL,
	})
}

func (f *fakeServer) device(r *http.Request) (string, string, bool) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	id, ok := f.tokens[token]
	return token, id, ok
}

func (f *fakeServer) hello(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hellos++
	if f.helloStatus != 0 {
		http.Error(w, `{"error":"broken"}`, f.helloStatus)
		return
	}
	_, id, ok := f.device(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	_ = json.NewEncoder(w).Encode(helloResponse{
		User:   User{ID: "u1", Username: "alice", DisplayName: "Alice A."},
		Device: Device{ID: id, Name: "Renamed"},
		Origin: f.URL,
	})
}

func (f *fakeServer) unpair(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	token, _, ok := f.device(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	delete(f.tokens, token)
	f.unpaired = append(f.unpaired, token)
	w.WriteHeader(http.StatusNoContent)
}

// clock is a settable time for the re-check interval.
type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func newTestService(t *testing.T, userCAs string) (*Service, *MemoryHost, *clock) {
	t.Helper()
	host := NewMemoryHost("Google Pixel 8")
	s := New(host, userCAs)
	c := &clock{now: time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)}
	s.now = c.Now
	return s, host, c
}

type answer struct {
	Error     string `json:"error"`
	Connected bool   `json:"connected"`
	Server    string `json:"server"`
	User      *struct {
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
	} `json:"user"`
	Device  *Device `json:"device"`
	Revoked *bool   `json:"revoked"`
}

func call(t *testing.T, s *Service, method, path, body string) (int, answer) {
	t.Helper()
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	var a answer
	if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil {
		t.Fatalf("%s %s: %v (body %s)", method, path, err, rec.Body)
	}
	return rec.Code, a
}

func pairLink(t *testing.T, s *Service, link string) (int, answer) {
	t.Helper()
	body, _ := json.Marshal(pairInput{Link: link})
	return call(t, s, http.MethodPost, "/api/local/sync/pair", string(body))
}

func savedConnection(t *testing.T, host *MemoryHost) *credentials {
	t.Helper()
	raw, _ := host.LoadSecret(secretName)
	if raw == "" {
		return nil
	}
	var c credentials
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatal(err)
	}
	return &c
}

func TestPairSavesTheConnectionInTheHost(t *testing.T) {
	f := newFakeServer(t, true)
	s, host, _ := newTestService(t, f.caPEM())

	if code, a := call(t, s, http.MethodGet, "/api/local/sync", ""); code != http.StatusOK || a.Connected || a.Revoked != nil {
		t.Fatalf("before pairing: %d %+v", code, a)
	}
	code, a := pairLink(t, s, f.URL+"/pair#abcd efgh jkmn pqrs")
	if code != http.StatusOK || !a.Connected || a.Server != f.URL || a.Revoked == nil || *a.Revoked {
		t.Fatalf("pair: %d %+v", code, a)
	}
	if a.User == nil || a.User.Username != "alice" || a.User.DisplayName != "Alice A." || a.Device == nil || a.Device.ID != "dev1" {
		t.Errorf("pair: user %+v device %+v, want hello's", a.User, a.Device)
	}
	f.mu.Lock()
	names, platforms := f.names, f.platforms
	f.mu.Unlock()
	if len(names) != 1 || names[0] != "Google Pixel 8" || platforms[0] != "android" {
		t.Errorf("server saw names %v platforms %v", names, platforms)
	}
	saved := savedConnection(t, host)
	if saved == nil || saved.Token != "token-1-secret" || saved.Server != f.URL || saved.Device.ID != "dev1" || saved.User.ID != "u1" {
		t.Fatalf("saved connection %+v", saved)
	}

	// The code is used up; the server's sentence reaches the page.
	if code, a := pairLink(t, s, f.URL+"/pair#"+testCode); code != http.StatusBadRequest || a.Error != invalidCode {
		t.Errorf("reused code: %d %+v", code, a)
	}
	if saved := savedConnection(t, host); saved == nil || saved.Token != "token-1-secret" {
		t.Errorf("a failed pairing changed the saved connection: %+v", saved)
	}
}

func TestPairWithServerAndCodeOverLocalhostHTTP(t *testing.T) {
	f := newFakeServer(t, false)
	s, host, _ := newTestService(t, "")
	body, _ := json.Marshal(pairInput{Server: f.URL + "/ignored/path", Code: "abcdefghjkmnpqrs"})
	code, a := call(t, s, http.MethodPost, "/api/local/sync/pair", string(body))
	if code != http.StatusOK || !a.Connected || a.Server != f.URL {
		t.Fatalf("pair: %d %+v", code, a)
	}
	if savedConnection(t, host) == nil {
		t.Error("nothing saved")
	}
}

func TestPairErrors(t *testing.T) {
	f := newFakeServer(t, true)
	closed := httptest.NewServer(http.NotFoundHandler())
	closedURL := closed.URL
	closed.Close()

	for name, tc := range map[string]struct {
		cas, link, want string
	}{
		"untrusted certificate": {"", f.URL + "/pair#" + testCode, "isn't trusted"},
		"plain http":            {"", "http://notes.example.com/pair#" + testCode, "https://"},
		"no code":               {"", f.URL + "/pair", "isn't a pairing link"},
		"unreachable":           {"", closedURL + "/pair#" + testCode, "Can't reach"},
		"rejected code":         {"", newFakeServer(t, false).URL + "/elsewhere#0000-0000-0000-0000", invalidCode},
	} {
		s, host, _ := newTestService(t, tc.cas)
		code, a := pairLink(t, s, tc.link)
		if code != http.StatusBadRequest || !strings.Contains(a.Error, tc.want) {
			t.Errorf("%s: %d %q, want 400 with %q", name, code, a.Error, tc.want)
		}
		if savedConnection(t, host) != nil {
			t.Errorf("%s: saved a connection", name)
		}
	}

	missing := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(missing.Close)
	s, _, _ := newTestService(t, "")
	if code, a := pairLink(t, s, missing.URL+"/pair#"+testCode); code != http.StatusBadRequest || !strings.Contains(a.Error, "doesn't offer device pairing") {
		t.Errorf("server without pairing: %d %q", code, a.Error)
	}
}

func TestRevokedTokenIsNoticedWithinAMinute(t *testing.T) {
	f := newFakeServer(t, true)
	s, host, clk := newTestService(t, f.caPEM())
	if code, a := pairLink(t, s, f.URL+"/pair#"+testCode); code != http.StatusOK {
		t.Fatalf("pair: %d %+v", code, a)
	}
	hellos := f.helloCount()

	f.revokeAll()
	if _, a := call(t, s, http.MethodGet, "/api/local/sync", ""); *a.Revoked || f.helloCount() != hellos {
		t.Fatalf("right after pairing: revoked %v, %d hellos; want no new check", *a.Revoked, f.helloCount()-hellos)
	}
	clk.advance(recheckInterval)
	_, a := call(t, s, http.MethodGet, "/api/local/sync", "")
	if !a.Connected || a.Revoked == nil || !*a.Revoked {
		t.Fatalf("after a minute: %+v, want connected and revoked", a)
	}
	if saved := savedConnection(t, host); saved == nil || !saved.Revoked {
		t.Errorf("saved connection %+v, want kept and marked revoked", saved)
	}
	// A revoked token stays revoked; the server isn't asked again.
	hellos = f.helloCount()
	clk.advance(2 * recheckInterval)
	call(t, s, http.MethodGet, "/api/local/sync", "")
	if f.helloCount() != hellos {
		t.Error("asked the server again about a revoked token")
	}

	// Pairing again replaces the revoked connection.
	f.addCode("0000-0000-0000-0001")
	if code, a := pairLink(t, s, f.URL+"/pair#0000-0000-0000-0001"); code != http.StatusOK || *a.Revoked {
		t.Fatalf("pair again: %d %+v", code, a)
	}
}

func TestServerErrorDoesNotRevoke(t *testing.T) {
	f := newFakeServer(t, true)
	s, _, clk := newTestService(t, f.caPEM())
	if code, a := pairLink(t, s, f.URL+"/pair#"+testCode); code != http.StatusOK {
		t.Fatalf("pair: %d %+v", code, a)
	}
	f.mu.Lock()
	f.helloStatus = http.StatusInternalServerError
	f.mu.Unlock()
	clk.advance(recheckInterval)
	if _, a := call(t, s, http.MethodGet, "/api/local/sync", ""); !a.Connected || *a.Revoked {
		t.Fatalf("after a server error: %+v, want connected, not revoked", a)
	}
	if f.helloCount() < 2 {
		t.Error("the server wasn't asked")
	}
}

func TestDisconnectUnpairsAndForgets(t *testing.T) {
	f := newFakeServer(t, true)
	s, host, _ := newTestService(t, f.caPEM())
	if code, a := pairLink(t, s, f.URL+"/pair#"+testCode); code != http.StatusOK {
		t.Fatalf("pair: %d %+v", code, a)
	}
	code, a := call(t, s, http.MethodDelete, "/api/local/sync", "")
	if code != http.StatusOK || a.Connected || a.Revoked != nil {
		t.Fatalf("disconnect: %d %+v", code, a)
	}
	f.mu.Lock()
	unpaired := f.unpaired
	f.mu.Unlock()
	if len(unpaired) != 1 || unpaired[0] != "token-1-secret" {
		t.Errorf("server unpaired %v", unpaired)
	}
	if raw, _ := host.LoadSecret(secretName); raw != "" {
		t.Errorf("host still holds %q", raw)
	}
	if _, a := call(t, s, http.MethodGet, "/api/local/sync", ""); a.Connected {
		t.Error("still connected after disconnect")
	}
}

func TestDisconnectFromAnUnreachableServerStillForgets(t *testing.T) {
	f := newFakeServer(t, true)
	s, host, _ := newTestService(t, f.caPEM())
	if code, a := pairLink(t, s, f.URL+"/pair#"+testCode); code != http.StatusOK {
		t.Fatalf("pair: %d %+v", code, a)
	}
	f.Close()
	if code, a := call(t, s, http.MethodDelete, "/api/local/sync", ""); code != http.StatusOK || a.Connected {
		t.Fatalf("disconnect: %d %+v", code, a)
	}
	if savedConnection(t, host) != nil {
		t.Error("connection kept")
	}
}

func TestLoadCertDirReadsAndroidFiles(t *testing.T) {
	f := newFakeServer(t, true)
	dir := t.TempDir()
	// Android's cacerts files start with a text dump of the certificate.
	data := "Certificate:\n    Data:\n        Version: 3 (0x2)\n" + f.caPEM()
	if err := os.WriteFile(filepath.Join(dir, "a1b2c3d4.0"), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "README"), []byte("not a certificate"), 0o644); err != nil {
		t.Fatal(err)
	}
	pool := baseRoots()
	if n := loadCertDir(pool, dir); n != 1 {
		t.Fatalf("loaded %d certificates, want 1", n)
	}
	if n := loadCertDir(pool, dir+"/missing"); n != 0 {
		t.Errorf("loaded %d from a missing directory", n)
	}
}

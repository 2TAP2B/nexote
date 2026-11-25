package engine

import (
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"nexote/accounts"
)

const testSecret = "s3cret"

var testWeb = fstest.MapFS{
	"index.html":                {Data: []byte("INDEX")},
	"404.html":                  {Data: []byte("NOT FOUND PAGE")},
	"settings.html":             {Data: []byte("SETTINGS")},
	"docs/index.html":           {Data: []byte("DOCS")},
	"manifest.webmanifest":      {Data: []byte("{}")},
	"_next/static/chunk-abc.js": {Data: []byte("console.log(1)")},
	".gitignore":                {Data: []byte("*\n")},
}

func startEngine(t *testing.T, home string) *Engine {
	t.Helper()
	e, err := Start(Config{Home: home, Secret: testSecret, Web: testWeb})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Stop)
	return e
}

// client never follows redirects, so tests see them.
var client = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func (e *Engine) url(path string) string {
	return "http://127.0.0.1:" + strconv.Itoa(e.Port()) + path
}

type response struct {
	status int
	header http.Header
	body   string
}

func request(t *testing.T, e *Engine, method, path, cookie, body string, header map[string]string) response {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, e.url(path), r)
	if err != nil {
		t.Fatal(err)
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: CookieName, Value: cookie})
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return response{status: res.StatusCode, header: res.Header, body: string(data)}
}

func get(t *testing.T, e *Engine, path string) response {
	t.Helper()
	return request(t, e, "GET", path, testSecret, "", nil)
}

func expectStatus(t *testing.T, res response, status int, what string) {
	t.Helper()
	if res.status != status {
		t.Errorf("%s: status %d, want %d (body %s)", what, res.status, status, strings.TrimSpace(res.body))
	}
}

func TestSecretCookieGatesEverything(t *testing.T) {
	e := startEngine(t, t.TempDir())
	for _, path := range []string{"/", "/api/auth/status", "/_next/static/chunk-abc.js"} {
		expectStatus(t, request(t, e, "GET", path, "", "", nil), http.StatusForbidden, "no cookie "+path)
		expectStatus(t, request(t, e, "GET", path, "wrong", "", nil), http.StatusForbidden, "wrong cookie "+path)
		expectStatus(t, request(t, e, "GET", path, testSecret, "", nil), http.StatusOK, "right cookie "+path)
	}
}

func TestStaticExportRoutes(t *testing.T) {
	e := startEngine(t, t.TempDir())

	for path, want := range map[string]string{
		"/":                     "INDEX",
		"/index.html":           "INDEX",
		"/settings":             "SETTINGS",
		"/docs":                 "DOCS",
		"/note/vault1/note1":    "INDEX",
		"/journal/note1":        "INDEX",
		"/dashboard":            "INDEX",
		"/manifest.webmanifest": "{}",
	} {
		res := get(t, e, path)
		expectStatus(t, res, http.StatusOK, path)
		if res.body != want {
			t.Errorf("%s: body %q, want %q", path, res.body, want)
		}
	}

	for path, want := range map[string]string{"/m/x": "/x", "/m": "/", "/m/note/a/b?x=1": "/note/a/b?x=1", "/m//evil.example": "/evil.example"} {
		res := get(t, e, path)
		expectStatus(t, res, http.StatusFound, path)
		if loc := res.header.Get("Location"); loc != want {
			t.Errorf("%s: redirects to %q, want %q", path, loc, want)
		}
	}

	chunk := get(t, e, "/_next/static/chunk-abc.js")
	if cc := chunk.header.Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("build file Cache-Control %q, want immutable", cc)
	}
	if ct := chunk.header.Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Errorf("build file Content-Type %q", ct)
	}
	index := get(t, e, "/")
	if cc := index.header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("index Cache-Control %q, want no-cache", cc)
	}
	if ct := index.header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("index Content-Type %q", ct)
	}
	if ct := get(t, e, "/manifest.webmanifest").header.Get("Content-Type"); ct != "application/manifest+json" {
		t.Errorf("manifest Content-Type %q", ct)
	}

	for _, path := range []string{"/nope", "/note/only-vault", "/journal", "/.gitignore", "/_next/static/missing.js"} {
		res := get(t, e, path)
		expectStatus(t, res, http.StatusNotFound, path)
		if res.body != "NOT FOUND PAGE" {
			t.Errorf("%s: body %q, want the 404 page", path, res.body)
		}
	}
}

type authStatus struct {
	SetupRequired bool `json:"setupRequired"`
	Local         bool `json:"local"`
	User          *struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Role     string `json:"role"`
	} `json:"user"`
}

func status(t *testing.T, e *Engine) authStatus {
	t.Helper()
	res := get(t, e, "/api/auth/status")
	expectStatus(t, res, http.StatusOK, "auth status")
	var s authStatus
	if err := json.Unmarshal([]byte(res.body), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

// notesVault returns the id of a notes (not collections) vault the local
// user can write to.
func notesVault(t *testing.T, e *Engine) string {
	t.Helper()
	res := get(t, e, "/api/vaults")
	expectStatus(t, res, http.StatusOK, "list vaults")
	var out struct {
		Vaults []struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"vaults"`
	}
	if err := json.Unmarshal([]byte(res.body), &out); err != nil {
		t.Fatal(err)
	}
	for _, v := range out.Vaults {
		if v.Type != "collections" {
			return v.ID
		}
	}
	t.Fatalf("no notes vault in %s", res.body)
	return ""
}

func TestLocalModeNeedsNoLogin(t *testing.T) {
	home := t.TempDir()
	e := startEngine(t, home)

	s := status(t, e)
	if !s.Local || s.SetupRequired || s.User == nil || s.User.Username != "me" || s.User.Role != "admin" {
		t.Fatalf("auth status %+v, want local admin \"me\"", s)
	}

	origin := map[string]string{"Origin": e.url(""), "Content-Type": "application/json"}
	vault := notesVault(t, e)
	created := request(t, e, "POST", "/api/vaults/"+vault+"/notes", testSecret, `{"title":"Hello"}`, origin)
	expectStatus(t, created, http.StatusCreated, "create note")
	var note struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal([]byte(created.body), &note)
	memo := request(t, e, "POST", "/api/vaults/home/notes", testSecret, `{"title":"Memo"}`, origin)
	expectStatus(t, memo, http.StatusCreated, "create note in the personal home store")

	foreign := map[string]string{"Origin": "http://evil.example", "Content-Type": "application/json"}
	expectStatus(t, request(t, e, "POST", "/api/vaults/"+vault+"/notes", testSecret, `{"title":"X"}`, foreign),
		http.StatusForbidden, "change from another origin")

	expectStatus(t, request(t, e, "POST", "/api/auth/logout", testSecret, "", origin), http.StatusNoContent, "logout")
	if after := status(t, e); after.User == nil || after.User.ID != s.User.ID {
		t.Errorf("after logout: %+v, want still the local user", after)
	}

	// Restarting on the same folder finds the same user and data.
	e.Stop()
	again := startEngine(t, home)
	if s2 := status(t, again); s2.User == nil || s2.User.ID != s.User.ID {
		t.Fatalf("after restart: %+v, want user %s", s2, s.User.ID)
	}
	expectStatus(t, get(t, again, "/api/vaults/"+vault+"/notes/"+note.ID), http.StatusOK, "note after restart")
	accts, err := accounts.Open(filepath.Join(home, "auth"))
	if err != nil {
		t.Fatal(err)
	}
	if users, _ := accts.Users(); len(users) != 1 {
		t.Errorf("%d accounts after restart, want 1", len(users))
	}
}

func TestLocalModeUsesTheFoldersAdmin(t *testing.T) {
	home := t.TempDir()
	accts, err := accounts.Open(filepath.Join(home, "auth"))
	if err != nil {
		t.Fatal(err)
	}
	alice, err := accounts.NewUser("alice", "Alice", accounts.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if alice, err = accts.CreateUser(alice); err != nil {
		t.Fatal(err)
	}

	e := startEngine(t, home)
	if s := status(t, e); s.User == nil || s.User.ID != alice.ID {
		t.Fatalf("auth status %+v, want alice", s)
	}
}

func TestBusyPortFallsBack(t *testing.T) {
	first := startEngine(t, t.TempDir())
	second, err := Start(Config{Home: t.TempDir(), Port: first.Port(), Secret: testSecret, Web: testWeb})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(second.Stop)
	if second.Port() == first.Port() {
		t.Fatalf("both engines on port %d", first.Port())
	}
	expectStatus(t, get(t, second, "/"), http.StatusOK, "engine on the fallback port")
}

func TestEventStreamFlowsAndStopEndsIt(t *testing.T) {
	e := startEngine(t, t.TempDir())
	req, err := http.NewRequest("GET", e.url("/api/events"), nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: CookieName, Value: testSecret})
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("events: status %d", res.StatusCode)
	}
	// The greeting arrives while the stream stays open, so nothing buffers
	// the response.
	buf := make([]byte, len(": connected"))
	if _, err := io.ReadFull(res.Body, buf); err != nil || string(buf) != ": connected" {
		t.Fatalf("events: read %q, %v", buf, err)
	}

	stopped := make(chan struct{})
	go func() {
		e.Stop()
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(shutdownGrace / 2):
		t.Fatal("Stop waited for the open event stream")
	}
}

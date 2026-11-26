package mobile

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"nexote/engine"
	"nexote/engine/serversync"
)

func TestEngineReadsTheConnectionFromTheHost(t *testing.T) {
	t.Cleanup(Stop)
	t.Cleanup(func() { SetHost(nil) })
	host := serversync.NewMemoryHost("Test phone")
	// Nothing listens on port 1, so the engine's check of the token fails
	// as if offline and the saved state is shown as it is.
	saved := `{"server":"http://127.0.0.1:1","token":"t","device":{"id":"d1","name":"Test phone"},"user":{"id":"u1","username":"alice","displayName":"Alice"}}`
	if err := host.SaveSecret("sync", saved); err != nil {
		t.Fatal(err)
	}
	SetHost(host)
	SetUserCAs("")
	port, err := Start(t.TempDir(), 0, "s")
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest("GET", "http://127.0.0.1:"+strconv.Itoa(port)+"/api/local/sync", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: engine.CookieName, Value: "s"})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || !strings.Contains(string(body), `"connected":true`) || !strings.Contains(string(body), `"username":"alice"`) {
		t.Fatalf("status %d %s, want the host's connection", res.StatusCode, body)
	}
}

func authStatusCode(t *testing.T, port int, secret string) int {
	t.Helper()
	req, err := http.NewRequest("GET", "http://127.0.0.1:"+strconv.Itoa(port)+"/api/auth/status", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: engine.CookieName, Value: secret})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

func TestStartKeepsOnePortAcrossFolders(t *testing.T) {
	t.Cleanup(Stop)
	dir := t.TempDir()
	first, err := Start(filepath.Join(dir, "a"), 0, "s")
	if err != nil {
		t.Fatal(err)
	}
	if again, err := Start(filepath.Join(dir, "a"), 0, "s"); err != nil || again != first {
		t.Fatalf("same folder: port %d, %v; want %d", again, err, first)
	}
	if other, err := Start(filepath.Join(dir, "b"), 0, "s"); err != nil || other != first {
		t.Fatalf("other folder: port %d, %v; want %d", other, err, first)
	}
	if _, err := os.Stat(filepath.Join(dir, "b", "auth", "users.json")); err != nil {
		t.Errorf("other folder not set up: %v", err)
	}

	// A folder that can't be used leaves the running engine alone.
	blocker := filepath.Join(dir, "file")
	if err := os.WriteFile(blocker, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Start(filepath.Join(blocker, "sub"), 0, "s"); err == nil {
		t.Fatal("started on a folder below a file")
	}
	if code := authStatusCode(t, first, "s"); code != http.StatusOK {
		t.Fatalf("after a failed folder change: status %d", code)
	}

	Stop()
	if _, err := http.Get("http://127.0.0.1:" + strconv.Itoa(first) + "/"); err == nil {
		t.Error("engine still answers after Stop")
	}
}

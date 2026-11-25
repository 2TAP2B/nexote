package mobile

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"nexote/engine"
)

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

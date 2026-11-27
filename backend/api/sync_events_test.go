package api

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nexote/accounts"
)

func TestSyncEventStreamLeavesOutOnlyTheDevicesOwnWrites(t *testing.T) {
	e := newTestEnv(t)
	u, session := e.user("alice", accounts.RoleAdmin)
	code, _, err := e.h.Accounts.CreatePairing(u.ID, accounts.PairingTTL)
	if err != nil {
		t.Fatal(err)
	}
	token, dev, _, err := e.h.Accounts.RedeemPairing(code, "Phone", "android")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(e.routes)
	t.Cleanup(srv.Close)
	open := func(bearer, cookie string) *http.Response {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		t.Cleanup(cancel)
		req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/sync/events", nil)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: sessionCookie, Value: cookie})
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { res.Body.Close() })
		return res
	}
	if res := open("wrong", ""); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("bad token: %d", res.StatusCode)
	}
	if res := open("", session); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("session cookie: %d, want 401", res.StatusCode)
	}

	res := open(token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("stream: %d", res.StatusCode)
	}
	lines := bufio.NewReader(res.Body)
	if l, _ := lines.ReadString('\n'); l != ": connected\n" {
		t.Fatalf("greeting %q", l)
	}
	me := map[string]bool{u.ID: true}
	next := func() string {
		t.Helper()
		var event []string
		for {
			l, err := lines.ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			if l == "\n" && len(event) > 0 {
				return strings.Join(event, "")
			}
			if strings.TrimSpace(l) != "" {
				event = append(event, l)
			}
		}
	}
	e.h.Events.publish(NoteEvent{Type: "tree-change", VaultID: "written-by-this-device", FromSync: true, DeviceID: dev.ID}, me)
	e.h.Events.publish(NoteEvent{Type: "tree-change", VaultID: "written-by-another-device", FromSync: true, DeviceID: "other"}, me)
	e.h.Events.publish(NoteEvent{Type: "tree-change", VaultID: "written-by-a-user"}, me)
	if got := next(); !strings.Contains(got, "written-by-another-device") {
		t.Errorf("first event %q, want the other device's change (and never this device's)", got)
	}
	if got := next(); !strings.Contains(got, "written-by-a-user") {
		t.Errorf("second event %q, want the user's change", got)
	}
}

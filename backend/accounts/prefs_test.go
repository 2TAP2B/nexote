package accounts

import (
	"errors"
	"testing"
)

// Preferences merge, survive a reload of users.json, keep "" as a value and
// refuse unknown keys (the store only holds what clients are meant to sync).
func TestPrefs(t *testing.T) {
	s, _ := newTestStore(t)
	u := mustUser(t, s, "alice", RoleMember)

	if _, err := s.SetPrefs(u.ID, map[string]string{"aiApiKey": "secret"}); !errors.Is(err, ErrInvalidPref) {
		t.Fatalf("unknown key: err = %v, want ErrInvalidPref", err)
	}
	if _, err := s.SetPrefs(u.ID, map[string]string{"notepadVault": "v1", "notepadFolder": "Inbox"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.SetPrefs(u.ID, map[string]string{"notepadFolder": ""})
	if err != nil {
		t.Fatal(err)
	}
	if got["notepadVault"] != "v1" || got["notepadFolder"] != "" || len(got) != 2 {
		t.Fatalf("prefs = %v", got)
	}
	reloaded, err := s.User(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v, ok := reloaded.Prefs["notepadFolder"]; !ok || v != "" || reloaded.Prefs["notepadVault"] != "v1" {
		t.Fatalf("stored prefs = %v", reloaded.Prefs)
	}
}

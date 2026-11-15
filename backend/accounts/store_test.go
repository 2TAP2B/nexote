package accounts

import (
	"errors"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

func newTestStore(t *testing.T) (*Store, *time.Time) {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	return s, &now
}

func mustUser(t *testing.T, s *Store, username string, role Role) User {
	t.Helper()
	u, err := NewUser(username, "", role)
	if err != nil {
		t.Fatal(err)
	}
	u.Passkeys = []Passkey{NewPasskey(webauthn.Credential{ID: []byte(username + "-key")}, "")}
	u, err = s.CreateUser(u)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestSessionLifetime(t *testing.T) {
	s, now := newTestStore(t)
	u := mustUser(t, s, "alice", RoleAdmin)
	token, _, err := s.CreateSession(u.ID, "test")
	if err != nil {
		t.Fatal(err)
	}

	if _, got, err := s.SessionUser(token); err != nil || got.ID != u.ID {
		t.Fatalf("fresh session: got %v, %v", got.ID, err)
	}
	if _, _, err := s.SessionUser(token + "x"); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("wrong token: want ErrSessionInvalid, got %v", err)
	}

	// Use keeps it alive past the TTL measured from login...
	*now = now.Add(SessionTTL - time.Hour)
	if _, _, err := s.SessionUser(token); err != nil {
		t.Fatalf("used just before expiry: %v", err)
	}
	*now = now.Add(SessionTTL - time.Hour)
	if _, _, err := s.SessionUser(token); err != nil {
		t.Fatalf("sliding expiry: still in use, got %v", err)
	}
	// ...but not past the TTL without use.
	*now = now.Add(SessionTTL + time.Minute)
	if _, _, err := s.SessionUser(token); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("idle past TTL: want ErrSessionInvalid, got %v", err)
	}
}

func TestSessionEndsWhenUserDeactivatedOrLoggedOut(t *testing.T) {
	s, _ := newTestStore(t)
	mustUser(t, s, "admin", RoleAdmin)
	u := mustUser(t, s, "bob", RoleMember)
	t1, _, _ := s.CreateSession(u.ID, "phone")
	t2, _, _ := s.CreateSession(u.ID, "laptop")

	if err := s.DeleteSession(t1); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SessionUser(t1); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("logged-out session still valid: %v", err)
	}
	if _, _, err := s.SessionUser(t2); err != nil {
		t.Fatalf("other device logged out too: %v", err)
	}

	if _, err := s.UpdateUser(u.ID, func(u *User) error { u.Disabled = true; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SessionUser(t2); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("deactivated user's session still valid: %v", err)
	}
}

func TestInviteSingleUseAndExpiry(t *testing.T) {
	s, now := newTestStore(t)
	admin := mustUser(t, s, "admin", RoleAdmin)

	token, inv, err := s.CreateInvite(Invite{Kind: InviteSignup, Role: RoleMember, CreatedBy: admin.ID}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := s.InviteByToken(token); err != nil || got.ID != inv.ID {
		t.Fatalf("valid invite: %v", err)
	}
	if err := s.UseInvite(inv.ID, "someone"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InviteByToken(token); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("used invite: want ErrInviteInvalid, got %v", err)
	}
	if err := s.UseInvite(inv.ID, "someone-else"); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("second use: want ErrInviteInvalid, got %v", err)
	}

	token2, inv2, _ := s.CreateInvite(Invite{Kind: InviteSignup, Role: RoleMember}, time.Hour)
	*now = now.Add(time.Hour + time.Second)
	if _, err := s.InviteByToken(token2); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("expired invite: want ErrInviteInvalid, got %v", err)
	}
	if err := s.UseInvite(inv2.ID, "late"); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("expired invite used: want ErrInviteInvalid, got %v", err)
	}

	token3, inv3, _ := s.CreateInvite(Invite{Kind: InviteSignup, Role: RoleMember}, time.Hour)
	if err := s.DeleteInvite(inv3.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InviteByToken(token3); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("revoked invite: want ErrInviteInvalid, got %v", err)
	}
}

func TestUsernamesAreUniqueIgnoringCase(t *testing.T) {
	s, _ := newTestStore(t)
	mustUser(t, s, "Alice", RoleAdmin)
	u, err := NewUser("  ALICE ", "", RoleMember)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser(u); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("want ErrUsernameTaken, got %v", err)
	}
	if free, _ := s.UsernameFree("alice"); free {
		t.Fatal("UsernameFree(alice) = true for an existing account")
	}
	for _, bad := range []string{"ab", "has space", "ünï", "-lead", ""} {
		if _, err := NewUser(bad, "", RoleMember); !errors.Is(err, ErrInvalidUsername) {
			t.Errorf("NewUser(%q): want ErrInvalidUsername, got %v", bad, err)
		}
	}
}

func TestLastActiveAdminIsKept(t *testing.T) {
	s, _ := newTestStore(t)
	admin := mustUser(t, s, "admin", RoleAdmin)
	member := mustUser(t, s, "member", RoleMember)

	demote := func(u *User) error { u.Role = RoleMember; return nil }
	disable := func(u *User) error { u.Disabled = true; return nil }
	if _, err := s.UpdateUser(admin.ID, demote); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("demote only admin: want ErrLastAdmin, got %v", err)
	}
	if _, err := s.UpdateUser(admin.ID, disable); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("disable only admin: want ErrLastAdmin, got %v", err)
	}

	if _, err := s.UpdateUser(member.ID, func(u *User) error { u.Role = RoleAdmin; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateUser(admin.ID, demote); err != nil {
		t.Fatalf("demote with another admin present: %v", err)
	}
}

func TestLastPasskeyIsKept(t *testing.T) {
	s, _ := newTestStore(t)
	u := mustUser(t, s, "alice", RoleAdmin)
	only := u.Passkeys[0].ID
	if err := s.RemovePasskey(u.ID, only); !errors.Is(err, ErrLastPasskey) {
		t.Fatalf("want ErrLastPasskey, got %v", err)
	}
	second, err := s.AddPasskey(u.ID, webauthn.Credential{ID: []byte("phone")}, "Phone")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RemovePasskey(u.ID, only); err != nil {
		t.Fatalf("remove with a second passkey present: %v", err)
	}
	got, _ := s.User(u.ID)
	if len(got.Passkeys) != 1 || got.Passkeys[0].ID != second.ID {
		t.Fatalf("passkeys after removal: %+v", got.Passkeys)
	}
}

// The server's recover command writes invites.json from a second process;
// the running server must see the new link without a restart.
func TestStoreSeesChangesFromAnotherProcess(t *testing.T) {
	dir := t.TempDir()
	server, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	cli, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := server.Invites(); err != nil { // warm the server's cache
		t.Fatal(err)
	}
	token, _, err := cli.CreateInvite(Invite{Kind: InviteRecovery, UserID: "u1"}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := server.InviteByToken(token); err != nil {
		t.Fatalf("server doesn't see the CLI's invite: %v", err)
	}
}

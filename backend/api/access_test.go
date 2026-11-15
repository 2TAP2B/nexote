package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nexote/accounts"
	"nexote/notes"
)

type testEnv struct {
	t      *testing.T
	h      *Handler
	routes http.Handler
	home   string
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	home := t.TempDir()
	reg, err := notes.NewVaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	spaces, err := notes.NewSpaceRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	accts, err := accounts.Open(filepath.Join(home, "auth"))
	if err != nil {
		t.Fatal(err)
	}
	origin, _ := accounts.PublicOrigin("http://localhost:3000")
	h, err := New(Config{Home: home, Registry: reg, Spaces: spaces, Accounts: accts, Origin: origin})
	if err != nil {
		t.Fatal(err)
	}
	return &testEnv{t: t, h: h, routes: h.Routes(), home: home}
}

// user creates an account and returns it with a session token.
func (e *testEnv) user(name string, role accounts.Role) (accounts.User, string) {
	e.t.Helper()
	u, err := accounts.NewUser(name, "", role)
	if err != nil {
		e.t.Fatal(err)
	}
	if u, err = e.h.Accounts.CreateUser(u); err != nil {
		e.t.Fatal(err)
	}
	token, _, err := e.h.Accounts.CreateSession(u.ID, "test")
	if err != nil {
		e.t.Fatal(err)
	}
	return u, token
}

// space creates a space owned by owner and returns it with its notes vault.
func (e *testEnv) space(owner accounts.User, name string) (notes.Space, string) {
	e.t.Helper()
	s, err := e.h.createSpace(owner.ID, name, "")
	if err != nil {
		e.t.Fatal(err)
	}
	vaults, _ := e.h.Registry.ListSpace(s.ID)
	for _, v := range vaults {
		if v.Type != notes.VaultTypeCollections {
			return s, v.ID
		}
	}
	e.t.Fatal("space has no notes vault")
	return s, ""
}

func (e *testEnv) do(method, path, token string, body any) *httptest.ResponseRecorder {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		r = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, r)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	}
	rec := httptest.NewRecorder()
	e.routes.ServeHTTP(rec, req)
	return rec
}

func (e *testEnv) expect(rec *httptest.ResponseRecorder, status int, what string) {
	e.t.Helper()
	if rec.Code != status {
		e.t.Errorf("%s: status %d, want %d (body %s)", what, rec.Code, status, strings.TrimSpace(rec.Body.String()))
	}
}

func (e *testEnv) createNote(vaultID, token, title string) string {
	e.t.Helper()
	rec := e.do("POST", "/api/vaults/"+vaultID+"/notes", token, map[string]string{"title": title})
	e.expect(rec, http.StatusCreated, "create note "+title)
	var p Payload
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	return p.ID
}

// contextWithUser is what authenticate attaches for a logged-in request.
func contextWithUser(r *http.Request, u *accounts.User) context.Context {
	return context.WithValue(r.Context(), userKey{}, u)
}

func TestRequestsNeedASession(t *testing.T) {
	e := newTestEnv(t)
	alice, _ := e.user("alice", accounts.RoleAdmin)
	_, vault := e.space(alice, "Alice")

	e.expect(e.do("GET", "/api/vaults", "", nil), http.StatusUnauthorized, "vault list without session")
	e.expect(e.do("GET", "/api/vaults/"+vault+"/notes", "", nil), http.StatusUnauthorized, "notes without session")
	e.expect(e.do("GET", "/api/vaults/"+vault+"/notes", "forged-token", nil), http.StatusUnauthorized, "notes with forged session")
	e.expect(e.do("GET", "/api/events", "", nil), http.StatusUnauthorized, "event stream without session")
	// Login, setup and invite routes are reachable before logging in.
	e.expect(e.do("GET", "/api/auth/status", "", nil), http.StatusOK, "auth status")
}

func TestSpaceRolesGateVaultAccess(t *testing.T) {
	e := newTestEnv(t)
	alice, aliceTok := e.user("alice", accounts.RoleAdmin)
	bob, bobTok := e.user("bob", accounts.RoleMember)
	carol, carolTok := e.user("carol", accounts.RoleMember)
	_, private := e.space(alice, "Alice")
	team, shared := e.space(alice, "Team")
	if _, err := e.h.Spaces.SetMember(team.ID, bob.ID, notes.SpaceViewer); err != nil {
		t.Fatal(err)
	}
	if _, err := e.h.Spaces.SetMember(team.ID, carol.ID, notes.SpaceEditor); err != nil {
		t.Fatal(err)
	}
	privNote := e.createNote(private, aliceTok, "Diary")
	teamNote := e.createNote(shared, aliceTok, "Plan")

	// Non-members don't even learn the vault exists.
	e.expect(e.do("GET", "/api/vaults/"+private+"/notes", bobTok, nil), http.StatusNotFound, "non-member lists notes")
	e.expect(e.do("GET", "/api/vaults/"+private+"/notes/"+privNote, bobTok, nil), http.StatusNotFound, "non-member reads note")
	e.expect(e.do("PUT", "/api/vaults/"+private+"/notes/"+privNote, carolTok, map[string]string{"title": "x", "body": "x"}),
		http.StatusNotFound, "non-member edits note")

	// Viewers read, but can't change content…
	e.expect(e.do("GET", "/api/vaults/"+shared+"/notes/"+teamNote, bobTok, nil), http.StatusOK, "viewer reads note")
	e.expect(e.do("PUT", "/api/vaults/"+shared+"/notes/"+teamNote, bobTok, map[string]string{"title": "Plan", "body": "hijack"}),
		http.StatusForbidden, "viewer edits note")
	e.expect(e.do("DELETE", "/api/vaults/"+shared+"/notes/"+teamNote, bobTok, nil), http.StatusForbidden, "viewer deletes note")
	e.expect(e.do("POST", "/api/vaults/"+shared+"/notes", bobTok, map[string]string{"title": "New"}), http.StatusForbidden, "viewer creates note")
	// …while their bookmarks and shortcuts are their own business.
	e.expect(e.do("POST", "/api/vaults/"+shared+"/bookmarks", bobTok, map[string]string{"id": teamNote}), http.StatusNoContent, "viewer bookmarks")
	e.expect(e.do("POST", "/api/vaults/"+shared+"/shortcuts", bobTok, map[string]string{"id": teamNote}), http.StatusNoContent, "viewer adds shortcut")

	// Bookmarks are per user: alice doesn't get bob's.
	rec := e.do("GET", "/api/vaults/"+shared+"/bookmarks", aliceTok, nil)
	if strings.Contains(rec.Body.String(), teamNote) {
		t.Errorf("alice sees bob's bookmark: %s", rec.Body.String())
	}

	// Editors change content.
	e.expect(e.do("PUT", "/api/vaults/"+shared+"/notes/"+teamNote, carolTok, map[string]string{"title": "Plan", "body": "edited"}),
		http.StatusOK, "editor edits note")
	e.expect(e.do("POST", "/api/vaults", carolTok, map[string]string{"name": "Docs", "spaceId": team.ID}), http.StatusCreated, "editor creates vault")
	e.expect(e.do("POST", "/api/vaults", bobTok, map[string]string{"name": "Mine", "spaceId": team.ID}), http.StatusForbidden, "viewer creates vault")

	// Moving a note out of a space you only view is a write on that space.
	e.expect(e.do("POST", "/api/vaults/"+shared+"/notes/move", bobTok, map[string]string{"id": teamNote, "dstVaultId": "home"}),
		http.StatusForbidden, "viewer moves note out")

	// Only owners delete vaults, and a space keeps at least one.
	e.expect(e.do("DELETE", "/api/vaults/"+shared, carolTok, nil), http.StatusForbidden, "editor deletes vault")
	e.expect(e.do("DELETE", "/api/vaults/"+private, aliceTok, nil), http.StatusConflict, "owner deletes the only vault")
	e.expect(e.do("DELETE", "/api/vaults/"+shared, aliceTok, nil), http.StatusNoContent, "owner deletes vault")
}

func TestVaultListShowsOnlyMemberSpaces(t *testing.T) {
	e := newTestEnv(t)
	alice, _ := e.user("alice", accounts.RoleAdmin)
	bob, bobTok := e.user("bob", accounts.RoleMember)
	_, private := e.space(alice, "Alice")
	team, shared := e.space(alice, "Team")
	if _, err := e.h.Spaces.SetMember(team.ID, bob.ID, notes.SpaceViewer); err != nil {
		t.Fatal(err)
	}

	rec := e.do("GET", "/api/vaults", bobTok, nil)
	e.expect(rec, http.StatusOK, "vault list")
	var out struct {
		Vaults []map[string]any `json:"vaults"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, v := range out.Vaults {
		id, _ := v["id"].(string)
		seen[id] = true
		if _, leaked := v["path"]; leaked {
			t.Errorf("vault %s exposes its server path", id)
		}
		if v["spaceId"] == team.ID && v["role"] != string(notes.SpaceViewer) {
			t.Errorf("vault %s: role %v, want viewer", id, v["role"])
		}
	}
	if seen[private] {
		t.Error("bob's vault list includes alice's private vault")
	}
	if !seen[shared] {
		t.Error("bob's vault list lacks the shared vault")
	}
}

func TestJournalIsPersonal(t *testing.T) {
	e := newTestEnv(t)
	_, aliceTok := e.user("alice", accounts.RoleAdmin)
	_, bobTok := e.user("bob", accounts.RoleMember)

	rec := e.do("GET", "/api/journal/daily?date=2026-03-01", aliceTok, nil)
	e.expect(rec, http.StatusOK, "alice opens today")
	var day Payload
	_ = json.Unmarshal(rec.Body.Bytes(), &day)

	e.expect(e.do("GET", "/api/journal/notes/"+day.ID, bobTok, nil), http.StatusNotFound, "bob reads alice's journal note")
	e.expect(e.do("GET", "/api/vaults/journal/notes/"+day.ID, bobTok, nil), http.StatusNotFound, "bob reads it via the pseudo vault")
	if rec := e.do("GET", "/api/journal/notes", bobTok, nil); strings.Contains(rec.Body.String(), day.ID) {
		t.Errorf("bob's journal lists alice's note: %s", rec.Body.String())
	}
	e.expect(e.do("GET", "/api/journal/notes/"+day.ID, aliceTok, nil), http.StatusOK, "alice reads her journal note")
}

func TestChangesMustComeFromThePublicOrigin(t *testing.T) {
	e := newTestEnv(t)
	alice, aliceTok := e.user("alice", accounts.RoleAdmin)
	_, vault := e.space(alice, "Alice")

	req := httptest.NewRequest("POST", "/api/vaults/"+vault+"/notes", strings.NewReader(`{"title":"x"}`))
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: aliceTok})
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	e.routes.ServeHTTP(rec, req)
	e.expect(rec, http.StatusForbidden, "cross-origin create")

	req = httptest.NewRequest("POST", "/api/vaults/"+vault+"/notes", strings.NewReader(`{"title":"x"}`))
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: aliceTok})
	req.Header.Set("Origin", "http://localhost:3000")
	rec = httptest.NewRecorder()
	e.routes.ServeHTTP(rec, req)
	e.expect(rec, http.StatusCreated, "same-origin create")
}

func TestMembershipManagement(t *testing.T) {
	e := newTestEnv(t)
	alice, aliceTok := e.user("alice", accounts.RoleAdmin)
	bob, bobTok := e.user("bob", accounts.RoleMember)
	carol, _ := e.user("carol", accounts.RoleMember)
	team, shared := e.space(alice, "Team")

	e.expect(e.do("PUT", "/api/spaces/"+team.ID+"/members/"+bob.ID, aliceTok, map[string]string{"role": "viewer"}),
		http.StatusOK, "owner adds bob")
	e.expect(e.do("PUT", "/api/spaces/"+team.ID+"/members/"+carol.ID, bobTok, map[string]string{"role": "owner"}),
		http.StatusForbidden, "viewer adds a member")
	e.expect(e.do("PUT", "/api/spaces/"+team.ID+"/members/"+bob.ID, aliceTok, map[string]string{"role": "admin"}),
		http.StatusBadRequest, "unknown role")
	e.expect(e.do("DELETE", "/api/spaces/"+team.ID+"/members/"+alice.ID, aliceTok, nil), http.StatusConflict, "last owner leaves")
	e.expect(e.do("PUT", "/api/spaces/"+team.ID+"/members/"+alice.ID, aliceTok, map[string]string{"role": "editor"}),
		http.StatusConflict, "last owner demotes self")

	// Members can leave; afterwards the space is gone for them.
	e.expect(e.do("DELETE", "/api/spaces/"+team.ID+"/members/"+bob.ID, bobTok, nil), http.StatusNoContent, "bob leaves")
	e.expect(e.do("GET", "/api/vaults/"+shared+"/notes", bobTok, nil), http.StatusNotFound, "bob after leaving")

	// Someone left without any space gets a fresh private one.
	rec := e.do("GET", "/api/spaces", bobTok, nil)
	e.expect(rec, http.StatusOK, "bob's spaces")
	var out struct {
		Spaces []spacePayload `json:"spaces"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Spaces) != 1 || out.Spaces[0].Role != notes.SpaceOwner {
		t.Fatalf("bob's spaces after leaving: %+v", out.Spaces)
	}
}

func TestAdminRoutesRefuseMembers(t *testing.T) {
	e := newTestEnv(t)
	_, adminTok := e.user("admin", accounts.RoleAdmin)
	bob, bobTok := e.user("bob", accounts.RoleMember)

	for _, r := range []struct{ method, path string }{
		{"GET", "/api/admin/users"},
		{"POST", "/api/admin/invites"},
		{"POST", "/api/admin/users/" + bob.ID + "/recovery"},
		{"GET", "/api/git/config"},
		{"GET", "/api/metadata/config"},
	} {
		e.expect(e.do(r.method, r.path, bobTok, map[string]string{}), http.StatusForbidden, "member "+r.method+" "+r.path)
	}
	e.expect(e.do("POST", "/api/admin/invites", adminTok, map[string]string{"role": "member"}), http.StatusCreated, "admin creates invite")
	e.expect(e.do("PATCH", "/api/admin/users/"+bob.ID, adminTok, map[string]bool{"disabled": true}), http.StatusOK, "admin deactivates bob")
	e.expect(e.do("GET", "/api/vaults", bobTok, nil), http.StatusUnauthorized, "deactivated bob's session")
}

func TestEventsReachOnlyThoseWhoCanSee(t *testing.T) {
	e := newTestEnv(t)
	alice, _ := e.user("alice", accounts.RoleAdmin)
	bob, _ := e.user("bob", accounts.RoleMember)
	_, private := e.space(alice, "Alice")
	team, shared := e.space(alice, "Team")
	if _, err := e.h.Spaces.SetMember(team.ID, bob.ID, notes.SpaceViewer); err != nil {
		t.Fatal(err)
	}
	aliceSub := e.h.Events.subscribe(alice.ID)
	bobSub := e.h.Events.subscribe(bob.ID)

	asAlice := httptest.NewRequest("GET", "/", nil)
	asAlice = asAlice.WithContext(contextWithUser(asAlice, &alice))
	e.h.publishTree(asAlice, private)
	e.h.publishTree(asAlice, shared)
	e.h.publishTree(asAlice, "journal")

	got := func(s *subscriber) []string {
		var ids []string
		for {
			select {
			case ev := <-s.ch:
				ids = append(ids, ev.VaultID)
			default:
				return ids
			}
		}
	}
	if ids := got(bobSub); len(ids) != 1 || ids[0] != shared {
		t.Errorf("bob received %v, want only the shared vault %s", ids, shared)
	}
	if ids := got(aliceSub); len(ids) != 3 {
		t.Errorf("alice received %v, want her three changes", ids)
	}
}

func TestMemoImagesFollowTheMemoIntoAVault(t *testing.T) {
	e := newTestEnv(t)
	alice, aliceTok := e.user("alice", accounts.RoleAdmin)
	_, vault := e.space(alice, "Alice")
	home, err := e.h.personalStore(alice.ID, "home")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home.Dir, "pic.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	rec := e.do("POST", "/api/vaults/"+vault+"/notes", aliceTok,
		map[string]string{"title": "From memo", "body": "look ![](/api/vaults/home/images/pic.png)"})
	e.expect(rec, http.StatusCreated, "make note from memo")
	var p Payload
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	if !strings.Contains(p.Body, "/api/vaults/"+vault+"/images/pic.png") || strings.Contains(p.Body, "/api/vaults/home/") {
		t.Fatalf("image URL not rewritten to the vault: %q", p.Body)
	}
	e.expect(e.do("GET", "/api/vaults/"+vault+"/images/pic.png", aliceTok, nil), http.StatusOK, "copied image in the vault")
	if _, err := os.Stat(filepath.Join(home.Dir, "pic.png")); err != nil {
		t.Errorf("memo's own image was removed: %v", err)
	}
}

package serversync

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nexote/accounts"
	"nexote/api"
	"nexote/notes"
	"nexote/server"
)

// The end-to-end tests run two real handlers: a server account (served
// over HTTP to the sync client with a real device token) and a phone (a
// local-mode handler, as in the engine), synced by the real sync code.

// peer is one side, driven through its REST routes like a user would.
type peer struct {
	t       *testing.T
	h       *api.Handler
	routes  http.Handler
	user    string
	session string
}

func (p *peer) do(method, path string, body any) (int, []byte) {
	p.t.Helper()
	var r io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		r = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, r)
	if p.session != "" {
		req.AddCookie(&http.Cookie{Name: "nexote_session", Value: p.session})
	}
	rec := httptest.NewRecorder()
	p.routes.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

// call expects a 2xx answer and decodes it into out (nil: ignored).
func (p *peer) call(method, path string, body, out any) {
	p.t.Helper()
	status, data := p.do(method, path, body)
	if status < 200 || status > 299 {
		p.t.Fatalf("%s %s: %d %s", method, path, status, data)
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			p.t.Fatalf("%s %s: %v", method, path, err)
		}
	}
}

func (p *peer) createNote(vault, title, folder, body string) string {
	p.t.Helper()
	var out struct {
		ID string `json:"id"`
	}
	p.call("POST", "/api/vaults/"+vault+"/notes", map[string]string{"title": title, "path": folder, "body": body}, &out)
	return out.ID
}

func (p *peer) updateNote(vault, id, title, body string) {
	p.t.Helper()
	p.call("PUT", "/api/vaults/"+vault+"/notes/"+id, map[string]string{"title": title, "body": body}, nil)
}

func (p *peer) deleteNote(vault, id string) {
	p.t.Helper()
	p.call("DELETE", "/api/vaults/"+vault+"/notes/"+id, nil, nil)
}

func (p *peer) manifest(scope string) api.SyncManifest {
	p.t.Helper()
	m, err := p.h.SyncManifest(p.user, scope)
	if err != nil {
		p.t.Fatalf("manifest %s: %v", scope, err)
	}
	return m
}

func (p *peer) note(scope, id string) (api.SyncNote, bool) {
	p.t.Helper()
	n, err := p.h.SyncGetNote(p.user, scope, id)
	if errors.Is(err, notes.ErrNotFound) {
		return api.SyncNote{}, false
	}
	if err != nil {
		p.t.Fatalf("note %s/%s: %v", scope, id, err)
	}
	return n, true
}

func (p *peer) structure() api.SyncStructure {
	p.t.Helper()
	s, err := p.h.SyncStructure(p.user)
	if err != nil {
		p.t.Fatal(err)
	}
	return s
}

// vault returns the first vault of the given type in the oldest space.
func (p *peer) vault(vaultType string) string {
	p.t.Helper()
	s := p.structure()
	for _, v := range s.Vaults {
		if v.SpaceID == s.Spaces[0].ID && v.Type == vaultType {
			return v.ID
		}
	}
	p.t.Fatalf("no vault of type %q", vaultType)
	return ""
}

// notesTitled returns the ids of the notes with the title in a scope.
func (p *peer) notesTitled(scope, title string) []string {
	var ids []string
	for id, info := range p.manifest(scope).Notes {
		if info.Title == title {
			ids = append(ids, id)
		}
	}
	return ids
}

type world struct {
	t          *testing.T
	server     *peer
	phone      *peer
	srv        *httptest.Server
	svc        *Service
	host       *MemoryHost
	serverHome string
	phoneHome  string
}

func newWorld(t *testing.T) *world {
	t.Helper()
	serverOrigin, _ := url.Parse("http://127.0.0.1")
	serverHome := t.TempDir()
	sh, err := server.Open(serverHome, serverOrigin, server.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(sh.Close)
	u, err := accounts.NewUser("alice", "Alice", accounts.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if u, err = sh.Accounts.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	// As at a server's first-admin setup: the legacy Default and
	// Collections vaults become the admin's "Personal" space.
	if err := sh.AdoptLegacyData(); err != nil {
		t.Fatal(err)
	}
	session, _, err := sh.Accounts.CreateSession(u.ID, "test")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(sh.Routes())
	t.Cleanup(srv.Close)

	phoneHome := t.TempDir()
	phoneOrigin, _ := url.Parse("http://127.0.0.1:1")
	ph, err := server.Open(phoneHome, phoneOrigin, server.Options{Local: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ph.Close)

	host := NewMemoryHost("Test phone")
	host.SetStateDir(t.TempDir())
	svc := New(host, "")
	code, _, err := sh.Accounts.CreatePairing(u.ID, accounts.PairingTTL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.pair(context.Background(), pairInput{Server: srv.URL, Code: code}); err != nil {
		t.Fatal(err)
	}
	// The scheduler's goroutine isn't started: the tests run each sync
	// themselves.
	svc.sched.local, svc.sched.localUser, svc.sched.folder, svc.sched.home = ph, ph.LocalUserID(), "folder-id", phoneHome
	return &world{
		t:          t,
		server:     &peer{t: t, h: sh, routes: sh.Routes(), user: u.ID, session: session},
		phone:      &peer{t: t, h: ph, routes: ph.Routes(), user: ph.LocalUserID()},
		srv:        srv,
		svc:        svc,
		host:       host,
		serverHome: serverHome,
		phoneHome:  phoneHome,
	}
}

// sync runs one sync that must go through cleanly and returns the offline
// copies it made.
func (w *world) sync() int {
	w.t.Helper()
	r := w.syncRun()
	if r.skipped != 0 {
		w.t.Errorf("sync left %d items for the next run", r.skipped)
	}
	if len(r.problems) != 0 {
		w.t.Errorf("sync problems: %v", r.problems)
	}
	return r.conflicts
}

// syncRun runs one sync and returns it for inspection.
func (w *world) syncRun() *run {
	w.t.Helper()
	c, err := w.svc.current()
	if err != nil || c == nil {
		w.t.Fatalf("not paired: %v", err)
	}
	r, err := w.svc.syncOnce(context.Background(), c)
	if err != nil {
		w.t.Fatalf("sync: %v", err)
	}
	return r
}

// expectInSync checks both sides hold the same notes (ids and content),
// attachments and folders in every scope, and the same structure.
func (w *world) expectInSync() {
	w.t.Helper()
	ls, rs := w.phone.structure(), w.server.structure()
	if !sameJSON(spaceSet(ls), spaceSet(rs)) || !sameJSON(vaultSet(ls), vaultSet(rs)) {
		w.t.Fatalf("structures differ:\nphone  %s %s\nserver %s %s", js(spaceSet(ls)), js(vaultSet(ls)), js(spaceSet(rs)), js(vaultSet(rs)))
	}
	scopes := []string{"journal", "home"}
	for _, v := range rs.Vaults {
		scopes = append(scopes, v.ID)
	}
	for _, scope := range scopes {
		lm, rm := w.phone.manifest(scope), w.server.manifest(scope)
		if !sameJSON(lm.Notes, rm.Notes) {
			w.t.Errorf("scope %s: notes differ:\nphone  %s\nserver %s", scope, js(lm.Notes), js(rm.Notes))
		}
		if !sameJSON(lm.Attachments, rm.Attachments) {
			w.t.Errorf("scope %s: attachments differ: phone %v server %v", scope, lm.Attachments, rm.Attachments)
		}
		if !sameJSON(lm.Folders, rm.Folders) {
			w.t.Errorf("scope %s: folders differ: phone %v server %v", scope, lm.Folders, rm.Folders)
		}
	}
}

func js(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}

func sameJSON(a, b any) bool { return js(a) == js(b) }

// spaceSet and vaultSet are what must agree (creation times and the order
// in each registry are each side's own).
func spaceSet(s api.SyncStructure) map[string]string {
	m := map[string]string{}
	for _, sp := range s.Spaces {
		m[sp.ID] = sp.Name + "|" + sp.Icon
	}
	return m
}

func vaultSet(s api.SyncStructure) map[string]api.SyncVault {
	m := map[string]api.SyncVault{}
	for _, v := range s.Vaults {
		m[v.ID] = v
	}
	return m
}

// syncWrites counts the changes a sync publishes on both sides.
func (w *world) syncWrites(run func()) int {
	w.t.Helper()
	count := 0
	for _, p := range []*peer{w.phone, w.server} {
		events, cancel := p.h.SubscribeEvents(p.user)
		defer cancel()
		defer func() {
			for {
				select {
				case ev := <-events:
					if ev.FromSync {
						count++
					}
				default:
					return
				}
			}
		}()
	}
	run()
	return count
}

var pngBytes = []byte("\x89PNG\r\n\x1a\nfake image data")

func TestFirstSyncFillsAnEmptyPhone(t *testing.T) {
	w := newWorld(t)
	sv := w.server.vault("")
	id := w.server.createNote(sv, "Groceries", "Lists", "## Groceries\n\n- milk #shopping\n")
	store, err := w.server.h.Registry.Store(sv)
	if err != nil {
		t.Fatal(err)
	}
	img, err := store.SaveImage(id, "png", sv, pngBytes)
	if err != nil {
		t.Fatal(err)
	}
	w.server.updateNote(sv, id, "Groceries", "## Groceries\n\n- milk #shopping\n\n![]("+img.URL+")\n")
	memo := w.server.createNote("home", "Ideas", "", "an idea\n")
	before, _ := w.server.note(sv, id)

	w.sync()

	if got := w.phone.vault(""); got != sv {
		t.Fatalf("phone's first vault is %s, want the server's %s", got, sv)
	}
	if w.phone.structure().Spaces[0].ID != w.server.structure().Spaces[0].ID {
		t.Fatal("phone's space wasn't aligned to the server's")
	}
	got, ok := w.phone.note(sv, id)
	if !ok || got.Body != before.Body || !got.Meta.UpdatedAt.Equal(before.Meta.UpdatedAt) || !got.Meta.CreatedAt.Equal(before.Meta.CreatedAt) || got.Meta.Path != "Lists" {
		t.Fatalf("phone's copy %+v, want the server's %+v", got, before)
	}
	if _, ok := w.phone.note("home", memo); !ok {
		t.Error("the home store's note didn't arrive")
	}
	w.expectInSync()
}

func TestFirstSyncMovesPhoneDataToTheAccount(t *testing.T) {
	w := newWorld(t)
	pv := w.phone.vault("")
	sv := w.server.vault("")
	id := w.phone.createNote(pv, "Trip", "", "## Trip\n")
	store, err := w.phone.h.Registry.Store(pv)
	if err != nil {
		t.Fatal(err)
	}
	img, err := store.SaveImage(id, "png", pv, pngBytes)
	if err != nil {
		t.Fatal(err)
	}
	w.phone.updateNote(pv, id, "Trip", "## Trip\n\n![]("+img.URL+")\n")
	if !strings.Contains(img.URL, "/api/vaults/"+pv+"/") {
		t.Fatalf("image URL %s", img.URL)
	}

	w.sync()

	if got := w.phone.vault(""); got != sv {
		t.Fatalf("phone vault %s, want re-keyed to %s", got, sv)
	}
	want := "/api/vaults/" + sv + "/images/" + img.Name
	for name, p := range map[string]*peer{"phone": w.phone, "server": w.server} {
		n, ok := p.note(sv, id)
		if !ok {
			t.Fatalf("%s: note missing", name)
		}
		if !strings.Contains(n.Body, want) || strings.Contains(n.Body, pv) {
			t.Errorf("%s: body %q, want the image URL rewritten to %s", name, n.Body, want)
		}
	}
	if data, err := w.server.h.SyncReadAttachment(w.server.user, sv, img.Name); err != nil || !bytes.Equal(data, pngBytes) {
		t.Errorf("image on the server: %q, %v", data, err)
	}
	if code, _ := w.server.do("GET", "/api/vaults/"+sv+"/images/"+img.Name, nil); code != http.StatusOK {
		t.Errorf("the rewritten image URL answers %d on the server", code)
	}
	devices, _ := w.server.h.Accounts.Devices(w.server.user)
	if len(devices) != 1 || devices[0].LastSyncAt.IsZero() {
		t.Errorf("device lastSyncAt not recorded: %+v", devices)
	}
	w.expectInSync()
}

func TestEditsAndDeletesTravelBothWays(t *testing.T) {
	w := newWorld(t)
	w.sync()
	v := w.server.vault("")
	a := w.phone.createNote(v, "From phone", "", "phone text\n")
	b := w.server.createNote(v, "From server", "", "server text\n")
	c := w.server.createNote(v, "Doomed on phone", "", "x\n")
	d := w.phone.createNote(v, "Doomed on server", "", "y\n")
	w.sync()
	w.expectInSync()

	w.phone.updateNote(v, b, "From server", "edited on the phone\n")
	w.server.updateNote(v, a, "From phone", "edited on the server\n")
	w.phone.deleteNote(v, c)
	w.server.deleteNote(v, d)
	if conflicts := w.sync(); conflicts != 0 {
		t.Errorf("%d offline copies, want none", conflicts)
	}
	if n, _ := w.server.note(v, b); n.Body != "edited on the phone\n" {
		t.Errorf("server's b: %q", n.Body)
	}
	if n, _ := w.phone.note(v, a); n.Body != "edited on the server\n" {
		t.Errorf("phone's a: %q", n.Body)
	}
	if _, ok := w.server.note(v, c); ok {
		t.Error("c still on the server")
	}
	if _, ok := w.phone.note(v, d); ok {
		t.Error("d still on the phone")
	}
	w.expectInSync()
}

func TestDeleteVersusEditKeepsTheEdit(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	x := w.server.createNote(v, "X", "", "x\n")
	y := w.server.createNote(v, "Y", "", "y\n")
	w.sync()
	w.phone.deleteNote(v, x)
	w.server.updateNote(v, x, "X", "x edited on the server\n")
	w.server.deleteNote(v, y)
	w.phone.updateNote(v, y, "Y", "y edited on the phone\n")
	w.sync()
	if n, ok := w.phone.note(v, x); !ok || n.Body != "x edited on the server\n" {
		t.Errorf("x on the phone: %v %q", ok, n.Body)
	}
	if n, ok := w.server.note(v, y); !ok || n.Body != "y edited on the phone\n" {
		t.Errorf("y on the server: %v %q", ok, n.Body)
	}
	w.expectInSync()
}

func TestEditVersusEditMakesAnOfflineCopy(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	id := w.server.createNote(v, "Plan", "Work", "v1\n")
	w.sync()
	w.server.updateNote(v, id, "Plan", "server's v2\n")
	w.phone.updateNote(v, id, "Plan", "phone's v2\n")
	if conflicts := w.sync(); conflicts != 1 {
		t.Errorf("%d offline copies, want 1", conflicts)
	}
	for name, p := range map[string]*peer{"phone": w.phone, "server": w.server} {
		if n, _ := p.note(v, id); n.Body != "server's v2\n" {
			t.Errorf("%s keeps %q, want the server's version", name, n.Body)
		}
		copies := p.notesTitled(v, "Plan (offline copy)")
		if len(copies) != 1 {
			t.Fatalf("%s: %d offline copies", name, len(copies))
		}
		if n, _ := p.note(v, copies[0]); n.Body != "phone's v2\n" || n.Meta.Path != "Work" {
			t.Errorf("%s: offline copy %q in %q", name, n.Body, n.Meta.Path)
		}
	}
	w.expectInSync()
}

func TestNotepadsMergeIntoTheServersNote(t *testing.T) {
	w := newWorld(t)
	srvPad := w.server.createNote("home", "Notepad", "", "### 2026-11-20\n- 09:00 server memo\n")
	phonePad := w.phone.createNote("home", "Notepad", "", "### 2026-11-20\n- 08:00 phone memo\n\n### 2026-11-21\n- 10:00 later\n")
	w.sync()
	for name, p := range map[string]*peer{"phone": w.phone, "server": w.server} {
		ids := p.notesTitled("home", "Notepad")
		if len(ids) != 1 || ids[0] != srvPad {
			t.Fatalf("%s: Notepads %v, want only the server's %s", name, ids, srvPad)
		}
		n, _ := p.note("home", srvPad)
		want := "### 2026-11-20\n- 08:00 phone memo\n- 09:00 server memo\n\n### 2026-11-21\n- 10:00 later\n"
		if n.Body != want {
			t.Errorf("%s: Notepad\n%q\nwant\n%q", name, n.Body, want)
		}
	}
	if _, ok := w.phone.note("home", phonePad); ok {
		t.Error("the phone's own Notepad id survived")
	}
	w.expectInSync()
}

func TestDailyNotesOfOneDateMerge(t *testing.T) {
	w := newWorld(t)
	var srvDay, phoneDay struct {
		ID string `json:"id"`
	}
	w.server.call("GET", "/api/journal/daily?date=2026-11-20", nil, &srvDay)
	w.phone.call("GET", "/api/journal/daily?date=2026-11-20", nil, &phoneDay)
	if srvDay.ID == phoneDay.ID {
		t.Fatal("both sides made the same id")
	}
	w.server.call("PUT", "/api/journal/notes/"+srvDay.ID, map[string]string{"title": "2026-11-20", "body": "## 2026-11-20\n\nmorning on the laptop\n"}, nil)
	w.phone.call("PUT", "/api/journal/notes/"+phoneDay.ID, map[string]string{"title": "2026-11-20", "body": "## 2026-11-20\n\nevening on the phone\n"}, nil)
	w.sync()
	for name, p := range map[string]*peer{"phone": w.phone, "server": w.server} {
		ids := p.notesTitled("journal", "2026-11-20")
		if len(ids) != 1 || ids[0] != srvDay.ID {
			t.Fatalf("%s: daily notes %v, want only %s", name, ids, srvDay.ID)
		}
		n, _ := p.note("journal", srvDay.ID)
		if want := "## 2026-11-20\n\nmorning on the laptop\n\nevening on the phone\n"; n.Body != want {
			t.Errorf("%s: %q, want %q", name, n.Body, want)
		}
	}
	w.expectInSync()
}

func TestVaultsAndSpacesTravelBothWays(t *testing.T) {
	w := newWorld(t)
	w.sync()
	space := w.server.structure().Spaces[0].ID
	var pv, sp struct {
		ID string `json:"id"`
	}
	w.phone.call("POST", "/api/vaults", map[string]string{"name": "Recipes", "spaceId": space}, &pv)
	w.server.call("POST", "/api/spaces", map[string]string{"name": "Work"}, &sp)
	w.sync()
	w.expectInSync()
	if _, err := w.server.h.Registry.Get(pv.ID); err != nil {
		t.Errorf("phone's vault not on the server with its id: %v", err)
	}
	found := false
	for _, s := range w.phone.structure().Spaces {
		found = found || (s.ID == sp.ID && s.Name == "Work")
	}
	if !found {
		t.Error("server's space not on the phone")
	}
	note := w.server.createNote(pv.ID, "Soup", "", "hot\n")

	w.phone.call("PUT", "/api/vaults/"+pv.ID, map[string]string{"name": "Cooking"}, nil)
	w.sync()
	if v, _ := w.server.h.Registry.Get(pv.ID); v.Name != "Cooking" {
		t.Errorf("rename didn't reach the server: %q", v.Name)
	}
	if _, ok := w.phone.note(pv.ID, note); !ok {
		t.Error("note in the new vault didn't reach the phone")
	}
	w.expectInSync()

	// A vault deleted on the phone goes on the server (nothing changed in
	// it there).
	w.phone.call("DELETE", "/api/vaults/"+pv.ID, nil, nil)
	w.sync()
	if _, err := w.server.h.Registry.Get(pv.ID); err == nil {
		t.Error("vault deleted on the phone is still on the server")
	}
	w.expectInSync()

	// One deleted on the server while the phone wrote in it comes back
	// there, with the phone's note.
	var kept struct {
		ID string `json:"id"`
	}
	w.server.call("POST", "/api/vaults", map[string]string{"name": "Drafts", "spaceId": space}, &kept)
	w.sync()
	draft := w.phone.createNote(kept.ID, "Draft", "", "written offline\n")
	w.server.call("DELETE", "/api/vaults/"+kept.ID, nil, nil)
	w.sync()
	if n, ok := w.server.note(kept.ID, draft); !ok || n.Body != "written offline\n" {
		t.Errorf("vault with the phone's changes wasn't recreated on the server: %v %q", ok, n.Body)
	}
	w.expectInSync()

	// A space made on the phone reaches the server with its id.
	var ps struct {
		ID string `json:"id"`
	}
	w.phone.call("POST", "/api/spaces", map[string]string{"name": "Family"}, &ps)
	w.sync()
	if s, err := w.server.h.Spaces.Get(ps.ID); err != nil || s.Name != "Family" {
		t.Errorf("phone's space on the server: %+v %v", s, err)
	}
	w.expectInSync()
}

func TestServerScopeIsOwnedSpacesOnly(t *testing.T) {
	w := newWorld(t)
	bob, err := accounts.NewUser("bob", "Bob", accounts.RoleMember)
	if err != nil {
		t.Fatal(err)
	}
	if bob, err = w.server.h.Accounts.CreateUser(bob); err != nil {
		t.Fatal(err)
	}
	shared, err := w.server.h.Spaces.Create("Bob's", "", bob.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.server.h.Spaces.SetMember(shared.ID, w.server.user, notes.SpaceEditor); err != nil {
		t.Fatal(err)
	}
	vault, err := w.server.h.Registry.Create("Shared notes", "", shared.ID)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := w.svc.current()
	server, _ := ParseServer(c.Server)
	remote := remoteSide{s: w.svc, server: server, token: c.Token}
	if _, err := remote.Manifest(context.Background(), vault.ID); !errors.Is(err, notes.ErrNotFound) {
		t.Errorf("manifest of a vault in a space the user only edits: %v, want not found", err)
	}
	s, err := remote.Structure(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(js(s), shared.ID) {
		t.Error("the structure lists a space the user doesn't own")
	}
	w.sync()
	if _, err := w.phone.h.Registry.Get(vault.ID); err == nil {
		t.Error("a shared vault reached the phone")
	}
}

func TestSchedulerSyncsOnDemand(t *testing.T) {
	w := newWorld(t)
	// The world set the scheduler's fields by hand; start it for real.
	ph, user, folder, home := w.svc.sched.local, w.svc.sched.localUser, w.svc.sched.folder, w.svc.sched.home
	w.svc.sched.local = nil
	w.svc.Attach(ph, user, folder, home)
	t.Cleanup(w.svc.Close)
	id := w.phone.createNote(w.phone.vault(""), "Hello", "", "hi\n")
	if err := w.svc.SyncNowWait(30 * time.Second); err != nil {
		t.Fatal(err)
	}
	if _, ok := w.server.note(w.server.vault(""), id); !ok {
		t.Error("the note didn't reach the server")
	}
	rec := httptest.NewRecorder()
	w.svc.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/api/local/sync", nil))
	var st struct {
		Connected     bool    `json:"connected"`
		Syncing       *bool   `json:"syncing"`
		LastSyncAt    *string `json:"lastSyncAt"`
		LastConflicts *int    `json:"lastConflicts"`
		Pending       *int    `json:"pending"`
		LastError     *string `json:"lastError"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if !st.Connected || st.Syncing == nil || st.LastSyncAt == nil || st.LastConflicts == nil || st.Pending == nil || st.LastError != nil {
		t.Errorf("status %s", rec.Body)
	}
	rec = httptest.NewRecorder()
	w.svc.Handler().ServeHTTP(rec, httptest.NewRequest("POST", "/api/local/sync/now", nil))
	if rec.Code != http.StatusAccepted || strings.TrimSpace(rec.Body.String()) != "{}" {
		t.Errorf("sync now: %d %s", rec.Code, rec.Body)
	}
}

func TestCollectionsPrefsFoldersLabelsAndBookmarks(t *testing.T) {
	w := newWorld(t)
	w.sync()
	space := w.server.structure().Spaces[0].ID
	v := w.server.vault("")
	w.server.call("POST", "/api/collections?space="+space, map[string]any{"name": "Wines", "icon": "Wine"}, nil)
	w.phone.call("PATCH", "/api/me/prefs", map[string]any{"prefs": map[string]string{"notepadFolder": "Inbox"}}, nil)
	w.phone.call("POST", "/api/vaults/"+v+"/folders", map[string]string{"path": "Empty/Inner"}, nil)
	w.server.call("POST", "/api/vaults/"+v+"/folders", map[string]string{"path": "Archive"}, nil)
	w.server.call("PUT", "/api/vaults/"+v+"/folders/label", map[string]string{"path": "Archive", "color": "red"}, nil)
	id := w.phone.createNote(v, "Keep", "", "k\n")
	w.phone.call("POST", "/api/vaults/"+v+"/bookmarks", map[string]string{"id": id}, nil)
	w.sync()

	cols := w.phone.structure().Collections[space]
	if !strings.Contains(js(cols), `"id":"wines"`) {
		t.Errorf("collection didn't reach the phone: %s", js(cols))
	}
	if p := w.server.structure().Prefs["notepadFolder"]; p != "Inbox" {
		t.Errorf("server's notepadFolder %q", p)
	}
	if m := w.server.manifest(v); !strings.Contains(js(m.Folders), "Empty/Inner") || !slicesContain(m.Bookmarks, id) {
		t.Errorf("server's folders %v / bookmarks %v", m.Folders, m.Bookmarks)
	}
	if m := w.phone.manifest(v); m.Labels["Archive"] != "red" || !slicesContain(m.Folders, "Archive") {
		t.Errorf("phone's labels %v / folders %v", m.Labels, m.Folders)
	}
	w.expectInSync()

	// An empty folder removed on one side goes on the other.
	w.phone.call("DELETE", "/api/vaults/"+v+"/folders/Empty", nil, nil)
	w.sync()
	if slicesContain(w.server.manifest(v).Folders, "Empty") {
		t.Error("folder removed on the phone is still on the server")
	}
	w.expectInSync()
}

func slicesContain(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func TestSecondSyncChangesNothing(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	w.server.createNote(v, "A", "F", "a\n")
	w.phone.createNote("home", "B", "", "b\n")
	w.phone.call("GET", "/api/journal/daily?date=2026-11-02", nil, nil)
	w.sync()
	if writes := w.syncWrites(func() { w.sync() }); writes != 0 {
		t.Errorf("the second sync wrote %d times, want a no-op", writes)
	}
	w.expectInSync()
}

func TestLostStateMakesNoDuplicates(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	w.server.createNote(v, "A", "", "a\n")
	w.phone.createNote(w.phone.vault(""), "B", "", "b\n")
	w.sync()
	before := len(w.server.manifest(v).Notes)
	files, _ := filepath.Glob(filepath.Join(w.host.StateDir(), "sync-state-*.json"))
	if len(files) == 0 {
		t.Fatal("no state file written")
	}
	for _, f := range files {
		os.Remove(f)
	}
	if conflicts := w.sync(); conflicts != 0 {
		t.Errorf("%d offline copies after losing the state", conflicts)
	}
	if after := len(w.server.manifest(v).Notes); after != before {
		t.Errorf("%d notes after losing the state, want %d", after, before)
	}
	w.expectInSync()
}

func TestRevokedTokenStopsSyncing(t *testing.T) {
	w := newWorld(t)
	w.sync()
	c, _ := w.svc.current()
	if err := w.server.h.Accounts.DeleteDevice(w.server.user, c.Device.ID); err != nil {
		t.Fatal(err)
	}
	w.svc.runOnce()
	c, _ = w.svc.current()
	if c == nil || !c.Revoked {
		t.Fatalf("connection %+v, want kept and revoked", c)
	}
	if st := w.svc.syncStatus(); st.LastError == "" {
		t.Error("no error in the status")
	}
	// No more syncing: a wait returns at once.
	if err := w.svc.SyncNowWait(0); err != nil {
		t.Errorf("SyncNowWait after revocation: %v", err)
	}
}

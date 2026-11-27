package serversync

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nexote/api"
	"nexote/notes"
)

// Tests for the paths where a sync could lose data.

// failingLocal wraps the device's side and fails chosen writes the way a
// concurrent edit does (the expected hash no longer matches).
type failingLocal struct {
	side
	failPut    func(note api.SyncNote, expect string) bool
	failDelete func(id string) bool
}

func (f failingLocal) PutNote(ctx context.Context, scope string, note api.SyncNote, expect string) (api.SyncNoteInfo, error) {
	if f.failPut != nil && f.failPut(note, expect) {
		return api.SyncNoteInfo{}, api.ErrSyncConflict
	}
	return f.side.PutNote(ctx, scope, note, expect)
}

func (f failingLocal) DeleteNote(ctx context.Context, scope, id, expect string) error {
	if f.failDelete != nil && f.failDelete(id) {
		return api.ErrSyncConflict
	}
	return f.side.DeleteNote(ctx, scope, id, expect)
}

func TestEmptiedScopeDoesNotDeleteTheOtherSide(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	a := w.server.createNote(v, "A", "", "a\n")
	b := w.server.createNote(v, "B", "", "b\n")
	w.sync()
	// The phone's vault loses every note at once (a wiped folder, not a
	// cleanup): the server keeps them, and the phone gets them back.
	w.phone.deleteNote(v, a)
	w.phone.deleteNote(v, b)
	w.sync()
	for _, id := range []string{a, b} {
		if _, ok := w.server.note(v, id); !ok {
			t.Errorf("note %s was deleted on the server", id)
		}
		if _, ok := w.phone.note(v, id); !ok {
			t.Errorf("note %s didn't come back to the phone", id)
		}
	}
	w.expectInSync()
}

func TestSyncDeletionsKeepTheLastVersionInHistory(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	keep := w.server.createNote(v, "Keep", "", "k\n")
	id := w.server.createNote(v, "Gone", "", "last words\n")
	w.sync()
	w.server.deleteNote(v, id)
	w.sync()
	if _, ok := w.phone.note(v, id); ok {
		t.Fatal("note still on the phone")
	}
	store, _ := w.phone.h.Registry.Store(v)
	versions, err := store.ListHistory(id)
	if err != nil || len(versions) == 0 {
		t.Fatalf("no history of the deleted note on the phone: %v %v", versions, err)
	}
	doc, err := store.GetHistoryVersion(id, versions[0].Timestamp.UnixNano())
	if err != nil || doc.Body != "last words\n" {
		t.Errorf("history version %q, %v", doc.Body, err)
	}
	_ = keep
}

func TestOfflineCopyExistsBeforeTheServerVersionReplacesTheNote(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	id := w.server.createNote(v, "Plan", "", "v1\n")
	w.sync()
	w.server.updateNote(v, id, "Plan", "server's v2\n")
	w.phone.updateNote(v, id, "Plan", "phone's v2\n")
	// The run stops right where the server's version would replace the
	// phone's (the user typed at that moment).
	w.svc.localHook = func(l side) side {
		return failingLocal{side: l, failPut: func(n api.SyncNote, _ string) bool { return n.Meta.ID == id }}
	}
	r := w.syncRun()
	w.svc.localHook = nil
	if r.conflicts != 1 {
		t.Fatalf("%d offline copies", r.conflicts)
	}
	if n, _ := w.phone.note(v, id); n.Body != "phone's v2\n" {
		t.Errorf("phone's note %q, want its own version still", n.Body)
	}
	for name, p := range map[string]*peer{"phone": w.phone, "server": w.server} {
		if copies := p.notesTitled(v, "Plan (offline copy)"); len(copies) != 1 {
			t.Errorf("%s: %d offline copies, want 1", name, len(copies))
		}
	}
	// The next run finishes the job without another copy.
	w.sync()
	if n, _ := w.phone.note(v, id); n.Body != "server's v2\n" {
		t.Errorf("phone's note %q after the next run", n.Body)
	}
	if copies := w.server.notesTitled(v, "Plan (offline copy)"); len(copies) != 1 {
		t.Errorf("%d offline copies after the next run", len(copies))
	}
	w.expectInSync()
}

func TestUnreadableNoteLeavesItsScopeAlone(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	id := w.server.createNote(v, "Fragile", "", "fine\n")
	w.sync()
	store, _ := w.phone.h.Registry.Store(v)
	if err := os.WriteFile(filepath.Join(store.Dir, "Fragile.md"), []byte("---\nid: [broken\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := w.syncRun()
	if len(r.problems) == 0 {
		t.Error("the unreadable note wasn't reported")
	}
	if _, ok := w.server.note(v, id); !ok {
		t.Error("the server deleted the note the phone can't read")
	}
}

func TestNoteWithoutFrontmatterSyncsUnderItsFileName(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	w.sync()
	store, _ := w.phone.h.Registry.Store(v)
	if err := os.WriteFile(filepath.Join(store.Dir, "Scribble.md"), []byte("written by hand\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	w.sync()
	n, ok := w.server.note(v, "Scribble")
	if !ok || n.Body != "written by hand\n" {
		t.Fatalf("server's copy %v %q", ok, n.Body)
	}
	if writes := w.syncWrites(func() { w.sync() }); writes != 0 {
		t.Errorf("the next sync wrote %d times", writes)
	}
	w.expectInSync()
}

func TestReferencedAttachmentIsNeverDeleted(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	id := w.phone.createNote(w.phone.vault(""), "Photo", "", "x\n")
	w.sync()
	store, _ := w.phone.h.Registry.Store(v)
	img, err := store.SaveImage(id, "png", v, pngBytes)
	if err != nil {
		t.Fatal(err)
	}
	w.phone.updateNote(v, id, "Photo", "![]("+img.URL+")\n")
	w.sync()
	// The server loses the file while its note still shows it.
	srvStore, _ := w.server.h.Registry.Store(v)
	if err := srvStore.DeleteImage(img.Name); err != nil {
		t.Fatal(err)
	}
	w.sync()
	if _, err := w.phone.h.SyncReadAttachment(w.phone.user, v, img.Name); err != nil {
		t.Errorf("the phone's copy was deleted: %v", err)
	}
	if _, err := w.server.h.SyncReadAttachment(w.server.user, v, img.Name); err != nil {
		t.Errorf("the server didn't get the file back: %v", err)
	}
	w.expectInSync()
}

func TestRefusedRenameIsNotRecordedAsSynced(t *testing.T) {
	w := newWorld(t)
	space := w.server.structure().Spaces[0].ID
	var a, b struct {
		ID string `json:"id"`
	}
	w.server.call("POST", "/api/vaults", map[string]string{"name": "Alpha", "spaceId": space}, &a)
	w.sync()
	// On the server another vault takes the name the phone renames to.
	w.server.call("POST", "/api/vaults", map[string]string{"name": "Beta", "spaceId": space}, &b)
	w.phone.call("PUT", "/api/vaults/"+a.ID, map[string]string{"name": "Beta"}, nil)
	if r := w.syncRun(); r.skipped == 0 {
		t.Fatal("the rename went through, want refused")
	}
	w.syncRun()
	if v, _ := w.phone.h.Registry.Get(a.ID); v.Name != "Beta" {
		t.Errorf("phone's vault renamed back to %q", v.Name)
	}
}

func TestFailedNotepadMergeLeavesNoSecondNotepad(t *testing.T) {
	w := newWorld(t)
	srvPad := w.server.createNote("home", "Notepad", "", "### 2026-11-20\n- 09:00 server\n")
	phonePad := w.phone.createNote("home", "Notepad", "", "### 2026-11-20\n- 08:00 phone\n")
	w.svc.localHook = func(l side) side {
		return failingLocal{side: l, failDelete: func(id string) bool { return id == phonePad }}
	}
	w.syncRun()
	w.svc.localHook = nil
	if ids := w.server.notesTitled("home", "Notepad"); len(ids) != 1 || ids[0] != srvPad {
		t.Fatalf("server's Notepads %v, want only %s", ids, srvPad)
	}
	w.sync()
	for name, p := range map[string]*peer{"phone": w.phone, "server": w.server} {
		if ids := p.notesTitled("home", "Notepad"); len(ids) != 1 || ids[0] != srvPad {
			t.Errorf("%s: Notepads %v after the next run", name, ids)
		}
	}
	w.expectInSync()
}

func TestFirstSyncKeepsPrefsSetOnlyOnThePhone(t *testing.T) {
	w := newWorld(t)
	w.phone.call("PATCH", "/api/me/prefs", map[string]any{"prefs": map[string]string{"memoNoteFolder": "Memos"}}, nil)
	w.server.call("PATCH", "/api/me/prefs", map[string]any{"prefs": map[string]string{"notepadFolder": "Inbox"}}, nil)
	w.sync()
	for name, p := range map[string]*peer{"phone": w.phone, "server": w.server} {
		prefs := p.structure().Prefs
		if prefs["memoNoteFolder"] != "Memos" || prefs["notepadFolder"] != "Inbox" {
			t.Errorf("%s prefs %v, want both", name, prefs)
		}
	}
}

func TestRekeyEventComesBeforeSpacesChange(t *testing.T) {
	w := newWorld(t)
	pSpace, pVault := w.phone.structure().Spaces[0].ID, w.phone.vault("")
	sSpace, sVault := w.server.structure().Spaces[0].ID, w.server.vault("")
	events, cancel := w.phone.h.SubscribeEvents(w.phone.user)
	defer cancel()
	w.sync()
	var types []string
	var rekey api.NoteEvent
	for done := false; !done; {
		select {
		case ev := <-events:
			types = append(types, ev.Type)
			if ev.Type == "rekey" {
				rekey = ev
			}
		default:
			done = true
		}
	}
	if len(types) == 0 || types[0] != "rekey" {
		t.Fatalf("events %v, want rekey first", types)
	}
	if rekey.Spaces[pSpace] != sSpace || rekey.Vaults[pVault] != sVault {
		t.Errorf("rekey %v %v, want %s→%s and %s→%s", rekey.Spaces, rekey.Vaults, pSpace, sSpace, pVault, sVault)
	}
}

func TestServerRefusesOtherUsersAndHiddenPaths(t *testing.T) {
	w := newWorld(t)
	space := w.server.structure().Spaces[0].ID
	other, err := w.server.h.Spaces.Create("Someone else's", "", "nobody")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := w.server.h.Registry.Create("Secret plans", "", other.ID)
	if err != nil {
		t.Fatal(err)
	}
	err = w.server.h.SyncPutVault(w.server.user, api.SyncVault{ID: foreign.ID, SpaceID: space, Name: "Mine"})
	if !errors.Is(err, notes.ErrNotFound) || strings.Contains(err.Error(), "Secret") {
		t.Errorf("putting another user's vault id: %v, want plain not found", err)
	}
	v := w.server.vault("")
	for _, p := range []string{".nexote/folder-id", "x/.hidden.png", "../escape.png", "notes.md"} {
		if _, err := w.server.h.SyncReadAttachment(w.server.user, v, p); !errors.Is(err, notes.ErrNotFound) {
			t.Errorf("reading %q: %v, want not found", p, err)
		}
		if err := w.server.h.SyncDeleteAttachment(w.server.user, v, p); !errors.Is(err, notes.ErrNotFound) {
			t.Errorf("deleting %q: %v, want not found", p, err)
		}
	}
}

func TestSyncNowWaitJoinsTheRunningSync(t *testing.T) {
	w := newWorld(t)
	sc := &w.svc.sched
	sc.kick = make(chan struct{}, 1)
	sc.syncing = true
	result := make(chan error, 1)
	go func() { result <- w.svc.SyncNowWait(5 * time.Second) }()
	deadline := time.Now().Add(2 * time.Second)
	for {
		sc.mu.Lock()
		joined := len(sc.running)
		sc.mu.Unlock()
		if joined == 1 || time.Now().After(deadline) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if len(sc.kick) != 0 {
		t.Error("SyncNowWait queued another run instead of waiting for the running one")
	}
	sc.mu.Lock()
	waiters := sc.running
	sc.running, sc.syncing = nil, false
	sc.mu.Unlock()
	if len(waiters) != 1 {
		t.Fatalf("%d waiters on the running sync", len(waiters))
	}
	waiters[0] <- nil
	if err := <-result; err != nil {
		t.Error(err)
	}
}

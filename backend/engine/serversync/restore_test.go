package serversync

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"nexote/api"
	"nexote/notes"
)

// Restores from a backup: a side whose data is older than the last sync
// must not be read against that sync's base (its missing notes would look
// deleted, its older versions like edits).

func (w *world) store(p *peer, vault string) *notes.Store {
	w.t.Helper()
	s, err := p.h.Registry.Store(vault)
	if err != nil {
		w.t.Fatal(err)
	}
	return s
}

func (w *world) offlineCopies(p *peer, vault, title string) []string {
	w.t.Helper()
	var bodies []string
	for _, id := range p.notesTitled(vault, title+" (offline copy)") {
		n, _ := p.note(vault, id)
		bodies = append(bodies, n.Body)
	}
	return bodies
}

func TestRestoredPhoneFolderDoesNotRollTheServerBack(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	a := w.server.createNote(v, "A", "", "v1\n")
	w.sync()
	phone := w.store(w.phone, v)
	oldA, _ := phone.Get(a)
	oldMark, err := os.ReadFile(lastSyncFile(w.phoneHome))
	if err != nil {
		t.Fatalf("no last-sync file in the data folder: %v", err)
	}

	w.phone.updateNote(v, a, "A", "v2\n")
	b := w.phone.createNote(v, "B", "", "new since\n")
	w.sync()

	// The phone's folder comes back from the backup taken after the first
	// sync: A is old again, B never existed, the folder's mark is old.
	if err := phone.Import(oldA, nil); err != nil {
		t.Fatal(err)
	}
	if err := phone.DeleteIf(b, nil); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(lastSyncFile(w.phoneHome), oldMark, 0o644); err != nil {
		t.Fatal(err)
	}

	r := w.syncRun()
	if !r.union {
		t.Error("the restore wasn't noticed")
	}
	if n, ok := w.server.note(v, b); !ok || n.Body != "new since\n" {
		t.Errorf("server's B: %v %q, want kept", ok, n.Body)
	}
	if n, _ := w.server.note(v, a); n.Body != "v2\n" {
		t.Errorf("server's A %q, want the newer edit", n.Body)
	}
	if _, ok := w.phone.note(v, b); !ok {
		t.Error("B didn't come back to the phone")
	}
	if got := w.offlineCopies(w.server, v, "A"); len(got) != 1 || got[0] != "v1\n" {
		t.Errorf("offline copies of A on the server: %q, want the restored v1", got)
	}
	w.expectInSync()
	if r := w.syncRun(); r.union || r.conflicts != 0 {
		t.Errorf("the run after the merge: union %v, %d conflicts", r.union, r.conflicts)
	}
}

func TestRestoredServerDoesNotRollThePhoneBack(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	a := w.server.createNote(v, "A", "", "v1\n")
	w.sync()
	server := w.store(w.server, v)
	oldA, _ := server.Get(a)
	devicesFile := filepath.Join(w.serverHome, "auth", "devices.json")
	oldDevices, err := os.ReadFile(devicesFile)
	if err != nil {
		t.Fatal(err)
	}

	w.phone.updateNote(v, a, "A", "v2\n")
	b := w.phone.createNote(v, "B", "", "new since\n")
	w.sync()

	// The server's data volume comes back from that day's backup: A is old
	// again, B is gone, and so is the device's record of the second sync.
	if err := server.Import(oldA, nil); err != nil {
		t.Fatal(err)
	}
	if err := server.DeleteIf(b, nil); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(devicesFile, oldDevices, 0o600); err != nil {
		t.Fatal(err)
	}

	r := w.syncRun()
	if !r.union {
		t.Error("the restore wasn't noticed")
	}
	for name, p := range map[string]*peer{"phone": w.phone, "server": w.server} {
		if n, ok := p.note(v, b); !ok || n.Body != "new since\n" {
			t.Errorf("%s's B: %v %q, want kept", name, ok, n.Body)
		}
		if got := w.offlineCopies(p, v, "A"); len(got) != 1 || got[0] != "v2\n" {
			t.Errorf("%s: offline copies of A %q, want the phone's newer v2", name, got)
		}
	}
	w.expectInSync()
}

// hardFail fails one note write the way a full disk does: the run stops.
type hardFail struct {
	side
	id string
}

var errDiskFull = errors.New("disk full")

func (f hardFail) PutNote(ctx context.Context, scope string, note api.SyncNote, expect string) (api.SyncNoteInfo, error) {
	if note.Meta.ID == f.id {
		return api.SyncNoteInfo{}, errDiskFull
	}
	return f.side.PutNote(ctx, scope, note, expect)
}

func TestInterruptedRunIsFollowedByANormalRun(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	a := w.server.createNote(v, "A", "", "a1\n")
	b := w.server.createNote(v, "B", "", "b1\n")
	w.sync()
	w.server.updateNote(v, a, "A", "a2 on the server\n")
	w.phone.updateNote(v, b, "B", "b2 on the phone\n")

	w.svc.localHook = func(l side) side { return hardFail{side: l, id: a} }
	c, _ := w.svc.current()
	if _, err := w.svc.syncOnce(context.Background(), c); !errors.Is(err, errDiskFull) {
		t.Fatalf("interrupted run: %v", err)
	}
	w.svc.localHook = nil

	r := w.syncRun()
	if r.union || r.conflicts != 0 {
		t.Errorf("run after the interruption: union %v, %d conflicts; want a normal run", r.union, r.conflicts)
	}
	if n, _ := w.phone.note(v, a); n.Body != "a2 on the server\n" {
		t.Errorf("phone's A %q", n.Body)
	}
	if n, _ := w.server.note(v, b); n.Body != "b2 on the phone\n" {
		t.Errorf("server's B %q", n.Body)
	}
	w.expectInSync()
}

func TestLostDoneAnswerCostsOneMergeRun(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	w.server.createNote(v, "A", "", "a\n")
	w.sync()
	// The server recorded a run whose answer never reached the phone.
	c, _ := w.svc.current()
	if _, err := w.server.h.Accounts.TouchDeviceSync(w.server.user, c.Device.ID); err != nil {
		t.Fatal(err)
	}
	if r := w.syncRun(); !r.union || r.conflicts != 0 {
		t.Errorf("union %v, %d conflicts; want one clean merge run", r.union, r.conflicts)
	}
	w.expectInSync()
	if r := w.syncRun(); r.union {
		t.Error("the merge runs again")
	}
}

func TestDeletingTheOnlyNoteOfAScopeSyncs(t *testing.T) {
	w := newWorld(t)
	v := w.server.vault("")
	id := w.server.createNote(v, "Only", "", "alone\n")
	w.sync()
	w.phone.deleteNote(v, id)
	w.sync()
	if _, ok := w.server.note(v, id); ok {
		t.Error("the deleted note is still on the server")
	}
	if _, ok := w.phone.note(v, id); ok {
		t.Error("the deleted note came back to the phone")
	}
	w.expectInSync()
}

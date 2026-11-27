package notes

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func syncTestDoc(id string) Document {
	created := time.Date(2026, 3, 4, 5, 6, 7, 123456789, time.UTC)
	return Document{
		Meta: Meta{
			ID:        id,
			Title:     "Plan",
			Path:      "work",
			CreatedAt: created,
			UpdatedAt: created.Add(90*time.Minute + 987654321),
			Tags:      []string{"alpha"},
			Fields:    map[string]string{"k": "v"},
			Priority:  2,
		},
		Body: "Hello #alpha\n",
	}
}

func TestContentHash(t *testing.T) {
	base := syncTestDoc(NewID())
	h := ContentHash(base)
	if len(h) != 64 || ContentHash(base) != h {
		t.Fatalf("hash %q not a stable hex sha256", h)
	}

	same := base
	same.Meta.ID = NewID()
	same.Meta.CreatedAt = time.Now()
	same.Meta.UpdatedAt = time.Time{}
	same.Body = "\n\r\n\n" + base.Body
	if got := ContentHash(same); got != h {
		t.Fatalf("hash depends on id/timestamps/leading newlines: %q != %q", got, h)
	}

	for name, mutate := range map[string]func(*Document){
		"title":  func(d *Document) { d.Meta.Title = "Other" },
		"path":   func(d *Document) { d.Meta.Path = "home" },
		"body":   func(d *Document) { d.Body = "Hello #alpha!\n" },
		"fields": func(d *Document) { d.Meta.Fields = map[string]string{"k": "w"} },
	} {
		d := base
		mutate(&d)
		if ContentHash(d) == h {
			t.Errorf("hash ignores %s", name)
		}
	}
}

func newSyncStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestImportRoundTrip(t *testing.T) {
	s := newSyncStore(t)
	doc := syncTestDoc(NewID())
	doc.Body = "\n" + doc.Body

	var sawNil bool
	if err := s.Import(doc, func(cur *Document) error { sawNil = cur == nil; return nil }); err != nil {
		t.Fatal(err)
	}
	if !sawNil {
		t.Fatal("check got a current version for a new note")
	}
	got, err := s.Get(doc.Meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got.Meta, doc.Meta) {
		t.Fatalf("meta changed:\n got %+v\nwant %+v", got.Meta, doc.Meta)
	}
	if !got.Meta.UpdatedAt.Equal(doc.Meta.UpdatedAt) || got.Meta.UpdatedAt.Nanosecond() != doc.Meta.UpdatedAt.Nanosecond() {
		t.Fatalf("updatedAt %v, want %v", got.Meta.UpdatedAt, doc.Meta.UpdatedAt)
	}
	if ContentHash(got) != ContentHash(doc) {
		t.Fatal("hash changed by a store round trip")
	}
	if err := s.Import(Document{Meta: Meta{ID: "../escape", Title: "x"}}, nil); !errors.Is(err, ErrInvalidID) {
		t.Fatalf("invalid id: %v", err)
	}
}

func TestImportOverwriteMovesAndSnapshots(t *testing.T) {
	s := newSyncStore(t)
	v1 := syncTestDoc(NewID())
	if err := s.Import(v1, nil); err != nil {
		t.Fatal(err)
	}
	oldFile := filepath.Join(s.Dir, "work", "Plan.md")
	if _, err := os.Stat(oldFile); err != nil {
		t.Fatalf("v1 file: %v", err)
	}

	v2 := v1
	v2.Meta.Title = "Renamed"
	v2.Meta.Path = "home/sub"
	v2.Meta.UpdatedAt = v1.Meta.UpdatedAt.Add(time.Hour)
	v2.Body = "changed\n"
	var seen *Document
	if err := s.Import(v2, func(cur *Document) error { seen = cur; return nil }); err != nil {
		t.Fatal(err)
	}
	if seen == nil || seen.Meta.Title != "Plan" || seen.Body != v1.Body {
		t.Fatalf("check saw %+v, want v1", seen)
	}
	if _, err := os.Stat(oldFile); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old file still there: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "home", "sub", "Renamed.md")); err != nil {
		t.Fatalf("new file: %v", err)
	}
	hist, err := s.ListHistory(v1.Meta.ID)
	if err != nil || len(hist) != 1 {
		t.Fatalf("history after overwrite: %v %v", hist, err)
	}

	// Importing the same content again changes nothing worth a snapshot.
	if err := s.Import(v2, nil); err != nil {
		t.Fatal(err)
	}
	if hist, _ := s.ListHistory(v1.Meta.ID); len(hist) != 1 {
		t.Fatalf("identical import snapshotted: %d versions", len(hist))
	}

	// A check error aborts: nothing is written, the error comes back as is.
	stop := errors.New("stop")
	v3 := v2
	v3.Meta.Title = "Never"
	if err := s.Import(v3, func(*Document) error { return stop }); err != stop {
		t.Fatalf("aborted import: %v", err)
	}
	if got, _ := s.Get(v1.Meta.ID); got.Meta.Title != "Renamed" {
		t.Fatalf("aborted import wrote %q", got.Meta.Title)
	}
	fresh := syncTestDoc(NewID())
	if err := s.Import(fresh, func(*Document) error { return stop }); err != stop {
		t.Fatalf("aborted new import: %v", err)
	}
	if _, err := s.Get(fresh.Meta.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("aborted new import exists: %v", err)
	}
}

func TestDeleteIf(t *testing.T) {
	s := newSyncStore(t)
	doc := syncTestDoc(NewID())
	if err := s.Import(doc, nil); err != nil {
		t.Fatal(err)
	}
	stop := errors.New("stop")
	if err := s.DeleteIf(doc.Meta.ID, func(cur Document) error {
		if cur.Meta.Title != "Plan" {
			t.Errorf("check saw %q", cur.Meta.Title)
		}
		return stop
	}); err != stop {
		t.Fatalf("aborted delete: %v", err)
	}
	if _, err := s.Get(doc.Meta.ID); err != nil {
		t.Fatalf("aborted delete removed the note: %v", err)
	}
	if err := s.DeleteIf(doc.Meta.ID, func(Document) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(doc.Meta.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("note survived: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "work")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("empty parent not pruned: %v", err)
	}
	if err := s.DeleteIf(doc.Meta.ID, func(Document) error { t.Error("check called for absent note"); return nil }); err != nil {
		t.Fatalf("absent delete: %v", err)
	}
}

func TestRemoveFolderIfEmpty(t *testing.T) {
	s := newSyncStore(t)
	if err := os.MkdirAll(filepath.Join(s.Dir, "a", "b", "c"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.LabelFolder("a/b", "red"); err != nil {
		t.Fatal(err)
	}
	if err := s.LabelFolder("keep", "blue"); err != nil {
		t.Fatal(err)
	}
	full := filepath.Join(s.Dir, "x", "y", "img.png")
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := s.RemoveFolderIfEmpty("x"); !errors.Is(err, ErrFolderNotEmpty) {
		t.Fatalf("non-empty folder: %v", err)
	}
	if _, err := os.Stat(full); err != nil {
		t.Fatalf("file under refused folder: %v", err)
	}
	if err := s.RemoveFolderIfEmpty("a"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "a")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("empty tree survived: %v", err)
	}
	if labels := s.FolderLabels(); !reflect.DeepEqual(labels, map[string]string{"keep": "blue"}) {
		t.Fatalf("labels %v", labels)
	}
	if err := s.RemoveFolderIfEmpty("missing"); err != nil {
		t.Fatalf("missing folder: %v", err)
	}
	if err := s.RemoveFolderIfEmpty(""); err == nil {
		t.Fatal("root accepted")
	}
}

func TestAttachments(t *testing.T) {
	s := newSyncStore(t)
	if err := s.Import(syncTestDoc(NewID()), nil); err != nil {
		t.Fatal(err)
	}
	pdf := []byte("%PDF-1.7 test")
	if err := s.WriteAttachment("docs/deep/Contract.pdf", pdf); err != nil {
		t.Fatal(err)
	}
	if err := s.WriteAttachment("img-a.png", []byte("png")); err != nil {
		t.Fatal(err)
	}
	// Hidden content is not listed.
	if err := os.MkdirAll(filepath.Join(s.Dir, ".history", "x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Dir, ".history", "x", "img-h.png"), []byte("h"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Dir, ".hidden.png"), []byte("h"), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, bad := range []string{"../x.png", "/abs.png", "docs/notes.txt", "", "docs/../../x.pdf"} {
		if err := s.WriteAttachment(bad, []byte("x")); err == nil {
			t.Errorf("WriteAttachment(%q) accepted", bad)
		}
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(s.Dir), "x.png")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("wrote outside the store")
	}

	got, err := s.Attachments()
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int64{"docs/deep/Contract.pdf": int64(len(pdf)), "img-a.png": 3}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("attachments %v, want %v", got, want)
	}

	data, err := s.ReadImage("docs/deep/Contract.pdf")
	if err != nil || string(data) != string(pdf) {
		t.Fatalf("ReadImage pdf: %q %v", data, err)
	}
	if err := s.DeleteImage("docs/deep/Contract.pdf"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadImage("docs/deep/Contract.pdf"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted pdf: %v", err)
	}
	entries, _ := os.ReadDir(filepath.Join(s.Dir, "docs", "deep"))
	if len(entries) != 0 {
		t.Fatalf("temp files left: %v", entries)
	}
}

func TestRewriteBodies(t *testing.T) {
	s := newSyncStore(t)
	a := syncTestDoc(NewID())
	a.Body = "see old-link\n"
	b := syncTestDoc(NewID())
	b.Meta.Title = "Other"
	b.Body = "untouched\n"
	for _, d := range []Document{a, b} {
		if err := s.Import(d, nil); err != nil {
			t.Fatal(err)
		}
	}
	changed, err := s.RewriteBodies(func(body string) string {
		return strings.ReplaceAll(body, "old-link", "new-link")
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(changed, []string{a.Meta.ID}) {
		t.Fatalf("changed %v, want [%s]", changed, a.Meta.ID)
	}
	got, err := s.Get(a.Meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Body != "see new-link\n" || !reflect.DeepEqual(got.Meta, a.Meta) {
		t.Fatalf("rewritten note: %+v %q", got.Meta, got.Body)
	}
	if hist, _ := s.ListHistory(a.Meta.ID); len(hist) != 0 {
		t.Fatalf("rewrite snapshotted %d versions", len(hist))
	}
}

func TestVaultCreateWithIDRekeyMoveSpace(t *testing.T) {
	r, err := NewVaultRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	vaults, _ := r.List()
	defaultID := vaults[0].ID

	id := NewID()
	v, err := r.CreateWithID(id, "Work", "💼", "sp1", VaultTypeCollections)
	if err != nil {
		t.Fatal(err)
	}
	if v.ID != id || v.Type != VaultTypeCollections || v.SpaceID != "sp1" || v.Icon != "💼" {
		t.Fatalf("created %+v", v)
	}
	if _, err := os.Stat(v.Path); err != nil {
		t.Fatalf("vault dir: %v", err)
	}
	if _, err := r.CreateWithID(id, "Else", "", "sp1", ""); !errors.Is(err, ErrVaultExists) {
		t.Fatalf("duplicate id: %v", err)
	}
	if _, err := r.CreateWithID(NewID(), "Work", "", "sp1", ""); err == nil || err.Error() != `vault "Work" already exists` {
		t.Fatalf("duplicate name: %v", err)
	}
	if _, err := r.CreateWithID("bad", "Bad", "", "sp1", ""); err == nil {
		t.Fatal("invalid id accepted")
	}

	newID := NewID()
	if err := r.Rekey(id, newID); err != nil {
		t.Fatal(err)
	}
	got, err := r.Get(newID)
	if err != nil || got.Path != v.Path || got.Name != "Work" {
		t.Fatalf("rekeyed vault %+v %v", got, err)
	}
	if _, err := r.Get(id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old id still resolves: %v", err)
	}
	if err := r.Rekey(id, NewID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown old id: %v", err)
	}
	if err := r.Rekey(newID, defaultID); !errors.Is(err, ErrVaultExists) {
		t.Fatalf("taken new id: %v", err)
	}
	if err := r.Rekey(newID, "bad"); err == nil {
		t.Fatal("invalid new id accepted")
	}

	if err := r.MoveSpace("sp1", "sp2"); err != nil {
		t.Fatal(err)
	}
	moved, _ := r.ListSpace("sp2")
	if len(moved) != 1 || moved[0].ID != newID {
		t.Fatalf("sp2 vaults %+v", moved)
	}
	if left, _ := r.ListSpace("sp1"); len(left) != 0 {
		t.Fatalf("sp1 still has %+v", left)
	}
}

func TestSpaceCreateWithIDRekey(t *testing.T) {
	r, err := NewSpaceRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	first, err := r.Create("First", "", "u1")
	if err != nil {
		t.Fatal(err)
	}
	id := NewID()
	sp, err := r.CreateWithID(id, "Second", "🏠", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if sp.ID != id || sp.Name != "Second" {
		t.Fatalf("created %+v", sp)
	}
	if role, ok := sp.RoleOf("u1"); !ok || role != SpaceOwner {
		t.Fatalf("owner role %q %v", role, ok)
	}
	if _, err := r.CreateWithID(id, "Again", "", "u1"); !errors.Is(err, ErrSpaceExists) {
		t.Fatalf("duplicate id: %v", err)
	}
	if _, err := r.CreateWithID("bad", "Bad", "", "u1"); err == nil {
		t.Fatal("invalid id accepted")
	}

	newID := NewID()
	if err := r.Rekey(first.ID, newID); err != nil {
		t.Fatal(err)
	}
	list := r.List()
	if len(list) != 2 || list[0].ID != newID || list[0].Name != "First" || list[1].ID != id {
		t.Fatalf("order after rekey: %+v", list)
	}
	if err := r.Rekey(first.ID, NewID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown old id: %v", err)
	}
	if err := r.Rekey(newID, id); !errors.Is(err, ErrSpaceExists) {
		t.Fatalf("taken new id: %v", err)
	}
	if err := r.Rekey(newID, "bad"); err == nil {
		t.Fatal("invalid new id accepted")
	}
	// Persisted: a fresh registry sees the new id.
	reread, err := NewSpaceRegistry(filepath.Dir(r.path))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reread.Get(newID); err != nil {
		t.Fatalf("rekey not saved: %v", err)
	}
}

func TestCollectionPut(t *testing.T) {
	r, err := NewCollectionRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []CollectionMeta{{ID: "a", Name: "A"}, {ID: "b", Name: "B"}} {
		if err := r.Put(c); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Put(CollectionMeta{ID: "a", Name: "A2", Pinned: true}); err != nil {
		t.Fatal(err)
	}
	if err := r.Put(CollectionMeta{ID: "c", Name: "C"}); err != nil {
		t.Fatal(err)
	}
	cols, err := r.List()
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, c := range cols {
		got = append(got, c.ID+":"+c.Name)
	}
	if want := []string{"a:A2", "b:B", "c:C"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("collections %v, want %v", got, want)
	}
	if !cols[0].Pinned {
		t.Fatal("replaced collection lost its fields")
	}
	if err := r.Put(CollectionMeta{Name: "x"}); err == nil {
		t.Fatal("empty id accepted")
	}
}

func TestIDListReplace(t *testing.T) {
	b := NewBookmarks(t.TempDir(), "u1")
	if err := b.Add("old"); err != nil {
		t.Fatal(err)
	}
	if err := b.Replace([]string{"x", "y", "x", "z"}); err != nil {
		t.Fatal(err)
	}
	got, err := b.List()
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"x", "y", "z"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("list %v, want %v", got, want)
	}
	if err := b.Replace(nil); err != nil {
		t.Fatal(err)
	}
	if got, _ := b.List(); len(got) != 0 {
		t.Fatalf("list after empty replace %v", got)
	}
}

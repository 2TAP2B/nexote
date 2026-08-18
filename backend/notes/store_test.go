package notes

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	return s
}

func TestCreateAndRead(t *testing.T) {
	s := newTestStore(t)

	doc, err := s.Create(CreateInput{Title: "First"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if doc.Meta.ID == "" {
		t.Fatal("id is empty")
	}
	if doc.Meta.Title != "First" {
		t.Errorf("title = %q, want %q", doc.Meta.Title, "First")
	}
	if doc.Body != "" {
		t.Errorf("body = %q, want empty", doc.Body)
	}

	// File exists on disk with the right name.
	if _, err := os.Stat(filepath.Join(s.Dir, doc.Meta.ID+".md")); err != nil {
		t.Fatalf("file not created: %v", err)
	}

	got, err := s.Get(doc.Meta.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Meta.ID != doc.Meta.ID {
		t.Errorf("Get id = %q, want %q", got.Meta.ID, doc.Meta.ID)
	}
}

func TestCreateDefaultsUntitled(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if doc.Meta.Title != "Untitled" {
		t.Errorf("title = %q, want Untitled", doc.Meta.Title)
	}
}

func TestUpdateBumpsUpdatedAt(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{Title: "Orig"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	before := doc.Meta.UpdatedAt

	updated, err := s.Update(doc.Meta.ID, UpdateInput{
		Title: "Renamed",
		Body:  "# Body\n",
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Meta.Title != "Renamed" {
		t.Errorf("title = %q, want Renamed", updated.Meta.Title)
	}
	if updated.Body != "# Body\n" {
		t.Errorf("body = %q, want # Body\\n", updated.Body)
	}
	if !updated.Meta.UpdatedAt.After(before) {
		t.Errorf("updatedAt not bumped: before=%v after=%v", before, updated.Meta.UpdatedAt)
	}
	// createdAt preserved
	if !updated.Meta.CreatedAt.Equal(doc.Meta.CreatedAt) {
		t.Errorf("createdAt changed: %v -> %v", doc.Meta.CreatedAt, updated.Meta.CreatedAt)
	}
}

func TestUpdateNotFound(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Update("nope", UpdateInput{Title: "x"})
	if err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestGetNotFound(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Get("missing")
	if err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestDelete(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{Title: "To delete"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := s.Delete(doc.Meta.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, doc.Meta.ID+".md")); !os.IsNotExist(err) {
		t.Fatalf("file still exists: %v", err)
	}
}

func TestDeleteIdempotent(t *testing.T) {
	s := newTestStore(t)
	// Deleting a non-existent note is not an error.
	if err := s.Delete("never-existed"); err != nil {
		t.Errorf("Delete missing: %v", err)
	}
}

func TestList(t *testing.T) {
	s := newTestStore(t)
	a, _ := s.Create(CreateInput{Title: "A"})
	b, _ := s.Create(CreateInput{Title: "B"})

	result, err := s.List()
	list := result.Notes
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}
	ids := map[string]bool{a.Meta.ID: true, b.Meta.ID: true}
	for _, e := range list {
		if !ids[e.ID] {
			t.Errorf("unexpected id %q", e.ID)
		}
	}
}

func TestListIgnoresNonMarkdown(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Create(CreateInput{Title: "Real"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Drop a stray file that isn't a note.
	if err := os.WriteFile(filepath.Join(s.Dir, "README.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := s.List()
	list := result.Notes
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("len = %d, want 1 (should ignore .txt)", len(list))
	}
}

func TestNewIDUniqueAndSafe(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		id := NewID()
		if seen[id] {
			t.Fatalf("duplicate id after %d: %q", i, id)
		}
		seen[id] = true
		// base64url: no padding, no + or /
		if strings.ContainsAny(id, "+/=") {
			t.Fatalf("id not base64url-safe: %q", id)
		}
	}
}

func TestCreateWithPath(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{Title: "Nested", Path: "Folder/Sub"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if doc.Meta.Path != "Folder/Sub" {
		t.Fatalf("path = %q, want Folder/Sub", doc.Meta.Path)
	}
	// File lives in the nested folder.
	p := filepath.Join(s.Dir, "Folder", "Sub", doc.Meta.ID+".md")
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("file not in nested folder: %v", err)
	}
	// Get returns the path.
	got, err := s.Get(doc.Meta.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Meta.Path != "Folder/Sub" {
		t.Fatalf("Get path = %q, want Folder/Sub", got.Meta.Path)
	}
}

func TestListRecursive(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Create(CreateInput{Title: "Root"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(CreateInput{Title: "A", Path: "Folder"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(CreateInput{Title: "B", Path: "Folder/Sub"}); err != nil {
		t.Fatal(err)
	}
	result, err := s.List()
	list := result.Notes
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("len = %d, want 3", len(list))
	}
}

func TestSanitizePath(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"  ", ""},
		{"Folder", "Folder"},
		{"Folder/Sub", "Folder/Sub"},
		{"Folder\\Sub", "Folder/Sub"},
		{"/absolute", ""},
		{"../escape", ""},
		{"Folder/../../../etc", ""},
		{"./Folder", "Folder"},
	}
	for _, c := range cases {
		if got := sanitizePath(c.in); got != c.want {
			t.Errorf("sanitizePath(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestDailyCreatesAndReuses(t *testing.T) {
	s := newTestStore(t)
	d1, err := s.Daily()
	if err != nil {
		t.Fatalf("Daily: %v", err)
	}
	if d1.Meta.Path != "Journal" {
		t.Fatalf("path = %q, want Journal", d1.Meta.Path)
	}
	if d1.Body == "" {
		t.Fatal("daily body should be seeded")
	}
	// Second call returns the same note (not a new one).
	d2, err := s.Daily()
	if err != nil {
		t.Fatalf("Daily 2: %v", err)
	}
	if d2.Meta.ID != d1.Meta.ID {
		t.Fatalf("Daily created a second note: %q vs %q", d1.Meta.ID, d2.Meta.ID)
	}
}

// TestUpdateSyncsInlineTags verifies that a note's frontmatter tags mirror the
// inline #hashtags in its body: adding a tag shows up, and removing a #tag from
// the text drops it from the note.
func TestUpdateSyncsInlineTags(t *testing.T) {
	s := newTestStore(t)

	doc, err := s.Create(CreateInput{Title: "Tagged"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Add inline tags.
	doc, err = s.Update(doc.Meta.ID, UpdateInput{Title: "Tagged", Body: "#work and #ideas notes\n"})
	if err != nil {
		t.Fatalf("Update (add): %v", err)
	}
	if len(doc.Meta.Tags) != 2 {
		t.Fatalf("tags = %v, want [ideas work]", doc.Meta.Tags)
	}
	if !containsString(doc.Meta.Tags, "work") || !containsString(doc.Meta.Tags, "ideas") {
		t.Fatalf("tags = %v, want to include work and ideas", doc.Meta.Tags)
	}

	// Remove one inline tag — it must disappear from the note's tags.
	doc, err = s.Update(doc.Meta.ID, UpdateInput{Title: "Tagged", Body: "#work notes\n"})
	if err != nil {
		t.Fatalf("Update (remove): %v", err)
	}
	if len(doc.Meta.Tags) != 1 || doc.Meta.Tags[0] != "work" {
		t.Fatalf("tags = %v, want [work]", doc.Meta.Tags)
	}

	// Removing all inline tags empties the tag list.
	doc, err = s.Update(doc.Meta.ID, UpdateInput{Title: "Tagged", Body: "no tags here\n"})
	if err != nil {
		t.Fatalf("Update (clear): %v", err)
	}
	if len(doc.Meta.Tags) != 0 {
		t.Fatalf("tags = %v, want empty", doc.Meta.Tags)
	}

	// The tag index reflects the drop.
	idx, err := s.TagIndex()
	if err != nil {
		t.Fatalf("TagIndex: %v", err)
	}
	if len(idx) != 0 {
		t.Fatalf("tag index = %v, want empty", idx)
	}
}
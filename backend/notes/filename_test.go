package notes

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestFileNameBase(t *testing.T) {
	cases := []struct{ title, want string }{
		{"My Weekend Trip", "My Weekend Trip"},
		{"Wed 11-11-2026 22:35", "Wed 11-11-2026 22-35"},
		{`a/b\c*d?e"f<g>h|i`, "a-b-c-d-e-f-g-h-i"},
		{"  ..hidden & trailing..  ", "hidden & trailing"},
		{"tabs\tand\nnewlines", "tabs and newlines"},
		{"two   spaces", "two spaces"},
		{"Ünïcödé 🎉", "Ünïcödé 🎉"},
		{"", "Untitled"},
		{"...", "Untitled"},
		{"con", "_con"},
		{"LPT1.txt", "_LPT1.txt"},
		{"Console", "Console"},
	}
	for _, c := range cases {
		if got := fileNameBase(c.title); got != c.want {
			t.Errorf("fileNameBase(%q) = %q, want %q", c.title, got, c.want)
		}
	}
	long := fileNameBase(strings.Repeat("ä", 100))
	if len(long) > maxFileNameBytes || !utf8.ValidString(long) {
		t.Errorf("long title: %d bytes, valid utf8 %v", len(long), utf8.ValidString(long))
	}
}

func fileExists(t *testing.T, p string) bool {
	t.Helper()
	_, err := os.Stat(p)
	return err == nil
}

func TestNotesAreNamedAfterTheirTitle(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{Title: "Shopping List", Path: "Home"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if !fileExists(t, filepath.Join(s.Dir, "Home", "Shopping List.md")) {
		t.Fatal("note file is not named after its title")
	}

	// Rename, then look the note up from a fresh store: the file name says
	// nothing about the id, so the lookup must go through the frontmatter.
	// "Renamed-Slug-Test" is made only of id characters on purpose.
	if _, err := s.Update(doc.Meta.ID, UpdateInput{Title: "Renamed-Slug-Test", Body: doc.Body}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if fileExists(t, filepath.Join(s.Dir, "Home", "Shopping List.md")) {
		t.Fatal("old file left behind after rename")
	}
	if !fileExists(t, filepath.Join(s.Dir, "Home", "Renamed-Slug-Test.md")) {
		t.Fatal("renamed file missing")
	}
	cold, err := NewStore(s.Dir)
	if err != nil {
		t.Fatal(err)
	}
	got, err := cold.Get(doc.Meta.ID)
	if err != nil || got.Meta.Title != "Renamed-Slug-Test" {
		t.Fatalf("cold Get = %q, %v", got.Meta.Title, err)
	}

	// Moving to another folder carries the title name along.
	folder := "Archive"
	if _, err := s.Update(doc.Meta.ID, UpdateInput{Title: "Renamed-Slug-Test", Body: doc.Body, Path: &folder}); err != nil {
		t.Fatalf("move: %v", err)
	}
	if !fileExists(t, filepath.Join(s.Dir, "Archive", "Renamed-Slug-Test.md")) ||
		fileExists(t, filepath.Join(s.Dir, "Home", "Renamed-Slug-Test.md")) {
		t.Fatal("move did not relocate the title-named file")
	}
}

func TestDuplicateTitlesGetNumberedNames(t *testing.T) {
	s := newTestStore(t)
	a, _ := s.Create(CreateInput{Title: "Meeting"})
	b, _ := s.Create(CreateInput{Title: "Meeting"})
	c, _ := s.Create(CreateInput{Title: "meeting"}) // case-only clash: one file on macOS/Windows
	for _, name := range []string{"Meeting.md", "Meeting 1.md", "meeting 2.md"} {
		if !fileExists(t, filepath.Join(s.Dir, name)) {
			t.Fatalf("expected %s", name)
		}
	}
	// Saving again keeps every note on its own name (no flip-flopping).
	for _, d := range []Document{a, b, c} {
		if _, err := s.Update(d.Meta.ID, UpdateInput{Title: d.Meta.Title, Body: "## " + d.Meta.Title + "\n\nedit"}); err != nil {
			t.Fatalf("Update: %v", err)
		}
	}
	got, err := s.Get(c.Meta.ID)
	if err != nil || !strings.Contains(got.Body, "edit") {
		t.Fatalf("Get after resave: %v", err)
	}
	list, err := s.List()
	if err != nil || len(list.Notes) != 3 {
		t.Fatalf("List = %d notes, %v; want 3", len(list.Notes), err)
	}
}

// A file at the indexed path that now holds another note (renamed or
// replaced outside the app) must not be served for the old id.
func TestIndexedPathIsVerified(t *testing.T) {
	s := newTestStore(t)
	alpha, _ := s.Create(CreateInput{Title: "Alpha"})
	beta, _ := s.Create(CreateInput{Title: "Beta"})
	pa, pb := filepath.Join(s.Dir, "Alpha.md"), filepath.Join(s.Dir, "Beta.md")
	tmp := filepath.Join(s.Dir, "swap.tmp")
	if err := os.Rename(pa, tmp); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(pb, pa); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tmp, pb); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(alpha.Meta.ID)
	if err != nil || got.Meta.ID != alpha.Meta.ID {
		t.Fatalf("Get(alpha) = %q, %v", got.Meta.ID, err)
	}
	// Writing alpha must not delete beta, which now sits at alpha's old path.
	if _, err := s.Update(alpha.Meta.ID, UpdateInput{Title: "Alpha", Body: "## Alpha\n\nx"}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got, err := s.Get(beta.Meta.ID); err != nil || got.Meta.Title != "Beta" {
		t.Fatalf("beta lost: %v", err)
	}
}

// Legacy "<id>.md" files are renamed to their title in place; a second run
// changes nothing.
func TestNormalizeFileNamesMigratesLegacyLayout(t *testing.T) {
	s := newTestStore(t)
	doc, _ := s.Create(CreateInput{Title: "Old Note", Path: "Notes"})
	titled := filepath.Join(s.Dir, "Notes", "Old Note.md")
	legacy := filepath.Join(s.Dir, "Notes", doc.Meta.ID+".md")
	before, err := os.ReadFile(titled)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(titled, legacy); err != nil {
		t.Fatal(err)
	}

	fresh, _ := NewStore(s.Dir)
	n, err := fresh.NormalizeFileNames()
	if err != nil || n != 1 {
		t.Fatalf("NormalizeFileNames = %d, %v; want 1", n, err)
	}
	after, err := os.ReadFile(titled)
	if err != nil || string(after) != string(before) {
		t.Fatalf("migrated file missing or content changed: %v", err)
	}
	if fileExists(t, legacy) {
		t.Fatal("legacy file left behind")
	}
	if n, _ := fresh.NormalizeFileNames(); n != 0 {
		t.Fatalf("second run renamed %d files", n)
	}
}

// Two files holding one id (crash between writing a renamed file and
// removing the old one): List shows the newer one, and the migration gives
// the newer one the title name.
func TestDuplicateIDFilesPreferNewest(t *testing.T) {
	s := newTestStore(t)
	doc, _ := s.Create(CreateInput{Title: "Draft"})
	stale := doc
	stale.Body = "## Draft\n\nold"
	stale.Meta.UpdatedAt = doc.Meta.UpdatedAt.Add(-time.Hour)
	data, err := Encode(stale)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Dir, doc.Meta.ID+".md"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(doc.Meta.ID, UpdateInput{Title: "Draft", Body: "## Draft\n\nnew"}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	list, err := s.List()
	if err != nil || len(list.Notes) != 1 || !strings.Contains(list.Notes[0].Snippet, "new") {
		t.Fatalf("List = %+v, %v", list.Notes, err)
	}
	if _, err := s.NormalizeFileNames(); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(s.Dir, "Draft.md"))
	if err != nil || !strings.Contains(string(got), "new") {
		t.Fatalf("Draft.md lost the newest version: %v", err)
	}
}

package notes

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Note files are named after their title, Obsidian-style ("My Note.md"), so a
// vault — and a git sync of it — reads naturally. The note's identity is the
// frontmatter id: every lookup goes through it (see Store.read/resolvePath),
// never through the file name, so renaming a file never breaks URLs, tabs,
// history or bookmarks.

// maxFileNameBytes caps the title part of a file name. Filesystems allow 255
// bytes per name; the margin leaves room for " 999.md" and for deep folders
// on systems with short path limits (Windows checkouts of a git sync).
const maxFileNameBytes = 120

// windowsDeviceNames can't be used as file names on Windows, with or without
// an extension.
var windowsDeviceNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true,
	"COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true,
	"LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// fileNameBase turns a note title into a file name stem that is valid on
// Linux, macOS and Windows: characters forbidden there become "-", control
// characters are dropped, whitespace runs collapse to one space, leading dots
// (hidden files) and trailing dots/spaces (invalid on Windows) are trimmed,
// and the length is capped on a rune boundary. Case, spaces and unicode are
// kept. An empty result becomes "Untitled".
func fileNameBase(title string) string {
	var b strings.Builder
	space := false
	for _, r := range strings.TrimSpace(title) {
		switch {
		case r == '\t' || r == '\n' || r == '\r' || r == '\u00a0':
			r = ' '
		case r < 0x20 || r == 0x7f:
			continue
		case strings.ContainsRune(`/\:*?"<>|`, r):
			r = '-'
		}
		if r == ' ' {
			if space {
				continue
			}
			space = true
		} else {
			space = false
		}
		b.WriteRune(r)
	}
	s := strings.TrimLeft(b.String(), ". ")
	if len(s) > maxFileNameBytes {
		cut := 0
		for i := range s {
			if i > maxFileNameBytes {
				break
			}
			cut = i
		}
		s = s[:cut]
	}
	s = strings.TrimRight(s, ". ")
	if s == "" {
		return "Untitled"
	}
	if stem, _, _ := strings.Cut(s, "."); windowsDeviceNames[strings.ToUpper(stem)] {
		s = "_" + s
	}
	return s
}

// noteFileTarget picks the path note id should be written to in dir:
// "<title>.md", or "<title> N.md" when another note already owns that name.
// prev is the note's current file ("" for new notes); it is kept when it
// already carries exactly this title, so autosaves never touch the directory
// listing and names never flip-flop.
//
// Names are compared case-insensitively: "Note.md" and "note.md" are one
// file on macOS/Windows, so they count as a collision everywhere (a git sync
// checked out there stays clean). A name held by a file of the same note
// (prev under another case, or a stale duplicate) is reused.
func (s *Store) noteFileTarget(dir, id, title, prev string) string {
	base := fileNameBase(title)
	if prev != "" && filepath.Dir(prev) == dir && filepath.Base(prev) == base+".md" {
		return prev
	}
	taken := map[string]string{}
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			taken[strings.ToLower(e.Name())] = e.Name()
		}
	}
	for n := 0; n < 1000; n++ {
		name := base + ".md"
		if n > 0 {
			name = fmt.Sprintf("%s %d.md", base, n)
		}
		existing, ok := taken[strings.ToLower(name)]
		if !ok {
			return filepath.Join(dir, name)
		}
		holder := filepath.Join(dir, existing)
		if prev != "" && sameFile(holder, prev) {
			return filepath.Join(dir, name)
		}
		if hid, ok := fileNoteID(holder); ok && hid == id {
			return filepath.Join(dir, name)
		}
	}
	// A thousand notes with one title in one folder: fall back to the id,
	// which is unique by construction.
	return filepath.Join(dir, base+" "+id+".md")
}

// noteIDOf is the id of the note decoded from the file at p: its frontmatter
// id, or — for files without one — the file name minus ".md", which is how
// such files have always been indexed.
func noteIDOf(doc Document, p string) string {
	if doc.Meta.ID != "" {
		return doc.Meta.ID
	}
	return strings.TrimSuffix(filepath.Base(p), ".md")
}

// fileNoteID reads the note stored at p and returns its id (see noteIDOf).
func fileNoteID(p string) (string, bool) {
	data, err := os.ReadFile(p)
	if err != nil {
		return "", false
	}
	doc, err := Decode(data)
	if err != nil {
		return "", false
	}
	return noteIDOf(doc, p), true
}

// sameFile reports whether a and b name the same file on disk (true for a
// case-only difference on a case-insensitive filesystem).
func sameFile(a, b string) bool {
	if a == b {
		return true
	}
	fa, errA := os.Stat(a)
	fb, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(fa, fb)
}

// NormalizeFileNames renames every note file whose name doesn't match its
// title. It migrates the legacy "<id>.md" layout at startup and afterwards
// only fixes names changed outside the app. Files are renamed in place, never
// rewritten, so content and mtimes are untouched. Files without a frontmatter
// id aren't app notes and are left alone. If one id is stored in several
// files (a crash between writing a renamed file and removing the old one),
// the newest version is the one that gets the title name. Returns how many
// files were renamed.
func (s *Store) NormalizeFileNames() (int, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	type noteFile struct {
		path, id, title string
		updated         time.Time
	}
	var files []noteFile
	byID := map[string]int{}
	err := filepath.WalkDir(s.Dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == historyDirName {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		doc, err := Decode(data)
		if err != nil || doc.Meta.ID == "" {
			return nil
		}
		f := noteFile{path: p, id: doc.Meta.ID, title: doc.Meta.Title, updated: doc.Meta.UpdatedAt}
		if i, ok := byID[f.id]; ok {
			if f.updated.After(files[i].updated) {
				files[i] = f
			}
			return nil
		}
		byID[f.id] = len(files)
		files = append(files, f)
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("walk notes dir: %w", err)
	}

	renamed := 0
	for _, f := range files {
		target := s.noteFileTarget(filepath.Dir(f.path), f.id, f.title, f.path)
		if target != f.path {
			if err := os.Rename(f.path, target); err != nil {
				return renamed, fmt.Errorf("rename %s: %w", f.path, err)
			}
			renamed++
		}
		s.trackIndex(f.id, target)
	}
	if renamed > 0 {
		s.afterWrite()
	}
	return renamed, nil
}

package notes

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
)

// idList is a persisted, order-preserving set of note IDs stored as a JSON
// file. It backs both Bookmarks and Shortcuts.
type idList struct {
	dir  string
	file string
}

func newIDList(dir, file string) *idList {
	return &idList{dir: dir, file: file}
}

func (l *idList) path() string {
	return filepath.Join(l.dir, l.file)
}

// List returns the IDs in the order they were added.
func (l *idList) List() ([]string, error) {
	data, err := os.ReadFile(l.path())
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return []string{}, nil
	}
	return ids, nil
}

// Add inserts an ID. No-op if already present.
func (l *idList) Add(id string) error {
	ids, err := l.List()
	if err != nil {
		return err
	}
	for _, existing := range ids {
		if existing == id {
			return nil
		}
	}
	ids = append(ids, id)
	return l.write(ids)
}

// Remove deletes an ID. No-op if not present.
func (l *idList) Remove(id string) error {
	ids, err := l.List()
	if err != nil {
		return err
	}
	filtered := make([]string, 0, len(ids))
	for _, existing := range ids {
		if existing != id {
			filtered = append(filtered, existing)
		}
	}
	return l.write(filtered)
}

// Contains reports whether the given ID is in the list.
func (l *idList) Contains(id string) bool {
	ids, err := l.List()
	if err != nil {
		return false
	}
	for _, existing := range ids {
		if existing == id {
			return true
		}
	}
	return false
}

// Sorted returns the IDs sorted for stable comparison.
func (l *idList) Sorted() ([]string, error) {
	ids, err := l.List()
	if err != nil {
		return nil, err
	}
	sorted := make([]string, len(ids))
	copy(sorted, ids)
	sort.Strings(sorted)
	return sorted, nil
}

// Replace stores exactly ids (duplicates dropped, first occurrence kept),
// for sync taking over a peer's list wholesale.
func (l *idList) Replace(ids []string) error {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return l.write(out)
}

func (l *idList) write(ids []string) error {
	if ids == nil {
		ids = []string{}
	}
	data, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	return os.WriteFile(l.path(), data, 0o644)
}

// Bookmarks is a persisted set of note IDs a user has bookmarked in a vault.
type Bookmarks struct{ *idList }

// NewBookmarks creates the user's Bookmarks store in the given notes
// directory.
func NewBookmarks(dir, userID string) *Bookmarks {
	return &Bookmarks{newIDList(dir, ".bookmarks-"+userID+".json")}
}

// Shortcuts is a persisted set of note IDs a user pinned to the top of a
// vault's tree.
type Shortcuts struct{ *idList }

// NewShortcuts creates the user's Shortcuts store in the given notes
// directory.
func NewShortcuts(dir, userID string) *Shortcuts {
	return &Shortcuts{newIDList(dir, ".shortcuts-"+userID+".json")}
}

// listFilePatterns match every user's bookmark and shortcut files.
var listFilePatterns = []string{".bookmarks-*.json", ".shortcuts-*.json"}

// forgetInLists removes a note id from every user's lists in dir.
func forgetInLists(dir, noteID string) error {
	var firstErr error
	for _, pattern := range listFilePatterns {
		files, _ := filepath.Glob(filepath.Join(dir, pattern))
		for _, f := range files {
			if err := newIDList(dir, filepath.Base(f)).Remove(noteID); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

// AdoptLegacyLists gives the vault's pre-accounts bookmark and shortcut
// files (".bookmarks.json", ".shortcuts.json") to userID. It never
// overwrites a list the user already has.
func AdoptLegacyLists(dir, userID string) error {
	for _, kind := range []string{"bookmarks", "shortcuts"} {
		legacy := filepath.Join(dir, "."+kind+".json")
		target := filepath.Join(dir, "."+kind+"-"+userID+".json")
		if _, err := os.Stat(legacy); err != nil {
			continue
		}
		if _, err := os.Stat(target); err == nil {
			continue
		}
		if err := os.Rename(legacy, target); err != nil {
			return err
		}
	}
	return nil
}
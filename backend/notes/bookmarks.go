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

// Bookmarks is a persisted set of note IDs the user has bookmarked.
type Bookmarks struct{ *idList }

// NewBookmarks creates a Bookmarks store rooted at the given notes directory.
func NewBookmarks(dir string) *Bookmarks {
	return &Bookmarks{newIDList(dir, ".bookmarks.json")}
}

// Shortcuts is a persisted set of note IDs pinned to the top of the tree.
type Shortcuts struct{ *idList }

// NewShortcuts creates a Shortcuts store rooted at the given notes directory.
func NewShortcuts(dir string) *Shortcuts {
	return &Shortcuts{newIDList(dir, ".shortcuts.json")}
}
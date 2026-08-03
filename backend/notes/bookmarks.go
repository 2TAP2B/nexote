package notes

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
)

// Bookmarks is a persisted set of note IDs that the user has starred.
// Stored as a simple JSON file in the notes directory.
type Bookmarks struct {
	dir string
}

// NewBookmarks creates a Bookmarks store rooted at the given notes directory.
func NewBookmarks(dir string) *Bookmarks {
	return &Bookmarks{dir: dir}
}

func (b *Bookmarks) path() string {
	return filepath.Join(b.dir, ".bookmarks.json")
}

// List returns the bookmarked note IDs in the order they were added.
func (b *Bookmarks) List() ([]string, error) {
	data, err := os.ReadFile(b.path())
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

// Add bookmarks a note ID. No-op if already present.
func (b *Bookmarks) Add(id string) error {
	ids, err := b.List()
	if err != nil {
		return err
	}
	for _, existing := range ids {
		if existing == id {
			return nil
		}
	}
	ids = append(ids, id)
	return b.write(ids)
}

// Remove removes a bookmark. No-op if not present.
func (b *Bookmarks) Remove(id string) error {
	ids, err := b.List()
	if err != nil {
		return err
	}
	filtered := make([]string, 0, len(ids))
	for _, existing := range ids {
		if existing != id {
			filtered = append(filtered, existing)
		}
	}
	return b.write(filtered)
}

// IsBookmarked returns true if the given note ID is bookmarked.
func (b *Bookmarks) IsBookmarked(id string) bool {
	ids, err := b.List()
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

// SortedIDs returns bookmarked IDs sorted for stable comparison.
func (b *Bookmarks) SortedIDs() ([]string, error) {
	ids, err := b.List()
	if err != nil {
		return nil, err
	}
	sorted := make([]string, len(ids))
	copy(sorted, ids)
	sort.Strings(sorted)
	return sorted, nil
}

func (b *Bookmarks) write(ids []string) error {
	if ids == nil {
		ids = []string{}
	}
	data, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	return os.WriteFile(b.path(), data, 0o644)
}
package notes

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// CollectionFieldType is the type of a custom field in a collection schema.
type CollectionFieldType string

const (
	FieldText    CollectionFieldType = "text"
	FieldNumber  CollectionFieldType = "number"
	FieldBoolean CollectionFieldType = "boolean"
	FieldDate    CollectionFieldType = "date"
)

// CollectionField defines a single custom field in a collection's schema.
type CollectionField struct {
	Key   string             `json:"key"`
	Label string             `json:"label"`
	Type  CollectionFieldType `json:"type"`
}

// CollectionMeta is the definition of a collection. Each collection is a
// folder inside the Collections vault; its items are notes with
// type=collection-item and collection=<id>.
type CollectionMeta struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Icon    string            `json:"icon,omitempty"`
	Pinned  bool              `json:"pinned"`
	Fields  []CollectionField `json:"fields"`
	BuiltIn bool              `json:"builtIn,omitempty"`
	Hidden  bool              `json:"hidden,omitempty"`
}

// CollectionRegistry manages the list of collections, persisted as
// collections.json in the registry root (the Collections vault directory).
type CollectionRegistry struct {
	root string
	mu   sync.Mutex
}

// NewCollectionRegistry creates a registry rooted at the given directory.
func NewCollectionRegistry(root string) (*CollectionRegistry, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("create collections dir: %w", err)
	}
	return &CollectionRegistry{root: root}, nil
}

func (r *CollectionRegistry) registryPath() string {
	return filepath.Join(r.root, "collections.json")
}

// List returns all collections.
func (r *CollectionRegistry) List() ([]CollectionMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	data, err := os.ReadFile(r.registryPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []CollectionMeta{}, nil
		}
		return nil, err
	}
	var cols []CollectionMeta
	if err := json.Unmarshal(data, &cols); err != nil {
		return []CollectionMeta{}, nil
	}
	return cols, nil
}

// Get returns a single collection by id.
func (r *CollectionRegistry) Get(id string) (CollectionMeta, error) {
	cols, err := r.List()
	if err != nil {
		return CollectionMeta{}, err
	}
	for _, c := range cols {
		if c.ID == id {
			return c, nil
		}
	}
	return CollectionMeta{}, ErrNotFound
}

// Create adds a new collection. The id is derived from the name.
func (r *CollectionRegistry) Create(name string, icon string, fields []CollectionField) (CollectionMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	name = sanitizePath(name)
	if name == "" {
		return CollectionMeta{}, errors.New("collection name cannot be empty")
	}
	id := slugify(name)

	cols, err := r.readLocked()
	if err != nil {
		return CollectionMeta{}, err
	}
	for _, c := range cols {
		if c.ID == id {
			return CollectionMeta{}, errors.New("collection already exists")
		}
	}
	col := CollectionMeta{
		ID:     id,
		Name:   name,
		Icon:   icon,
		Pinned: false,
		Fields: fields,
	}
	cols = append(cols, col)
	if err := r.writeLocked(cols); err != nil {
		return CollectionMeta{}, err
	}
	return col, nil
}

// Update renames a collection and updates its icon/fields.
func (r *CollectionRegistry) Update(id string, name string, icon string, fields []CollectionField) (CollectionMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	cols, err := r.readLocked()
	if err != nil {
		return CollectionMeta{}, err
	}
	for i, c := range cols {
		if c.ID == id {
			if name != "" {
				c.Name = sanitizePath(name)
			}
			if icon != "" {
				c.Icon = icon
			}
			if fields != nil {
				c.Fields = fields
			}
			cols[i] = c
			if err := r.writeLocked(cols); err != nil {
				return CollectionMeta{}, err
			}
			return c, nil
		}
	}
	return CollectionMeta{}, ErrNotFound
}

// SetPinned toggles whether a collection is pinned to the dashboard.
func (r *CollectionRegistry) SetPinned(id string, pinned bool) (CollectionMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	cols, err := r.readLocked()
	if err != nil {
		return CollectionMeta{}, err
	}
	for i, c := range cols {
		if c.ID == id {
			c.Pinned = pinned
			cols[i] = c
			if err := r.writeLocked(cols); err != nil {
				return CollectionMeta{}, err
			}
			return c, nil
		}
	}
	return CollectionMeta{}, ErrNotFound
}

// SetHidden toggles whether a collection is visible in the app. Hidden
// collections keep their items — nothing is deleted, they are just not
// rendered in the UI.
func (r *CollectionRegistry) SetHidden(id string, hidden bool) (CollectionMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	cols, err := r.readLocked()
	if err != nil {
		return CollectionMeta{}, err
	}
	for i, c := range cols {
		if c.ID == id {
			c.Hidden = hidden
			cols[i] = c
			if err := r.writeLocked(cols); err != nil {
				return CollectionMeta{}, err
			}
			return c, nil
		}
	}
	return CollectionMeta{}, ErrNotFound
}

// Delete removes a collection definition.
func (r *CollectionRegistry) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	cols, err := r.readLocked()
	if err != nil {
		return err
	}
	out := cols[:0]
	found := false
	for _, c := range cols {
		if c.ID == id {
			found = true
			continue
		}
		out = append(out, c)
	}
	if !found {
		return ErrNotFound
	}
	return r.writeLocked(out)
}

func (r *CollectionRegistry) readLocked() ([]CollectionMeta, error) {
	data, err := os.ReadFile(r.registryPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []CollectionMeta{}, nil
		}
		return nil, err
	}
	var cols []CollectionMeta
	if err := json.Unmarshal(data, &cols); err != nil {
		return []CollectionMeta{}, nil
	}
	return cols, nil
}

func (r *CollectionRegistry) writeLocked(cols []CollectionMeta) error {
	data, err := json.MarshalIndent(cols, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(r.registryPath(), data, 0o644)
}

// Built-in collection definitions. Ensured on startup; the user can hide
// them in the UI but their notes and definitions persist.
var builtInCollections = []struct {
	ID    string
	Name  string
	Icon  string
	Fields []CollectionField
}{
	{
		ID:   "vinyls",
		Name: "Vinyls",
		Icon: "Music",
		Fields: []CollectionField{
			{Key: "discogsId", Label: "Discogs ID", Type: FieldText},
			{Key: "artist", Label: "Artist", Type: FieldText},
			{Key: "year", Label: "Year", Type: FieldText},
			{Key: "genre", Label: "Genre", Type: FieldText},
			{Key: "label", Label: "Label", Type: FieldText},
			{Key: "catno", Label: "Cat #", Type: FieldText},
		},
	},
	{
		ID:   "books",
		Name: "Books",
		Icon: "FileText",
		Fields: []CollectionField{
			{Key: "isbn", Label: "ISBN", Type: FieldText},
			{Key: "author", Label: "Author", Type: FieldText},
			{Key: "year", Label: "Year", Type: FieldText},
			{Key: "publisher", Label: "Publisher", Type: FieldText},
			{Key: "pages", Label: "Pages", Type: FieldText},
			{Key: "genre", Label: "Genre", Type: FieldText},
		},
	},
}

// EnsureBuiltIns makes sure the built-in collections exist (creating them if
// needed) and that their field schemas are up to date. Never touches the
// hidden/pinned flags or the user's own collections.
func (r *CollectionRegistry) EnsureBuiltIns() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	cols, err := r.readLocked()
	if err != nil {
		return err
	}
	changed := false
	for _, def := range builtInCollections {
		found := -1
		for i, c := range cols {
			if c.ID == def.ID {
				found = i
				break
			}
		}
		if found == -1 {
			cols = append(cols, CollectionMeta{
				ID:      def.ID,
				Name:    def.Name,
				Icon:    def.Icon,
				Pinned:  false,
				Fields:  def.Fields,
				BuiltIn: true,
			})
			changed = true
			continue
		}
		// Exists — mark built-in and backfill any new schema fields.
		c := cols[found]
		if !c.BuiltIn {
			c.BuiltIn = true
			changed = true
		}
		have := map[string]bool{}
		for _, f := range c.Fields {
			have[f.Key] = true
		}
		for _, f := range def.Fields {
			if !have[f.Key] {
				c.Fields = append(c.Fields, f)
				changed = true
			}
		}
		cols[found] = c
	}
	if !changed {
		return nil
	}
	return r.writeLocked(cols)
}

// slugify converts a name into a stable id (lowercase, dashes).
func slugify(s string) string {
	var out []rune
	prevDash := false
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z':
			out = append(out, r-'A'+'a')
			prevDash = false
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			out = append(out, r)
			prevDash = false
		case r == ' ' || r == '-' || r == '_':
			if !prevDash && len(out) > 0 {
				out = append(out, '-')
				prevDash = true
			}
		}
	}
	// Trim trailing dash.
	for len(out) > 0 && out[len(out)-1] == '-' {
		out = out[:len(out)-1]
	}
	if len(out) == 0 {
		return "collection"
	}
	return string(out)
}

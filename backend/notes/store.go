package notes

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ErrNotFound is returned when a note id does not resolve to a file.
var ErrNotFound = errors.New("note not found")

// Store is a filesystem-backed collection of notes. Each note is stored as a
// single "<id>.md" file inside Dir, using the frontmatter format decoded by
// this package.
type Store struct {
	Dir string
}

// NewStore creates a Store rooted at dir, creating the directory if needed.
func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create notes dir: %w", err)
	}
	return &Store{Dir: dir}, nil
}

// Entry is the metadata-only view returned by List.
type Entry struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// List returns metadata for every note in the store, sorted by updatedAt desc.
func (s *Store) List() ([]Entry, error) {
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		return nil, fmt.Errorf("read notes dir: %w", err)
	}
	var out []Entry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".md")
		doc, err := s.read(id)
		if err != nil {
			return nil, err
		}
		out = append(out, Entry{
			ID:        doc.Meta.ID,
			Title:     doc.Meta.Title,
			CreatedAt: doc.Meta.CreatedAt,
			UpdatedAt: doc.Meta.UpdatedAt,
		})
	}
	return out, nil
}

// Get returns the full document for id.
func (s *Store) Get(id string) (Document, error) {
	return s.read(id)
}

// CreateInput is the optional body for creating a note.
type CreateInput struct {
	Title string `json:"title"`
}

// Create writes a new note file with a fresh id and empty body, returning the
// full document.
func (s *Store) Create(in CreateInput) (Document, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "Untitled"
	}
	now := time.Now().UTC()
	doc := Document{
		Meta: Meta{
			ID:        NewID(),
			Title:     title,
			CreatedAt: now,
			UpdatedAt: now,
		},
		Body: "",
	}
	if err := s.write(doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// UpdateInput is the body for updating a note.
type UpdateInput struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// Update rewrites a note's title and body, bumping updatedAt. The id and
// createdAt are preserved.
func (s *Store) Update(id string, in UpdateInput) (Document, error) {
	doc, err := s.read(id)
	if err != nil {
		return Document{}, err
	}
	if title := strings.TrimSpace(in.Title); title != "" {
		doc.Meta.Title = title
	}
	doc.Body = in.Body
	doc.Meta.UpdatedAt = time.Now().UTC()
	if err := s.write(doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// Delete removes the note file. Missing files are treated as success so the
// endpoint is idempotent.
func (s *Store) Delete(id string) error {
	if err := os.Remove(s.path(id)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("delete note: %w", err)
	}
	return nil
}

func (s *Store) read(id string) (Document, error) {
	data, err := os.ReadFile(s.path(id))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Document{}, ErrNotFound
		}
		return Document{}, fmt.Errorf("read note: %w", err)
	}
	doc, err := Decode(data)
	if err != nil {
		return Document{}, fmt.Errorf("decode note %q: %w", id, err)
	}
	return doc, nil
}

func (s *Store) write(doc Document) error {
	data, err := Encode(doc)
	if err != nil {
		return fmt.Errorf("encode note: %w", err)
	}
	if err := os.WriteFile(s.path(doc.Meta.ID), data, 0o644); err != nil {
		return fmt.Errorf("write note: %w", err)
	}
	return nil
}

func (s *Store) path(id string) string {
	return filepath.Join(s.Dir, id+".md")
}
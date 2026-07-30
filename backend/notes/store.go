package notes

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// ErrNotFound is returned when a note id does not resolve to a file.
var ErrNotFound = errors.New("note not found")

// Store is a filesystem-backed collection of notes. Notes may live in nested
// folders under Dir; each note is a "<id>.md" file whose frontmatter records
// its path (the folder, relative to Dir) and title.
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
	Path      string    `json:"path"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// List walks the store recursively and returns metadata for every note, sorted
// by updatedAt desc. Folders are traversed; the note's path (folder relative
// to the store root, "/"-joined) is read from frontmatter.
func (s *Store) List() ([]Entry, error) {
	var out []Entry
	err := filepath.WalkDir(s.Dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		id := strings.TrimSuffix(d.Name(), ".md")
		doc, err := s.read(id)
		if err != nil {
			// Skip files that aren't valid notes rather than failing the whole
			// listing; a stray .md in the tree shouldn't break the UI.
			return nil
		}
		out = append(out, Entry{
			ID:        doc.Meta.ID,
			Title:     doc.Meta.Title,
			Path:      doc.Meta.Path,
			CreatedAt: doc.Meta.CreatedAt,
			UpdatedAt: doc.Meta.UpdatedAt,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk notes dir: %w", err)
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
	Path  string `json:"path"`
}

// Create writes a new note file with a fresh id and empty body, returning the
// full document. If Path is set the note is created in that folder (created if
// needed); the path is stored in frontmatter.
func (s *Store) Create(in CreateInput) (Document, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "Untitled"
	}
	notePath := sanitizePath(in.Path)
	now := time.Now().UTC()
	doc := Document{
		Meta: Meta{
			ID:        NewID(),
			Title:     title,
			Path:      notePath,
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

// Update rewrites a note's title and body, bumping updatedAt. The id, path and
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
	p, err := s.resolvePath(id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		return err
	}
	if err := os.Remove(p); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("delete note: %w", err)
	}
	return nil
}

// Daily opens-or-creates today's journal note under "Journal". The note is
// named by date (YYYY-MM-DD) and titled "YYYY-MM-DD". If it already exists it
// is returned as-is; otherwise it is created.
func (s *Store) Daily() (Document, error) {
	now := time.Now().UTC()
	date := now.Format("2006-01-02")
	folder := "Journal"

	// Look for an existing note whose path is Journal and title is the date.
	list, err := s.List()
	if err != nil {
		return Document{}, err
	}
	for _, e := range list {
		if e.Path == folder && e.Title == date {
			return s.Get(e.ID)
		}
	}

	doc, err := s.Create(CreateInput{Title: date, Path: folder})
	if err != nil {
		return Document{}, err
	}
	// Seed the body with a header so the journal isn't empty.
	doc.Body = fmt.Sprintf("# %s\n\n", date)
	doc.Meta.UpdatedAt = now
	if err := s.write(doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// resolvePath finds the on-disk path of a note by id, searching the tree in
// case the note lives in a subfolder. If not found, returns ErrNotFound.
func (s *Store) resolvePath(id string) (string, error) {
	// Fast path: note at the root.
	rootPath := filepath.Join(s.Dir, id+".md")
	if _, err := os.Stat(rootPath); err == nil {
		return rootPath, nil
	}
	// Search the tree for "<id>.md".
	var found string
	err := filepath.WalkDir(s.Dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && d.Name() == id+".md" {
			found = p
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("resolve note: %w", err)
	}
	if found == "" {
		return "", ErrNotFound
	}
	return found, nil
}

func (s *Store) read(id string) (Document, error) {
	p, err := s.resolvePath(id)
	if err != nil {
		return Document{}, err
	}
	data, err := os.ReadFile(p)
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
	// If frontmatter is missing the path, derive it from the file location so
	// the tree still renders for legacy notes.
	if doc.Meta.Path == "" {
		rel, _ := filepath.Rel(s.Dir, filepath.Dir(p))
		if rel != "." && rel != "" {
			doc.Meta.Path = filepath.ToSlash(rel)
		}
	}
	return doc, nil
}

func (s *Store) write(doc Document) error {
	notePath := sanitizePath(doc.Meta.Path)
	dir := s.Dir
	if notePath != "" {
		dir = filepath.Join(s.Dir, filepath.FromSlash(notePath))
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create note dir: %w", err)
	}
	data, err := Encode(doc)
	if err != nil {
		return fmt.Errorf("encode note: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, doc.Meta.ID+".md"), data, 0o644); err != nil {
		return fmt.Errorf("write note: %w", err)
	}
	return nil
}

// sanitizePath normalizes a user-supplied folder path: trims, cleans, rejects
// ".." segments, and converts to slash notation. Empty stays empty (root).
func sanitizePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	// Normalize separators to "/" then clean.
	p = path.Clean(strings.ReplaceAll(p, "\\", "/"))
	// Disallow absolute and parent escapes.
	if strings.HasPrefix(p, "/") || p == "." {
		return ""
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return ""
		}
	}
	return p
}
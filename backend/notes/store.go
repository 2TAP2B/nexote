package notes

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ErrNotFound is returned when a note id does not resolve to a file.
var ErrNotFound = errors.New("note not found")

// ErrConflict is returned when an update's optimistic-concurrency check fails:
// the note changed since the caller read it, so the write is refused rather
// than silently overwriting a concurrent edit.
var ErrConflict = errors.New("note changed since read")

// Store is a filesystem-backed collection of notes. Notes may live in nested
// folders under Dir; each note is a "<id>.md" file whose frontmatter records
// its path (the folder, relative to Dir) and title. Empty folders are tracked
// as real directories so they persist even without notes.
//
// A lazily-built in-memory index maps note id -> absolute file path so that
// reading a note (and the tree listing) does not re-walk the directory tree
// for every note. Mutations (create/update/delete/move) keep the index in sync
// so List/Get are fast even with many notes.
type Store struct {
	Dir string

	mu    sync.RWMutex
	index map[string]string // id -> absolute path of "<id>.md"

	// writeMu serializes read-modify-write mutations (create/update/delete/
	// daily/copy/move). Without it, two concurrent requests can both read the
	// same base state and then each write, clobbering the other's change (and,
	// for Daily, creating two notes for the same date). It is separate from mu
	// (which guards only the in-memory index) so reads stay concurrent.
	writeMu sync.Mutex
}

// NewStore creates a Store rooted at dir, creating the directory if needed.
func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create notes dir: %w", err)
	}
	return &Store{Dir: dir}, nil
}

// buildIndex walks the tree once and records every "<id>.md" file's absolute
// path. Called lazily; must be called with s.mu held (or after ensuring it).
func (s *Store) buildIndex() {
	s.index = make(map[string]string)
	_ = filepath.WalkDir(s.Dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		// Skip history snapshots (they live under .history/<noteId>/).
		if strings.Contains(filepath.ToSlash(p), "/"+historyDirName+"/") {
			return nil
		}
		s.index[strings.TrimSuffix(d.Name(), ".md")] = p
		return nil
	})
}

// indexPath returns the indexed path for id, or "" if not indexed.
func (s *Store) indexPath(id string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.index == nil {
		return "", false
	}
	p, ok := s.index[id]
	return p, ok
}

// ensureIndex populates the index on first use.
func (s *Store) ensureIndex() {
	s.mu.Lock()
	if s.index == nil {
		s.buildIndex()
	}
	s.mu.Unlock()
}

// trackIndex records a note's path (after a write or create).
func (s *Store) trackIndex(id, path string) {
	s.mu.Lock()
	if s.index == nil {
		s.index = make(map[string]string)
	}
	s.index[id] = path
	s.mu.Unlock()
}

// untrackIndex removes a note from the index (after a delete).
func (s *Store) untrackIndex(id string) {
	s.mu.Lock()
	if s.index != nil {
		delete(s.index, id)
	}
	s.mu.Unlock()
}

// Entry is the metadata-only view returned by List for notes.
type Entry struct {
	ID         string            `json:"id"`
	Title      string            `json:"title"`
	Path       string            `json:"path"`
	CreatedAt  time.Time         `json:"createdAt"`
	UpdatedAt  time.Time         `json:"updatedAt"`
	Tags       []string          `json:"tags"`
	Snippet    string            `json:"snippet"`
	Type       string            `json:"type,omitempty"`
	Artist     string            `json:"artist,omitempty"`
	Year       int               `json:"year,omitempty"`
	Genre      string            `json:"genre,omitempty"`
	Wantlist   *bool             `json:"wantlist,omitempty"`
	Cover      string            `json:"cover,omitempty"`
	Collection string            `json:"collection,omitempty"`
	Fields     map[string]string `json:"fields,omitempty"`
}

// FolderEntry represents an (possibly empty) folder in the tree.
type FolderEntry struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// ListResult is the full tree returned by List: notes plus empty folders.
type ListResult struct {
	Notes   []Entry      `json:"notes"`
	Folders []FolderEntry `json:"folders"`
}

// List walks the store recursively and returns metadata for every note plus
// every folder (including empty ones). Folders are derived from real
// directories on disk, so empty folders persist after the last note is deleted.
// A single tree walk populates the id->path index, so a subsequent read of any
// listed note is O(1) rather than another walk.
func (s *Store) List() (ListResult, error) {
	var notes []Entry
	var folders []FolderEntry = []FolderEntry{}

	idx := make(map[string]string)

	err := filepath.WalkDir(s.Dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(s.Dir, p)
		rel = filepath.ToSlash(rel)

		if d.IsDir() {
			// Skip the root dir itself.
			if rel == "." || rel == "" {
				return nil
			}
			// Skip the hidden history directory (per-note snapshots) so its
			// .md files are never treated as notes.
			if d.Name() == historyDirName {
				return filepath.SkipDir
			}
			folders = append(folders, FolderEntry{
				Path: rel,
				Name: d.Name(),
			})
			return nil
		}

		if !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		id := strings.TrimSuffix(d.Name(), ".md")
		idx[id] = p
		doc, err := s.readAt(id, p)
		if err != nil {
			// Skip files that aren't valid notes rather than failing the whole
			// listing; a stray .md in the tree shouldn't break the UI.
			return nil
		}
		notes = append(notes, Entry{
			ID:         doc.Meta.ID,
			Title:      doc.Meta.Title,
			Path:       doc.Meta.Path,
			CreatedAt:  doc.Meta.CreatedAt,
			UpdatedAt:  doc.Meta.UpdatedAt,
			Tags:       doc.Meta.Tags,
			Snippet:    makeSnippet(doc.Body, 150),
			Type:       doc.Meta.Type,
			Artist:     doc.Meta.Artist,
			Year:       doc.Meta.Year,
			Genre:      doc.Meta.Genre,
			Wantlist:   doc.Meta.Wantlist,
			Cover:      doc.Meta.Cover,
			Collection: doc.Meta.Collection,
			Fields:     doc.Meta.Fields,
		})
		return nil
	})
	if err != nil {
		return ListResult{}, fmt.Errorf("walk notes dir: %w", err)
	}

	// Publish the freshly-built index so later reads are O(1).
	s.mu.Lock()
	s.index = idx
	s.mu.Unlock()

	return ListResult{Notes: notes, Folders: folders}, nil
}

// Get returns the full document for id.
func (s *Store) Get(id string) (Document, error) {
	return s.read(id)
}

// Copy duplicates a note: reads the source note, generates a new ID, and
// writes it as a new file in the same folder. The title gets " (copy)"
// appended if it doesn't already end with that.
func (s *Store) Copy(id string) (Document, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	doc, err := s.read(id)
	if err != nil {
		return Document{}, err
	}
	newDoc := Document{
		Meta: doc.Meta,
		Body: doc.Body,
	}
	newDoc.Meta.ID = NewID()
	if !strings.HasSuffix(newDoc.Meta.Title, " (copy)") {
		newDoc.Meta.Title = newDoc.Meta.Title + " (copy)"
	}
	now := time.Now().UTC()
	newDoc.Meta.CreatedAt = now
	newDoc.Meta.UpdatedAt = now
	if err := s.write(newDoc); err != nil {
		return Document{}, err
	}
	return newDoc, nil
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
		Body: fmt.Sprintf("## %s\n\n", title),
	}
	if err := s.write(doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// CreateFolder creates an empty directory at the given path (relative to the
// store root). Intermediate folders are created as needed. Returns an error
// if the folder already exists.
func (s *Store) CreateFolder(folderPath string) error {
	p := sanitizePath(folderPath)
	if p == "" {
		return fmt.Errorf("folder path cannot be empty")
	}
	dir := filepath.Join(s.Dir, filepath.FromSlash(p))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create folder: %w", err)
	}
	return nil
}

// DeleteFolder removes a folder and everything inside it (notes + subfolders).
// The path is relative to the store root. Missing folders are treated as
// success for idempotency.
func (s *Store) DeleteFolder(folderPath string) error {
	p := sanitizePath(folderPath)
	if p == "" {
		return fmt.Errorf("folder path cannot be empty")
	}
	dir := filepath.Join(s.Dir, filepath.FromSlash(p))
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	return nil
}

// UpdateInput is the body for updating a note. Path is optional (nil = don't
// change); an empty string moves the note to the root. The structured
// collection fields are pointers so a nil value means "leave unchanged".
// ExpectedUpdatedAt, when set, enables optimistic concurrency: if it does not
// match the note's current updatedAt, Update returns ErrConflict instead of
// overwriting a concurrent change.
type UpdateInput struct {
	Title             string            `json:"title"`
	Body              string            `json:"body"`
	Path              *string           `json:"path,omitempty"`
	Type              *string           `json:"type,omitempty"`
	Artist            *string           `json:"artist,omitempty"`
	Year              *int              `json:"year,omitempty"`
	Genre             *string           `json:"genre,omitempty"`
	Wantlist          *bool             `json:"wantlist,omitempty"`
	Cover             *string           `json:"cover,omitempty"`
	Collection        *string           `json:"collection,omitempty"`
	Fields            map[string]string `json:"fields,omitempty"`
	ExpectedUpdatedAt *string           `json:"expectedUpdatedAt,omitempty"`
}

// Update rewrites a note's title and body, bumping updatedAt. The id and
// createdAt are preserved. If Path is non-nil, the note is moved to that folder
// (empty string = root); the old file is deleted and a new one written.
// Inline #hashtags in the body are extracted and merged into the frontmatter
// tags so they appear in the tag index.
func (s *Store) Update(id string, in UpdateInput) (Document, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	doc, err := s.read(id)
	if err != nil {
		return Document{}, err
	}
	oldPath := doc.Meta.Path

	// Snapshot the pre-update version so the note's history is preserved.
	// Best-effort: a history write failure must not block the save itself.
	_, _ = s.snapshotHistory(doc)

	// Optimistic concurrency: if the caller expected a specific updatedAt and
	// the note has since changed, refuse to overwrite the newer content.
	if in.ExpectedUpdatedAt != nil && *in.ExpectedUpdatedAt != "" {
		if doc.Meta.UpdatedAt.Format(time.RFC3339Nano) != *in.ExpectedUpdatedAt &&
			doc.Meta.UpdatedAt.Format(time.RFC3339) != *in.ExpectedUpdatedAt {
			return Document{}, ErrConflict
		}
	}

	// Never let a blank body wipe a note that has content. A save that sends
	// an empty body (e.g. a race or a transient editor state) must not destroy
	// the existing text.
	if in.Body == "" && strings.TrimSpace(doc.Body) != "" {
		in.Body = doc.Body
	}

	if title := strings.TrimSpace(in.Title); title != "" {
		doc.Meta.Title = title
	}
	if in.Path != nil {
		doc.Meta.Path = sanitizePath(*in.Path)
	}
	if in.Type != nil {
		doc.Meta.Type = *in.Type
	}
	if in.Artist != nil {
		doc.Meta.Artist = *in.Artist
	}
	if in.Year != nil {
		doc.Meta.Year = *in.Year
	}
	if in.Genre != nil {
		doc.Meta.Genre = *in.Genre
	}
	if in.Wantlist != nil {
		doc.Meta.Wantlist = in.Wantlist
	}
	if in.Cover != nil {
		doc.Meta.Cover = *in.Cover
	}
	if in.Collection != nil {
		doc.Meta.Collection = *in.Collection
	}
	if in.Fields != nil {
		doc.Meta.Fields = in.Fields
	}

	// When the note moves to a different folder, physically move any image
	// files it references and rewrite the image URLs in the body.
	if doc.Meta.Path != oldPath {
		body := in.Body
		if body == "" {
			body = doc.Body
		}
		migrated, err := s.MigrateImagesForBody(body, oldPath, doc.Meta.Path)
		if err != nil {
			return Document{}, err
		}
		in.Body = migrated
	}

	doc.Body = in.Body
	doc.Meta.UpdatedAt = time.Now().UTC()

	// Tags are defined inline in the body with #hashtags (e.g. #work #ideas).
	// Replace the note's frontmatter tags with exactly the tags present in the
	// body, so removing a #tag from the text also drops it from the note (and,
	// if no other note carries it, from the tag index). This keeps the
	// frontmatter tags a faithful mirror of the inline hashtags.
	doc.Meta.Tags = extractInlineTags(doc.Body)

	// If the path changed, delete the old file first, then write the new one.
	if doc.Meta.Path != oldPath {
		if oldFile, err := s.resolvePath(id); err == nil {
			_ = os.Remove(oldFile)
		}
	}
	if err := s.write(doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// inlineTagRe matches #hashtags in the body. Milkdown escapes # at the start
// of a line as \# to prevent heading interpretation, so we match both #tag
// and \#tag. The tag name must start with a lowercase letter or digit to
// avoid matching real headings ("# Title"). Preceded by start-of-line or
// whitespace. Skips code blocks (handled separately by extractInlineTags).
var inlineTagRe = regexp.MustCompile(`(?m)(?:^|\s)\\?#\s*([a-z0-9][\w-]*)`)

// extractInlineTags scans the body for #hashtags and returns a deduplicated,
// normalized list. Lines inside fenced code blocks (``` ... ```) are skipped.
func extractInlineTags(body string) []string {
	lines := strings.Split(body, "\n")
	inCodeBlock := false
	seen := map[string]bool{}
	var tags []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inCodeBlock = !inCodeBlock
			continue
		}
		if inCodeBlock {
			continue
		}
		for _, m := range inlineTagRe.FindAllStringSubmatch(line, -1) {
			tag := normalizeTag(m[1])
			if tag == "" || seen[tag] {
				continue
			}
			seen[tag] = true
			tags = append(tags, tag)
		}
	}
	return tags
}

// Delete removes the note file. Missing files are treated as success so the
// endpoint is idempotent. Empty parent folders are left in place so the tree
// structure persists.
func (s *Store) Delete(id string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
	s.untrackIndex(id)
	// Prune now-empty parent directories up to (but not including) the store
	// root. This removes folders that became empty *and* had no explicit
	// creation — i.e. folders that only existed because a note was in them.
	// Folders created via CreateFolder are kept because they're real dirs on
	// disk; RemoveAll on an empty dir removes it, but we only remove if empty.
	s.pruneEmptyDirs(filepath.Dir(p))
	return nil
}

// pruneEmptyDirs removes parent directories that are empty, walking upward
// until a non-empty directory or the store root is reached.
func (s *Store) pruneEmptyDirs(dir string) {
	for {
		rel, _ := filepath.Rel(s.Dir, dir)
		if rel == "." || rel == "" || strings.HasPrefix(rel, "..") {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) > 0 {
			return
		}
		if err := os.Remove(dir); err != nil {
			return
		}
		dir = filepath.Dir(dir)
	}
}

// Daily opens-or-creates today's journal note under "Journal". The note is
// named by date (YYYY-MM-DD) and titled "YYYY-MM-DD". If it already exists it
// is returned as-is; otherwise it is created. The whole check-then-create runs
// under the write mutex so two concurrent calls can never create two notes for
// the same date.
func (s *Store) Daily() (Document, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	now := time.Now().UTC()
	date := now.Format("2006-01-02")
	folder := "Journal"

	list, err := s.List()
	if err != nil {
		return Document{}, err
	}
	for _, e := range list.Notes {
		if e.Path == folder && e.Title == date {
			return s.Get(e.ID)
		}
	}

	// Create the note inline (rather than calling s.Create, which would
	// re-acquire the write mutex and deadlock). Use the same `now` for both
	// timestamps so updatedAt is never earlier than createdAt.
	doc := Document{
		Meta: Meta{
			ID:        NewID(),
			Title:     date,
			Path:      folder,
			CreatedAt: now,
			UpdatedAt: now,
		},
		Body: fmt.Sprintf("## %s\n\n", date),
	}
	if err := s.write(doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// --- Tags ---

// TagCount is a tag name plus the number of notes that carry it.
type TagCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// normalizeTag trims whitespace, strips a leading "#", and lowercases. This
// gives a canonical form for tag comparison and storage so "#Work", "work",
// and "Work " all map to "work".
func normalizeTag(tag string) string {
	tag = strings.TrimSpace(tag)
	tag = strings.TrimPrefix(tag, "#")
	tag = strings.TrimSpace(tag)
	return strings.ToLower(tag)
}

func containsString(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

// AddTag adds a tag to a note's frontmatter. Idempotent — if the tag is
// already present nothing changes. Returns the updated document.
func (s *Store) AddTag(id string, tag string) (Document, error) {
	nt := normalizeTag(tag)
	if nt == "" {
		return Document{}, fmt.Errorf("tag cannot be empty")
	}
	doc, err := s.read(id)
	if err != nil {
		return Document{}, err
	}
	if containsString(doc.Meta.Tags, nt) {
		return doc, nil
	}
	doc.Meta.Tags = append(doc.Meta.Tags, nt)
	doc.Meta.UpdatedAt = time.Now().UTC()
	if err := s.write(doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// RemoveTag removes a tag from a note's frontmatter. Returns the updated
// document.
func (s *Store) RemoveTag(id string, tag string) (Document, error) {
	nt := normalizeTag(tag)
	doc, err := s.read(id)
	if err != nil {
		return Document{}, err
	}
	filtered := doc.Meta.Tags[:0]
	for _, t := range doc.Meta.Tags {
		if t != nt {
			filtered = append(filtered, t)
		}
	}
	doc.Meta.Tags = filtered
	doc.Meta.UpdatedAt = time.Now().UTC()
	if err := s.write(doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// RenameTag renames a tag across all notes in the store. Returns the number
// of notes that had the tag renamed.
func (s *Store) RenameTag(from string, to string) (int, error) {
	nf := normalizeTag(from)
	nt := normalizeTag(to)
	if nf == "" || nt == "" {
		return 0, fmt.Errorf("tag cannot be empty")
	}
	list, err := s.List()
	if err != nil {
		return 0, err
	}
	count := 0
	for _, e := range list.Notes {
		if !containsString(e.Tags, nf) {
			continue
		}
		doc, err := s.read(e.ID)
		if err != nil {
			continue
		}
		renamed := false
		for i, t := range doc.Meta.Tags {
			if t == nf {
				doc.Meta.Tags[i] = nt
				renamed = true
			}
		}
		if renamed {
			doc.Meta.UpdatedAt = time.Now().UTC()
			if err := s.write(doc); err != nil {
				return count, err
			}
			count++
		}
	}
	return count, nil
}

// DeleteTag removes a tag from all notes in the store. Returns the number of
// notes that had the tag removed.
func (s *Store) DeleteTag(tag string) (int, error) {
	nt := normalizeTag(tag)
	list, err := s.List()
	if err != nil {
		return 0, err
	}
	count := 0
	for _, e := range list.Notes {
		if !containsString(e.Tags, nt) {
			continue
		}
		doc, err := s.read(e.ID)
		if err != nil {
			continue
		}
		filtered := doc.Meta.Tags[:0]
		for _, t := range doc.Meta.Tags {
			if t != nt {
				filtered = append(filtered, t)
			}
		}
		doc.Meta.Tags = filtered
		doc.Meta.UpdatedAt = time.Now().UTC()
		if err := s.write(doc); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

// TagIndex returns all unique tags in the store with their note counts,
// sorted alphabetically by tag name.
func (s *Store) TagIndex() ([]TagCount, error) {
	list, err := s.List()
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, e := range list.Notes {
		for _, t := range e.Tags {
			counts[t]++
		}
	}
	result := make([]TagCount, 0, len(counts))
	for name, c := range counts {
		result = append(result, TagCount{Name: name, Count: c})
	}
	// Sort alphabetically.
	for i := 1; i < len(result); i++ {
		for j := i; j > 0 && result[j-1].Name > result[j].Name; j-- {
			result[j-1], result[j] = result[j], result[j-1]
		}
	}
	return result, nil
}

// --- Tasks ---

// Task is a single checkbox item extracted from a note's body.
type Task struct {
	NoteID    string    `json:"noteId"`
	NoteTitle string    `json:"noteTitle"`
	Text      string    `json:"text"`
	Checked   bool      `json:"checked"`
	Line      int       `json:"line"` // 0-based line index in the note body
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// taskLineRe matches markdown task list items: "- [ ] text" or "- [x] text",
// also allowing "*", "+", and leading whitespace.
var taskLineRe = regexp.MustCompile(`(?m)^(\s*[-*+]\s+)\[( |x|X)\]\s+(.+)$`)

// Tasks walks all notes in the store and extracts every task list item from
// their bodies. The returned tasks are sorted by note title, then by line
// number within each note.
func (s *Store) Tasks() ([]Task, error) {
	list, err := s.List()
	if err != nil {
		return nil, err
	}
	var tasks []Task
	for _, e := range list.Notes {
		doc, err := s.read(e.ID)
		if err != nil {
			continue
		}
		body := doc.Body
		lines := strings.Split(body, "\n")
		for i, line := range lines {
			m := taskLineRe.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			checked := m[2] == "x" || m[2] == "X"
			text := strings.TrimSpace(m[3])
			tasks = append(tasks, Task{
				NoteID:    e.ID,
				NoteTitle: e.Title,
				Text:      text,
				Checked:   checked,
				Line:      i,
				CreatedAt: e.CreatedAt,
				UpdatedAt: e.UpdatedAt,
			})
		}
	}
	return tasks, nil
}

// SetTaskChecked flips a task checkbox in a note's body. It reads the note,
// rewrites the specified line (0-based) to [ ] or [x], and saves.
func (s *Store) SetTaskChecked(id string, line int, checked bool) (Document, error) {
	doc, err := s.read(id)
	if err != nil {
		return Document{}, err
	}
	lines := strings.Split(doc.Body, "\n")
	if line < 0 || line >= len(lines) {
		return doc, fmt.Errorf("task line out of range")
	}
	m := taskLineRe.FindStringSubmatch(lines[line])
	if m == nil {
		return doc, fmt.Errorf("line %d is not a task", line)
	}
	mark := " "
	if checked {
		mark = "x"
	}
	lines[line] = m[1] + "[" + mark + "] " + strings.TrimSpace(m[3])
	doc.Body = strings.Join(lines, "\n")
	doc.Meta.UpdatedAt = time.Now().UTC()
	if err := s.write(doc); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// resolvePath finds the on-disk path of a note by id, searching the tree in
// case the note lives in a subfolder. If not found, returns ErrNotFound.
func (s *Store) resolvePath(id string) (string, error) {
	// Fast path: the note is indexed (the common case after a listing or an
	// earlier read). Falls back to a full tree walk only when the index is
	// stale (e.g. a file was added out-of-band), keeping lookups O(1).
	if p, ok := s.indexPath(id); ok {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		s.untrackIndex(id)
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
	s.trackIndex(id, found)
	return found, nil
}

func (s *Store) read(id string) (Document, error) {
	p, err := s.resolvePath(id)
	if err != nil {
		return Document{}, err
	}
	return s.readAt(id, p)
}

// readAt decodes a note from an already-resolved absolute path. Used by List to
// avoid resolving each note (which would walk the tree again) during a listing.
func (s *Store) readAt(id, p string) (Document, error) {
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
	// Write to a temp file in the same directory, then rename over the real
	// file. Readers never see a partially-written note, and without an atomic
	// swap a reader (e.g. another client's GET or the file listing) could
	// observe a half-written body. os.Rename is atomic on the local FS.
	path := filepath.Join(dir, doc.Meta.ID+".md")
	tmp, err := os.CreateTemp(dir, doc.Meta.ID+".*.tmp")
	if err != nil {
		return fmt.Errorf("create note temp: %w", err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return fmt.Errorf("write note temp: %w", err)
	}
	if err := tmp.Chmod(0o644); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return fmt.Errorf("chmod note temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("close note temp: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("rename note: %w", err)
	}
	// Keep the id->path index in sync with the on-disk location.
	s.trackIndex(doc.Meta.ID, path)
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

// makeSnippet extracts a plain-text preview from a note body, skipping the
// first heading line (which is the title) and stripping markdown syntax.
// Returns at most max characters.
func makeSnippet(body string, max int) string {
	lines := strings.Split(body, "\n")
	start := 0
	if len(lines) > 0 && strings.HasPrefix(strings.TrimSpace(lines[0]), "#") {
		start = 1
	}
	var parts []string
	for _, line := range lines[start:] {
		// Skip empty lines and frontmatter markers.
		t := strings.TrimSpace(line)
		if t == "" || t == "---" {
			continue
		}
		// Strip markdown: HTML tags, headers, emphasis, code, links, images, list markers.
		t = regexp.MustCompile(`<[^>]+>`).ReplaceAllString(t, " ")
		t = regexp.MustCompile(`^#+\s*`).ReplaceAllString(t, "")
		t = regexp.MustCompile(`[*_` + "`" + `~]`).ReplaceAllString(t, "")
		t = regexp.MustCompile(`!\[.*?\]\(.*?\)`).ReplaceAllString(t, "")
		t = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`).ReplaceAllString(t, "$1")
		t = regexp.MustCompile(`^\s*[-+*]\s+`).ReplaceAllString(t, "")
		t = regexp.MustCompile(`^\s*\d+\.\s+`).ReplaceAllString(t, "")
		t = strings.TrimSpace(t)
		if t != "" {
			parts = append(parts, t)
		}
	}
	text := strings.Join(parts, " ")
	text = regexp.MustCompile(`\s+`).ReplaceAllString(text, " ")
	text = strings.TrimSpace(text)
	if len(text) > max {
		return text[:max] + "…"
	}
	return text
}
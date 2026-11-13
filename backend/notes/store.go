package notes

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ErrNotFound is returned when a note id does not resolve to a file.
var ErrNotFound = errors.New("note not found")

// ErrConflict is returned when an update's optimistic-concurrency check fails:
// the note changed since the caller read it, so the write is refused rather
// than silently overwriting a concurrent edit.
var ErrConflict = errors.New("note changed since read")

// Store is a filesystem-backed collection of notes. Notes may live in nested
// folders under Dir; each note is a markdown file named after its title (see
// filenames.go) whose frontmatter records its id, path (the folder, relative
// to Dir) and title. Empty folders are tracked as real directories so they
// persist even without notes.
//
// The frontmatter id is a note's identity; the file name is only a readable
// label. An in-memory index maps id -> absolute file path so reads don't
// re-walk the tree; it is verified on every hit (the file must still hold
// that id) and rebuilt by List, so files renamed or replaced outside the app
// never resolve to the wrong note. One Store per directory is shared by all
// requests (VaultRegistry.Store), so the index and writeMu are too.
type Store struct {
	Dir string

	mu    sync.RWMutex
	index map[string]string // note id -> absolute path of its file

	// writeMu serializes read-modify-write mutations (create/update/delete/
	// daily/copy/move/tags/tasks). Without it, two concurrent requests can
	// both read the same base state and then each write, clobbering the
	// other's change (and, for Daily, creating two notes for the same date;
	// with title-named files, two notes could pick the same name). It is
	// separate from mu (which guards only the in-memory index) so reads stay
	// concurrent.
	writeMu sync.Mutex

	// gitSync is an optional git auto-commit hook. When set, it triggers a
	// debounced commit after each mutation. Atomic because the store is
	// shared and SetGitSync can swap the hook while a request is writing.
	gitSync atomic.Pointer[GitSync]
}

// NewStore creates a Store rooted at dir, creating the directory if needed.
func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create notes dir: %w", err)
	}
	return &Store{Dir: dir}, nil
}

// SetGitSync attaches an optional git auto-commit hook. Pass nil to disable.
func (s *Store) SetGitSync(gs *GitSync) {
	s.gitSync.Store(gs)
}

// afterWrite triggers a debounced git commit if gitSync is configured.
// commitDebounced only (re)arms a timer, so this never blocks the writer.
func (s *Store) afterWrite() {
	if gs := s.gitSync.Load(); gs != nil {
		gs.commitDebounced()
	}
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
	Cover       string            `json:"cover,omitempty"`
	Icon        string            `json:"icon,omitempty"`
	Collection  string            `json:"collection,omitempty"`
	Fields     map[string]string `json:"fields,omitempty"`
}

// FolderEntry represents an (possibly empty) folder in the tree.
type FolderEntry struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Label string `json:"label,omitempty"` // Finder-style color label
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
	var notes []Entry = []Entry{}
	var folders []FolderEntry = []FolderEntry{}

	idx := make(map[string]string)
	// One entry per note id. A second file with the same id appears when a
	// listing races a rename (new name written, old one not yet removed) or
	// after a crash in between; the newest version wins.
	pos := make(map[string]int)
	mod := make(map[string]time.Time)

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
		doc, err := s.readAt("", p)
		if err != nil {
			// Skip files that aren't valid notes rather than failing the whole
			// listing; a stray .md in the tree shouldn't break the UI.
			return nil
		}
		id := noteIDOf(doc, p)
		var mtime time.Time
		if info, err := d.Info(); err == nil {
			mtime = info.ModTime()
		}
		entry := Entry{
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
			Icon:       doc.Meta.Icon,
			Collection: doc.Meta.Collection,
			Fields:     doc.Meta.Fields,
		}
		if i, dup := pos[id]; dup {
			prev := notes[i]
			newer := entry.UpdatedAt.After(prev.UpdatedAt) ||
				(entry.UpdatedAt.Equal(prev.UpdatedAt) && mtime.After(mod[id]))
			if newer {
				notes[i] = entry
				idx[id] = p
				mod[id] = mtime
			}
			return nil
		}
		pos[id] = len(notes)
		mod[id] = mtime
		idx[id] = p
		notes = append(notes, entry)
		return nil
	})
	if err != nil {
		return ListResult{}, fmt.Errorf("walk notes dir: %w", err)
	}

	// Merge the Finder-style folder labels into the folder entries.
	labels := s.readFolderLabels()
	if len(labels) > 0 {
		for i, f := range folders {
			if labels[f.Path] != "" {
				folders[i].Label = labels[f.Path]
			}
		}
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
	defer s.afterWrite()
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
	// Body seeds the note content. Empty = the default title heading
	// ("## <title>"); the frontend's headingOnNewNote=off passes "\n" so the
	// note starts as a plain blank paragraph (classic Obsidian look).
	Body string `json:"body,omitempty"`
}

// Create writes a new note file with a fresh id and empty body, returning the
// full document. If Path is set the note is created in that folder (created if
// needed); the path is stored in frontmatter.
func (s *Store) Create(in CreateInput) (Document, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "Untitled"
	}
	notePath := sanitizePath(in.Path)
	now := time.Now().UTC()
	body := fmt.Sprintf("## %s\n\n", title)
	if in.Body != "" {
		body = in.Body
	}
	doc := Document{
		Meta: Meta{
			ID:        NewID(),
			Title:     title,
			Path:      notePath,
			CreatedAt: now,
			UpdatedAt: now,
		},
		Body: body,
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()

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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()

	p := sanitizePath(folderPath)
	if p == "" {
		return fmt.Errorf("folder path cannot be empty")
	}
	dir := filepath.Join(s.Dir, filepath.FromSlash(p))
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	s.deleteFolderLabels(p)
	return nil
}

// RenameFolder renames a folder (and everything inside it) by moving it to a
// new path. Both oldPath and newPath are relative to the store root. All notes
// in the subtree keep their relative paths; their frontmatter Path field is
// updated to reflect the new location.
func (s *Store) RenameFolder(oldPath, newPath string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()

	oldRel := sanitizePath(oldPath)
	newRel := sanitizePath(newPath)
	if oldRel == "" || newRel == "" {
		return fmt.Errorf("folder path cannot be empty")
	}
	if oldRel == newRel {
		return nil
	}

	oldDir := filepath.Join(s.Dir, filepath.FromSlash(oldRel))
	newDir := filepath.Join(s.Dir, filepath.FromSlash(newRel))

	if _, err := os.Stat(oldDir); os.IsNotExist(err) {
		return fmt.Errorf("folder not found: %s", oldRel)
	}
	if _, err := os.Stat(newDir); err == nil {
		return fmt.Errorf("folder already exists: %s", newRel)
	}

	// Move the directory tree.
	if err := os.MkdirAll(filepath.Dir(newDir), 0o755); err != nil {
		return fmt.Errorf("create parent folder: %w", err)
	}
	if err := os.Rename(oldDir, newDir); err != nil {
		return fmt.Errorf("rename folder: %w", err)
	}
	s.renameFolderLabels(oldRel, newRel)

	// Update the Path field in every note's frontmatter within the moved tree.
	list, err := s.List()
	if err != nil {
		return nil
	}
	for _, entry := range list.Notes {
		if !strings.HasPrefix(entry.Path, oldRel+"/") && entry.Path != oldRel {
			continue
		}
		doc, err := s.read(entry.ID)
		if err != nil {
			continue
		}
		// Replace the old prefix with the new one.
		if entry.Path == oldRel {
			doc.Meta.Path = newRel
		} else {
			doc.Meta.Path = newRel + entry.Path[len(oldRel):]
		}
		if err := s.write(doc); err != nil {
			continue
		}
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
	Icon              *string           `json:"icon,omitempty"`
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
	defer s.afterWrite()
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
	if in.Icon != nil {
		doc.Meta.Icon = *in.Icon
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

	// write() names the file after the (possibly new) title in the (possibly
	// new) folder and removes the previous file only once the new one is in
	// place, so a failed write never loses the note.
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
	defer s.afterWrite()
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

// ErrInvalidDate is returned by Daily for a date not in YYYY-MM-DD form.
var ErrInvalidDate = errors.New("invalid date, want YYYY-MM-DD")

// Daily opens-or-creates the journal note for date (YYYY-MM-DD; "" means
// today in UTC) under "Journal". The note is titled by its date. If it already
// exists it is returned as-is; otherwise it is created — past and future dates
// included. The whole check-then-create runs under the write mutex so two
// concurrent calls can never create two notes for the same date.
func (s *Store) Daily(date string) (Document, error) {
	now := time.Now().UTC()
	if date == "" {
		date = now.Format("2006-01-02")
	} else if _, err := time.Parse("2006-01-02", date); err != nil {
		return Document{}, ErrInvalidDate
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()

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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	defer s.afterWrite()
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

// resolvePath returns the on-disk path of note id. An indexed path is used
// only while the file there still holds that id (it may have been renamed,
// replaced or deleted outside the app); otherwise the tree is searched.
// Returns ErrNotFound when no file holds the id.
func (s *Store) resolvePath(id string) (string, error) {
	if p, ok := s.indexPath(id); ok {
		if fid, ok := fileNoteID(p); ok && fid == id {
			return p, nil
		}
		s.untrackIndex(id)
	}
	return s.findPath(id)
}

// findPath walks the tree for the file holding note id. File names say
// nothing about ids, so each note's frontmatter is read; every note passed on
// the way is indexed, so a cold store pays for the walk only once.
func (s *Store) findPath(id string) (string, error) {
	var found string
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
		fid, ok := fileNoteID(p)
		if !ok {
			return nil
		}
		s.trackIndex(fid, p)
		if fid == id {
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

// read loads note id. Like resolvePath, an indexed path counts only if the
// file there still holds the id; the check costs nothing extra because the
// file is being read anyway.
func (s *Store) read(id string) (Document, error) {
	if p, ok := s.indexPath(id); ok {
		if doc, err := s.readAt(id, p); err == nil && noteIDOf(doc, p) == id {
			return doc, nil
		}
		s.untrackIndex(id)
	}
	p, err := s.findPath(id)
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

// write persists doc under its title-derived file name (see noteFileTarget).
// The caller must hold writeMu, and for an existing note must have read it
// through this store first, which puts its current file in the index.
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
	id := doc.Meta.ID
	prev, _ := s.indexPath(id)
	path := s.noteFileTarget(dir, id, doc.Meta.Title, prev)

	// Write to a temp file in the same directory, then rename over the real
	// file. Readers never see a partially-written note, and without an atomic
	// swap a reader (e.g. another client's GET or the file listing) could
	// observe a half-written body. os.Rename is atomic on the local FS.
	tmp, err := os.CreateTemp(dir, id+".*.tmp")
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
	// The note's previous file (old title, old folder, or a legacy "<id>.md")
	// goes only now that the new one is in place, and only if it still holds
	// this note (an outside change may have reused the name) and isn't the
	// very same file (a case-only rename on a case-insensitive filesystem).
	if prev != "" && prev != path && !sameFile(prev, path) {
		if fid, ok := fileNoteID(prev); ok && fid == id {
			_ = os.Remove(prev)
		}
	}
	s.trackIndex(id, path)
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

// SearchEntry is one result of a full-text Search: title matches carry no
// snippet; content matches carry a trimmed body slice around the hit.
type SearchEntry struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Path      string    `json:"path"`
	UpdatedAt time.Time `json:"updatedAt"`
	// "title" or "content"
	Match   string `json:"match"`
	Snippet string `json:"snippet,omitempty"`
}

// Search returns up to limit notes whose title or content contains q
// (case-insensitive). Title matches are ranked first, then by updatedAt.
func (s *Store) Search(q string, limit int) ([]SearchEntry, error) {
	ql := strings.ToLower(strings.TrimSpace(q))
	if ql == "" {
		return []SearchEntry{}, nil
	}
	if limit <= 0 {
		limit = 20
	}
	var results []SearchEntry
	err := filepath.WalkDir(s.Dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() != filepath.Base(s.Dir) && strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		if len(results) >= limit {
			return filepath.SkipAll
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return nil // unreadable stray file: skip
		}
		doc, err := Decode(data)
		if err != nil {
			return nil // not a valid note: skip
		}
		tl := strings.ToLower(doc.Meta.Title)
		bl := strings.ToLower(doc.Body)
		titleMatch := strings.Contains(tl, ql)
		contentIdx := strings.Index(bl, ql)
		if !titleMatch && contentIdx < 0 {
			return nil
		}
		e := SearchEntry{
			ID:        doc.Meta.ID,
			Title:     doc.Meta.Title,
			Path:      doc.Meta.Path,
			UpdatedAt: doc.Meta.UpdatedAt,
			Match:     "title",
		}
		if titleMatch {
			// Content also matching is secondary information; only surface
			// it (with a snippet) when the title does not already match.
			results = append(results, e)
			return nil
		}
		e.Match = "content"
		e.Snippet = contentSnippet(doc.Body, contentIdx, ql, 120)
		results = append(results, e)
		return nil
	})
	if err != nil && err != filepath.SkipAll {
		return results, fmt.Errorf("walk notes dir: %w", err)
	}
	// Title matches first, then most recently updated.
	sort.Slice(results, func(i, j int) bool {
		if results[i].Match != results[j].Match {
			return results[i].Match == "title"
		}
		return results[i].UpdatedAt.After(results[j].UpdatedAt)
	})
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

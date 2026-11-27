package notes

// Store operations for two-way sync between the app's engine and a server.
// Sync moves notes between peers verbatim (ids, timestamps and all), so these
// bypass the stamping, tag extraction and image migration of Create/Update.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// ErrUnreadableNote is returned by SyncSnapshot for a note file that can't
// be read or decoded. Sync must not treat it as missing: the other side
// would delete its copy.
var ErrUnreadableNote = errors.New("a note file can't be read")

// SyncSnapshot is every note of a store (by id) and every folder.
type SyncSnapshot struct {
	Notes   map[string]Document
	Folders []string
}

// SyncSnapshot reads the whole store in one walk, like List but strict: an
// unreadable note fails it (ErrUnreadableNote) instead of being skipped.
// A note without a frontmatter id gets the id List and Get give it (its
// file name, see noteIDOf), which also ends up in Meta.ID. Two files with
// one id keep the newer version, as in List.
func (s *Store) SyncSnapshot() (SyncSnapshot, error) {
	snap := SyncSnapshot{Notes: map[string]Document{}, Folders: []string{}}
	err := filepath.WalkDir(s.Dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(s.Dir, p)
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel == "." || rel == "" {
				return nil
			}
			if d.Name() == historyDirName {
				return filepath.SkipDir
			}
			snap.Folders = append(snap.Folders, rel)
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		doc, err := s.readAt("", p)
		if errors.Is(err, ErrNotFound) {
			return nil // removed while walking
		}
		if err != nil {
			return fmt.Errorf("%w: %s: %v", ErrUnreadableNote, rel, err)
		}
		doc.Meta.ID = noteIDOf(doc, p)
		if prev, dup := snap.Notes[doc.Meta.ID]; dup && !doc.Meta.UpdatedAt.After(prev.Meta.UpdatedAt) {
			return nil
		}
		snap.Notes[doc.Meta.ID] = doc
		return nil
	})
	if err != nil {
		return SyncSnapshot{}, err
	}
	return snap, nil
}

// IsSyncAttachmentPath reports whether rel names an attachment (image or
// PDF) inside a store: relative, no "..", and no hidden segment (dot files
// and folders are the app's own, never attachments).
func IsSyncAttachmentPath(rel string) bool {
	rel = strings.ReplaceAll(rel, "\\", "/")
	if rel == "" || strings.HasPrefix(rel, "/") || path.Clean(rel) != rel {
		return false
	}
	for _, seg := range strings.Split(rel, "/") {
		if seg == "" || strings.HasPrefix(seg, ".") {
			return false
		}
	}
	return IsAttachmentName(rel)
}

// AttachmentRefs returns the attachment paths a note body references in the
// store with id vaultID (/api/vaults/<vaultID>/images/<path> URLs).
func AttachmentRefs(body, vaultID string) []string {
	var out []string
	for _, m := range imageURLRe.FindAllStringSubmatch(body, -1) {
		if m[1] != vaultID {
			continue
		}
		p := strings.TrimRight(m[2], ">\"'")
		if unescaped, err := url.PathUnescape(p); err == nil {
			p = unescaped
		}
		out = append(out, p)
	}
	return out
}

// ErrFolderNotEmpty is returned by RemoveFolderIfEmpty for a folder that
// still holds a file somewhere below it.
var ErrFolderNotEmpty = errors.New("folder is not empty")

// ContentHash fingerprints what a note says, independent of its identity:
// id and timestamps are left out (they are compared separately), and so are
// leading newlines of the body, because Decode drops one per round trip and
// a note must hash the same before and after being stored.
func ContentHash(doc Document) string {
	doc.Meta.ID = ""
	doc.Meta.CreatedAt = time.Time{}
	doc.Meta.UpdatedAt = time.Time{}
	for {
		trimmed := strings.TrimPrefix(strings.TrimPrefix(doc.Body, "\r\n"), "\n")
		if trimmed == doc.Body {
			break
		}
		doc.Body = trimmed
	}
	data, err := Encode(doc)
	if err != nil {
		// Meta is plain data, so encoding can't fail in practice; an empty
		// hash never equals a real one, so it only ever reads as "changed".
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// Import writes doc exactly as given: a peer's version must land with its
// own id, timestamps and fields, or the two sides would never agree. check
// (optional) sees the current version (nil if there is none) under the write
// lock, so a decision based on it can't race a local edit; its error aborts
// the import unchanged.
func (s *Store) Import(doc Document, check func(current *Document) error) error {
	if !importableID(doc.Meta.ID) {
		return ErrInvalidID
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	// Reading the current version also indexes its file, which write needs
	// to remove it when the title or folder changes.
	var current *Document
	existing, err := s.read(doc.Meta.ID)
	switch {
	case err == nil:
		current = &existing
	case !errors.Is(err, ErrNotFound):
		return err
	}
	if check != nil {
		if err := check(current); err != nil {
			return err
		}
	}
	if current != nil && !sameEncoding(*current, doc) {
		// Like Update: keep the replaced version restorable. Best-effort, a
		// history failure must not block the write.
		_, _ = s.snapshotHistory(*current)
	}
	if err := s.write(doc); err != nil {
		return err
	}
	s.afterWrite()
	return nil
}

// importableID accepts any id a note can already have: besides NewID ids
// that's the 12-character ids of older notes and the file-name ids of notes
// written without frontmatter (see noteIDOf), which a peer still has to be
// able to store. Only what could break the frontmatter or a path is out.
func importableID(id string) bool {
	return id != "" && len(id) <= 255 && strings.TrimSpace(id) == id && !strings.ContainsAny(id, "/\\\n\r\x00")
}

// sameEncoding reports whether a and b serialize to the same bytes, i.e.
// replacing one with the other changes nothing worth a history snapshot.
func sameEncoding(a, b Document) bool {
	ea, err := Encode(a)
	if err != nil {
		return false
	}
	eb, err := Encode(b)
	if err != nil {
		return false
	}
	return bytes.Equal(ea, eb)
}

// DeleteIf is Delete with a last look: check sees the current version under
// the write lock and its error aborts, so a peer's delete can't remove an
// edit made since the peer last saw the note. An absent note is success
// without calling check.
func (s *Store) DeleteIf(id string, check func(current Document) error) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	p, err := s.resolvePath(id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		return err
	}
	current, err := s.readAt(id, p)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		return err
	}
	if check != nil {
		if err := check(current); err != nil {
			return err
		}
	}
	// Nexote has no trash: the last version goes to the note's history, so
	// a deletion that came through sync can still be undone there.
	_, _ = s.snapshotHistory(current)
	if err := os.Remove(p); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("delete note: %w", err)
	}
	s.untrackIndex(id)
	s.pruneEmptyDirs(filepath.Dir(p))
	s.afterWrite()
	return nil
}

// RemoveFolderIfEmpty removes folder p and its subfolders only if there is
// no file anywhere below it, so a peer's folder delete can never take notes
// or attachments with it. A missing folder is success.
func (s *Store) RemoveFolderIfEmpty(p string) error {
	p = sanitizePath(p)
	if p == "" {
		return fmt.Errorf("folder path cannot be empty")
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	root := filepath.Join(s.Dir, filepath.FromSlash(p))
	info, err := os.Lstat(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("stat folder: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("%q is not a folder", p)
	}
	var dirs []string
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			return ErrFolderNotEmpty
		}
		dirs = append(dirs, path)
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrFolderNotEmpty) {
			return ErrFolderNotEmpty
		}
		return fmt.Errorf("walk folder: %w", err)
	}
	// Deepest first, with Remove rather than RemoveAll: a file created since
	// the walk makes its folder fail to go instead of being deleted.
	for i := len(dirs) - 1; i >= 0; i-- {
		if err := os.Remove(dirs[i]); err != nil && !errors.Is(err, os.ErrNotExist) {
			if entries, rerr := os.ReadDir(dirs[i]); rerr == nil && len(entries) > 0 {
				return ErrFolderNotEmpty
			}
			return fmt.Errorf("remove folder: %w", err)
		}
	}
	s.deleteFolderLabels(p)
	s.afterWrite()
	return nil
}

// Attachments lists every attachment (image or PDF) in the store by its
// slash-separated path relative to the store root, with its size. Hidden
// files and folders (history, temp files) are not content and are skipped.
func (s *Store) Attachments() (map[string]int64, error) {
	out := map[string]int64{}
	err := filepath.WalkDir(s.Dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == s.Dir {
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() || !IsAttachmentName(d.Name()) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		rel, err := filepath.Rel(s.Dir, p)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = info.Size()
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk attachments: %w", err)
	}
	return out, nil
}

// WriteAttachment stores an attachment at relPath (relative to the store
// root), creating its folders. The bytes go to a hidden temp file first and
// are renamed into place, so a reader never sees a partial file.
func (s *Store) WriteAttachment(relPath string, data []byte) error {
	p, ok := s.safeImagePath(relPath)
	if !ok || !IsSyncAttachmentPath(relPath) {
		return fmt.Errorf("invalid attachment path %q", relPath)
	}
	// Under the write lock so RemoveFolderIfEmpty can't remove the folder
	// between creating it and renaming the file into it.
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	dir := filepath.Dir(p)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create attachment dir: %w", err)
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(p)+".*.tmp")
	if err != nil {
		return fmt.Errorf("create attachment temp: %w", err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return fmt.Errorf("write attachment temp: %w", err)
	}
	if err := tmp.Chmod(0o644); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return fmt.Errorf("chmod attachment temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("close attachment temp: %w", err)
	}
	if err := os.Rename(tmpName, p); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("rename attachment: %w", err)
	}
	s.afterWrite()
	return nil
}

// RewriteBodies passes every note's body through fn and writes back those it
// changes, meta untouched: sync uses it to fix ids inside links after a
// rekey, which is not an edit and must not bump timestamps or add history.
// Returns the ids of the rewritten notes.
func (s *Store) RewriteBodies(fn func(body string) string) ([]string, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	list, err := s.List()
	if err != nil {
		return nil, err
	}
	var changed []string
	for _, e := range list.Notes {
		if e.ID == "" {
			continue
		}
		doc, err := s.read(e.ID)
		if err != nil {
			return changed, err
		}
		body := fn(doc.Body)
		if body == doc.Body {
			continue
		}
		doc.Body = body
		if err := s.write(doc); err != nil {
			return changed, err
		}
		changed = append(changed, e.ID)
	}
	if len(changed) > 0 {
		s.afterWrite()
	}
	return changed, nil
}

// FolderLabels returns a copy of the folder label colors, keyed by folder
// path.
func (s *Store) FolderLabels() map[string]string {
	folderLabelsMu.Lock()
	defer folderLabelsMu.Unlock()
	out := make(map[string]string)
	for p, color := range s.readFolderLabels() {
		out[p] = color
	}
	return out
}

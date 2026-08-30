package notes

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// History is stored as full per-version snapshot files under a hidden
// ".history" directory inside the store root:
//
//	<store>/.history/<noteId>/<unix-ms>.md
//
// Each snapshot is a complete, restorable copy of the note (frontmatter +
// body) at the moment before an update. Keeping every version means a note can
// always be recovered, even if a later save clobbers it.

// historyDirName is the hidden folder that holds all note histories.
const historyDirName = ".history"

// HistoryVersion is the metadata returned when listing a note's history.
type HistoryVersion struct {
	Timestamp time.Time `json:"timestamp"`
	Snippet   string    `json:"snippet"`
}

// historyDir returns the per-note history directory for id.
func (s *Store) historyDir(id string) string {
	return filepath.Join(s.Dir, historyDirName, id)
}

// snapshotHistory writes a full copy of doc to the note's history directory,
// keyed by the current time. It is best-effort: a failure to write history
// must never block the actual save. Returns the timestamp used.
func (s *Store) snapshotHistory(doc Document) (time.Time, error) {
	ts := time.Now().UTC()
	dir := s.historyDir(doc.Meta.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ts, fmt.Errorf("create history dir: %w", err)
	}
	data, err := Encode(doc)
	if err != nil {
		return ts, fmt.Errorf("encode history snapshot: %w", err)
	}
	// Use nanosecond precision so rapid successive saves (which can land in
	// the same millisecond) each get their own snapshot file. If a collision
	// still occurs, append a counter suffix.
	name := filepath.Join(dir, fmt.Sprintf("%d.md", ts.UnixNano()))
	if _, err := os.Stat(name); err == nil {
		for i := 1; ; i++ {
			alt := filepath.Join(dir, fmt.Sprintf("%d-%d.md", ts.UnixNano(), i))
			if _, err := os.Stat(alt); os.IsNotExist(err) {
				name = alt
				break
			}
		}
	}
	if err := os.WriteFile(name, data, 0o644); err != nil {
		return ts, fmt.Errorf("write history snapshot: %w", err)
	}
	return ts, nil
}

// ListHistory returns the saved versions for a note, newest first. A note with
// no history returns an empty slice (not an error).
func (s *Store) ListHistory(id string) ([]HistoryVersion, error) {
	dir := s.historyDir(id)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []HistoryVersion{}, nil
		}
		return nil, fmt.Errorf("list history: %w", err)
	}
	versions := make([]HistoryVersion, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		ts, ok := parseHistoryName(e.Name())
		if !ok {
			continue
		}
		versions = append(versions, HistoryVersion{
			Timestamp: ts,
			Snippet:   historySnippet(filepath.Join(dir, e.Name())),
		})
	}
	sort.Slice(versions, func(i, j int) bool {
		return versions[i].Timestamp.After(versions[j].Timestamp)
	})
	return versions, nil
}

// GetHistoryVersion returns the full document for a specific saved version,
// identified by its nanosecond timestamp. Returns ErrNotFound if the version
// does not exist.
func (s *Store) GetHistoryVersion(id string, ts int64) (Document, error) {
	dir := s.historyDir(id)
	prefix := fmt.Sprintf("%d", ts)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Document{}, ErrNotFound
		}
		return Document{}, fmt.Errorf("read history dir: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		if strings.HasPrefix(e.Name(), prefix) {
			data, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				return Document{}, fmt.Errorf("read history version: %w", err)
			}
			doc, err := Decode(data)
			if err != nil {
				return Document{}, fmt.Errorf("decode history version: %w", err)
			}
			return doc, nil
		}
	}
	return Document{}, ErrNotFound
}

// RestoreHistoryVersion restores a saved version as the note's current content
// by writing it through the normal Update path (so the pre-restore state is
// itself snapshotted to history). Returns the restored document.
func (s *Store) RestoreHistoryVersion(id string, ts int64) (Document, error) {
	version, err := s.GetHistoryVersion(id, ts)
	if err != nil {
		return Document{}, err
	}
	return s.Update(id, UpdateInput{
		Title: version.Meta.Title,
		Body:  version.Body,
		Path:  &version.Meta.Path,
	})
}

// parseHistoryName parses a snapshot filename ("<nanos>.md" or
// "<nanos>-<n>.md") into its timestamp. Returns ok=false for non-snapshot
// files.
func parseHistoryName(name string) (time.Time, bool) {
	base := strings.TrimSuffix(name, ".md")
	// Strip an optional "-<n>" collision suffix.
	if i := strings.LastIndex(base, "-"); i > 0 {
		base = base[:i]
	}
	ns, err := strconv.ParseInt(base, 10, 64)
	if err != nil || ns <= 0 {
		return time.Time{}, false
	}
	return time.Unix(0, ns).UTC(), true
}

// historySnippet extracts a short plain-text preview from a history snapshot
// file, skipping the frontmatter and the first heading line.
func historySnippet(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	doc, err := Decode(data)
	if err != nil {
		return ""
	}
	return makeSnippet(doc.Body, 120)
}

package notes

// Finder-style folder "labels": a per-vault registry of folder path → color
// name, persisted as folders.json in the vault root. The colored dot is
// rendered by the frontend next to the folder name; the file lives outside
// the note stores (never treated as a note), and Rename/DeleteFolder keep
// the keys in sync with the folder tree.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type folderLabels map[string]string

func (s *Store) folderLabelsPath() string {
	return filepath.Join(s.Dir, "folders.json")
}

var folderLabelsMu sync.Mutex

func (s *Store) readFolderLabels() folderLabels {
	data, err := os.ReadFile(s.folderLabelsPath())
	if err != nil {
		return folderLabels{}
	}
	var labels folderLabels
	_ = json.Unmarshal(data, &labels)
	return labels
}

func (s *Store) writeFolderLabels(labels folderLabels) error {
	if labels == nil {
		labels = folderLabels{}
	}
	data, err := json.MarshalIndent(labels, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.folderLabelsPath(), data, 0o644)
}

// LabelFolder stores (or clears, with an empty color) the Finder-style
// label color of a folder, keying the real on-disk path.
func (s *Store) LabelFolder(p, color string) error {
	folderLabelsMu.Lock()
	defer folderLabelsMu.Unlock()
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	p = sanitizePath(p)
	if p == "" {
		return fmt.Errorf("folder path cannot be empty")
	}
	labels := s.readFolderLabels()
	if color == "" {
		delete(labels, p)
	} else {
		labels[p] = color
	}
	return s.writeFolderLabels(labels)
}

// renameFolderLabels rekeys label entries from oldRel to newRel (including
// everything below the renamed folder).
func (s *Store) renameFolderLabels(oldRel, newRel string) {
	folderLabelsMu.Lock()
	defer folderLabelsMu.Unlock()

	labels := s.readFolderLabels()
	if len(labels) == 0 {
		return
	}
	next := folderLabels{}
	for path, color := range labels {
		switch {
		case path == oldRel:
			next[newRel] = color
		case strings.HasPrefix(path, oldRel+"/"):
			next[newRel+path[len(oldRel):]] = color
		default:
			next[path] = color
		}
	}
	_ = s.writeFolderLabels(next)
}

// deleteFolderLabels drops label entries for the folder (and its children).
func (s *Store) deleteFolderLabels(prefix string) {
	folderLabelsMu.Lock()
	defer folderLabelsMu.Unlock()

	labels := s.readFolderLabels()
	if len(labels) == 0 {
		return
	}
	next := folderLabels{}
	for path, color := range labels {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			continue
		}
		next[path] = color
	}
	_ = s.writeFolderLabels(next)
}

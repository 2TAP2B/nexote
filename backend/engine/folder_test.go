package engine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFolderIDIsStableUntilTheFolderIsWiped(t *testing.T) {
	home := t.TempDir()
	first, err := folderID(home)
	if err != nil || first == "" {
		t.Fatalf("folderID: %q, %v", first, err)
	}
	if again, err := folderID(home); err != nil || again != first {
		t.Fatalf("second call: %q, %v; want %q", again, err, first)
	}
	// An emptied (or replaced) folder at the same path is another folder
	// for sync: it must not inherit the old base.
	if err := os.RemoveAll(filepath.Join(home, ".nexote")); err != nil {
		t.Fatal(err)
	}
	if fresh, err := folderID(home); err != nil || fresh == first {
		t.Fatalf("after wiping: %q, %v; want a new id", fresh, err)
	}
}

package api

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"nexote/accounts"
	"nexote/notes"
)

// notepadTitle is the quick-capture note (frontend lib/notepad.ts). It
// lives in each user's personal "home" store.
const notepadTitle = "Notepad"

// AdoptLegacyData gives everything from before accounts existed to the
// first admin:
//   - vaults without a space join the admin's first space (created as
//     "Personal" if needed), with the vault's bookmarks and shortcuts,
//   - the collection definitions ($NEXOTE_HOME/collections) move into that
//     space,
//   - the journal ($NEXOTE_HOME/journal) becomes the admin's journal,
//   - the quick-capture "Notepad" note moves into the admin's home store.
//
// It is idempotent: it runs at setup and at every start, and does nothing
// once the legacy data is adopted (or before any account exists).
func (h *Handler) AdoptLegacyData() error {
	admin, ok := h.firstAdmin()
	if !ok {
		return nil
	}
	vaults, err := h.Registry.List()
	if err != nil {
		return err
	}
	var orphans []notes.VaultMeta
	for _, v := range vaults {
		if v.SpaceID == "" {
			orphans = append(orphans, v)
		}
	}
	legacyCollections := filepath.Join(h.home, "collections", "collections.json")
	legacyJournal := filepath.Join(h.home, "journal")
	_, colErr := os.Stat(legacyCollections)
	_, jourErr := os.Stat(legacyJournal)
	if len(orphans) == 0 && colErr != nil && jourErr != nil {
		return nil
	}

	space, err := h.adoptionSpace(admin)
	if err != nil {
		return err
	}
	var errs []error
	for _, v := range orphans {
		if err := h.Registry.SetSpace(v.ID, space.ID); err != nil {
			errs = append(errs, fmt.Errorf("vault %q: %w", v.Name, err))
			continue
		}
		if err := notes.AdoptLegacyLists(v.Path, admin.ID); err != nil {
			errs = append(errs, fmt.Errorf("vault %q bookmarks: %w", v.Name, err))
		}
	}
	if colErr == nil {
		target := filepath.Join(h.home, "spaces", space.ID, "collections.json")
		if err := moveIfAbsent(legacyCollections, target); err != nil {
			errs = append(errs, fmt.Errorf("collections: %w", err))
		} else {
			_ = os.Remove(filepath.Dir(legacyCollections)) // only if empty
			h.colMu.Lock()
			delete(h.collectionsReady, space.ID)
			h.colMu.Unlock()
		}
	}
	if jourErr == nil {
		target := filepath.Join(h.home, "users", admin.ID, "journal")
		if err := moveDirIfAbsent(legacyJournal, target); err != nil {
			errs = append(errs, fmt.Errorf("journal: %w", err))
		}
	}
	if len(orphans) > 0 {
		if err := h.adoptNotepad(admin, orphans); err != nil {
			errs = append(errs, fmt.Errorf("notepad: %w", err))
		}
	}
	log.Printf("adopted pre-account data into %q's space %q (%d vaults)", admin.Username, space.Name, len(orphans))
	return errors.Join(errs...)
}

// adoptionSpace is the admin's oldest owned space, or a new private one.
func (h *Handler) adoptionSpace(admin accounts.User) (notes.Space, error) {
	for _, s := range h.Spaces.ForUser(admin.ID) {
		if role, _ := s.RoleOf(admin.ID); role == notes.SpaceOwner {
			return s, nil
		}
	}
	return h.Spaces.Create("Personal", "", admin.ID)
}

// adoptNotepad moves the first "Notepad" note found in the adopted vaults
// into the admin's home store, unless they already have one there.
func (h *Handler) adoptNotepad(admin accounts.User, vaults []notes.VaultMeta) error {
	home, err := h.personalStore(admin.ID, "home")
	if err != nil {
		return err
	}
	if existing, err := home.List(); err == nil {
		for _, n := range existing.Notes {
			if n.Title == notepadTitle {
				return nil
			}
		}
	}
	for _, v := range vaults {
		if v.Type == notes.VaultTypeCollections {
			continue
		}
		src, err := h.Registry.Store(v.ID)
		if err != nil {
			continue
		}
		list, err := src.List()
		if err != nil {
			continue
		}
		for _, n := range list.Notes {
			if n.Title == notepadTitle && n.Collection == "" {
				root := ""
				_, err := notes.MoveNote(src, n.ID, home, "home", &root)
				return err
			}
		}
	}
	return nil
}

// moveIfAbsent renames src to dst unless dst exists.
func moveIfAbsent(src, dst string) error {
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("%s already exists", dst)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.Rename(src, dst)
}

// moveDirIfAbsent renames the directory src to dst unless dst exists with
// content (an empty dst is replaced).
func moveDirIfAbsent(src, dst string) error {
	if entries, err := os.ReadDir(dst); err == nil {
		if len(entries) > 0 {
			return fmt.Errorf("%s already has content", dst)
		}
		if err := os.Remove(dst); err != nil {
			return err
		}
	}
	return moveIfAbsent(src, dst)
}

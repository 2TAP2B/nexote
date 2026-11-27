package api

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"nexote/accounts"
	"nexote/notes"
)

// Sync primitives. The Android app's engine mirrors the user's account:
// the spaces they own with their vaults and collection definitions, the
// personal stores journal and home, and the account prefs. Both sides
// expose the same operations on Handler, taking the acting user's id: the
// server's /api/sync/ routes (sync_routes.go) wrap them for a paired
// device's user, the engine calls them directly for its local user. The
// sync algorithm itself lives in the engine (package serversync).
//
// Only spaces the user owns are in scope (shared spaces where they are an
// editor or viewer are not synced); anything else is notes.ErrNotFound.
// Mutations publish the usual events, marked FromSync so the engine doesn't
// take its own writes for local changes.

// ErrSyncConflict means the item changed since the caller's last look (the
// expected content hash doesn't match): the caller re-reads and retries in
// a later round.
var ErrSyncConflict = errors.New("changed since the last sync")

// ErrSyncRefused wraps a structure change the side won't make (its only
// space, a space's last vault, a built-in collection). Not an error for a
// whole sync: the item stays as it is.
var ErrSyncRefused = errors.New("refused")

// ErrSyncUnreadable means a scope holds a note file that can't be read: the
// scope is left out of the run instead of looking like that note was
// deleted.
var ErrSyncUnreadable = errors.New("a note can't be read")

func refused(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrSyncRefused, fmt.Sprintf(format, args...))
}

// SyncNote is a note on the wire: the complete frontmatter (every field,
// timestamps included, so sync preserves them) and the body. Meta has no
// JSON tags, so its fields travel under their Go names; new Meta fields are
// carried without changes here.
type SyncNote struct {
	Meta notes.Meta `json:"meta"`
	Body string     `json:"body"`
}

// Document returns the note as a notes.Document.
func (n SyncNote) Document() notes.Document { return notes.Document{Meta: n.Meta, Body: n.Body} }

// SyncNoteInfo is a note in a manifest: its content hash and what the
// singleton rules (the Notepad, daily notes) need to know.
type SyncNoteInfo struct {
	Hash       string    `json:"hash"`
	UpdatedAt  time.Time `json:"updatedAt"`
	Title      string    `json:"title"`
	Path       string    `json:"path,omitempty"`
	Collection string    `json:"collection,omitempty"`
}

func noteInfo(doc notes.Document) SyncNoteInfo {
	return SyncNoteInfo{
		Hash:       notes.ContentHash(doc),
		UpdatedAt:  doc.Meta.UpdatedAt,
		Title:      doc.Meta.Title,
		Path:       doc.Meta.Path,
		Collection: doc.Meta.Collection,
	}
}

// SyncManifest is the current state of one scope (a vault id, "journal" or
// "home").
type SyncManifest struct {
	Notes map[string]SyncNoteInfo `json:"notes"`
	// Attachments maps paths relative to the store to sizes; their names
	// are random, so they are treated as immutable.
	Attachments map[string]int64  `json:"attachments"`
	Folders     []string          `json:"folders"`
	Labels      map[string]string `json:"labels"`
	// Bookmarks and Shortcuts are the user's lists in this store (their
	// files are named after the user id, which differs per side).
	Bookmarks []string `json:"bookmarks"`
	Shortcuts []string `json:"shortcuts"`
	// Refs are the attachment paths the scope's notes reference; sync never
	// deletes those.
	Refs []string `json:"refs"`
}

// SyncSpace, SyncVault and SyncStructure describe what the user owns.
type SyncSpace struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Icon      string    `json:"icon,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type SyncVault struct {
	ID      string `json:"id"`
	SpaceID string `json:"spaceId"`
	Name    string `json:"name"`
	Icon    string `json:"icon,omitempty"`
	Type    string `json:"type,omitempty"`
}

type SyncStructure struct {
	// Spaces are the owned spaces, oldest first; Vaults their vaults in
	// registry order.
	Spaces []SyncSpace `json:"spaces"`
	Vaults []SyncVault `json:"vaults"`
	// Collections are the collection definitions per space id.
	Collections map[string][]notes.CollectionMeta `json:"collections"`
	// Prefs are the account prefs (accounts.PrefKeys).
	Prefs map[string]string `json:"prefs"`
	// Device is the asking device's sync record (server only).
	Device *SyncDevice `json:"device,omitempty"`
}

// SyncDevice is what the server remembers of a device's syncs. A device
// compares LastSyncAt with its own record to notice that the server's data
// was restored from a backup.
type SyncDevice struct {
	LastSyncAt time.Time `json:"lastSyncAt,omitzero"`
}

// SyncFolderChange creates folders, removes empty ones (a folder still
// holding files stays) and sets folder labels ("" clears one).
type SyncFolderChange struct {
	Create []string          `json:"create,omitempty"`
	Remove []string          `json:"remove,omitempty"`
	Labels map[string]string `json:"labels,omitempty"`
}

// SyncLists replaces the user's bookmarks and/or shortcuts of a store; nil
// leaves a list as it is.
type SyncLists struct {
	Bookmarks []string `json:"bookmarks"`
	Shortcuts []string `json:"shortcuts"`
}

// --- scope and audience ---

func (h *Handler) syncAccount(userID string) (*accounts.User, error) {
	u, err := h.Accounts.User(userID)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// ownedSpace returns the space if the user owns it, else notes.ErrNotFound.
func (h *Handler) ownedSpace(userID, spaceID string) (notes.Space, error) {
	s, err := h.Spaces.Get(spaceID)
	if err != nil {
		return notes.Space{}, notes.ErrNotFound
	}
	if role, ok := s.RoleOf(userID); !ok || role != notes.SpaceOwner {
		return notes.Space{}, notes.ErrNotFound
	}
	return s, nil
}

// ownedVault returns the vault if the user owns its space.
func (h *Handler) ownedVault(userID, vaultID string) (notes.VaultMeta, error) {
	v, err := h.Registry.Get(vaultID)
	if err != nil {
		return notes.VaultMeta{}, notes.ErrNotFound
	}
	if _, err := h.ownedSpace(userID, v.SpaceID); err != nil {
		return notes.VaultMeta{}, err
	}
	return v, nil
}

// syncStore returns the store of a scope: a personal store or a vault of an
// owned space.
func (h *Handler) syncStore(userID, scope string) (*notes.Store, error) {
	if kind, ok := personalVaults[scope]; ok {
		return h.personalStore(userID, kind)
	}
	if _, err := h.ownedVault(userID, scope); err != nil {
		return nil, err
	}
	return h.Registry.Store(scope)
}

// syncAudience is who sees changes of a scope.
func (h *Handler) syncAudience(userID, scope string) map[string]bool {
	if _, personal := personalVaults[scope]; personal {
		return map[string]bool{userID: true}
	}
	u, err := h.syncAccount(userID)
	if err != nil {
		return map[string]bool{userID: true}
	}
	return h.vaultAudience(u, scope)
}

func (h *Handler) publishSyncNote(userID, scope, id string, updatedAt time.Time) {
	audience := h.syncAudience(userID, scope)
	h.Events.publish(NoteEvent{Type: "note-change", VaultID: scope, ID: id, UpdatedAt: updatedAt.Format(timeRFC3339Millis), FromSync: true}, audience)
	h.Events.publish(NoteEvent{Type: "tree-change", VaultID: scope, FromSync: true}, audience)
}

func (h *Handler) publishSyncTree(userID, scope string) {
	h.Events.publish(NoteEvent{Type: "tree-change", VaultID: scope, FromSync: true}, h.syncAudience(userID, scope))
}

func (h *Handler) publishSyncSpaces(userID, spaceID string) {
	audience := map[string]bool{userID: true}
	if s, err := h.Spaces.Get(spaceID); err == nil {
		for _, m := range s.Members {
			audience[m.UserID] = true
		}
	}
	h.Events.publish(NoteEvent{Type: "spaces-change", SpaceID: spaceID, FromSync: true}, audience)
}

// SubscribeEvents delivers the events the user would get on their event
// stream until cancel is called. The engine watches it for local changes.
func (h *Handler) SubscribeEvents(userID string) (<-chan NoteEvent, func()) {
	s := h.Events.subscribe(userID)
	return s.ch, func() { h.Events.unsubscribe(s) }
}

// --- structure ---

// SyncStructure returns the spaces the user owns, their vaults and
// collection definitions, and the account prefs.
func (h *Handler) SyncStructure(userID string) (SyncStructure, error) {
	u, err := h.syncAccount(userID)
	if err != nil {
		return SyncStructure{}, err
	}
	out := SyncStructure{Spaces: []SyncSpace{}, Vaults: []SyncVault{}, Collections: map[string][]notes.CollectionMeta{}, Prefs: map[string]string{}}
	owned := map[string]bool{}
	for _, s := range h.Spaces.ForUser(userID) {
		if role, _ := s.RoleOf(userID); role != notes.SpaceOwner {
			continue
		}
		owned[s.ID] = true
		out.Spaces = append(out.Spaces, SyncSpace{ID: s.ID, Name: s.Name, Icon: s.Icon, CreatedAt: s.CreatedAt})
		// The definitions are read as they are: h.collections would create
		// a Collections vault (with a new id) for a space whose vaults are
		// still on their way.
		reg, err := notes.NewCollectionRegistry(filepath.Join(h.home, "spaces", s.ID))
		if err != nil {
			return SyncStructure{}, err
		}
		cols, err := reg.List()
		if err != nil {
			return SyncStructure{}, err
		}
		out.Collections[s.ID] = cols
	}
	vaults, err := h.Registry.List()
	if err != nil {
		return SyncStructure{}, err
	}
	for _, v := range vaults {
		if owned[v.SpaceID] {
			out.Vaults = append(out.Vaults, SyncVault{ID: v.ID, SpaceID: v.SpaceID, Name: v.Name, Icon: v.Icon, Type: v.Type})
		}
	}
	for k, v := range u.Prefs {
		if accounts.PrefKeys[k] {
			out.Prefs[k] = v
		}
	}
	return out, nil
}

// SyncPutSpace creates the space with its id, or renames it / changes its
// icon.
func (h *Handler) SyncPutSpace(userID string, in SyncSpace) error {
	if _, err := h.Spaces.Get(in.ID); err != nil {
		if _, err := h.Spaces.CreateWithID(in.ID, in.Name, in.Icon, userID); err != nil {
			return refused("space %q: %v", in.Name, err)
		}
		h.publishSyncSpaces(userID, in.ID)
		return nil
	}
	s, err := h.ownedSpace(userID, in.ID)
	if err != nil {
		return err
	}
	if s.Name == in.Name && s.Icon == in.Icon {
		return nil
	}
	if _, err := h.Spaces.Update(in.ID, &in.Name, &in.Icon); err != nil {
		return refused("space %q: %v", in.Name, err)
	}
	h.publishSyncSpaces(userID, in.ID)
	return nil
}

// SyncDeleteSpace deletes an owned space with its vaults. The user's only
// space is refused.
func (h *Handler) SyncDeleteSpace(userID, spaceID string) error {
	space, err := h.ownedSpace(userID, spaceID)
	if err != nil {
		if errors.Is(err, notes.ErrNotFound) {
			return nil
		}
		return err
	}
	if len(h.Spaces.ForUser(userID)) <= 1 {
		return refused("you can't delete your only space")
	}
	if err := h.removeSpace(space); err != nil {
		return err
	}
	h.Events.publish(NoteEvent{Type: "spaces-change", SpaceID: spaceID, FromSync: true}, memberSet(space, userID))
	return nil
}

func memberSet(s notes.Space, extra string) map[string]bool {
	out := map[string]bool{extra: true}
	for _, m := range s.Members {
		out[m.UserID] = true
	}
	return out
}

// SyncPutVault creates the vault with its id in an owned space, or renames
// it / changes its icon / sets its type. Moving a vault to another space
// isn't a thing in Nexote and is refused.
func (h *Handler) SyncPutVault(userID string, in SyncVault) error {
	if _, err := h.ownedSpace(userID, in.SpaceID); err != nil {
		return err
	}
	existing, err := h.Registry.Get(in.ID)
	if err != nil {
		// Names are unique per space: a vault of the same name made on the
		// other side gets a number.
		name := in.Name
		for i := 2; ; i++ {
			_, err = h.Registry.CreateWithID(in.ID, name, in.Icon, in.SpaceID, in.Type)
			if err == nil || i > 20 || !strings.Contains(err.Error(), "already exists") || errors.Is(err, notes.ErrVaultExists) {
				break
			}
			name = fmt.Sprintf("%s %d", in.Name, i)
		}
		if err != nil {
			return refused("vault %q: %v", in.Name, err)
		}
		h.publishSyncSpaces(userID, in.SpaceID)
		return nil
	}
	if existing.SpaceID != in.SpaceID {
		// Someone else's vault id says nothing about it to this user.
		if _, err := h.ownedSpace(userID, existing.SpaceID); err != nil {
			return notes.ErrNotFound
		}
		return refused("vault %q belongs to another space", existing.Name)
	}
	changed := false
	if existing.Name != in.Name {
		if _, err := h.Registry.Rename(in.ID, in.Name); err != nil {
			return refused("vault %q: %v", in.Name, err)
		}
		changed = true
	}
	if existing.Icon != in.Icon {
		if _, err := h.Registry.SetIcon(in.ID, in.Icon); err != nil {
			return err
		}
		changed = true
	}
	if in.Type != "" && existing.Type != in.Type {
		if err := h.Registry.SetType(in.ID, in.Type); err != nil {
			return err
		}
		changed = true
	}
	if changed {
		h.publishSyncSpaces(userID, in.SpaceID)
	}
	return nil
}

// SyncDeleteVault deletes a vault of an owned space. The Collections vault
// and a space's last regular vault are refused.
func (h *Handler) SyncDeleteVault(userID, vaultID string) error {
	vault, err := h.ownedVault(userID, vaultID)
	if err != nil {
		if errors.Is(err, notes.ErrNotFound) {
			return nil
		}
		return err
	}
	if vault.Type == notes.VaultTypeCollections {
		return refused("the Collections vault goes only with its space")
	}
	siblings, err := h.Registry.ListSpace(vault.SpaceID)
	if err != nil {
		return err
	}
	regular := 0
	for _, v := range siblings {
		if v.Type != notes.VaultTypeCollections {
			regular++
		}
	}
	if regular <= 1 {
		return refused("a space needs at least one vault")
	}
	if err := h.Registry.Delete(vaultID); err != nil {
		return err
	}
	h.publishSyncSpaces(userID, vault.SpaceID)
	return nil
}

func (h *Handler) spaceCollectionRegistry(userID, spaceID string) (*notes.CollectionRegistry, error) {
	if _, err := h.ownedSpace(userID, spaceID); err != nil {
		return nil, err
	}
	return notes.NewCollectionRegistry(filepath.Join(h.home, "spaces", spaceID))
}

// SyncPutCollection creates or replaces a collection definition.
func (h *Handler) SyncPutCollection(userID, spaceID string, col notes.CollectionMeta) error {
	reg, err := h.spaceCollectionRegistry(userID, spaceID)
	if err != nil {
		return err
	}
	if err := reg.Put(col); err != nil {
		return refused("collection %q: %v", col.Name, err)
	}
	h.publishSyncSpaces(userID, spaceID)
	return nil
}

// SyncDeleteCollection deletes a collection definition (its items are
// notes and sync on their own). Built-ins are refused: they come back on
// every start anyway.
func (h *Handler) SyncDeleteCollection(userID, spaceID, id string) error {
	reg, err := h.spaceCollectionRegistry(userID, spaceID)
	if err != nil {
		return err
	}
	col, err := reg.Get(id)
	if err != nil {
		return nil
	}
	if col.BuiltIn {
		return refused("built-in collection %q", col.Name)
	}
	if err := reg.Delete(id); err != nil && !errors.Is(err, notes.ErrNotFound) {
		return err
	}
	h.publishSyncSpaces(userID, spaceID)
	return nil
}

// SyncPutPrefs merges account prefs (unknown keys are dropped).
func (h *Handler) SyncPutPrefs(userID string, prefs map[string]string) error {
	patch := map[string]string{}
	for k, v := range prefs {
		if accounts.PrefKeys[k] {
			patch[k] = v
		}
	}
	if len(patch) == 0 {
		return nil
	}
	_, err := h.Accounts.SetPrefs(userID, patch)
	return err
}

// --- scope contents ---

// SyncManifest returns the state of one scope.
func (h *Handler) SyncManifest(userID, scope string) (SyncManifest, error) {
	store, err := h.syncStore(userID, scope)
	if err != nil {
		return SyncManifest{}, err
	}
	snap, err := store.SyncSnapshot()
	if errors.Is(err, notes.ErrUnreadableNote) {
		return SyncManifest{}, fmt.Errorf("%w: %v", ErrSyncUnreadable, err)
	}
	if err != nil {
		return SyncManifest{}, err
	}
	m := SyncManifest{Notes: map[string]SyncNoteInfo{}, Folders: snap.Folders, Refs: []string{}}
	refs := map[string]bool{}
	for id, doc := range snap.Notes {
		m.Notes[id] = noteInfo(doc)
		for _, p := range notes.AttachmentRefs(doc.Body, scope) {
			if !refs[p] {
				refs[p] = true
				m.Refs = append(m.Refs, p)
			}
		}
	}
	slices.Sort(m.Refs)
	if m.Attachments, err = store.Attachments(); err != nil {
		return SyncManifest{}, err
	}
	m.Labels = store.FolderLabels()
	if m.Bookmarks, err = notes.NewBookmarks(store.Dir, userID).List(); err != nil {
		return SyncManifest{}, err
	}
	if m.Shortcuts, err = notes.NewShortcuts(store.Dir, userID).List(); err != nil {
		return SyncManifest{}, err
	}
	return m, nil
}

// SyncGetNote returns a note with its complete frontmatter.
func (h *Handler) SyncGetNote(userID, scope, id string) (SyncNote, error) {
	store, err := h.syncStore(userID, scope)
	if err != nil {
		return SyncNote{}, err
	}
	doc, err := store.Get(id)
	if err != nil {
		return SyncNote{}, err
	}
	// A note without a frontmatter id goes by its file name (see the
	// manifest); its copy on the other side carries that id.
	if doc.Meta.ID == "" {
		doc.Meta.ID = id
	}
	return SyncNote{Meta: doc.Meta, Body: doc.Body}, nil
}

// SyncPutNote writes a note as given (timestamps kept), if the note there
// still has the content hash expect ("" = there is no such note). A note
// that already has the new content counts as written. Overwrites keep the
// previous version in the note's history.
func (h *Handler) SyncPutNote(userID, scope string, note SyncNote, expect string) (SyncNoteInfo, error) {
	store, err := h.syncStore(userID, scope)
	if err != nil {
		return SyncNoteInfo{}, err
	}
	doc := note.Document()
	want := notes.ContentHash(doc)
	err = store.Import(doc, func(current *notes.Document) error {
		have := ""
		if current != nil {
			have = notes.ContentHash(*current)
		}
		if have != expect && have != want {
			return ErrSyncConflict
		}
		return nil
	})
	if err != nil {
		return SyncNoteInfo{}, err
	}
	h.publishSyncNote(userID, scope, doc.Meta.ID, doc.Meta.UpdatedAt)
	return noteInfo(doc), nil
}

// SyncDeleteNote deletes a note if it still has the content hash expect.
// A missing note counts as deleted.
func (h *Handler) SyncDeleteNote(userID, scope, id, expect string) error {
	store, err := h.syncStore(userID, scope)
	if err != nil {
		return err
	}
	deleted := false
	err = store.DeleteIf(id, func(current notes.Document) error {
		if notes.ContentHash(current) != expect {
			return ErrSyncConflict
		}
		deleted = true
		return nil
	})
	if err != nil {
		return err
	}
	if deleted {
		h.publishSyncTree(userID, scope)
	}
	return nil
}

// SyncReadAttachment, SyncWriteAttachment and SyncDeleteAttachment handle
// images and PDFs by their path in the store.
func (h *Handler) SyncReadAttachment(userID, scope, path string) ([]byte, error) {
	store, err := h.syncStore(userID, scope)
	if err != nil {
		return nil, err
	}
	if !notes.IsSyncAttachmentPath(path) {
		return nil, notes.ErrNotFound
	}
	data, err := store.ReadImage(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, notes.ErrNotFound
	}
	return data, err
}

func (h *Handler) SyncWriteAttachment(userID, scope, path string, data []byte) error {
	store, err := h.syncStore(userID, scope)
	if err != nil {
		return err
	}
	return store.WriteAttachment(path, data)
}

func (h *Handler) SyncDeleteAttachment(userID, scope, path string) error {
	store, err := h.syncStore(userID, scope)
	if err != nil {
		return err
	}
	if !notes.IsSyncAttachmentPath(path) {
		return notes.ErrNotFound
	}
	if err := store.DeleteImage(path); err != nil && !errors.Is(err, os.ErrNotExist) && !errors.Is(err, notes.ErrNotFound) {
		return err
	}
	return nil
}

// SyncChangeFolders creates folders, removes empty ones and sets labels.
func (h *Handler) SyncChangeFolders(userID, scope string, change SyncFolderChange) error {
	store, err := h.syncStore(userID, scope)
	if err != nil {
		return err
	}
	for _, p := range change.Create {
		if err := store.CreateFolder(p); err != nil {
			return err
		}
	}
	// Deepest first, so a parent emptied by removing its children goes too.
	remove := slices.Clone(change.Remove)
	slices.SortFunc(remove, func(a, b string) int { return strings.Count(b, "/") - strings.Count(a, "/") })
	for _, p := range remove {
		if err := store.RemoveFolderIfEmpty(p); err != nil && !errors.Is(err, notes.ErrFolderNotEmpty) {
			return err
		}
	}
	for p, color := range change.Labels {
		if err := store.LabelFolder(p, color); err != nil {
			return err
		}
	}
	h.publishSyncTree(userID, scope)
	return nil
}

// SyncPutLists replaces the user's bookmarks and/or shortcuts in a scope.
func (h *Handler) SyncPutLists(userID, scope string, lists SyncLists) error {
	store, err := h.syncStore(userID, scope)
	if err != nil {
		return err
	}
	if lists.Bookmarks != nil {
		if err := notes.NewBookmarks(store.Dir, userID).Replace(lists.Bookmarks); err != nil {
			return err
		}
	}
	if lists.Shortcuts != nil {
		if err := notes.NewShortcuts(store.Dir, userID).Replace(lists.Shortcuts); err != nil {
			return err
		}
	}
	return nil
}

// --- re-keying (the engine's alignment with the server) ---

// SyncRekey gives owned spaces and vaults new ids (the server's): spaces
// maps old to new space ids, vaults old to new vault ids. Registries,
// collection directories, the /api/vaults/<id>/ URLs in every note body of
// the user's stores (timestamps kept) and prefs naming a vault follow.
// Once everything is in place, the user's page gets one "rekey" event with
// both maps, then the usual spaces-change and tree-change events.
func (h *Handler) SyncRekey(userID string, spaces, vaults map[string]string) error {
	done := map[string]map[string]string{"spaces": {}, "vaults": {}}
	var err error
	for oldID, newID := range spaces {
		if err = h.rekeySpace(userID, oldID, newID); err != nil {
			break
		}
		done["spaces"][oldID] = newID
	}
	if err == nil {
		for oldID, newID := range vaults {
			if err = h.rekeyVault(userID, oldID, newID); err != nil {
				break
			}
			done["vaults"][oldID] = newID
		}
	}
	// What was re-keyed is announced even when a later step failed: the
	// page must not keep the old ids.
	if len(done["spaces"])+len(done["vaults"]) > 0 {
		me := map[string]bool{userID: true}
		h.Events.publish(NoteEvent{Type: "rekey", Spaces: done["spaces"], Vaults: done["vaults"], FromSync: true}, me)
		for oldID, newID := range done["spaces"] {
			h.Events.publish(NoteEvent{Type: "spaces-change", SpaceID: oldID, FromSync: true}, me)
			h.publishSyncSpaces(userID, newID)
		}
		for oldID, newID := range done["vaults"] {
			h.Events.publish(NoteEvent{Type: "tree-change", VaultID: oldID, FromSync: true}, me)
			h.publishSyncTree(userID, newID)
			if v, err := h.Registry.Get(newID); err == nil {
				h.publishSyncSpaces(userID, v.SpaceID)
			}
		}
		for _, scope := range []string{"journal", "home"} {
			h.publishSyncTree(userID, scope)
		}
	}
	return err
}

// rekeySpace re-keys one owned space: the registry, its vaults and its
// collections directory.
func (h *Handler) rekeySpace(userID, oldID, newID string) error {
	if oldID == newID {
		return nil
	}
	if _, err := h.ownedSpace(userID, oldID); err != nil {
		return err
	}
	if err := h.Spaces.Rekey(oldID, newID); err != nil {
		return err
	}
	if err := h.Registry.MoveSpace(oldID, newID); err != nil {
		return err
	}
	oldDir := filepath.Join(h.home, "spaces", oldID)
	if _, err := os.Stat(oldDir); err == nil {
		if err := os.Rename(oldDir, filepath.Join(h.home, "spaces", newID)); err != nil {
			return err
		}
	}
	h.colMu.Lock()
	if h.collectionsReady[oldID] {
		h.collectionsReady[newID] = true
	}
	delete(h.collectionsReady, oldID)
	h.colMu.Unlock()
	return nil
}

// rekeyVault re-keys one vault of an owned space, rewriting image URLs in
// every note of the user's stores and prefs naming the vault.
func (h *Handler) rekeyVault(userID, oldID, newID string) error {
	if oldID == newID {
		return nil
	}
	if _, err := h.ownedVault(userID, oldID); err != nil {
		return err
	}
	if err := h.Registry.Rekey(oldID, newID); err != nil {
		return err
	}
	oldURL, newURL := "/api/vaults/"+oldID+"/", "/api/vaults/"+newID+"/"
	scopes := []string{"journal", "home"}
	for _, s := range h.Spaces.ForUser(userID) {
		vaults, err := h.Registry.ListSpace(s.ID)
		if err != nil {
			return err
		}
		for _, v := range vaults {
			scopes = append(scopes, v.ID)
		}
	}
	for _, scope := range scopes {
		var store *notes.Store
		var err error
		if kind, ok := personalVaults[scope]; ok {
			store, err = h.personalStore(userID, kind)
		} else {
			store, err = h.Registry.Store(scope)
		}
		if err != nil {
			return err
		}
		if _, err := store.RewriteBodies(func(body string) string { return strings.ReplaceAll(body, oldURL, newURL) }); err != nil {
			return err
		}
	}
	if u, err := h.syncAccount(userID); err == nil {
		patch := map[string]string{}
		for k, v := range u.Prefs {
			if v == oldID && accounts.PrefKeys[k] {
				patch[k] = newID
			}
		}
		if len(patch) > 0 {
			if _, err := h.Accounts.SetPrefs(userID, patch); err != nil {
				log.Printf("sync: prefs after re-keying vault %s: %v", oldID, err)
			}
		}
	}
	return nil
}

package notes

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// VaultMeta is the metadata for a registered vault.
type VaultMeta struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Icon   string `json:"icon,omitempty"`
	Path   string `json:"path"`
	Type   string `json:"type,omitempty"`
	// SpaceID is the space the vault belongs to. Empty only for vaults from
	// before spaces existed; they are adopted into the first admin's space.
	SpaceID string `json:"spaceId,omitempty"`
}

// VaultTypeCollections marks the auto-created system vault that holds the
// collection folders. Vaults with this type are hidden from the user-facing
// note tree and vault lists (the Collections sidebar view still reads them).
const VaultTypeCollections = "collections"

// VaultRegistry manages the list of vaults. Each vault is a subdirectory
// under the registry root (typically ~/.nexote/vaults/). The registry itself
// is persisted as vaults.json in the root.
type VaultRegistry struct {
	root string
	mu   sync.Mutex
	// gitSync is attached to every store this registry hands out so
	// mutations trigger debounced auto-commits.
	gitSync *GitSync
	// stores holds one Store per vault directory. Requests must share it:
	// its writeMu is what serializes concurrent mutations of a vault, and
	// its id->path index spares every request a tree walk. Keyed by path, so
	// a renamed vault gets a fresh store; Rename/Delete drop the old one.
	stores map[string]*Store
}

// SetGitSync attaches the git auto-commit hook to every vault store, current
// and future.
func (r *VaultRegistry) SetGitSync(gs *GitSync) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gitSync = gs
	for _, s := range r.stores {
		s.SetGitSync(gs)
	}
}

// NewVaultRegistry creates a registry rooted at the given directory. The
// directory and a default vault are created if they don't exist.
func NewVaultRegistry(root string) (*VaultRegistry, error) {
	if err := os.MkdirAll(filepath.Join(root, "vaults"), 0o755); err != nil {
		return nil, fmt.Errorf("create vault root: %w", err)
	}
	r := &VaultRegistry{root: root}
	// Ensure a default vault exists.
	if err := r.ensureDefault(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *VaultRegistry) registryPath() string {
	return filepath.Join(r.root, "vaults.json")
}

// Root returns the root directory the registry manages ($NEXOTE_HOME).
func (r *VaultRegistry) Root() string {
	return r.root
}

func (r *VaultRegistry) vaultsDir() string {
	return filepath.Join(r.root, "vaults")
}

// ensureDefault creates a "Default" vault if no vaults are registered.
func (r *VaultRegistry) ensureDefault() error {
	vaults, err := r.List()
	if err != nil {
		return err
	}
	if len(vaults) > 0 {
		return nil
	}
	_, err = r.Create("Default", "", "")
	return err
}

// List returns all registered vaults.
func (r *VaultRegistry) List() ([]VaultMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	data, err := os.ReadFile(r.registryPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []VaultMeta{}, nil
		}
		return nil, err
	}
	var vaults []VaultMeta
	if err := json.Unmarshal(data, &vaults); err != nil {
		return []VaultMeta{}, nil
	}
	return vaults, nil
}

// Create registers a new vault with the given name in a space. Names are
// unique per space; the directory under the vaults root gets a number
// suffix when another space already uses the name.
func (r *VaultRegistry) Create(name, icon, spaceID string) (VaultMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	name = sanitizeVaultName(name)
	if name == "" {
		return VaultMeta{}, fmt.Errorf("vault name cannot be empty")
	}

	vaults, err := r.read()
	if err != nil {
		return VaultMeta{}, err
	}

	for _, v := range vaults {
		if v.SpaceID == spaceID && v.Name == name {
			return VaultMeta{}, fmt.Errorf("vault %q already exists", name)
		}
	}

	id := NewID()
	vaultPath := r.freeDir(vaults, name, "")
	if err := os.MkdirAll(vaultPath, 0o755); err != nil {
		return VaultMeta{}, fmt.Errorf("create vault dir: %w", err)
	}

	vault := VaultMeta{
		ID:      id,
		Name:    name,
		Icon:    icon,
		Path:    vaultPath,
		SpaceID: spaceID,
	}
	vaults = append(vaults, vault)
	if err := r.write(vaults); err != nil {
		return VaultMeta{}, err
	}
	return vault, nil
}

// freeDir returns vaults/<name>, or "<name> 2", "<name> 3"… when another
// vault or an existing folder holds that path. current is the vault's own
// path (on rename), which counts as free.
func (r *VaultRegistry) freeDir(vaults []VaultMeta, name, current string) string {
	base := filepath.Join(r.vaultsDir(), name)
	for i := 1; ; i++ {
		p := base
		if i > 1 {
			p = fmt.Sprintf("%s %d", base, i)
		}
		if p == current {
			return p
		}
		taken := false
		for _, v := range vaults {
			if v.Path == p {
				taken = true
				break
			}
		}
		if _, err := os.Stat(p); err == nil {
			taken = true
		}
		if !taken {
			return p
		}
	}
}

// ListSpace returns the vaults of one space.
func (r *VaultRegistry) ListSpace(spaceID string) ([]VaultMeta, error) {
	vaults, err := r.List()
	if err != nil {
		return nil, err
	}
	out := []VaultMeta{}
	for _, v := range vaults {
		if v.SpaceID == spaceID {
			out = append(out, v)
		}
	}
	return out, nil
}

// SetSpace moves a vault into a space (used when adopting legacy vaults).
func (r *VaultRegistry) SetSpace(id, spaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	vaults, err := r.read()
	if err != nil {
		return err
	}
	for i := range vaults {
		if vaults[i].ID == id {
			vaults[i].SpaceID = spaceID
			return r.write(vaults)
		}
	}
	return ErrNotFound
}

// SetType records the vault's system type (e.g. the collections vault). It
// is idempotent and only ever sets the field; the type is never cleared.
func (r *VaultRegistry) SetType(id, t string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	vaults, err := r.read()
	if err != nil {
		return err
	}
	for i, v := range vaults {
		if v.ID == id {
			if vaults[i].Type == t {
				return nil
			}
			vaults[i].Type = t
			return r.write(vaults)
		}
	}
	return ErrNotFound
}

// SetIcon changes a vault's icon without touching its directory.
func (r *VaultRegistry) SetIcon(id, icon string) (VaultMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	vaults, err := r.read()
	if err != nil {
		return VaultMeta{}, err
	}

	var idx int = -1
	for i, v := range vaults {
		if v.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return VaultMeta{}, ErrNotFound
	}

	vaults[idx].Icon = icon
	if err := r.write(vaults); err != nil {
		return VaultMeta{}, err
	}
	return vaults[idx], nil
}

// Rename changes a vault's name. The directory is renamed on disk.
func (r *VaultRegistry) Rename(id, newName string) (VaultMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	newName = sanitizeVaultName(newName)
	if newName == "" {
		return VaultMeta{}, fmt.Errorf("vault name cannot be empty")
	}

	vaults, err := r.read()
	if err != nil {
		return VaultMeta{}, err
	}

	var idx int = -1
	for i, v := range vaults {
		if v.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return VaultMeta{}, ErrNotFound
	}
	for _, v := range vaults {
		if v.ID != id && v.SpaceID == vaults[idx].SpaceID && v.Name == newName {
			return VaultMeta{}, fmt.Errorf("vault %q already exists", newName)
		}
	}

	old := vaults[idx]
	newPath := r.freeDir(vaults, newName, old.Path)
	if newPath != old.Path {
		if err := os.Rename(old.Path, newPath); err != nil {
			return VaultMeta{}, fmt.Errorf("rename vault dir: %w", err)
		}
		delete(r.stores, old.Path)
	}

	vaults[idx].Name = newName
	vaults[idx].Path = newPath
	if err := r.write(vaults); err != nil {
		return VaultMeta{}, err
	}
	return vaults[idx], nil
}

// Delete removes a vault and all its contents. The collections vault cannot
// be deleted on its own (it goes with its space).
func (r *VaultRegistry) Delete(id string) error {
	return r.delete(id, false)
}

// DeleteWithSpace removes a vault, including a collections vault, when its
// whole space is deleted.
func (r *VaultRegistry) DeleteWithSpace(id string) error {
	return r.delete(id, true)
}

func (r *VaultRegistry) delete(id string, withSpace bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	vaults, err := r.read()
	if err != nil {
		return err
	}

	var idx int = -1
	for i, v := range vaults {
		if v.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return ErrNotFound
	}
	if !withSpace && vaults[idx].Type == VaultTypeCollections {
		return fmt.Errorf("cannot delete the Collections vault")
	}

	if err := os.RemoveAll(vaults[idx].Path); err != nil {
		return fmt.Errorf("delete vault dir: %w", err)
	}
	delete(r.stores, vaults[idx].Path)

	vaults = append(vaults[:idx], vaults[idx+1:]...)
	return r.write(vaults)
}

// Get returns the vault metadata for the given ID.
func (r *VaultRegistry) Get(id string) (VaultMeta, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	vaults, err := r.read()
	if err != nil {
		return VaultMeta{}, err
	}
	for _, v := range vaults {
		if v.ID == id {
			return v, nil
		}
	}
	return VaultMeta{}, ErrNotFound
}

// Store returns the shared notes.Store for the given vault ID.
func (r *VaultRegistry) Store(id string) (*Store, error) {
	vault, err := r.Get(id)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.stores[vault.Path]; ok {
		return s, nil
	}
	store, err := NewStore(vault.Path)
	if err != nil {
		return nil, err
	}
	if r.gitSync != nil {
		store.SetGitSync(r.gitSync)
	}
	if r.stores == nil {
		r.stores = make(map[string]*Store)
	}
	r.stores[vault.Path] = store
	return store, nil
}

// MoveNote moves a note from one store to another (vaults or personal
// stores). It reads the note from the source, writes it to the target with
// a new ID (preserving title, body, and path), then deletes the original.
// When dstPath is non-nil the note is placed in that destination folder
// instead of keeping its source path (e.g. drag & drop into a specific
// folder of another vault). dstVaultId is the target's id in image URLs.
func MoveNote(srcStore *Store, noteId string, dstStore *Store, dstVaultId string, dstPath *string) (Document, error) {

	doc, err := srcStore.Get(noteId)
	if err != nil {
		return Document{}, err
	}

	newDoc := Document{
		Meta: doc.Meta,
		Body: doc.Body,
	}
	newDoc.Meta.ID = NewID()
	now := time.Now().UTC()
	newDoc.Meta.CreatedAt = now
	newDoc.Meta.UpdatedAt = now
	if dstPath != nil {
		newDoc.Meta.Path = sanitizePath(*dstPath)
	}

	// Move any referenced image files into the destination vault and rewrite
	// the image URLs to use the destination vault id.
	migrated, err := srcStore.MigrateImagesTo(newDoc.Body, dstStore, dstVaultId)
	if err != nil {
		return Document{}, err
	}
	newDoc.Body = migrated

	dstStore.writeMu.Lock()
	err = dstStore.write(newDoc)
	dstStore.writeMu.Unlock()
	if err != nil {
		return Document{}, err
	}
	dstStore.afterWrite()

	if err := srcStore.Delete(noteId); err != nil {
		return Document{}, err
	}

	return newDoc, nil
}

// Bookmarks returns the user's bookmarks for the given vault ID.
func (r *VaultRegistry) Bookmarks(id, userID string) (*Bookmarks, error) {
	vault, err := r.Get(id)
	if err != nil {
		return nil, err
	}
	return NewBookmarks(vault.Path, userID), nil
}

// Shortcuts returns the user's shortcuts for the given vault ID.
func (r *VaultRegistry) Shortcuts(id, userID string) (*Shortcuts, error) {
	vault, err := r.Get(id)
	if err != nil {
		return nil, err
	}
	return NewShortcuts(vault.Path, userID), nil
}

// ForgetNote removes a deleted note from every user's bookmarks and
// shortcuts in the vault.
func (r *VaultRegistry) ForgetNote(id, noteID string) error {
	vault, err := r.Get(id)
	if err != nil {
		return err
	}
	return forgetInLists(vault.Path, noteID)
}

func (r *VaultRegistry) read() ([]VaultMeta, error) {
	data, err := os.ReadFile(r.registryPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []VaultMeta{}, nil
		}
		return nil, err
	}
	var vaults []VaultMeta
	if err := json.Unmarshal(data, &vaults); err != nil {
		return []VaultMeta{}, nil
	}
	return vaults, nil
}

func (r *VaultRegistry) write(vaults []VaultMeta) error {
	if vaults == nil {
		vaults = []VaultMeta{}
	}
	data, err := json.MarshalIndent(vaults, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(r.registryPath(), data, 0o644)
}

// sanitizeVaultName removes characters that are problematic for directory
// names.
func sanitizeVaultName(name string) string {
	name = filepath.Base(name)
	if name == "." || name == ".." || name == "" {
		return ""
	}
	return name
}
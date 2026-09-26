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
	// gitSync is shared with every store this registry hands out, so
	// per-request Store() instances all trigger debounced auto-commits.
	gitSync *GitSync
}

// SetGitSync attaches the git auto-commit hook for all future stores.
func (r *VaultRegistry) SetGitSync(gs *GitSync) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gitSync = gs
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
	_, err = r.Create("Default", "")
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

// Create registers a new vault with the given name. The vault directory is
// created under the vaults root. Returns the vault metadata.
func (r *VaultRegistry) Create(name, icon string) (VaultMeta, error) {
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

	// Check for duplicate name.
	for _, v := range vaults {
		if v.Name == name {
			return VaultMeta{}, fmt.Errorf("vault %q already exists", name)
		}
	}

	id := NewID()
	vaultPath := filepath.Join(r.vaultsDir(), name)
	if err := os.MkdirAll(vaultPath, 0o755); err != nil {
		return VaultMeta{}, fmt.Errorf("create vault dir: %w", err)
	}

	vault := VaultMeta{
		ID:   id,
		Name: name,
		Icon: icon,
		Path: vaultPath,
	}
	vaults = append(vaults, vault)
	if err := r.write(vaults); err != nil {
		return VaultMeta{}, err
	}
	return vault, nil
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
		if v.Name == newName {
			return VaultMeta{}, fmt.Errorf("vault %q already exists", newName)
		}
	}
	if idx == -1 {
		return VaultMeta{}, ErrNotFound
	}

	old := vaults[idx]
	newPath := filepath.Join(r.vaultsDir(), newName)
	if err := os.Rename(old.Path, newPath); err != nil {
		return VaultMeta{}, fmt.Errorf("rename vault dir: %w", err)
	}

	vaults[idx].Name = newName
	vaults[idx].Path = newPath
	if err := r.write(vaults); err != nil {
		return VaultMeta{}, err
	}
	return vaults[idx], nil
}

// Delete removes a vault and all its contents. The "Default" vault cannot
// be deleted.
func (r *VaultRegistry) Delete(id string) error {
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
	if vaults[idx].Name == "Default" {
		return fmt.Errorf("cannot delete the Default vault")
	}
	if vaults[idx].Type == VaultTypeCollections || vaults[idx].Name == "Collections" {
		return fmt.Errorf("cannot delete the Collections vault")
	}

	if err := os.RemoveAll(vaults[idx].Path); err != nil {
		return fmt.Errorf("delete vault dir: %w", err)
	}

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

// Store returns a notes.Store for the given vault ID.
func (r *VaultRegistry) Store(id string) (*Store, error) {
	vault, err := r.Get(id)
	if err != nil {
		return nil, err
	}
	store, err := NewStore(vault.Path)
	if err != nil {
		return nil, err
	}
	if r.gitSync != nil {
		store.SetGitSync(r.gitSync)
	}
	return store, nil
}

// MoveNote moves a note from one vault to another. It reads the note from
// the source vault, writes it to the target vault with a new ID (preserving
// title, body, and path), then deletes the original. When dstPath is
// non-nil the note is placed in that destination folder instead of keeping
// its source path (e.g. drag & drop into a specific folder of another
// vault).
func (r *VaultRegistry) MoveNote(srcVaultId, noteId, dstVaultId string, dstPath *string) (Document, error) {
	srcStore, err := r.Store(srcVaultId)
	if err != nil {
		return Document{}, err
	}
	dstStore, err := r.Store(dstVaultId)
	if err != nil {
		return Document{}, err
	}

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

	if err := dstStore.write(newDoc); err != nil {
		return Document{}, err
	}

	if err := srcStore.Delete(noteId); err != nil {
		return Document{}, err
	}

	return newDoc, nil
}

// Bookmarks returns a bookmarks store for the given vault ID.
func (r *VaultRegistry) Bookmarks(id string) (*Bookmarks, error) {
	vault, err := r.Get(id)
	if err != nil {
		return nil, err
	}
	return NewBookmarks(vault.Path), nil
}

// Shortcuts returns a shortcuts store for the given vault ID.
func (r *VaultRegistry) Shortcuts(id string) (*Shortcuts, error) {
	vault, err := r.Get(id)
	if err != nil {
		return nil, err
	}
	return NewShortcuts(vault.Path), nil
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
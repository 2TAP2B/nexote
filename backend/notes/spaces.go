package notes

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// SpaceRole is a member's role in a space.
type SpaceRole string

const (
	// SpaceOwner can do everything, including managing members and deleting
	// vaults or the space.
	SpaceOwner SpaceRole = "owner"
	// SpaceEditor can create and edit vaults, notes, folders and collections.
	SpaceEditor SpaceRole = "editor"
	// SpaceViewer can only read.
	SpaceViewer SpaceRole = "viewer"
)

// Valid reports whether r is a known role.
func (r SpaceRole) Valid() bool {
	return r == SpaceOwner || r == SpaceEditor || r == SpaceViewer
}

// CanWrite reports whether the role may change content.
func (r SpaceRole) CanWrite() bool { return r == SpaceOwner || r == SpaceEditor }

// SpaceMember is a user's membership in a space.
type SpaceMember struct {
	UserID  string    `json:"userId"`
	Role    SpaceRole `json:"role"`
	AddedAt time.Time `json:"addedAt"`
}

// Space groups vaults and the people who can open them. A space with only
// its owner is private; adding members shares it.
type Space struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	Icon      string        `json:"icon,omitempty"`
	CreatedBy string        `json:"createdBy"`
	CreatedAt time.Time     `json:"createdAt"`
	Members   []SpaceMember `json:"members"`
}

// RoleOf returns the user's role in the space, if they are a member.
func (s Space) RoleOf(userID string) (SpaceRole, bool) {
	for _, m := range s.Members {
		if m.UserID == userID {
			return m.Role, true
		}
	}
	return "", false
}

func (s Space) owners() int {
	n := 0
	for _, m := range s.Members {
		if m.Role == SpaceOwner {
			n++
		}
	}
	return n
}

var (
	// ErrLastOwner is returned when a change would leave a space without
	// an owner.
	ErrLastOwner = errors.New("a space needs at least one owner")
	// ErrInvalidSpaceName is returned for empty or overlong names.
	ErrInvalidSpaceName = errors.New("space names are 1–64 characters")
	// ErrSpaceExists is returned when a space is created or rekeyed to an
	// id that is already registered.
	ErrSpaceExists = errors.New("space id already exists")
)

// SpaceRegistry persists spaces in spaces.json under $NEXOTE_HOME. Only the
// server writes it, so it is cached in memory and written through.
type SpaceRegistry struct {
	path   string
	mu     sync.Mutex
	spaces []Space
}

// NewSpaceRegistry loads (or starts) the registry in root.
func NewSpaceRegistry(root string) (*SpaceRegistry, error) {
	r := &SpaceRegistry{path: filepath.Join(root, "spaces.json")}
	data, err := os.ReadFile(r.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &r.spaces); err != nil {
			return nil, fmt.Errorf("read spaces.json: %w", err)
		}
	}
	return r, nil
}

// Reload re-reads spaces.json (after a git pull replaced it on disk).
func (r *SpaceRegistry) Reload() error {
	fresh, err := NewSpaceRegistry(filepath.Dir(r.path))
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.spaces = fresh.spaces
	return nil
}

// List returns all spaces, oldest first.
func (r *SpaceRegistry) List() []Space {
	r.mu.Lock()
	defer r.mu.Unlock()
	return cloneSpaces(r.spaces)
}

// ForUser returns the spaces the user is a member of, oldest first.
func (r *SpaceRegistry) ForUser(userID string) []Space {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Space
	for _, s := range r.spaces {
		if _, ok := s.RoleOf(userID); ok {
			out = append(out, cloneSpace(s))
		}
	}
	return out
}

// Get returns the space with the given id.
func (r *SpaceRegistry) Get(id string) (Space, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.spaces {
		if s.ID == id {
			return cloneSpace(s), nil
		}
	}
	return Space{}, ErrNotFound
}

// RoleOf returns the user's role in the space, if the space exists and the
// user is a member.
func (r *SpaceRegistry) RoleOf(spaceID, userID string) (SpaceRole, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.spaces {
		if s.ID == spaceID {
			return s.RoleOf(userID)
		}
	}
	return "", false
}

// Create adds a space owned by ownerID.
func (r *SpaceRegistry) Create(name, icon, ownerID string) (Space, error) {
	return r.CreateWithID(NewID(), name, icon, ownerID)
}

// CreateWithID is Create with a caller-chosen id, for a space that already
// exists on a synced peer and must keep its id there and here.
func (r *SpaceRegistry) CreateWithID(id, name, icon, ownerID string) (Space, error) {
	if !validID(id) {
		return Space{}, fmt.Errorf("invalid space id %q", id)
	}
	name, err := cleanSpaceName(name)
	if err != nil {
		return Space{}, err
	}
	now := time.Now().UTC()
	s := Space{
		ID:        id,
		Name:      name,
		Icon:      icon,
		CreatedBy: ownerID,
		CreatedAt: now,
		Members:   []SpaceMember{{UserID: ownerID, Role: SpaceOwner, AddedAt: now}},
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.spaces {
		if existing.ID == id {
			return Space{}, ErrSpaceExists
		}
	}
	next := append(cloneSpaces(r.spaces), s)
	if err := r.save(next); err != nil {
		return Space{}, err
	}
	return cloneSpace(s), nil
}

// Rekey changes a space's id in place, keeping its position so the
// oldest-first order (and with it the default space) is unchanged. Vaults
// pointing at the old id are the caller's business (VaultRegistry.MoveSpace).
func (r *SpaceRegistry) Rekey(oldID, newID string) error {
	if !validID(newID) {
		return fmt.Errorf("invalid space id %q", newID)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	at := -1
	for i, s := range r.spaces {
		switch s.ID {
		case oldID:
			at = i
		case newID:
			return ErrSpaceExists
		}
	}
	if at < 0 {
		return ErrNotFound
	}
	if oldID == newID {
		return nil
	}
	next := cloneSpaces(r.spaces)
	next[at].ID = newID
	return r.save(next)
}

// Update changes a space's name and/or icon (nil leaves a field as is).
func (r *SpaceRegistry) Update(id string, name, icon *string) (Space, error) {
	var clean string
	if name != nil {
		var err error
		if clean, err = cleanSpaceName(*name); err != nil {
			return Space{}, err
		}
	}
	return r.mutate(id, func(s *Space) error {
		if name != nil {
			s.Name = clean
		}
		if icon != nil {
			s.Icon = *icon
		}
		return nil
	})
}

// SetMember adds a user to a space or changes their role.
func (r *SpaceRegistry) SetMember(id, userID string, role SpaceRole) (Space, error) {
	if !role.Valid() {
		return Space{}, fmt.Errorf("unknown role %q", role)
	}
	return r.mutate(id, func(s *Space) error {
		for i := range s.Members {
			if s.Members[i].UserID == userID {
				s.Members[i].Role = role
				return nil
			}
		}
		s.Members = append(s.Members, SpaceMember{UserID: userID, Role: role, AddedAt: time.Now().UTC()})
		return nil
	})
}

// RemoveMember removes a user from a space.
func (r *SpaceRegistry) RemoveMember(id, userID string) (Space, error) {
	return r.mutate(id, func(s *Space) error {
		for i := range s.Members {
			if s.Members[i].UserID == userID {
				s.Members = append(s.Members[:i], s.Members[i+1:]...)
				return nil
			}
		}
		return ErrNotFound
	})
}

// Delete removes a space from the registry. Its vaults are the caller's
// business.
func (r *SpaceRegistry) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	next := make([]Space, 0, len(r.spaces))
	found := false
	for _, s := range r.spaces {
		if s.ID == id {
			found = true
			continue
		}
		next = append(next, s)
	}
	if !found {
		return ErrNotFound
	}
	return r.save(next)
}

// mutate applies fn to a copy of the space and saves it unless the change
// would leave the space without an owner.
func (r *SpaceRegistry) mutate(id string, fn func(*Space) error) (Space, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	next := cloneSpaces(r.spaces)
	for i := range next {
		if next[i].ID != id {
			continue
		}
		if err := fn(&next[i]); err != nil {
			return Space{}, err
		}
		if next[i].owners() == 0 {
			return Space{}, ErrLastOwner
		}
		if err := r.save(next); err != nil {
			return Space{}, err
		}
		return cloneSpace(next[i]), nil
	}
	return Space{}, ErrNotFound
}

// save writes spaces atomically and makes them current. Caller holds mu.
func (r *SpaceRegistry) save(spaces []Space) error {
	if spaces == nil {
		spaces = []Space{}
	}
	data, err := json.MarshalIndent(spaces, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, r.path); err != nil {
		os.Remove(tmp)
		return err
	}
	r.spaces = spaces
	return nil
}

func cleanSpaceName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n == 0 || n > 64 {
		return "", ErrInvalidSpaceName
	}
	return name, nil
}

func cloneSpace(s Space) Space {
	s.Members = append([]SpaceMember(nil), s.Members...)
	return s
}

func cloneSpaces(spaces []Space) []Space {
	out := make([]Space, len(spaces))
	for i, s := range spaces {
		out[i] = cloneSpace(s)
	}
	return out
}

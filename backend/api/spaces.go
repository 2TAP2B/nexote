package api

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"nexote/accounts"
	"nexote/notes"
)

// spacePayload is a space as the logged-in user sees it.
type spacePayload struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Icon        string          `json:"icon,omitempty"`
	Role        notes.SpaceRole `json:"role"`
	MemberCount int             `json:"memberCount"`
	CreatedAt   time.Time       `json:"createdAt"`
}

func toSpacePayload(s notes.Space, userID string) spacePayload {
	role, _ := s.RoleOf(userID)
	return spacePayload{ID: s.ID, Name: s.Name, Icon: s.Icon, Role: role, MemberCount: len(s.Members), CreatedAt: s.CreatedAt}
}

func memberIDs(s notes.Space) []string {
	ids := make([]string, len(s.Members))
	for i, m := range s.Members {
		ids[i] = m.UserID
	}
	return ids
}

// createSpace creates a space owned by userID with a first "Notes" vault
// and its Collections vault.
func (h *Handler) createSpace(userID, name, icon string) (notes.Space, error) {
	space, err := h.Spaces.Create(name, icon, userID)
	if err != nil {
		return notes.Space{}, err
	}
	if _, err := h.Registry.Create("Notes", "Folder", space.ID); err != nil {
		return space, err
	}
	if _, _, err := h.collections(space.ID); err != nil {
		log.Printf("space %s: collections: %v", space.ID, err)
	}
	return space, nil
}

// listSpaces returns the user's spaces, oldest first. Someone left without
// any space (all deleted or left) gets a fresh private one.
func (h *Handler) listSpaces(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	spaces := h.Spaces.ForUser(user.ID)
	if len(spaces) == 0 {
		s, err := h.createSpace(user.ID, "Personal", "")
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		spaces = []notes.Space{s}
	}
	out := make([]spacePayload, 0, len(spaces))
	for _, s := range spaces {
		out = append(out, toSpacePayload(s, user.ID))
	}
	writeJSON(w, http.StatusOK, map[string]any{"spaces": out})
}

func (h *Handler) createSpaceRoute(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Icon string `json:"icon"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	user := currentUser(r)
	space, err := h.createSpace(user.ID, in.Name, in.Icon)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	h.publishSpaces(space.ID, memberIDs(space))
	writeJSON(w, http.StatusCreated, toSpacePayload(space, user.ID))
}

func (h *Handler) updateSpace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name *string `json:"name,omitempty"`
		Icon *string `json:"icon,omitempty"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	user := currentUser(r)
	if _, _, err := h.spaceAccess(user, r.PathValue("id"), notes.SpaceOwner); err != nil {
		h.writeRegistryError(w, err)
		return
	}
	space, err := h.Spaces.Update(r.PathValue("id"), in.Name, in.Icon)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	h.publishSpaces(space.ID, memberIDs(space))
	writeJSON(w, http.StatusOK, toSpacePayload(space, user.ID))
}

// deleteSpace deletes a space with all its vaults and notes.
func (h *Handler) deleteSpace(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	space, _, err := h.spaceAccess(user, r.PathValue("id"), notes.SpaceOwner)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	if len(h.Spaces.ForUser(user.ID)) <= 1 {
		writeError(w, http.StatusConflict, errors.New("you can't delete your only space"))
		return
	}
	vaults, err := h.Registry.ListSpace(space.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	for _, v := range vaults {
		if err := h.Registry.DeleteWithSpace(v.ID); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}
	h.colMu.Lock()
	delete(h.collectionsReady, space.ID)
	h.colMu.Unlock()
	if err := os.RemoveAll(filepath.Join(h.home, "spaces", space.ID)); err != nil {
		log.Printf("delete space %s: %v", space.ID, err)
	}
	if err := h.Spaces.Delete(space.ID); err != nil {
		h.writeRegistryError(w, err)
		return
	}
	h.publishSpaces(space.ID, memberIDs(space))
	w.WriteHeader(http.StatusNoContent)
}

// memberPayload is a space member as listed in the space settings.
type memberPayload struct {
	UserID      string          `json:"userId"`
	Username    string          `json:"username"`
	DisplayName string          `json:"displayName"`
	Avatar      string          `json:"avatar,omitempty"`
	Role        notes.SpaceRole `json:"role"`
	AddedAt     time.Time       `json:"addedAt"`
}

func (h *Handler) membersPayload(s notes.Space) []memberPayload {
	out := make([]memberPayload, 0, len(s.Members))
	for _, m := range s.Members {
		p := memberPayload{UserID: m.UserID, Role: m.Role, AddedAt: m.AddedAt}
		if u, err := h.Accounts.User(m.UserID); err == nil {
			p.Username, p.DisplayName, p.Avatar = u.Username, u.DisplayName, u.Avatar
		}
		out = append(out, p)
	}
	return out
}

func (h *Handler) listMembers(w http.ResponseWriter, r *http.Request) {
	space, _, err := h.spaceAccess(currentUser(r), r.PathValue("id"), notes.SpaceViewer)
	if err != nil {
		h.writeRegistryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": h.membersPayload(space)})
}

// setMember adds an existing user to a space or changes their role.
func (h *Handler) setMember(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Role notes.SpaceRole `json:"role"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if _, _, err := h.spaceAccess(currentUser(r), r.PathValue("id"), notes.SpaceOwner); err != nil {
		h.writeRegistryError(w, err)
		return
	}
	target, err := h.Accounts.User(r.PathValue("userId"))
	if err != nil {
		writeAccountError(w, err)
		return
	}
	if target.Disabled {
		writeError(w, http.StatusConflict, errors.New("this account is deactivated"))
		return
	}
	space, err := h.Spaces.SetMember(r.PathValue("id"), target.ID, in.Role)
	if err != nil {
		h.writeSpaceError(w, err)
		return
	}
	h.publishSpaces(space.ID, memberIDs(space))
	writeJSON(w, http.StatusOK, map[string]any{"members": h.membersPayload(space)})
}

// removeMember removes someone from a space: owners remove anyone, members
// can leave.
func (h *Handler) removeMember(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	targetID := r.PathValue("userId")
	if targetID == "me" { // leaving: DELETE /api/spaces/{id}/members/me
		targetID = user.ID
	}
	need := notes.SpaceOwner
	if targetID == user.ID {
		need = notes.SpaceViewer
	}
	if _, _, err := h.spaceAccess(user, r.PathValue("id"), need); err != nil {
		h.writeRegistryError(w, err)
		return
	}
	space, err := h.Spaces.RemoveMember(r.PathValue("id"), targetID)
	if err != nil {
		h.writeSpaceError(w, err)
		return
	}
	h.publishSpaces(space.ID, memberIDs(space), targetID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) writeSpaceError(w http.ResponseWriter, err error) {
	if errors.Is(err, notes.ErrLastOwner) {
		writeError(w, http.StatusConflict, err)
		return
	}
	h.writeRegistryError(w, err)
}

// --- collections (one set per space) ---

// collections returns a space's collection registry and the store of its
// Collections vault, creating both (with the built-in collections) on
// first use.
func (h *Handler) collections(spaceID string) (*notes.CollectionRegistry, *notes.Store, error) {
	h.colMu.Lock()
	defer h.colMu.Unlock()
	cr, err := notes.NewCollectionRegistry(filepath.Join(h.home, "spaces", spaceID))
	if err != nil {
		return nil, nil, err
	}
	vaults, err := h.Registry.ListSpace(spaceID)
	if err != nil {
		return nil, nil, err
	}
	vaultID := ""
	for _, v := range vaults {
		if v.Type == notes.VaultTypeCollections {
			vaultID = v.ID
			break
		}
	}
	if vaultID == "" {
		v, err := h.Registry.Create("Collections", "Folder", spaceID)
		if err != nil {
			return nil, nil, err
		}
		if err := h.Registry.SetType(v.ID, notes.VaultTypeCollections); err != nil {
			return nil, nil, err
		}
		vaultID = v.ID
	}
	store, err := h.Registry.Store(vaultID)
	if err != nil {
		return nil, nil, err
	}
	if !h.collectionsReady[spaceID] {
		if err := cr.EnsureBuiltIns(); err != nil {
			log.Printf("space %s: built-in collections: %v", spaceID, err)
		}
		// Every collection needs a folder in the Collections vault to show
		// up in the tree.
		if cols, err := cr.List(); err == nil {
			for _, c := range cols {
				if c.Name != "" {
					_ = store.CreateFolder(c.Name)
				}
			}
		}
		h.collectionsReady[spaceID] = true
	}
	return cr, store, nil
}

// collectionsVaultID returns the id of a space's Collections vault ("" when
// it has none yet), for the tree-change events of collection changes.
func (h *Handler) collectionsVaultID(spaceID string) string {
	vaults, err := h.Registry.ListSpace(spaceID)
	if err != nil {
		return ""
	}
	for _, v := range vaults {
		if v.Type == notes.VaultTypeCollections {
			return v.ID
		}
	}
	return ""
}

// spaceCollections resolves the ?space= of a collections request after
// checking the user may read (GET) or change it.
func (h *Handler) spaceCollections(r *http.Request) (*notes.CollectionRegistry, *notes.Store, error) {
	spaceID := r.URL.Query().Get("space")
	if _, _, err := h.spaceAccess(currentUser(r), spaceID, needFor(r)); err != nil {
		return nil, nil, err
	}
	return h.collections(spaceID)
}

// firstAdmin returns the oldest active admin account.
func (h *Handler) firstAdmin() (accounts.User, bool) {
	users, err := h.Accounts.Users()
	if err != nil {
		return accounts.User{}, false
	}
	for _, u := range users {
		if u.Role == accounts.RoleAdmin && !u.Disabled {
			return u, true
		}
	}
	return accounts.User{}, false
}

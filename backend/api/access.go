package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"nexote/accounts"
	"nexote/notes"
)

// --- Who is asking ---

type userKey struct{}

// currentUser returns the logged-in user. Every route outside /api/auth/
// runs behind authenticate, so there it is never nil.
func currentUser(r *http.Request) *accounts.User {
	u, _ := r.Context().Value(userKey{}).(*accounts.User)
	return u
}

// sessionCookie holds the login session token (HttpOnly; only its hash is
// stored server-side).
const sessionCookie = "nexote_session"

// sessionUser resolves the request's session cookie to its active user.
func (h *Handler) sessionUser(r *http.Request) *accounts.User {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil
	}
	_, u, err := h.Accounts.SessionUser(c.Value)
	if err != nil {
		return nil
	}
	return &u
}

// setSessionCookie logs the browser in. The cookie outlives the server-side
// session on purpose: the session expires after SessionTTL without use.
func (h *Handler) setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int((400 * 24 * time.Hour).Seconds()),
		HttpOnly: true,
		Secure:   h.origin.Scheme == "https",
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.origin.Scheme == "https",
		SameSite: http.SameSiteLaxMode,
	})
}

var errLoginRequired = errors.New("login required")

// authenticate attaches the session's user to the request and refuses
// requests without one, except for the login/setup/invite routes under
// /api/auth/. Changing requests must come from the public origin: the
// SameSite cookie already stops cross-site posts, this also stops other
// sites on the same domain.
func (h *Handler) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin := r.Header.Get("Origin"); origin != "" && origin != h.origin.String() {
				writeError(w, http.StatusForbidden, fmt.Errorf(
					"this server only accepts changes from %s (NEXOTE_PUBLIC_URL)", h.origin))
				return
			}
		}
		if u := h.sessionUser(r); u != nil {
			r = r.WithContext(context.WithValue(r.Context(), userKey{}, u))
		} else if !strings.HasPrefix(r.URL.Path, "/api/auth/") {
			writeError(w, http.StatusUnauthorized, errLoginRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- What they may do ---

// forbidden errors map to 403. Missing access to a vault or space maps to
// 404 instead (notes.ErrNotFound), so ids of other people's spaces don't
// leak.
type forbidden string

func (f forbidden) Error() string { return string(f) }

const (
	errReadOnly  = forbidden("you can only view this space")
	errOwnerOnly = forbidden("only an owner of this space can do that")
	errAdminOnly = forbidden("only an admin can do that")
)

func isForbidden(err error) bool {
	var f forbidden
	return errors.As(err, &f)
}

// requireAdmin writes 403 and returns false unless the user is an admin.
func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if u := currentUser(r); u == nil || u.Role != accounts.RoleAdmin {
		writeError(w, http.StatusForbidden, errAdminOnly)
		return false
	}
	return true
}

// spaceAccess returns the space and the user's role in it, checking the
// role is at least need (viewer < editor < owner).
func (h *Handler) spaceAccess(user *accounts.User, spaceID string, need notes.SpaceRole) (notes.Space, notes.SpaceRole, error) {
	space, err := h.Spaces.Get(spaceID)
	if err != nil {
		return notes.Space{}, "", notes.ErrNotFound
	}
	role, ok := space.RoleOf(user.ID)
	if !ok {
		return notes.Space{}, "", notes.ErrNotFound
	}
	switch need {
	case notes.SpaceOwner:
		if role != notes.SpaceOwner {
			return space, role, errOwnerOnly
		}
	case notes.SpaceEditor:
		if !role.CanWrite() {
			return space, role, errReadOnly
		}
	}
	return space, role, nil
}

// vaultAccess returns the vault after checking the user's role in its space
// is at least need.
func (h *Handler) vaultAccess(user *accounts.User, vaultID string, need notes.SpaceRole) (notes.VaultMeta, error) {
	v, err := h.Registry.Get(vaultID)
	if err != nil {
		return notes.VaultMeta{}, err
	}
	if _, _, err := h.spaceAccess(user, v.SpaceID, need); err != nil {
		return notes.VaultMeta{}, err
	}
	return v, nil
}

// needFor is the role a request needs: reading takes a viewer, anything
// else an editor.
func needFor(r *http.Request) notes.SpaceRole {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return notes.SpaceViewer
	}
	return notes.SpaceEditor
}

// personalVaults are pseudo vault ids routed to the user's own stores: the
// daily journal and "home", which holds the quick-capture Notepad. Real
// vault ids never collide with these literals.
var personalVaults = map[string]string{"journal": "journal", "home": "home"}

// personalStore returns one of the user's own stores
// ($NEXOTE_HOME/users/<id>/<kind>), shared across requests like vault
// stores so its write lock serializes mutations.
func (h *Handler) personalStore(userID, kind string) (*notes.Store, error) {
	dir := filepath.Join(h.home, "users", userID, kind)
	h.storesMu.Lock()
	defer h.storesMu.Unlock()
	if s, ok := h.personal[dir]; ok {
		return s, nil
	}
	s, err := notes.NewStore(dir)
	if err != nil {
		return nil, err
	}
	if h.GitSync != nil {
		s.SetGitSync(h.GitSync)
	}
	h.personal[dir] = s
	return s, nil
}

// journal returns the user's journal store.
func (h *Handler) journal(r *http.Request) (*notes.Store, error) {
	return h.personalStore(currentUser(r).ID, "journal")
}

// storeFor returns the store behind a vault id (real or personal) after
// checking the user's role is at least need.
func (h *Handler) storeFor(user *accounts.User, vaultID string, need notes.SpaceRole) (*notes.Store, error) {
	if kind, ok := personalVaults[vaultID]; ok {
		return h.personalStore(user.ID, kind)
	}
	if _, err := h.vaultAccess(user, vaultID, need); err != nil {
		return nil, err
	}
	return h.Registry.Store(vaultID)
}

// resolveStore returns the store for the vault in the path and the user's
// bookmarks there, after checking the user may read it (GET) or change it
// (any other method).
func (h *Handler) resolveStore(r *http.Request) (*notes.Store, *notes.Bookmarks, error) {
	return h.resolveStoreAs(r, needFor(r))
}

func (h *Handler) resolveStoreAs(r *http.Request, need notes.SpaceRole) (*notes.Store, *notes.Bookmarks, error) {
	user := currentUser(r)
	vaultID := r.PathValue("vaultId")
	store, err := h.storeFor(user, vaultID, need)
	if err != nil {
		return nil, nil, err
	}
	if _, ok := personalVaults[vaultID]; ok {
		return store, notes.NewBookmarks(store.Dir, user.ID), nil
	}
	bookmarks, err := h.Registry.Bookmarks(vaultID, user.ID)
	if err != nil {
		return nil, nil, err
	}
	return store, bookmarks, nil
}

// shortcuts returns the user's shortcuts in the vault in the path. They are
// personal, so viewers may change them too.
func (h *Handler) shortcuts(r *http.Request) (*notes.Shortcuts, error) {
	user := currentUser(r)
	vaultID := r.PathValue("vaultId")
	store, err := h.storeFor(user, vaultID, notes.SpaceViewer)
	if err != nil {
		return nil, err
	}
	return notes.NewShortcuts(store.Dir, user.ID), nil
}

// accessibleVaults returns the vaults the user can see, optionally limited
// to one space, with their role in each vault's space.
func (h *Handler) accessibleVaults(user *accounts.User, spaceID string) ([]notes.VaultMeta, map[string]notes.SpaceRole, error) {
	roles := map[string]notes.SpaceRole{}
	for _, s := range h.Spaces.ForUser(user.ID) {
		if spaceID != "" && s.ID != spaceID {
			continue
		}
		role, _ := s.RoleOf(user.ID)
		roles[s.ID] = role
	}
	vaults, err := h.Registry.List()
	if err != nil {
		return nil, nil, err
	}
	out := []notes.VaultMeta{}
	for _, v := range vaults {
		if _, ok := roles[v.SpaceID]; ok {
			out = append(out, v)
		}
	}
	return out, roles, nil
}

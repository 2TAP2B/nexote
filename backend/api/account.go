package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"nexote/accounts"
)

// passkeyInfo is a passkey as listed in the account settings.
type passkeyInfo struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	CreatedAt  time.Time `json:"createdAt"`
	LastUsedAt time.Time `json:"lastUsedAt,omitzero"`
}

func passkeyInfos(u *accounts.User) []passkeyInfo {
	out := make([]passkeyInfo, 0, len(u.Passkeys))
	for _, p := range u.Passkeys {
		out = append(out, passkeyInfo{ID: p.ID, Name: p.Name, CreatedAt: p.CreatedAt, LastUsedAt: p.LastUsedAt})
	}
	return out
}

// getMe returns the logged-in account with its passkeys.
func (h *Handler) getMe(w http.ResponseWriter, r *http.Request) {
	u, err := h.Accounts.User(currentUser(r).ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": toPublicUser(&u), "passkeys": passkeyInfos(&u)})
}

// updateMe changes the logged-in user's display name.
func (h *Handler) updateMe(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DisplayName string `json:"displayName"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	name := strings.TrimSpace(in.DisplayName)
	if !accounts.ValidDisplayName(name) {
		writeError(w, http.StatusBadRequest, accounts.ErrInvalidName)
		return
	}
	u, err := h.Accounts.UpdateUser(currentUser(r).ID, func(u *accounts.User) error {
		u.DisplayName = name
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": toPublicUser(&u)})
}

// addPasskeyBegin starts registering another passkey (another device) for
// the logged-in user.
func (h *Handler) addPasskeyBegin(w http.ResponseWriter, r *http.Request) {
	u, err := h.Accounts.User(currentUser(r).ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.beginRegistration(w, accounts.Ceremony{Kind: accounts.CeremonyAddPasskey, User: u})
}

func (h *Handler) addPasskeyFinish(w http.ResponseWriter, r *http.Request) {
	var in finishInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cer, cred, err := h.finishRegistration(in, accounts.CeremonyAddPasskey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if cer.User.ID != currentUser(r).ID {
		writeError(w, http.StatusBadRequest, errCeremonyExpired)
		return
	}
	p, err := h.Accounts.AddPasskey(cer.User.ID, *cred, in.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, passkeyInfo{ID: p.ID, Name: p.Name, CreatedAt: p.CreatedAt})
}

func (h *Handler) renamePasskey(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := h.Accounts.RenamePasskey(currentUser(r).ID, r.PathValue("id"), in.Name); err != nil {
		writeAccountError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) removePasskey(w http.ResponseWriter, r *http.Request) {
	if err := h.Accounts.RemovePasskey(currentUser(r).ID, r.PathValue("id")); err != nil {
		writeAccountError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// directoryUser is how other people see an account (to add them to a
// space).
type directoryUser struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

// listDirectory lists active accounts for adding space members.
func (h *Handler) listDirectory(w http.ResponseWriter, r *http.Request) {
	users, err := h.Accounts.Users()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	out := []directoryUser{}
	for _, u := range users {
		if !u.Disabled {
			out = append(out, directoryUser{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

// writeAccountError maps account store errors to HTTP statuses.
func writeAccountError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		writeError(w, http.StatusNotFound, err)
	case errors.Is(err, accounts.ErrLastPasskey), errors.Is(err, accounts.ErrLastAdmin),
		errors.Is(err, accounts.ErrUsernameTaken):
		writeError(w, http.StatusConflict, err)
	case errors.Is(err, accounts.ErrInvalidName), errors.Is(err, accounts.ErrInvalidUsername):
		writeError(w, http.StatusBadRequest, err)
	case isForbidden(err):
		writeError(w, http.StatusForbidden, err)
	default:
		writeError(w, http.StatusInternalServerError, err)
	}
}

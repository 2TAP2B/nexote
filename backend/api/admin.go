package api

import (
	"errors"
	"net/http"
	"net/url"
	"time"

	"nexote/accounts"
)

// adminUser is an account as listed for admins.
type adminUser struct {
	ID          string        `json:"id"`
	Username    string        `json:"username"`
	DisplayName string        `json:"displayName"`
	Role        accounts.Role `json:"role"`
	Disabled    bool          `json:"disabled"`
	CreatedAt   time.Time     `json:"createdAt"`
	LastSeenAt  time.Time     `json:"lastSeenAt,omitzero"`
	Passkeys    int           `json:"passkeys"`
}

func (h *Handler) adminListUsers(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	users, err := h.Accounts.Users()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	seen, err := h.Accounts.LastSeen()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	out := make([]adminUser, 0, len(users))
	for _, u := range users {
		out = append(out, adminUser{
			ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Role: u.Role,
			Disabled: u.Disabled, CreatedAt: u.CreatedAt, LastSeenAt: seen[u.ID], Passkeys: len(u.Passkeys),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

// adminUpdateUser changes an account's role or (de)activates it.
// Deactivating logs the user out everywhere; their spaces stay as they are.
func (h *Handler) adminUpdateUser(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var in struct {
		Role     *accounts.Role `json:"role,omitempty"`
		Disabled *bool          `json:"disabled,omitempty"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	id := r.PathValue("id")
	if in.Role != nil && *in.Role != accounts.RoleAdmin && *in.Role != accounts.RoleMember {
		writeError(w, http.StatusBadRequest, errors.New("role must be admin or member"))
		return
	}
	if in.Disabled != nil && *in.Disabled && id == currentUser(r).ID {
		writeError(w, http.StatusConflict, errors.New("you can't deactivate your own account"))
		return
	}
	u, err := h.Accounts.UpdateUser(id, func(u *accounts.User) error {
		if in.Role != nil {
			u.Role = *in.Role
		}
		if in.Disabled != nil {
			u.Disabled = *in.Disabled
		}
		return nil
	})
	if err != nil {
		writeAccountError(w, err)
		return
	}
	if u.Disabled {
		_ = h.Accounts.DeleteUserSessions(u.ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": toPublicUser(&u)})
}

// InviteURL is the link a person opens to redeem an invite or recovery
// token (the frontend's /invite/[token] page).
func InviteURL(origin *url.URL, token string) string {
	return origin.String() + "/invite/" + token
}

func (h *Handler) inviteURL(token string) string { return InviteURL(h.origin, token) }

// adminCreateRecovery creates a link that adds a passkey to an existing
// account, for users who lost all their devices.
func (h *Handler) adminCreateRecovery(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	target, err := h.Accounts.User(r.PathValue("id"))
	if err != nil {
		writeAccountError(w, err)
		return
	}
	token, inv, err := h.Accounts.CreateInvite(accounts.Invite{
		Kind: accounts.InviteRecovery, UserID: target.ID, CreatedBy: currentUser(r).ID,
	}, RecoveryTTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"url": h.inviteURL(token), "expiresAt": inv.ExpiresAt})
}

// adminInvite is an invite as listed for admins. The token itself is only
// ever shown once, right after creation.
type adminInvite struct {
	ID        string              `json:"id"`
	Kind      accounts.InviteKind `json:"kind"`
	Role      accounts.Role       `json:"role,omitempty"`
	User      string              `json:"user,omitempty"`
	CreatedBy string              `json:"createdBy,omitempty"`
	CreatedAt time.Time           `json:"createdAt"`
	ExpiresAt time.Time           `json:"expiresAt"`
	UsedAt    *time.Time          `json:"usedAt,omitempty"`
	UsedBy    string              `json:"usedBy,omitempty"`
	// Status is "pending", "used" or "expired".
	Status string `json:"status"`
}

func (h *Handler) adminListInvites(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	invites, err := h.Accounts.Invites()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	users, err := h.Accounts.Users()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	names := map[string]string{}
	for _, u := range users {
		names[u.ID] = u.DisplayName
	}
	now := time.Now()
	out := make([]adminInvite, 0, len(invites))
	for _, inv := range invites {
		status := "pending"
		if inv.UsedAt != nil {
			status = "used"
		} else if now.After(inv.ExpiresAt) {
			status = "expired"
		}
		out = append(out, adminInvite{
			ID: inv.ID, Kind: inv.Kind, Role: inv.Role, User: names[inv.UserID],
			CreatedBy: names[inv.CreatedBy], CreatedAt: inv.CreatedAt, ExpiresAt: inv.ExpiresAt,
			UsedAt: inv.UsedAt, UsedBy: names[inv.UsedBy], Status: status,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": out})
}

// adminCreateInvite creates a single-use link for a new account.
func (h *Handler) adminCreateInvite(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var in struct {
		Role accounts.Role `json:"role"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if in.Role == "" {
		in.Role = accounts.RoleMember
	}
	if in.Role != accounts.RoleAdmin && in.Role != accounts.RoleMember {
		writeError(w, http.StatusBadRequest, errors.New("role must be admin or member"))
		return
	}
	token, inv, err := h.Accounts.CreateInvite(accounts.Invite{
		Kind: accounts.InviteSignup, Role: in.Role, CreatedBy: currentUser(r).ID,
	}, inviteTTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"url": h.inviteURL(token), "id": inv.ID, "expiresAt": inv.ExpiresAt,
	})
}

func (h *Handler) adminDeleteInvite(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if err := h.Accounts.DeleteInvite(r.PathValue("id")); err != nil {
		writeAccountError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

package api

import (
	"fmt"
	"log"

	"nexote/accounts"
)

// Local mode runs the API for one person on their own device (the Android
// app's engine): there is no login, every request acts as the local user.
// The engine in front of it decides who may talk to it at all.

// Local account names for a data folder without accounts.
const (
	localUsername    = "me"
	localDisplayName = "Me"
)

// StartLocalMode makes every request act as the local user: the first
// active admin, or a new admin "me" when the folder has no accounts yet,
// set up like a server's first admin (legacy data, personal space and
// stores) minus the passkey. Idempotent; call it before serving.
func (h *Handler) StartLocalMode() (accounts.User, error) {
	h.setupMu.Lock()
	defer h.setupMu.Unlock()
	user, ok := h.firstAdmin()
	if !ok {
		hasUsers, err := h.Accounts.HasUsers()
		if err != nil {
			return accounts.User{}, err
		}
		if hasUsers {
			// Promoting a member or reactivating an admin would be a
			// decision about someone else's account; refuse instead.
			return accounts.User{}, fmt.Errorf("this folder has accounts but no active admin")
		}
		fresh, err := accounts.NewUser("local", localDisplayName, accounts.RoleAdmin)
		if err != nil {
			return accounts.User{}, err
		}
		// "me" is shorter than usernames typed at a signup may be; nobody
		// types this one, it only labels the device's own account.
		fresh.Username = localUsername
		if user, err = h.Accounts.CreateUser(fresh); err != nil {
			return accounts.User{}, err
		}
		log.Printf("local mode: created account %q", user.Username)
		// Everything from before accounts existed becomes the local user's,
		// as at a server's first-admin setup.
		if err := h.AdoptLegacyData(); err != nil {
			log.Printf("local mode: adopt existing data: %v", err)
		}
	}
	// A server creates the first space lazily on the first space listing;
	// doing it here leaves a ready folder behind even if the app never got
	// that far.
	if len(h.Spaces.ForUser(user.ID)) == 0 {
		if _, err := h.createSpace(user.ID, "Personal", ""); err != nil {
			return accounts.User{}, fmt.Errorf("personal space: %w", err)
		}
	}
	for kind := range personalVaults {
		if _, err := h.personalStore(user.ID, kind); err != nil {
			return accounts.User{}, err
		}
	}
	h.setupCode = ""
	h.localUserID = user.ID
	return user, nil
}

// localUser returns the local user in local mode, nil otherwise. It is
// re-read per request so profile changes show up at once.
func (h *Handler) localUser() *accounts.User {
	if h.localUserID == "" {
		return nil
	}
	u, err := h.Accounts.User(h.localUserID)
	if err != nil || u.Disabled {
		return nil
	}
	return &u
}

// LocalUserID is the local user's id in local mode, "" on a server.
func (h *Handler) LocalUserID() string { return h.localUserID }

// Close stops the handler's background work (git sync timers) once nothing
// serves it anymore. A server runs until the process ends and never calls
// it; the engine does when it closes a data folder.
func (h *Handler) Close() {
	if h.GitSync != nil {
		h.GitSync.Stop()
	}
}

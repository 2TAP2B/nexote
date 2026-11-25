package api

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"nexote/accounts"
)

// Login is passkey-only. The account model keeps users separate from login
// methods (accounts.User.Passkeys, .Identities), so an OIDC login can be
// added as two more routes here without touching anything else.

// publicUser is the account shape the frontend sees.
type publicUser struct {
	ID          string        `json:"id"`
	Username    string        `json:"username"`
	DisplayName string        `json:"displayName"`
	Role        accounts.Role `json:"role"`
	Avatar      string        `json:"avatar,omitempty"`
}

func toPublicUser(u *accounts.User) *publicUser {
	if u == nil {
		return nil
	}
	return &publicUser{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Role: u.Role, Avatar: u.Avatar}
}

const (
	// inviteTTL is how long an invite link for a new account stays valid.
	inviteTTL = 7 * 24 * time.Hour
	// RecoveryTTL is how long a recovery link (a new passkey for an existing
	// account) stays valid.
	RecoveryTTL = 24 * time.Hour
)

var (
	errAlreadySetUp    = errors.New("Nexote is already set up — log in instead")
	errWrongSetupCode  = errors.New("wrong setup code — it's printed in the server log")
	errCeremonyExpired = errors.New("the passkey prompt expired — please try again")
	errPasskeyFailed   = errors.New("the passkey couldn't be verified — please try again")
	errUnknownPasskey  = errors.New("this passkey doesn't belong to an account on this server")
	errAccountDisabled = errors.New("this account is deactivated — ask an admin")
	errAlreadyLoggedIn = errors.New("log out first to use this link")
)

// newSetupCode returns a code like "K7QM-XR4D" from an alphabet without
// look-alike characters.
func newSetupCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b[:4]) + "-" + string(b[4:])
}

func setupCodeMatches(given, want string) bool {
	norm := func(s string) string {
		return strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(s)))
	}
	return want != "" && subtle.ConstantTimeCompare([]byte(norm(given)), []byte(norm(want))) == 1
}

// SetupCode returns the code needed to create the first admin account, or
// "" once an account exists.
func (h *Handler) SetupCode() string {
	h.setupMu.Lock()
	defer h.setupMu.Unlock()
	return h.setupCode
}

// authStatus tells the frontend what to show: first-time setup, the login
// screen, or the app for the logged-in user. "local" marks local mode,
// where the user is always signed in.
func (h *Handler) authStatus(w http.ResponseWriter, r *http.Request) {
	hasUsers, err := h.Accounts.HasUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	status := map[string]any{
		"setupRequired": !hasUsers,
		"user":          toPublicUser(currentUser(r)),
		"origin":        h.origin.String(),
	}
	if h.localUserID != "" {
		status["local"] = true
	}
	writeJSON(w, http.StatusOK, status)
}

// --- registration ceremonies (setup, invite, recovery, extra passkey) ---

// beginRegistration starts a passkey registration for cer.User and returns
// the browser's navigator.credentials.create() options.
func (h *Handler) beginRegistration(w http.ResponseWriter, cer accounts.Ceremony) {
	creation, session, err := h.webAuthn.BeginRegistration(&cer.User, accounts.RegistrationOptions(&cer.User)...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	cer.Session = *session
	writeJSON(w, http.StatusOK, map[string]any{
		"ceremonyId": h.ceremonies.Put(cer),
		"options":    creation.Response,
	})
}

// finishInput is what the browser sends back after a passkey prompt.
type finishInput struct {
	CeremonyID string          `json:"ceremonyId"`
	Credential json.RawMessage `json:"credential"`
	// Name labels a new passkey ("MacBook", "iPhone"…).
	Name string `json:"name,omitempty"`
}

// finishRegistration verifies the new credential against a pending
// ceremony of one of the given kinds.
func (h *Handler) finishRegistration(in finishInput, kinds ...accounts.CeremonyKind) (accounts.Ceremony, *webauthn.Credential, error) {
	cer, ok := h.ceremonies.Take(in.CeremonyID, kinds...)
	if !ok {
		return accounts.Ceremony{}, nil, errCeremonyExpired
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(in.Credential)
	if err != nil {
		log.Printf("passkey registration: parse: %v", describeWebAuthnError(err))
		return accounts.Ceremony{}, nil, errPasskeyFailed
	}
	cred, err := h.webAuthn.CreateCredential(&cer.User, cer.Session, parsed)
	if err != nil {
		log.Printf("passkey registration: verify: %v", describeWebAuthnError(err))
		return accounts.Ceremony{}, nil, errPasskeyFailed
	}
	return cer, cred, nil
}

// describeWebAuthnError includes the library's developer details in logs.
func describeWebAuthnError(err error) string {
	var perr *protocol.Error
	if errors.As(err, &perr) && perr.DevInfo != "" {
		return perr.Error() + ": " + perr.DevInfo
	}
	return err.Error()
}

// startSession logs the user in on this browser and answers with the user.
func (h *Handler) startSession(w http.ResponseWriter, r *http.Request, u *accounts.User) {
	token, _, err := h.Accounts.CreateSession(u.ID, r.UserAgent())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.setSessionCookie(w, token)
	writeJSON(w, http.StatusOK, map[string]any{"user": toPublicUser(u)})
}

// --- first-time setup: the first account becomes the admin ---

func (h *Handler) setupBegin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SetupCode   string `json:"setupCode"`
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.setupMu.Lock()
	defer h.setupMu.Unlock()
	if hasUsers, err := h.Accounts.HasUsers(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	} else if hasUsers {
		writeError(w, http.StatusConflict, errAlreadySetUp)
		return
	}
	if !setupCodeMatches(in.SetupCode, h.setupCode) {
		writeError(w, http.StatusForbidden, errWrongSetupCode)
		return
	}
	user, err := accounts.NewUser(in.Username, in.DisplayName, accounts.RoleAdmin)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.beginRegistration(w, accounts.Ceremony{Kind: accounts.CeremonySetup, User: user})
}

func (h *Handler) setupFinish(w http.ResponseWriter, r *http.Request) {
	var in finishInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cer, cred, err := h.finishRegistration(in, accounts.CeremonySetup)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.setupMu.Lock()
	defer h.setupMu.Unlock()
	if hasUsers, err := h.Accounts.HasUsers(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	} else if hasUsers {
		writeError(w, http.StatusConflict, errAlreadySetUp)
		return
	}
	user := cer.User
	user.Passkeys = []accounts.Passkey{accounts.NewPasskey(*cred, in.Name)}
	saved, err := h.Accounts.CreateUser(user)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	h.setupCode = ""
	log.Printf("setup: created admin account %q", saved.Username)
	// Everything from before accounts existed becomes the admin's.
	if err := h.AdoptLegacyData(); err != nil {
		log.Printf("setup: adopt existing data: %v", err)
	}
	h.startSession(w, r, &saved)
}

// --- login ---

func (h *Handler) loginBegin(w http.ResponseWriter, r *http.Request) {
	assertion, session, err := h.webAuthn.BeginDiscoverableLogin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ceremonyId": h.ceremonies.Put(accounts.Ceremony{Kind: accounts.CeremonyLogin, Session: *session}),
		"options":    assertion.Response,
	})
}

func (h *Handler) loginFinish(w http.ResponseWriter, r *http.Request) {
	var in finishInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cer, ok := h.ceremonies.Take(in.CeremonyID, accounts.CeremonyLogin)
	if !ok {
		writeError(w, http.StatusBadRequest, errCeremonyExpired)
		return
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(in.Credential)
	if err != nil {
		log.Printf("passkey login: parse: %v", describeWebAuthnError(err))
		writeError(w, http.StatusBadRequest, errPasskeyFailed)
		return
	}
	var found accounts.User
	unknown := false
	lookup := func(rawID, userHandle []byte) (webauthn.User, error) {
		u, err := h.Accounts.UserByHandle(userHandle)
		if err != nil {
			unknown = errors.Is(err, accounts.ErrNotFound)
			return nil, err
		}
		found = u
		return &found, nil
	}
	_, cred, err := h.webAuthn.ValidatePasskeyLogin(lookup, cer.Session, parsed)
	if err != nil {
		log.Printf("passkey login: %v", describeWebAuthnError(err))
		if unknown || errors.Is(err, accounts.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, errUnknownPasskey)
		} else {
			writeError(w, http.StatusUnauthorized, errPasskeyFailed)
		}
		return
	}
	if found.Disabled {
		writeError(w, http.StatusForbidden, errAccountDisabled)
		return
	}
	if err := h.Accounts.UsePasskey(found.ID, *cred); err != nil {
		// A credential that verified but isn't stored can't happen unless
		// it was removed concurrently; refuse rather than guess.
		writeError(w, http.StatusUnauthorized, errUnknownPasskey)
		return
	}
	h.startSession(w, r, &found)
}

// logout ends the browser's session. In local mode there is none to end:
// the next request acts as the local user again.
func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if h.localUserID != "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = h.Accounts.DeleteSession(c.Value)
	}
	h.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// --- invite and recovery links ---

// inviteInfo describes a link before the visitor redeems it.
func (h *Handler) inviteInfo(w http.ResponseWriter, r *http.Request) {
	inv, err := h.Accounts.InviteByToken(r.PathValue("token"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	out := map[string]any{"kind": inv.Kind, "expiresAt": inv.ExpiresAt}
	if inv.Kind == accounts.InviteSignup {
		out["role"] = inv.Role
	}
	if inv.CreatedBy != "" {
		if u, err := h.Accounts.User(inv.CreatedBy); err == nil {
			out["invitedBy"] = u.DisplayName
		}
	}
	if inv.Kind == accounts.InviteRecovery {
		u, err := h.Accounts.User(inv.UserID)
		if err != nil {
			writeError(w, http.StatusNotFound, accounts.ErrInviteInvalid)
			return
		}
		out["username"] = u.Username
		out["displayName"] = u.DisplayName
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) inviteBegin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if currentUser(r) != nil {
		writeError(w, http.StatusConflict, errAlreadyLoggedIn)
		return
	}
	inv, err := h.Accounts.InviteByToken(r.PathValue("token"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	switch inv.Kind {
	case accounts.InviteSignup:
		user, err := accounts.NewUser(in.Username, in.DisplayName, inv.Role)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if free, err := h.Accounts.UsernameFree(user.Username); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		} else if !free {
			writeError(w, http.StatusConflict, accounts.ErrUsernameTaken)
			return
		}
		h.beginRegistration(w, accounts.Ceremony{Kind: accounts.CeremonySignup, User: user, InviteID: inv.ID})
	case accounts.InviteRecovery:
		user, err := h.Accounts.User(inv.UserID)
		if err != nil {
			writeError(w, http.StatusNotFound, accounts.ErrInviteInvalid)
			return
		}
		if user.Disabled {
			writeError(w, http.StatusForbidden, errAccountDisabled)
			return
		}
		h.beginRegistration(w, accounts.Ceremony{Kind: accounts.CeremonyRecovery, User: user, InviteID: inv.ID})
	default:
		writeError(w, http.StatusNotFound, accounts.ErrInviteInvalid)
	}
}

func (h *Handler) inviteFinish(w http.ResponseWriter, r *http.Request) {
	var in finishInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cer, cred, err := h.finishRegistration(in, accounts.CeremonySignup, accounts.CeremonyRecovery)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	// Serialize redemptions so a link can't be used twice concurrently.
	h.setupMu.Lock()
	defer h.setupMu.Unlock()
	inv, err := h.Accounts.InviteByToken(r.PathValue("token"))
	if err != nil || inv.ID != cer.InviteID {
		writeError(w, http.StatusGone, accounts.ErrInviteInvalid)
		return
	}
	var user accounts.User
	switch cer.Kind {
	case accounts.CeremonySignup:
		u := cer.User
		u.Passkeys = []accounts.Passkey{accounts.NewPasskey(*cred, in.Name)}
		if user, err = h.Accounts.CreateUser(u); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, accounts.ErrUsernameTaken) {
				status = http.StatusConflict
			}
			writeError(w, status, err)
			return
		}
		if err := h.Accounts.UseInvite(inv.ID, user.ID); err != nil {
			log.Printf("invite %s: mark used: %v", inv.ID, err)
		}
		if _, err := h.createSpace(user.ID, "Personal", ""); err != nil {
			log.Printf("invite: personal space for %q: %v", user.Username, err)
		}
		log.Printf("invite: created account %q (%s)", user.Username, user.Role)
	case accounts.CeremonyRecovery:
		if _, err := h.Accounts.AddPasskey(cer.User.ID, *cred, in.Name); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if err := h.Accounts.UseInvite(inv.ID, cer.User.ID); err != nil {
			log.Printf("recovery %s: mark used: %v", inv.ID, err)
		}
		if user, err = h.Accounts.User(cer.User.ID); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if user.Disabled {
			writeError(w, http.StatusForbidden, errAccountDisabled)
			return
		}
		log.Printf("recovery: added a passkey to %q", user.Username)
	}
	h.startSession(w, r, &user)
}

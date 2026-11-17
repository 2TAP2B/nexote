// Package accounts holds Nexote's users and how they log in: passkeys today,
// external identities (OIDC) later. A user is independent of its login
// methods, so adding one needs no data migration. Everything is stored as
// JSON under $NEXOTE_HOME/auth (0600), like the rest of Nexote: no database.
package accounts

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

// Role is a user's role on the server.
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
)

// User is a Nexote account.
type User struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        Role   `json:"role"`
	// Avatar is the version of the profile picture (auth/avatars/<id>), ""
	// for none. It changes with every upload, for cache-busting URLs.
	Avatar string `json:"avatar,omitempty"`
	// Handle is the WebAuthn user handle: random, opaque, never shown.
	Handle    []byte    `json:"handle"`
	Disabled  bool      `json:"disabled,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	Passkeys  []Passkey `json:"passkeys"`
	// Identities links external logins (OIDC issuer + subject). Reserved for
	// the OIDC login method; nothing creates them yet.
	Identities []Identity `json:"identities,omitempty"`
}

// Passkey is one registered WebAuthn credential of a user.
type Passkey struct {
	// ID is the base64url credential id (also the public handle in the API).
	ID         string              `json:"id"`
	Name       string              `json:"name"`
	Credential webauthn.Credential `json:"credential"`
	CreatedAt  time.Time           `json:"createdAt"`
	LastUsedAt time.Time           `json:"lastUsedAt,omitzero"`
}

// Identity is an external login linked to a user (OIDC).
type Identity struct {
	Provider  string    `json:"provider"`
	Issuer    string    `json:"issuer"`
	Subject   string    `json:"subject"`
	Email     string    `json:"email,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// WebAuthnID, WebAuthnName, WebAuthnDisplayName and WebAuthnCredentials make
// a User a webauthn.User.
func (u *User) WebAuthnID() []byte          { return u.Handle }
func (u *User) WebAuthnName() string        { return u.Username }
func (u *User) WebAuthnDisplayName() string { return u.DisplayName }
func (u *User) WebAuthnCredentials() []webauthn.Credential {
	creds := make([]webauthn.Credential, len(u.Passkeys))
	for i, p := range u.Passkeys {
		creds[i] = p.Credential
	}
	return creds
}

// Session is a logged-in browser. Only a hash of its cookie token is stored.
type Session struct {
	ID         string    `json:"id"`
	TokenHash  string    `json:"tokenHash"`
	UserID     string    `json:"userId"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	UserAgent  string    `json:"userAgent,omitempty"`
}

// InviteKind tells what redeeming an invite link does.
type InviteKind string

const (
	// InviteSignup creates a new account with Role.
	InviteSignup InviteKind = "signup"
	// InviteRecovery adds a passkey to the existing account UserID.
	InviteRecovery InviteKind = "recovery"
)

// Invite is a single-use link. Only a hash of its token is stored.
type Invite struct {
	ID        string     `json:"id"`
	TokenHash string     `json:"tokenHash"`
	Kind      InviteKind `json:"kind"`
	Role      Role       `json:"role,omitempty"`
	UserID    string     `json:"userId,omitempty"`
	// CreatedBy is the admin's user id; empty for the server's recover command.
	CreatedBy string     `json:"createdBy,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	UsedAt    *time.Time `json:"usedAt,omitempty"`
	UsedBy    string     `json:"usedBy,omitempty"`
}

var (
	ErrNotFound        = errors.New("not found")
	ErrUsernameTaken   = errors.New("this username is taken")
	ErrInvalidUsername = errors.New("usernames are 3–32 characters: letters, digits, dot, dash or underscore")
	ErrInvalidName     = errors.New("display names are 1–64 characters")
	ErrSessionInvalid  = errors.New("session expired or invalid")
	ErrInviteInvalid   = errors.New("this link is invalid, expired or already used")
	ErrLastPasskey     = errors.New("you can't remove your only passkey")
	ErrLastAdmin       = errors.New("there must be at least one active admin")
)

// SessionTTL is how long a session stays valid after it was last used.
const SessionTTL = 30 * 24 * time.Hour

// touchEvery limits how often a session's last-seen time is written.
const touchEvery = time.Hour

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,31}$`)

// NormalizeUsername lowercases and trims a username; ValidUsername checks it.
func NormalizeUsername(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func ValidUsername(s string) bool { return usernamePattern.MatchString(s) }

func ValidDisplayName(s string) bool {
	n := len([]rune(strings.TrimSpace(s)))
	return n >= 1 && n <= 64
}

// Store persists users, sessions and invites. Files are re-read when they
// change on disk, so the server's recover command can run next to a live
// server.
type Store struct {
	mu       sync.Mutex
	dir      string
	users    jsonFile[User]
	sessions jsonFile[Session]
	invites  jsonFile[Invite]
	now      func() time.Time
}

// Open opens (and creates) the store in dir.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create auth dir: %w", err)
	}
	return &Store{
		dir:      dir,
		users:    jsonFile[User]{path: filepath.Join(dir, "users.json")},
		sessions: jsonFile[Session]{path: filepath.Join(dir, "sessions.json")},
		invites:  jsonFile[Invite]{path: filepath.Join(dir, "invites.json")},
		now:      time.Now,
	}, nil
}

// --- users ---

// HasUsers reports whether any account exists (setup is done).
func (s *Store) HasUsers() (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	users, err := s.users.load()
	return len(users) > 0, err
}

// Users returns all accounts, oldest first.
func (s *Store) Users() ([]User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	users, err := s.users.load()
	return append([]User(nil), users...), err
}

// User returns the account with the given id.
func (s *Store) User(id string) (User, error) {
	return s.findUser(func(u *User) bool { return u.ID == id })
}

// UserByHandle returns the account with the given WebAuthn user handle.
func (s *Store) UserByHandle(handle []byte) (User, error) {
	return s.findUser(func(u *User) bool { return string(u.Handle) == string(handle) })
}

func (s *Store) findUser(match func(*User) bool) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	users, err := s.users.load()
	if err != nil {
		return User{}, err
	}
	for i := range users {
		if match(&users[i]) {
			return users[i], nil
		}
	}
	return User{}, ErrNotFound
}

// NewUser prepares (does not save) an account with a fresh id and WebAuthn
// handle, validating the username and display name.
func NewUser(username, displayName string, role Role) (User, error) {
	username = NormalizeUsername(username)
	displayName = strings.TrimSpace(displayName)
	if !ValidUsername(username) {
		return User{}, ErrInvalidUsername
	}
	if displayName == "" {
		displayName = username
	}
	if !ValidDisplayName(displayName) {
		return User{}, ErrInvalidName
	}
	return User{
		ID:          randomID(),
		Username:    username,
		DisplayName: displayName,
		Role:        role,
		Handle:      randomBytes(64),
		Passkeys:    []Passkey{},
	}, nil
}

// CreateUser saves a new account. The username must be free.
func (s *Store) CreateUser(u User) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	users, err := s.users.load()
	if err != nil {
		return User{}, err
	}
	for _, existing := range users {
		if existing.Username == u.Username {
			return User{}, ErrUsernameTaken
		}
	}
	u.CreatedAt = s.now().UTC()
	users = append(users, u)
	return u, s.users.save(users)
}

// UsernameFree reports whether no account uses the (normalized) username.
func (s *Store) UsernameFree(username string) (bool, error) {
	_, err := s.findUser(func(u *User) bool { return u.Username == NormalizeUsername(username) })
	if errors.Is(err, ErrNotFound) {
		return true, nil
	}
	return false, err
}

// UpdateUser changes an account through fn and saves it. It refuses changes
// that would leave no active admin.
func (s *Store) UpdateUser(id string, fn func(*User) error) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	users, err := s.users.load()
	if err != nil {
		return User{}, err
	}
	for i := range users {
		if users[i].ID != id {
			continue
		}
		updated := users[i]
		updated.Passkeys = append([]Passkey(nil), users[i].Passkeys...)
		if err := fn(&updated); err != nil {
			return User{}, err
		}
		next := append([]User(nil), users...)
		next[i] = updated
		if activeAdmins(users) > 0 && activeAdmins(next) == 0 {
			return User{}, ErrLastAdmin
		}
		return updated, s.users.save(next)
	}
	return User{}, ErrNotFound
}

func activeAdmins(users []User) int {
	n := 0
	for _, u := range users {
		if u.Role == RoleAdmin && !u.Disabled {
			n++
		}
	}
	return n
}

// NewPasskey wraps a newly registered credential.
func NewPasskey(cred webauthn.Credential, name string) Passkey {
	return Passkey{
		ID:         base64.RawURLEncoding.EncodeToString(cred.ID),
		Name:       passkeyName(name),
		Credential: cred,
		CreatedAt:  time.Now().UTC(),
	}
}

// AddPasskey stores a newly registered credential for the user.
func (s *Store) AddPasskey(userID string, cred webauthn.Credential, name string) (Passkey, error) {
	p := NewPasskey(cred, name)
	_, err := s.UpdateUser(userID, func(u *User) error {
		u.Passkeys = append(u.Passkeys, p)
		return nil
	})
	return p, err
}

// UsePasskey records a successful login with the credential: the updated
// signature counter and flags, and the time.
func (s *Store) UsePasskey(userID string, cred webauthn.Credential) error {
	id := base64.RawURLEncoding.EncodeToString(cred.ID)
	_, err := s.UpdateUser(userID, func(u *User) error {
		for i := range u.Passkeys {
			if u.Passkeys[i].ID == id {
				u.Passkeys[i].Credential.Authenticator = cred.Authenticator
				u.Passkeys[i].Credential.Flags = cred.Flags
				u.Passkeys[i].LastUsedAt = s.now().UTC()
				return nil
			}
		}
		return ErrNotFound
	})
	return err
}

// RenamePasskey changes a passkey's label.
func (s *Store) RenamePasskey(userID, passkeyID, name string) error {
	_, err := s.UpdateUser(userID, func(u *User) error {
		for i := range u.Passkeys {
			if u.Passkeys[i].ID == passkeyID {
				u.Passkeys[i].Name = passkeyName(name)
				return nil
			}
		}
		return ErrNotFound
	})
	return err
}

// RemovePasskey deletes a passkey; the last one can't be removed.
func (s *Store) RemovePasskey(userID, passkeyID string) error {
	_, err := s.UpdateUser(userID, func(u *User) error {
		for i := range u.Passkeys {
			if u.Passkeys[i].ID == passkeyID {
				if len(u.Passkeys) == 1 {
					return ErrLastPasskey
				}
				u.Passkeys = append(u.Passkeys[:i], u.Passkeys[i+1:]...)
				return nil
			}
		}
		return ErrNotFound
	})
	return err
}

func passkeyName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "Passkey"
	}
	if r := []rune(name); len(r) > 64 {
		name = string(r[:64])
	}
	return name
}

// --- sessions ---

// CreateSession logs a user in and returns the cookie token.
func (s *Store) CreateSession(userID, userAgent string) (string, Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sessions, err := s.sessions.load()
	if err != nil {
		return "", Session{}, err
	}
	token := randomToken()
	now := s.now().UTC()
	sess := Session{
		ID:         randomID(),
		TokenHash:  hashToken(token),
		UserID:     userID,
		CreatedAt:  now,
		LastSeenAt: now,
		UserAgent:  truncate(userAgent, 200),
	}
	sessions = append(pruneSessions(sessions, now), sess)
	return token, sess, s.sessions.save(sessions)
}

// SessionUser resolves a cookie token to its session and active user, and
// keeps the session alive (sliding expiry).
func (s *Store) SessionUser(token string) (Session, User, error) {
	if token == "" {
		return Session{}, User{}, ErrSessionInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sessions, err := s.sessions.load()
	if err != nil {
		return Session{}, User{}, err
	}
	now := s.now().UTC()
	hash := hashToken(token)
	for i := range sessions {
		sess := sessions[i]
		if sess.TokenHash != hash {
			continue
		}
		if now.Sub(sess.LastSeenAt) > SessionTTL {
			return Session{}, User{}, ErrSessionInvalid
		}
		users, err := s.users.load()
		if err != nil {
			return Session{}, User{}, err
		}
		for _, u := range users {
			if u.ID != sess.UserID {
				continue
			}
			if u.Disabled {
				return Session{}, User{}, ErrSessionInvalid
			}
			if now.Sub(sess.LastSeenAt) > touchEvery {
				sessions[i].LastSeenAt = now
				sess.LastSeenAt = now
				_ = s.sessions.save(pruneSessions(sessions, now))
			}
			return sess, u, nil
		}
		return Session{}, User{}, ErrSessionInvalid
	}
	return Session{}, User{}, ErrSessionInvalid
}

// DeleteSession logs a browser out.
func (s *Store) DeleteSession(token string) error {
	hash := hashToken(token)
	return s.deleteSessions(func(sess Session) bool { return sess.TokenHash == hash })
}

// DeleteUserSessions logs a user out everywhere.
func (s *Store) DeleteUserSessions(userID string) error {
	return s.deleteSessions(func(sess Session) bool { return sess.UserID == userID })
}

func (s *Store) deleteSessions(match func(Session) bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sessions, err := s.sessions.load()
	if err != nil {
		return err
	}
	kept := sessions[:0:0]
	for _, sess := range sessions {
		if !match(sess) {
			kept = append(kept, sess)
		}
	}
	return s.sessions.save(kept)
}

// LastSeen returns when each user last used any session.
func (s *Store) LastSeen() (map[string]time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sessions, err := s.sessions.load()
	if err != nil {
		return nil, err
	}
	seen := map[string]time.Time{}
	for _, sess := range sessions {
		if sess.LastSeenAt.After(seen[sess.UserID]) {
			seen[sess.UserID] = sess.LastSeenAt
		}
	}
	return seen, nil
}

func pruneSessions(sessions []Session, now time.Time) []Session {
	kept := sessions[:0:0]
	for _, sess := range sessions {
		if now.Sub(sess.LastSeenAt) <= SessionTTL {
			kept = append(kept, sess)
		}
	}
	return kept
}

// --- invites ---

// CreateInvite stores a new single-use link and returns its token.
func (s *Store) CreateInvite(inv Invite, ttl time.Duration) (string, Invite, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	invites, err := s.invites.load()
	if err != nil {
		return "", Invite{}, err
	}
	token := randomToken()
	now := s.now().UTC()
	inv.ID = randomID()
	inv.TokenHash = hashToken(token)
	inv.CreatedAt = now
	inv.ExpiresAt = now.Add(ttl)
	invites = append(invites, inv)
	return token, inv, s.invites.save(invites)
}

// InviteByToken returns a still-usable invite (unused, not expired).
func (s *Store) InviteByToken(token string) (Invite, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	invites, err := s.invites.load()
	if err != nil {
		return Invite{}, err
	}
	hash := hashToken(token)
	now := s.now().UTC()
	for _, inv := range invites {
		if inv.TokenHash == hash {
			if inv.UsedAt != nil || now.After(inv.ExpiresAt) {
				return Invite{}, ErrInviteInvalid
			}
			return inv, nil
		}
	}
	return Invite{}, ErrInviteInvalid
}

// UseInvite marks an invite as redeemed by userID; it fails if the invite
// was used or expired in the meantime.
func (s *Store) UseInvite(id, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	invites, err := s.invites.load()
	if err != nil {
		return err
	}
	now := s.now().UTC()
	for i := range invites {
		if invites[i].ID != id {
			continue
		}
		if invites[i].UsedAt != nil || now.After(invites[i].ExpiresAt) {
			return ErrInviteInvalid
		}
		invites[i].UsedAt = &now
		invites[i].UsedBy = userID
		return s.invites.save(invites)
	}
	return ErrInviteInvalid
}

// Invites returns all invites, newest first.
func (s *Store) Invites() ([]Invite, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	invites, err := s.invites.load()
	out := make([]Invite, 0, len(invites))
	for i := len(invites) - 1; i >= 0; i-- {
		out = append(out, invites[i])
	}
	return out, err
}

// DeleteInvite revokes an invite.
func (s *Store) DeleteInvite(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	invites, err := s.invites.load()
	if err != nil {
		return err
	}
	for i := range invites {
		if invites[i].ID == id {
			return s.invites.save(append(invites[:i:i], invites[i+1:]...))
		}
	}
	return ErrNotFound
}

// --- helpers ---

func randomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("crypto/rand: %v", err))
	}
	return b
}

func randomToken() string { return base64.RawURLEncoding.EncodeToString(randomBytes(32)) }

func randomID() string { return base64.RawURLEncoding.EncodeToString(randomBytes(12)) }

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// jsonFile is a JSON array file cached in memory and re-read when it changes
// on disk. Writes are atomic (temp file + rename).
type jsonFile[T any] struct {
	path    string
	items   []T
	modTime time.Time
	size    int64
	loaded  bool
}

func (f *jsonFile[T]) load() ([]T, error) {
	info, err := os.Stat(f.path)
	if errors.Is(err, os.ErrNotExist) {
		f.items, f.loaded = nil, true
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if f.loaded && info.ModTime().Equal(f.modTime) && info.Size() == f.size {
		return f.items, nil
	}
	data, err := os.ReadFile(f.path)
	if err != nil {
		return nil, err
	}
	var items []T
	if len(data) > 0 {
		if err := json.Unmarshal(data, &items); err != nil {
			return nil, fmt.Errorf("read %s: %w", filepath.Base(f.path), err)
		}
	}
	f.items, f.modTime, f.size, f.loaded = items, info.ModTime(), info.Size(), true
	return items, nil
}

func (f *jsonFile[T]) save(items []T) error {
	if items == nil {
		items = []T{}
	}
	data, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}
	if err := writeFileAtomic(f.path, data); err != nil {
		return err
	}
	f.items, f.loaded = items, true
	if info, err := os.Stat(f.path); err == nil {
		f.modTime, f.size = info.ModTime(), info.Size()
	}
	return nil
}

// writeFileAtomic replaces path with data (mode 0600) via a temp file and a
// rename, so readers never see a half-written file.
func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}

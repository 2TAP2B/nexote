package accounts

import (
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// PublicOrigin parses the browser-facing address of the server
// (NEXOTE_PUBLIC_URL, e.g. "https://notes.example.com") into its origin.
// Passkeys are bound to its host name, so it must be a domain (or
// localhost), not an IP address.
func PublicOrigin(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, fmt.Errorf("NEXOTE_PUBLIC_URL must look like https://notes.example.com, got %q", raw)
	}
	return &url.URL{Scheme: u.Scheme, Host: u.Host}, nil
}

// NewWebAuthn configures passkey ceremonies for the public origin.
func NewWebAuthn(origin *url.URL) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{
		RPDisplayName: "Nexote",
		RPID:          origin.Hostname(),
		RPOrigins:     []string{origin.String()},
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			// Passkeys must be discoverable so login needs no username.
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			RequireResidentKey: protocol.ResidentKeyRequired(),
			UserVerification:   protocol.VerificationPreferred,
		},
	})
}

// RegistrationOptions excludes the user's existing passkeys, so the browser
// doesn't register the same authenticator twice.
func RegistrationOptions(u *User) []webauthn.RegistrationOption {
	exclude := make([]protocol.CredentialDescriptor, 0, len(u.Passkeys))
	for _, p := range u.Passkeys {
		exclude = append(exclude, p.Credential.Descriptor())
	}
	return []webauthn.RegistrationOption{webauthn.WithExclusions(exclude)}
}

// CeremonyKind tells what a pending passkey ceremony does on success.
type CeremonyKind string

const (
	CeremonySetup      CeremonyKind = "setup"       // first admin account
	CeremonySignup     CeremonyKind = "signup"      // account from an invite
	CeremonyRecovery   CeremonyKind = "recovery"    // passkey from a recovery link
	CeremonyAddPasskey CeremonyKind = "add-passkey" // passkey for the logged-in user
	CeremonyLogin      CeremonyKind = "login"
)

// Ceremony is the server half of a passkey registration or login between
// its begin and finish requests.
type Ceremony struct {
	Kind    CeremonyKind
	Session webauthn.SessionData
	// User is the account being registered (not yet saved for setup and
	// signup) or getting a passkey.
	User     User
	InviteID string
	expires  time.Time
}

// ceremonyTTL bounds how long a user may take to confirm a passkey prompt.
const ceremonyTTL = 5 * time.Minute

// maxCeremonies caps pending prompts: the begin routes are public, so
// unbounded storage would let anyone grow server memory. When full, the
// oldest prompt is dropped (its user just retries).
const maxCeremonies = 1000

// Ceremonies keeps pending ceremonies in memory; a restart only cancels
// prompts that are open at that moment.
type Ceremonies struct {
	mu sync.Mutex
	m  map[string]*Ceremony
}

func NewCeremonies() *Ceremonies { return &Ceremonies{m: map[string]*Ceremony{}} }

// Put stores a ceremony and returns its id.
func (c *Ceremonies) Put(cer Ceremony) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for id, old := range c.m {
		if now.After(old.expires) {
			delete(c.m, id)
		}
	}
	if len(c.m) >= maxCeremonies {
		oldest := ""
		for id, old := range c.m {
			if oldest == "" || old.expires.Before(c.m[oldest].expires) {
				oldest = id
			}
		}
		delete(c.m, oldest)
	}
	id := randomToken()
	cer.expires = now.Add(ceremonyTTL)
	c.m[id] = &cer
	return id
}

// Take removes and returns a pending ceremony of the given kind. Each
// ceremony can be finished once.
func (c *Ceremonies) Take(id string, kinds ...CeremonyKind) (Ceremony, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	cer, ok := c.m[id]
	if !ok {
		return Ceremony{}, false
	}
	delete(c.m, id)
	if time.Now().After(cer.expires) {
		return Ceremony{}, false
	}
	for _, k := range kinds {
		if cer.Kind == k {
			return *cer, true
		}
	}
	return Ceremony{}, false
}

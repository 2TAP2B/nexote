package accounts

import (
	"errors"
	"strings"
	"time"
)

// Paired devices are apps (the Android app) that sync with the server. A
// device gets a bearer token by redeeming a short pairing code that a
// signed-in user created on the server; the token is only good for the sync
// API. Codes and tokens are stored as SHA-256 hashes, like session tokens.

// Device is an app paired with a user's account.
type Device struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	Name       string    `json:"name"`
	Platform   string    `json:"platform"`
	TokenHash  string    `json:"tokenHash"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

// pairing is an unredeemed pairing code. Redeeming deletes it, so a code
// works once.
type pairing struct {
	CodeHash  string    `json:"codeHash"`
	UserID    string    `json:"userId"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

const (
	// DeviceTTL is how long a paired device stays valid without syncing.
	DeviceTTL = 180 * 24 * time.Hour
	// PairingTTL is how long a pairing code can be redeemed.
	PairingTTL = 10 * time.Minute
	// defaultDeviceName labels a device that didn't say what it is.
	defaultDeviceName = "Android device"
	defaultPlatform   = "android"
)

var (
	ErrPairingInvalid = errors.New("This code is invalid or has expired. Create a new one on the server.")
	ErrDeviceInvalid  = errors.New("device token expired or invalid")
)

// pairingAlphabet is Crockford's base32: no I, L, O or U, so a code read off
// a screen can't be mistyped as a look-alike.
const pairingAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// pairingCodeLen is 16 characters of 5 bits each: 80 random bits.
const pairingCodeLen = 16

// newPairingCode returns a fresh code formatted as ABCD-EFGH-JKMN-PQRS.
// Every 5 bits of randomness pick one character, so all characters are
// equally likely (no modulo bias).
func newPairingCode() string {
	b := randomBytes(pairingCodeLen * 5 / 8)
	var out strings.Builder
	var acc uint64
	for _, c := range b {
		acc = acc<<8 | uint64(c)
	}
	for i := range pairingCodeLen {
		if i > 0 && i%4 == 0 {
			out.WriteByte('-')
		}
		shift := uint(5 * (pairingCodeLen - 1 - i))
		out.WriteByte(pairingAlphabet[(acc>>shift)&31])
	}
	return out.String()
}

// NormalizePairingCode turns a typed code into its canonical form: upper
// case without spaces or dashes, look-alikes mapped as Crockford does
// (I and L to 1, O to 0). It returns "" for anything that can't be a code.
func NormalizePairingCode(code string) string {
	var out strings.Builder
	for _, r := range strings.ToUpper(code) {
		switch r {
		case ' ', '-', '\t':
			continue
		case 'I', 'L':
			r = '1'
		case 'O':
			r = '0'
		}
		if !strings.ContainsRune(pairingAlphabet, r) {
			return ""
		}
		out.WriteRune(r)
	}
	if out.Len() != pairingCodeLen {
		return ""
	}
	return out.String()
}

// CreatePairing creates a pairing code for the user, valid for ttl. The
// user's earlier unused codes stop working: only the code on screen counts.
func (s *Store) CreatePairing(userID string, ttl time.Duration) (string, time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pairings, err := s.pairings.load()
	if err != nil {
		return "", time.Time{}, err
	}
	now := s.now().UTC()
	kept := pairings[:0:0]
	for _, p := range pairings {
		if p.UserID != userID && now.Before(p.ExpiresAt) {
			kept = append(kept, p)
		}
	}
	code := newPairingCode()
	p := pairing{
		CodeHash:  hashToken(NormalizePairingCode(code)),
		UserID:    userID,
		CreatedAt: now,
		ExpiresAt: now.Add(ttl),
	}
	return code, p.ExpiresAt, s.pairings.save(append(kept, p))
}

// RedeemPairing trades a pairing code for a new device of the code's user
// and returns the device's bearer token. The code is used up even if
// saving the device fails, so it can never pair two devices.
func (s *Store) RedeemPairing(code, name, platform string) (string, Device, User, error) {
	norm := NormalizePairingCode(code)
	if norm == "" {
		return "", Device{}, User{}, ErrPairingInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	pairings, err := s.pairings.load()
	if err != nil {
		return "", Device{}, User{}, err
	}
	now := s.now().UTC()
	hash := hashToken(norm)
	idx := -1
	for i, p := range pairings {
		if p.CodeHash == hash {
			idx = i
			break
		}
	}
	if idx < 0 || !now.Before(pairings[idx].ExpiresAt) {
		return "", Device{}, User{}, ErrPairingInvalid
	}
	userID := pairings[idx].UserID
	if err := s.pairings.save(append(pairings[:idx:idx], pairings[idx+1:]...)); err != nil {
		return "", Device{}, User{}, err
	}
	user, ok, err := s.activeUser(userID)
	if err != nil {
		return "", Device{}, User{}, err
	}
	if !ok {
		return "", Device{}, User{}, ErrPairingInvalid
	}
	devices, err := s.devices.load()
	if err != nil {
		return "", Device{}, User{}, err
	}
	token := randomToken()
	dev := Device{
		ID:         randomID(),
		UserID:     userID,
		Name:       deviceName(name),
		Platform:   devicePlatform(platform),
		TokenHash:  hashToken(token),
		CreatedAt:  now,
		LastSeenAt: now,
	}
	if err := s.devices.save(append(pruneDevices(devices, now), dev)); err != nil {
		return "", Device{}, User{}, err
	}
	return token, dev, user, nil
}

// DeviceUser resolves a bearer token to its device and active user. Use
// keeps the device alive; its last-seen time is written at most hourly.
func (s *Store) DeviceUser(token string) (Device, User, error) {
	if token == "" {
		return Device{}, User{}, ErrDeviceInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	devices, err := s.devices.load()
	if err != nil {
		return Device{}, User{}, err
	}
	now := s.now().UTC()
	hash := hashToken(token)
	for i := range devices {
		dev := devices[i]
		if dev.TokenHash != hash {
			continue
		}
		if now.Sub(dev.LastSeenAt) > DeviceTTL {
			return Device{}, User{}, ErrDeviceInvalid
		}
		user, ok, err := s.activeUser(dev.UserID)
		if err != nil {
			return Device{}, User{}, err
		}
		if !ok {
			return Device{}, User{}, ErrDeviceInvalid
		}
		if now.Sub(dev.LastSeenAt) > touchEvery {
			devices[i].LastSeenAt = now
			dev.LastSeenAt = now
			_ = s.devices.save(pruneDevices(devices, now))
		}
		return dev, user, nil
	}
	return Device{}, User{}, ErrDeviceInvalid
}

// Devices returns the user's paired devices, newest first.
func (s *Store) Devices(userID string) ([]Device, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	devices, err := s.devices.load()
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	out := []Device{}
	for i := len(devices) - 1; i >= 0; i-- {
		if devices[i].UserID == userID && now.Sub(devices[i].LastSeenAt) <= DeviceTTL {
			out = append(out, devices[i])
		}
	}
	return out, nil
}

// DeleteDevice unpairs one of the user's devices; its token stops working
// at once. Other users' devices are ErrNotFound.
func (s *Store) DeleteDevice(userID, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	devices, err := s.devices.load()
	if err != nil {
		return err
	}
	for i := range devices {
		if devices[i].ID == id && devices[i].UserID == userID {
			return s.devices.save(append(devices[:i:i], devices[i+1:]...))
		}
	}
	return ErrNotFound
}

// activeUser returns the account with the id unless it is missing or
// deactivated. The caller holds s.mu.
func (s *Store) activeUser(id string) (User, bool, error) {
	users, err := s.users.load()
	if err != nil {
		return User{}, false, err
	}
	for _, u := range users {
		if u.ID == id {
			return u, !u.Disabled, nil
		}
	}
	return User{}, false, nil
}

func pruneDevices(devices []Device, now time.Time) []Device {
	kept := devices[:0:0]
	for _, d := range devices {
		if now.Sub(d.LastSeenAt) <= DeviceTTL {
			kept = append(kept, d)
		}
	}
	return kept
}

// deviceName is the label a device asked for, trimmed to 64 characters.
// Over-long names are cut rather than refused: they come from the phone's
// model name, which the user didn't type.
func deviceName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return defaultDeviceName
	}
	if r := []rune(name); len(r) > 64 {
		name = strings.TrimSpace(string(r[:64]))
	}
	return name
}

func devicePlatform(platform string) string {
	platform = strings.ToLower(strings.TrimSpace(platform))
	if platform == "" {
		return defaultPlatform
	}
	if r := []rune(platform); len(r) > 32 {
		platform = string(r[:32])
	}
	return platform
}

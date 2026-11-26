package accounts

import (
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestPairingCodeFormatAndNormalization(t *testing.T) {
	shape := regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$`)
	seen := map[string]bool{}
	for range 200 {
		code := newPairingCode()
		if !shape.MatchString(code) {
			t.Fatalf("code %q isn't four groups of Crockford base32", code)
		}
		if seen[code] {
			t.Fatalf("code %q repeated", code)
		}
		seen[code] = true
	}

	want := "ABCDEFGH1KMN0PQR"
	for _, typed := range []string{
		"ABCD-EFGH-1KMN-0PQR",
		"abcd-efgh-1kmn-0pqr",
		" abcd efgh ikmn opqr ",
		"ABCDEFGHLKMNOPQR",
		"abcd-efgh-lkmn-opqr",
	} {
		if got := NormalizePairingCode(typed); got != want {
			t.Errorf("NormalizePairingCode(%q) = %q, want %q", typed, got, want)
		}
	}
	for _, bad := range []string{"", "ABCD-EFGH", "ABCD-EFGH-JKMN-PQRSX", "ABCD-EFGH-JKMN-PQRU", "ABCD/EFGH/JKMN/PQRS"} {
		if got := NormalizePairingCode(bad); got != "" {
			t.Errorf("NormalizePairingCode(%q) = %q, want rejected", bad, got)
		}
	}
}

func TestPairingIsSingleUseAndExpires(t *testing.T) {
	s, now := newTestStore(t)
	u := mustUser(t, s, "alice", RoleAdmin)

	code, expiresAt, err := s.CreatePairing(u.ID, PairingTTL)
	if err != nil {
		t.Fatal(err)
	}
	if !expiresAt.Equal(now.Add(PairingTTL)) {
		t.Fatalf("expiresAt %v, want %v", expiresAt, now.Add(PairingTTL))
	}
	// Typed sloppily: lowercase, no dashes.
	token, dev, got, err := s.RedeemPairing(strings.ToLower(strings.ReplaceAll(code, "-", "")), "  Pixel 8  ", "")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != u.ID || dev.UserID != u.ID || dev.Name != "Pixel 8" || dev.Platform != "android" || token == "" {
		t.Fatalf("redeemed: user %q device %+v token %q", got.ID, dev, token)
	}
	if _, _, _, err := s.RedeemPairing(code, "", ""); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("second use: want ErrPairingInvalid, got %v", err)
	}

	late, _, _ := s.CreatePairing(u.ID, PairingTTL)
	*now = now.Add(PairingTTL)
	if _, _, _, err := s.RedeemPairing(late, "", ""); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("expired code: want ErrPairingInvalid, got %v", err)
	}

	old, _, _ := s.CreatePairing(u.ID, PairingTTL)
	current, _, _ := s.CreatePairing(u.ID, PairingTTL)
	if _, _, _, err := s.RedeemPairing(old, "", ""); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("code replaced by a newer one: want ErrPairingInvalid, got %v", err)
	}
	if _, dev, _, err := s.RedeemPairing(current, "", ""); err != nil || dev.Name != "Android device" {
		t.Fatalf("newest code: device %+v, %v", dev, err)
	}
}

func TestDeviceTokenLifetime(t *testing.T) {
	s, now := newTestStore(t)
	mustUser(t, s, "admin", RoleAdmin)
	u := mustUser(t, s, "bob", RoleMember)
	code, _, _ := s.CreatePairing(u.ID, PairingTTL)
	token, dev, _, err := s.RedeemPairing(code, "Phone", "android")
	if err != nil {
		t.Fatal(err)
	}

	if got, user, err := s.DeviceUser(token); err != nil || got.ID != dev.ID || user.ID != u.ID {
		t.Fatalf("fresh token: device %q user %q, %v", got.ID, user.ID, err)
	}
	if _, _, err := s.DeviceUser(token + "x"); !errors.Is(err, ErrDeviceInvalid) {
		t.Fatalf("wrong token: want ErrDeviceInvalid, got %v", err)
	}

	// Syncing keeps a device alive past DeviceTTL measured from pairing...
	*now = now.Add(DeviceTTL - time.Hour)
	if _, _, err := s.DeviceUser(token); err != nil {
		t.Fatalf("used just before expiry: %v", err)
	}
	*now = now.Add(DeviceTTL - time.Hour)
	got, _, err := s.DeviceUser(token)
	if err != nil {
		t.Fatalf("still in use: %v", err)
	}
	if !got.LastSeenAt.Equal(*now) {
		t.Fatalf("lastSeenAt %v, want %v", got.LastSeenAt, *now)
	}
	// ...but 180 days without use end it.
	*now = now.Add(DeviceTTL + time.Minute)
	if _, _, err := s.DeviceUser(token); !errors.Is(err, ErrDeviceInvalid) {
		t.Fatalf("idle past DeviceTTL: want ErrDeviceInvalid, got %v", err)
	}
	if list, _ := s.Devices(u.ID); len(list) != 0 {
		t.Fatalf("expired device still listed: %+v", list)
	}
}

func TestDeviceEndsWhenUnpairedOrUserDeactivated(t *testing.T) {
	s, _ := newTestStore(t)
	mustUser(t, s, "admin", RoleAdmin)
	bob := mustUser(t, s, "bob", RoleMember)
	carol := mustUser(t, s, "carol", RoleMember)
	pair := func(u User, name string) (string, Device) {
		t.Helper()
		code, _, _ := s.CreatePairing(u.ID, PairingTTL)
		token, dev, _, err := s.RedeemPairing(code, name, "android")
		if err != nil {
			t.Fatal(err)
		}
		return token, dev
	}
	t1, d1 := pair(bob, "Phone")
	t2, d2 := pair(bob, "Tablet")
	_, d3 := pair(carol, "Carol's phone")

	list, err := s.Devices(bob.ID)
	if err != nil || len(list) != 2 || list[0].ID != d2.ID || list[1].ID != d1.ID {
		t.Fatalf("bob's devices newest first: %+v, %v", list, err)
	}
	if err := s.DeleteDevice(bob.ID, d3.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleting another user's device: want ErrNotFound, got %v", err)
	}
	if err := s.DeleteDevice(bob.ID, d1.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.DeviceUser(t1); !errors.Is(err, ErrDeviceInvalid) {
		t.Fatalf("unpaired device still valid: %v", err)
	}
	if _, _, err := s.DeviceUser(t2); err != nil {
		t.Fatalf("other device unpaired too: %v", err)
	}

	if _, err := s.UpdateUser(bob.ID, func(u *User) error { u.Disabled = true; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.DeviceUser(t2); !errors.Is(err, ErrDeviceInvalid) {
		t.Fatalf("deactivated user's device still valid: %v", err)
	}
	code, _, _ := s.CreatePairing(bob.ID, PairingTTL)
	if _, _, _, err := s.RedeemPairing(code, "", ""); !errors.Is(err, ErrPairingInvalid) {
		t.Fatalf("deactivated user's pairing code: want ErrPairingInvalid, got %v", err)
	}
}

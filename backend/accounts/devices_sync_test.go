package accounts

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestTouchDeviceSync(t *testing.T) {
	s, now := newTestStore(t)
	alice := mustUser(t, s, "alice", RoleAdmin)
	bob := mustUser(t, s, "bob", RoleMember)

	code, _, err := s.CreatePairing(alice.ID, PairingTTL)
	if err != nil {
		t.Fatal(err)
	}
	_, dev, _, err := s.RedeemPairing(code, "Pixel", "")
	if err != nil {
		t.Fatal(err)
	}
	if data, _ := json.Marshal(dev); strings.Contains(string(data), "lastSyncAt") {
		t.Fatalf("unsynced device JSON has lastSyncAt: %s", data)
	}

	*now = now.Add(5 * time.Minute)
	at, err := s.TouchDeviceSync(alice.ID, dev.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !at.Equal(*now) {
		t.Fatalf("sync time %v, want %v", at, *now)
	}
	devices, err := s.Devices(alice.ID)
	if err != nil || len(devices) != 1 {
		t.Fatalf("devices %+v %v", devices, err)
	}
	if !devices[0].LastSyncAt.Equal(*now) || !devices[0].LastSeenAt.Equal(*now) {
		t.Fatalf("device after sync %+v", devices[0])
	}
	if data, _ := json.Marshal(devices[0]); !strings.Contains(string(data), `"lastSyncAt"`) {
		t.Fatalf("synced device JSON lacks lastSyncAt: %s", data)
	}

	if _, err := s.TouchDeviceSync(bob.ID, dev.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user's device: %v", err)
	}
	if _, err := s.TouchDeviceSync(alice.ID, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown device: %v", err)
	}
}

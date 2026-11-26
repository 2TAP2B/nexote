package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nexote/accounts"
)

// doDevice sends a request with a device token (and optionally a session
// cookie, to show it is ignored).
func (e *testEnv) doDevice(method, path, deviceToken, sessionToken string) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if deviceToken != "" {
		req.Header.Set("Authorization", "Bearer "+deviceToken)
	}
	if sessionToken != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: sessionToken})
	}
	rec := httptest.NewRecorder()
	e.routes.ServeHTTP(rec, req)
	return rec
}

type pairingResponse struct {
	Code      string `json:"code"`
	Link      string `json:"link"`
	ExpiresAt string `json:"expiresAt"`
}

type pairResponse struct {
	Token  string    `json:"token"`
	Device deviceRef `json:"device"`
	User   syncUser  `json:"user"`
	Origin string    `json:"origin"`
}

// pairingCode creates a pairing code as the session's user.
func (e *testEnv) pairingCode(sessionToken string) pairingResponse {
	e.t.Helper()
	rec := e.do("POST", "/api/devices/pairing", sessionToken, map[string]any{})
	e.expect(rec, http.StatusOK, "create pairing code")
	var p pairingResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		e.t.Fatal(err)
	}
	return p
}

// pair redeems a code like the app does and returns the device token.
func (e *testEnv) pair(code, name string) pairResponse {
	e.t.Helper()
	rec := e.do("POST", "/api/auth/pair", "", map[string]string{"code": code, "name": name, "platform": "android"})
	e.expect(rec, http.StatusOK, "pair "+name)
	var p pairResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		e.t.Fatal(err)
	}
	return p
}

func TestPairingFlow(t *testing.T) {
	e := newTestEnv(t)
	alice, aliceTok := e.user("alice", accounts.RoleMember)

	p := e.pairingCode(aliceTok)
	if p.Link != "http://localhost:3000/pair#"+p.Code || len(p.Code) != 19 || p.ExpiresAt == "" {
		t.Fatalf("pairing code: %+v", p)
	}

	// The app may send the code as typed: lowercase, without dashes.
	typed := strings.ToLower(strings.ReplaceAll(p.Code, "-", ""))
	paired := e.pair(typed, "Google Pixel 8")
	if paired.Token == "" || paired.Device.Name != "Google Pixel 8" || paired.User.ID != alice.ID ||
		paired.User.Username != "alice" || paired.Origin != "http://localhost:3000" {
		t.Fatalf("pair response: %+v", paired)
	}

	rec := e.do("POST", "/api/auth/pair", "", map[string]string{"code": p.Code})
	e.expect(rec, http.StatusBadRequest, "code used twice")
	if !strings.Contains(rec.Body.String(), "This code is invalid or has expired. Create a new one on the server.") {
		t.Errorf("second use error: %s", rec.Body.String())
	}

	old := e.pairingCode(aliceTok)
	current := e.pairingCode(aliceTok)
	e.expect(e.do("POST", "/api/auth/pair", "", map[string]string{"code": old.Code}), http.StatusBadRequest, "code replaced by a newer one")
	e.pair(current.Code, "")

	rec = e.do("GET", "/api/devices", aliceTok, nil)
	e.expect(rec, http.StatusOK, "list devices")
	var list struct {
		Devices []devicePayload `json:"devices"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Devices) != 2 || list.Devices[0].Name != "Android device" || list.Devices[1].ID != paired.Device.ID ||
		list.Devices[1].Platform != "android" {
		t.Fatalf("devices, newest first: %+v", list.Devices)
	}
}

func TestDeviceTokenOnlyReachesTheSyncAPI(t *testing.T) {
	e := newTestEnv(t)
	alice, aliceTok := e.user("alice", accounts.RoleAdmin)
	e.space(alice, "Alice")
	device := e.pair(e.pairingCode(aliceTok).Code, "Phone")

	rec := e.doDevice("GET", "/api/sync/hello", device.Token, "")
	e.expect(rec, http.StatusOK, "hello with device token")
	var hello struct {
		User   syncUser  `json:"user"`
		Device deviceRef `json:"device"`
		Origin string    `json:"origin"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hello)
	if hello.User.ID != alice.ID || hello.Device.ID != device.Device.ID || hello.Origin != "http://localhost:3000" {
		t.Fatalf("hello: %+v", hello)
	}

	e.expect(e.doDevice("GET", "/api/sync/hello", "", ""), http.StatusUnauthorized, "hello without token")
	e.expect(e.doDevice("GET", "/api/sync/hello", "forged", ""), http.StatusUnauthorized, "hello with forged token")
	e.expect(e.doDevice("GET", "/api/sync/hello", "", aliceTok), http.StatusUnauthorized, "hello with a session cookie")
	e.expect(e.doDevice("GET", "/api/vaults", device.Token, ""), http.StatusUnauthorized, "vaults with device token")
	e.expect(e.doDevice("GET", "/api/devices", device.Token, ""), http.StatusUnauthorized, "device list with device token")
	e.expect(e.doDevice("POST", "/api/devices/pairing", device.Token, ""), http.StatusUnauthorized, "pairing with device token")
}

func TestUnpairingRevokesTheToken(t *testing.T) {
	e := newTestEnv(t)
	_, aliceTok := e.user("alice", accounts.RoleAdmin)
	_, bobTok := e.user("bob", accounts.RoleMember)
	phone := e.pair(e.pairingCode(aliceTok).Code, "Phone")
	tablet := e.pair(e.pairingCode(aliceTok).Code, "Tablet")

	e.expect(e.do("DELETE", "/api/devices/"+phone.Device.ID, bobTok, nil), http.StatusNotFound, "other user deletes device")
	e.expect(e.doDevice("GET", "/api/sync/hello", phone.Token, ""), http.StatusOK, "device after foreign delete attempt")

	e.expect(e.do("DELETE", "/api/devices/"+phone.Device.ID, aliceTok, nil), http.StatusNoContent, "owner deletes device")
	e.expect(e.doDevice("GET", "/api/sync/hello", phone.Token, ""), http.StatusUnauthorized, "deleted device")
	e.expect(e.doDevice("GET", "/api/sync/hello", tablet.Token, ""), http.StatusOK, "other device")

	e.expect(e.doDevice("DELETE", "/api/sync/device", tablet.Token, ""), http.StatusNoContent, "device unpairs itself")
	e.expect(e.doDevice("GET", "/api/sync/hello", tablet.Token, ""), http.StatusUnauthorized, "self-unpaired device")

	rec := e.do("GET", "/api/devices", aliceTok, nil)
	if !strings.Contains(rec.Body.String(), `"devices":[]`) {
		t.Errorf("devices after unpairing all: %s", rec.Body.String())
	}
}

func TestDeactivatedUsersDevicesStopWorking(t *testing.T) {
	e := newTestEnv(t)
	_, adminTok := e.user("admin", accounts.RoleAdmin)
	bob, bobTok := e.user("bob", accounts.RoleMember)
	phone := e.pair(e.pairingCode(bobTok).Code, "Phone")

	e.expect(e.do("PATCH", "/api/admin/users/"+bob.ID, adminTok, map[string]bool{"disabled": true}), http.StatusOK, "deactivate bob")
	e.expect(e.doDevice("GET", "/api/sync/hello", phone.Token, ""), http.StatusUnauthorized, "deactivated user's device")
}

func TestPairingRoutesAreOffInLocalMode(t *testing.T) {
	e := newTestEnv(t)
	if _, err := e.h.StartLocalMode(); err != nil {
		t.Fatal(err)
	}
	e.expect(e.do("POST", "/api/devices/pairing", "", map[string]any{}), http.StatusNotFound, "create pairing code")
	e.expect(e.do("GET", "/api/devices", "", nil), http.StatusNotFound, "list devices")
	e.expect(e.do("POST", "/api/auth/pair", "", map[string]string{"code": "ABCD-EFGH-JKMN-PQRS"}), http.StatusNotFound, "pair")
	e.expect(e.doDevice("GET", "/api/sync/hello", "", ""), http.StatusNotFound, "sync hello")
}

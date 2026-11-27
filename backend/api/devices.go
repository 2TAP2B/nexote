package api

import (
	"errors"
	"net/http"
	"time"

	"nexote/accounts"
)

// Pairing connects the Android app to this server: a signed-in user creates
// a short-lived code (shown as a QR code of the pairing link), the app
// redeems it at POST /api/auth/pair for a device token, and the token then
// works only on the sync API (/api/sync/, see authenticate).

// devicePayload is a paired device as its owner sees it.
type devicePayload struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Platform   string    `json:"platform"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	LastSyncAt time.Time `json:"lastSyncAt,omitzero"`
}

// deviceRef and syncUser are the device and account a paired app shows.
type deviceRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type syncUser struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

func toSyncUser(u *accounts.User) syncUser {
	return syncUser{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName}
}

// pairingURL is the link a pairing QR code encodes. The code sits in the
// fragment, which browsers never send, so it stays out of server logs.
func (h *Handler) pairingURL(code string) string {
	return h.origin.String() + "/pair#" + code
}

// serverOnly answers 404 in local mode: the app's own engine has no
// accounts to pair devices with.
func (h *Handler) serverOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.localUserID != "" {
			http.NotFound(w, r)
			return
		}
		next(w, r)
	}
}

// createPairing makes a new pairing code for the signed-in user; their
// earlier unused codes stop working.
func (h *Handler) createPairing(w http.ResponseWriter, r *http.Request) {
	code, expiresAt, err := h.Accounts.CreatePairing(currentUser(r).ID, accounts.PairingTTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code":      code,
		"link":      h.pairingURL(code),
		"expiresAt": expiresAt,
	})
}

// pairDevice redeems a pairing code (public: the app has no session) and
// returns the new device's token, shown only this once.
func (h *Handler) pairDevice(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code     string `json:"code"`
		Name     string `json:"name"`
		Platform string `json:"platform"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	token, dev, user, err := h.Accounts.RedeemPairing(in.Code, in.Name, in.Platform)
	if errors.Is(err, accounts.ErrPairingInvalid) {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token":  token,
		"device": deviceRef{ID: dev.ID, Name: dev.Name},
		"user":   toSyncUser(&user),
		"origin": h.origin.String(),
	})
}

// listDevices returns the signed-in user's paired devices, newest first.
func (h *Handler) listDevices(w http.ResponseWriter, r *http.Request) {
	devices, err := h.Accounts.Devices(currentUser(r).ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	out := make([]devicePayload, 0, len(devices))
	for _, d := range devices {
		out = append(out, devicePayload{
			ID: d.ID, Name: d.Name, Platform: d.Platform, CreatedAt: d.CreatedAt, LastSeenAt: d.LastSeenAt, LastSyncAt: d.LastSyncAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": out})
}

// deleteDevice unpairs one of the user's devices; its token stops working
// with the next request. Other users' devices are 404.
func (h *Handler) deleteDevice(w http.ResponseWriter, r *http.Request) {
	if err := h.Accounts.DeleteDevice(currentUser(r).ID, r.PathValue("id")); err != nil {
		writeAccountError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// syncHello lets a paired app check its token and learn whose it is.
func (h *Handler) syncHello(w http.ResponseWriter, r *http.Request) {
	dev := currentDevice(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":   toSyncUser(currentUser(r)),
		"device": deviceRef{ID: dev.ID, Name: dev.Name},
		"origin": h.origin.String(),
	})
}

// syncUnpair lets a paired app revoke its own token (disconnecting in the
// app).
func (h *Handler) syncUnpair(w http.ResponseWriter, r *http.Request) {
	if err := h.Accounts.DeleteDevice(currentUser(r).ID, currentDevice(r).ID); err != nil {
		writeAccountError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

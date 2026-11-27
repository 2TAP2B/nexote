package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"nexote/accounts"
)

// NoteEvent is sent to the SSE streams of the users who can see what
// changed. The SSE event name is Type:
//   - "note-change": a note was saved (VaultID, ID, UpdatedAt); clients
//     refetch it lazily.
//   - "tree-change": notes or folders of VaultID were created, moved,
//     renamed or deleted; clients refetch the vault's note list.
//   - "spaces-change": the user's spaces, a space's members or its vaults
//     changed (SpaceID); clients refetch spaces and vaults.
//   - "rekey" (the Android app only): its first sync gave the device's
//     space and vaults the server's ids (Spaces, Vaults: old → new); sent
//     before the matching spaces-change.
//
// VaultID uses the same ids as the REST routes: a real vault id, or the
// personal pseudo vaults "journal" and "home".
type NoteEvent struct {
	Type      string `json:"type"`
	VaultID   string `json:"vaultId,omitempty"`
	SpaceID   string `json:"spaceId,omitempty"`
	ID        string `json:"id,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
	// Spaces and Vaults map old to new ids in a "rekey" event: the engine's
	// first sync gave the device's space and vaults the server's ids.
	Spaces map[string]string `json:"spaces,omitempty"`
	Vaults map[string]string `json:"vaults,omitempty"`
	// FromSync marks changes the engine's sync applied, so it doesn't take
	// them for local edits. Never sent to clients.
	FromSync bool `json:"-"`
	// DeviceID is the paired device whose sync caused the change ("" for
	// everything else); its own change stream leaves these out. Never sent.
	DeviceID string `json:"-"`
}

// hub fans events out to subscribed SSE streams. A mutex protects the
// subscriber set; slow readers are dropped rather than blocking a writer.
type hub struct {
	mu   sync.Mutex
	subs map[*subscriber]struct{}
}

type subscriber struct {
	userID string
	ch     chan NoteEvent
}

func newHub() *hub {
	return &hub{subs: make(map[*subscriber]struct{})}
}

func (h *hub) subscribe(userID string) *subscriber {
	s := &subscriber{userID: userID, ch: make(chan NoteEvent, 64)}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	return s
}

func (h *hub) unsubscribe(s *subscriber) {
	h.mu.Lock()
	delete(h.subs, s)
	h.mu.Unlock()
}

// publish sends e to the streams of the users in audience.
func (h *hub) publish(e NoteEvent, audience map[string]bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.subs {
		if !audience[s.userID] {
			continue
		}
		select {
		case s.ch <- e:
		default:
		}
	}
}

// streamEvents serves the Server-Sent Events stream that announces changes
// the user can see. Plain SSE (a GET response) is used so it works unchanged
// through the Next.js /api proxy without a websocket upgrade path. A
// heartbeat comment every 20s keeps proxy buffers from timing the
// connection out; each heartbeat also re-checks the session, so a logged-out
// or deactivated user stops receiving events.
func (h *Handler) streamEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("streaming unsupported"))
		return
	}
	user := currentUser(r)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sub := h.Events.subscribe(user.ID)
	defer h.Events.unsubscribe(sub)

	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case e := <-sub.ch:
			data, err := json.Marshal(e)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e.Type, data)
			flusher.Flush()
		case <-ticker.C:
			if h.requestUser(r) == nil {
				return
			}
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// publishNote announces a saved note to everyone who can see its vault.
func (h *Handler) publishNote(r *http.Request, vaultId, id string, updatedAt time.Time) {
	h.Events.publish(NoteEvent{
		Type:      "note-change",
		VaultID:   vaultId,
		ID:        id,
		UpdatedAt: updatedAt.Format(timeRFC3339Millis),
	}, h.vaultAudience(currentUser(r), vaultId))
}

// publishTree announces that notes or folders of a vault changed.
func (h *Handler) publishTree(r *http.Request, vaultId string) {
	h.Events.publish(NoteEvent{Type: "tree-change", VaultID: vaultId},
		h.vaultAudience(currentUser(r), vaultId))
}

// publishSpaces tells a space's members (plus extra users, e.g. someone
// just removed) that the space, its members or its vaults changed.
func (h *Handler) publishSpaces(spaceID string, members []string, extra ...string) {
	audience := map[string]bool{}
	for _, id := range members {
		audience[id] = true
	}
	for _, id := range extra {
		audience[id] = true
	}
	h.Events.publish(NoteEvent{Type: "spaces-change", SpaceID: spaceID}, audience)
}

// vaultAudience is everyone who can see a vault: its space's members, or
// only the user for their personal pseudo vaults.
func (h *Handler) vaultAudience(user *accounts.User, vaultId string) map[string]bool {
	audience := map[string]bool{}
	if user == nil {
		return audience
	}
	if _, personal := personalVaults[vaultId]; personal {
		audience[user.ID] = true
		return audience
	}
	v, err := h.Registry.Get(vaultId)
	if err != nil {
		return audience
	}
	if s, err := h.Spaces.Get(v.SpaceID); err == nil {
		for _, m := range s.Members {
			audience[m.UserID] = true
		}
	}
	return audience
}

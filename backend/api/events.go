package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// NoteEvent is broadcast to every connected SSE stream when a note changes.
// VaultID uses the same pseudo id as the REST routes ("journal" for journal
// notes, or a real vault id). Clients refetch the full note lazily.
type NoteEvent struct {
	Type      string `json:"type"`
	VaultID   string `json:"vaultId"`
	ID        string `json:"id"`
	UpdatedAt string `json:"updatedAt"`
}

// hub fans NoteEvents out to subscribed SSE streams. A mutex protects the
// subscriber set; slow readers are dropped rather than blocking a writer.
type hub struct {
	mu   sync.Mutex
	subs map[chan NoteEvent]struct{}
}

func newHub() *hub {
	return &hub{subs: make(map[chan NoteEvent]struct{})}
}

func (h *hub) subscribe() chan NoteEvent {
	ch := make(chan NoteEvent, 64)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *hub) unsubscribe(ch chan NoteEvent) {
	h.mu.Lock()
	delete(h.subs, ch)
	h.mu.Unlock()
}

func (h *hub) publish(e NoteEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

// streamEvents serves the Server-Sent Events stream that announces note
// changes. Plain SSE (a GET response) is used so it works unchanged through
// the Next.js /api proxy without a websocket upgrade path. A heartbeat
// comment every 20s keeps proxy buffers from timing the connection out.
func (h *Handler) streamEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("streaming unsupported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := h.Events.subscribe()
	defer h.Events.unsubscribe(ch)

	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case e := <-ch:
			data, err := json.Marshal(e)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: note-change\ndata: %s\n\n", data)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// publishNote announces a saved note to all SSE streams.
func (h *Handler) publishNote(vaultId, id string, updatedAt time.Time) {
	h.Events.publish(NoteEvent{
		Type:      "note-change",
		VaultID:   vaultId,
		ID:        id,
		UpdatedAt: updatedAt.Format(timeRFC3339Millis),
	})
}
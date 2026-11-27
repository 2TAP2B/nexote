package serversync

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"nexote/accounts"
	"nexote/api"
	"nexote/server"
)

// waitFor polls cond until it holds or the time is up.
func waitFor(t *testing.T, within time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(within)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (s *Service) schedRuns() (runs int, syncing, listening bool) {
	sc := &s.sched
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.runs, sc.syncing, sc.listening
}

// startScheduler runs the world's scheduler for real (with its change
// stream) and waits for the first sync and the stream's connection.
func (w *world) startScheduler() {
	w.t.Helper()
	sc := &w.svc.sched
	ph, user, folder, home := sc.local, sc.localUser, sc.folder, sc.home
	sc.local = nil
	w.svc.Attach(ph, user, folder, home)
	w.t.Cleanup(w.svc.Close)
	if err := w.svc.SyncNowWait(30 * time.Second); err != nil {
		w.t.Fatal(err)
	}
	waitFor(w.t, 5*time.Second, "the change stream", func() bool { _, _, l := w.svc.schedRuns(); return l })
}

func TestServerChangeReachesThePhoneWithinSeconds(t *testing.T) {
	w := newWorld(t)
	w.startScheduler()
	v := w.server.vault("")
	start := time.Now()
	id := w.server.createNote(v, "From the laptop", "", "typed on the server\n")
	waitFor(t, 5*time.Second, "the note on the phone", func() bool { _, ok := w.phone.note(v, id); return ok })
	t.Logf("arrived after %s", time.Since(start).Round(time.Millisecond))
}

// secondPhone pairs another local-mode phone with the world's account and
// runs its scheduler for real.
func (w *world) secondPhone() (*peer, *Service) {
	w.t.Helper()
	home := w.t.TempDir()
	origin, _ := url.Parse("http://127.0.0.1:2")
	ph, err := server.Open(home, origin, server.Options{Local: true})
	if err != nil {
		w.t.Fatal(err)
	}
	w.t.Cleanup(ph.Close)
	host := NewMemoryHost("Second phone")
	host.SetStateDir(w.t.TempDir())
	svc := New(host, "")
	code, _, err := w.server.h.Accounts.CreatePairing(w.server.user, accounts.PairingTTL)
	if err != nil {
		w.t.Fatal(err)
	}
	if _, err := svc.pair(context.Background(), pairInput{Server: w.srv.URL, Code: code}); err != nil {
		w.t.Fatal(err)
	}
	svc.Attach(ph, ph.LocalUserID(), "second-folder", home)
	w.t.Cleanup(svc.Close)
	if err := svc.SyncNowWait(30 * time.Second); err != nil {
		w.t.Fatal(err)
	}
	return &peer{t: w.t, h: ph, routes: ph.Routes(), user: ph.LocalUserID()}, svc
}

func TestAnotherPhonesEditReachesThisPhoneWithinSeconds(t *testing.T) {
	w := newWorld(t)
	w.startScheduler()
	b, _ := w.secondPhone()
	v := w.server.vault("")
	start := time.Now()
	id := b.createNote(v, "From phone B", "", "typed on the other phone\n")
	// B syncs it after its debounce; the server's stream then tells this
	// phone, which pulls it.
	waitFor(t, changeDelay+5*time.Second, "B's note on this phone", func() bool { _, ok := w.phone.note(v, id); return ok })
	t.Logf("arrived after %s", time.Since(start).Round(time.Millisecond))
}

func TestBurstOfPhoneEditsIsOneRunAndTriggersNoEcho(t *testing.T) {
	w := newWorld(t)
	w.startScheduler()
	v := w.phone.vault("")
	waitFor(t, 5*time.Second, "an idle scheduler", func() bool { _, s, _ := w.svc.schedRuns(); return !s })
	before, _, _ := w.svc.schedRuns()
	var ids []string
	for i := range 3 {
		ids = append(ids, w.phone.createNote(v, fmt.Sprintf("Burst %d", i), "", "x\n"))
		time.Sleep(200 * time.Millisecond)
	}
	waitFor(t, 6*time.Second, "the notes on the server", func() bool {
		for _, id := range ids {
			if _, ok := w.server.note(v, id); !ok {
				return false
			}
		}
		return true
	})
	// The run's own writes on the server must not come back as a reason to
	// sync again.
	time.Sleep(changeDelay + time.Second)
	if runs, _, _ := w.svc.schedRuns(); runs != before+1 {
		t.Errorf("%d runs for one burst, want 1", runs-before)
	}
}

// fakeStream is a server with only the change stream: each connection
// runs the next handler of conns (the last one repeats).
type fakeStream struct {
	*httptest.Server
	count atomic.Int32
}

func newFakeStream(t *testing.T, conns ...func(w http.ResponseWriter, r *http.Request)) *fakeStream {
	f := &fakeStream{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sync/events" || r.Header.Get("Authorization") != "Bearer tok" {
			http.NotFound(w, r)
			return
		}
		n := int(f.count.Add(1)) - 1
		conns[min(n, len(conns)-1)](w, r)
	}))
	t.Cleanup(f.Close)
	return f
}

func sse(w http.ResponseWriter, text string) {
	fmt.Fprint(w, text)
	w.(http.Flusher).Flush()
}

// listeningService is a paired Service running only its listener; kicks
// counts the syncs it asked for.
func listeningService(t *testing.T, server string) (*Service, func() int) {
	t.Helper()
	oldMin := listenBackoffMin
	listenBackoffMin = 20 * time.Millisecond
	t.Cleanup(func() { listenBackoffMin = oldMin })
	host := NewMemoryHost("Test phone")
	creds, _ := json.Marshal(credentials{Server: server, Token: "tok", Device: Device{ID: "d1"}})
	_ = host.SaveSecret(secretName, string(creds))
	s := New(host, "")
	sc := &s.sched
	sc.local = new(api.Handler) // only so SyncNow kicks; nothing runs a sync
	sc.kick = make(chan struct{}, 1)
	sc.listenWake = make(chan struct{}, 1)
	quit, done := make(chan struct{}), make(chan struct{})
	var mu sync.Mutex
	kicks := 0
	stopCount := make(chan struct{})
	go func() {
		for {
			select {
			case <-sc.kick:
				mu.Lock()
				kicks++
				mu.Unlock()
			case <-stopCount:
				return
			}
		}
	}()
	go func() {
		defer close(done)
		s.listen(quit, sc.listenWake)
	}()
	t.Cleanup(func() {
		close(quit)
		s.relisten()
		<-done
		close(stopCount)
	})
	return s, func() int { mu.Lock(); defer mu.Unlock(); return kicks }
}

func TestStreamEventKicksASyncAndHeartbeatsDont(t *testing.T) {
	send := make(chan string)
	f := newFakeStream(t, func(w http.ResponseWriter, r *http.Request) {
		sse(w, ": connected\n\n")
		for {
			select {
			case text := <-send:
				sse(w, text)
			case <-r.Context().Done():
				return
			}
		}
	})
	_, kicks := listeningService(t, f.URL)
	waitFor(t, 2*time.Second, "the connection", func() bool { return f.count.Load() == 1 })
	send <- ": keepalive\n\n"
	time.Sleep(100 * time.Millisecond)
	if n := kicks(); n != 0 {
		t.Fatalf("%d syncs for a heartbeat", n)
	}
	send <- "event: tree-change\ndata: {\"type\":\"tree-change\",\"vaultId\":\"v\"}\n\n"
	waitFor(t, 2*time.Second, "a sync for the event", func() bool { return kicks() == 1 })
}

func TestDroppedStreamReconnectsAndKeepsListening(t *testing.T) {
	send := make(chan string)
	f := newFakeStream(t,
		func(w http.ResponseWriter, r *http.Request) { sse(w, ": connected\n\n") }, // drops at once
		func(w http.ResponseWriter, r *http.Request) {
			sse(w, ": connected\n\n")
			for {
				select {
				case text := <-send:
					sse(w, text)
				case <-r.Context().Done():
					return
				}
			}
		})
	_, kicks := listeningService(t, f.URL)
	waitFor(t, 3*time.Second, "the reconnect", func() bool { return f.count.Load() == 2 })
	// The reconnect itself syncs once: changes may have been missed.
	waitFor(t, 2*time.Second, "the catch-up sync", func() bool { return kicks() == 1 })
	send <- "event: note-change\ndata: {}\n\n"
	waitFor(t, 2*time.Second, "a sync for the later event", func() bool { return kicks() == 2 })
}

func TestStreamRefusingTheTokenMarksThePairingRevoked(t *testing.T) {
	f := newFakeStream(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"unpaired"}`, http.StatusUnauthorized)
	})
	s, _ := listeningService(t, f.URL)
	waitFor(t, 2*time.Second, "the revoked pairing", func() bool { c, _ := s.current(); return c != nil && c.Revoked })
	time.Sleep(100 * time.Millisecond)
	if n := f.count.Load(); n != 1 {
		t.Errorf("%d connections after the 401, want the listener to stop", n)
	}
}

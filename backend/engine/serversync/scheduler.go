package serversync

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"nexote/api"
)

const (
	// changeDelay is how long after the last local change a sync starts:
	// long enough that a burst of typing (every keystroke saves after a
	// moment) becomes one sync, short enough that the server has the change
	// within a few seconds.
	changeDelay = 2 * time.Second
	// syncInterval is the regular sync while the engine runs, a fallback
	// for changes the server's change stream didn't announce.
	syncInterval = 2 * time.Minute
	// runTimeout bounds one sync run.
	runTimeout = 15 * time.Minute
)

// errStopped ends a run whose pairing changed underneath it.
var errStopped = errors.New("sync stopped")

// errNoEngine: SyncNowWait without an attached engine.
var errNoEngine = errors.New("the engine isn't running")

// scheduler runs syncs one at a time on its own goroutine. Triggers: the
// start, local changes (debounced), the server's change stream (listen.go),
// a timer, SyncNow. A trigger during a run queues exactly one follow-up
// (kick holds at most one).
type scheduler struct {
	mu        sync.Mutex
	local     *api.Handler
	localUser string
	// folder identifies the engine's data folder (part of the state's key),
	// home is its path.
	folder string
	home   string
	kick   chan struct{}
	quit   chan struct{}
	done   chan struct{}
	// cancel ends the running sync (nil when none runs).
	cancel context.CancelFunc
	// waiters are SyncNowWait calls the next run answers, running those
	// the run in progress answers.
	waiters []chan error
	running []chan error
	// listenCancel drops the change stream's connection, listenWake makes
	// the listener look at the pairing again, listenDone closes when it
	// ended.
	listenCancel context.CancelFunc
	listenWake   chan struct{}
	listenDone   chan struct{}
	// listening is set while the change stream is connected; runs counts
	// started sync runs (both for tests and logs).
	listening bool
	runs      int

	syncing       bool
	lastSyncAt    time.Time
	lastError     string
	lastConflicts int
	// pending counts local changes since the last run started plus items
	// the last run left for the next one (best effort).
	pending int
}

// syncStatus is the scheduler's part of GET /api/local/sync.
type syncStatus struct {
	Syncing       bool      `json:"syncing"`
	LastSyncAt    time.Time `json:"lastSyncAt,omitzero"`
	LastError     string    `json:"lastError,omitempty"`
	LastConflicts int       `json:"lastConflicts"`
	Pending       int       `json:"pending"`
}

// Attach starts syncing the engine's data (handler h, acting as userID; the
// data folder is home, its id folder) with the paired account. Call Close
// when the engine stops.
func (s *Service) Attach(h *api.Handler, userID, folder, home string) {
	sc := &s.sched
	sc.mu.Lock()
	if sc.local != nil {
		sc.mu.Unlock()
		return
	}
	sc.local, sc.localUser, sc.folder, sc.home = h, userID, folder, home
	sc.kick = make(chan struct{}, 1)
	sc.quit = make(chan struct{})
	sc.done = make(chan struct{})
	sc.listenWake = make(chan struct{}, 1)
	sc.listenDone = make(chan struct{})
	quit, wake, listenDone := sc.quit, sc.listenWake, sc.listenDone
	sc.mu.Unlock()
	events, unsubscribe := h.SubscribeEvents(userID)
	go func() {
		defer unsubscribe()
		s.loop(events)
	}()
	go func() {
		defer close(listenDone)
		s.listen(quit, wake)
	}()
	s.SyncNow()
}

// Close stops the scheduler, ending a running sync, and waits for it.
func (s *Service) Close() {
	sc := &s.sched
	sc.mu.Lock()
	if sc.local == nil {
		sc.mu.Unlock()
		return
	}
	close(sc.quit)
	if sc.cancel != nil {
		sc.cancel()
	}
	if sc.listenCancel != nil {
		sc.listenCancel()
	}
	done, listenDone := sc.done, sc.listenDone
	sc.mu.Unlock()
	<-done
	<-listenDone
	sc.mu.Lock()
	for _, w := range sc.waiters {
		w <- errNoEngine
	}
	sc.waiters = nil
	sc.local = nil
	sc.mu.Unlock()
}

// SyncNow asks for a sync soon; it does nothing when not paired.
func (s *Service) SyncNow() {
	sc := &s.sched
	sc.mu.Lock()
	kick := sc.kick
	attached := sc.local != nil
	sc.mu.Unlock()
	if !attached {
		return
	}
	select {
	case kick <- struct{}{}:
	default:
	}
}

// SyncNowWait waits until a sync finished (or timeout) and returns its
// error: the run in progress if there is one, else the next one (started
// now unless one is queued already). Not paired (or a revoked pairing): nil
// at once.
func (s *Service) SyncNowWait(timeout time.Duration) error {
	if c, err := s.current(); err != nil {
		return err
	} else if c == nil || c.Revoked {
		return nil
	}
	sc := &s.sched
	result := make(chan error, 1)
	sc.mu.Lock()
	if sc.local == nil {
		sc.mu.Unlock()
		return errNoEngine
	}
	joined := sc.syncing
	if joined {
		sc.running = append(sc.running, result)
	} else {
		sc.waiters = append(sc.waiters, result)
	}
	sc.mu.Unlock()
	if !joined {
		s.SyncNow()
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-result:
		return err
	case <-timer.C:
		return fmt.Errorf("The sync didn't finish within %s.", timeout)
	}
}

// cancelRun ends a running sync (pairing changed).
func (s *Service) cancelRun() {
	sc := &s.sched
	sc.mu.Lock()
	defer sc.mu.Unlock()
	if sc.cancel != nil {
		sc.cancel()
	}
}

// resetStatus forgets the last run (a new or no pairing).
func (s *Service) resetStatus() {
	sc := &s.sched
	sc.mu.Lock()
	defer sc.mu.Unlock()
	sc.lastSyncAt, sc.lastError, sc.lastConflicts, sc.pending = time.Time{}, "", 0, 0
}

func (s *Service) syncStatus() syncStatus {
	sc := &s.sched
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return syncStatus{Syncing: sc.syncing, LastSyncAt: sc.lastSyncAt, LastError: sc.lastError, LastConflicts: sc.lastConflicts, Pending: sc.pending}
}

func (s *Service) loop(events <-chan api.NoteEvent) {
	sc := &s.sched
	defer close(sc.done)
	ticker := time.NewTicker(syncInterval)
	defer ticker.Stop()
	debounce := time.NewTimer(changeDelay)
	debounce.Stop()
	defer debounce.Stop()
	for {
		select {
		case <-sc.quit:
			return
		case <-sc.kick:
		case <-ticker.C:
		case <-debounce.C:
		case ev, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			// The sync's own writes publish events too; only the user's
			// edits count.
			if ev.FromSync {
				continue
			}
			sc.mu.Lock()
			sc.pending++
			sc.mu.Unlock()
			debounce.Reset(changeDelay)
			continue
		}
		s.runOnce()
	}
}

// runOnce runs one sync if paired and answers the waiters registered
// before it started.
func (s *Service) runOnce() {
	sc := &s.sched
	c, err := s.current()
	if err != nil || c == nil || c.Revoked {
		sc.mu.Lock()
		waiters := sc.waiters
		sc.waiters = nil
		sc.mu.Unlock()
		for _, w := range waiters {
			w <- err
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), runTimeout)
	sc.mu.Lock()
	sc.cancel, sc.syncing = cancel, true
	sc.runs++
	sc.running, sc.waiters = sc.waiters, nil
	changesBefore := sc.pending
	sc.mu.Unlock()

	r, err := s.syncOnce(ctx, c)
	cancel()

	if errors.Is(err, errRevoked) {
		s.update(c.Token, func(next *credentials) { next.Revoked = true })
	}
	sc.mu.Lock()
	sc.cancel, sc.syncing = nil, false
	waiters := sc.running
	sc.running = nil
	switch {
	case err == nil:
		sc.lastSyncAt = s.now().UTC()
		sc.lastError = ""
		if len(r.problems) > 0 {
			sc.lastError = "Not everything was synced: " + r.problems[0]
			if n := len(r.problems) - 1; n > 0 {
				sc.lastError += fmt.Sprintf(" (and %d more)", n)
			}
		}
		sc.lastConflicts = r.conflicts
		// Changes made while the run was going may not be in it.
		sc.pending = max(sc.pending-changesBefore, 0) + r.skipped
	case !errors.Is(err, errStopped):
		sc.lastError = sentence(err)
		log.Printf("sync: %v", err)
	}
	sc.mu.Unlock()
	if errors.Is(err, errStopped) {
		err = nil
	}
	for _, w := range waiters {
		w <- err
	}
}

// sentence makes an error fit the page's status line.
func sentence(err error) string {
	var se *serverError
	switch {
	case errors.Is(err, errRevoked):
		return errRevoked.Error()
	case errors.Is(err, context.DeadlineExceeded):
		return "The sync took too long and was stopped; it continues next time."
	case errors.As(err, &se):
		return fmt.Sprintf("The server refused a sync step: %s", se.Error())
	}
	return err.Error()
}

// syncOnce is one sync run with the connection c: structure, then every
// scope, saving the base after each step so an interrupted run keeps what
// it reconciled. The run carries the counts and problems for the status.
func (s *Service) syncOnce(ctx context.Context, c *credentials) (*run, error) {
	sc := &s.sched
	sc.mu.Lock()
	h, user, folder, home := sc.local, sc.localUser, sc.folder, sc.home
	sc.mu.Unlock()
	if h == nil {
		return nil, errNoEngine
	}
	server, err := ParseServer(c.Server)
	if err != nil {
		return nil, err
	}
	dir := s.host.StateDir()
	st, err := loadState(dir, stateKey(c.Device.ID, user, folder))
	if err != nil {
		return nil, err
	}
	remote := remoteSide{s: s, server: server, token: c.Token}
	local := side(localSide{h: h, user: user})
	if s.localHook != nil {
		local = s.localHook(local)
	}
	r := &run{ctx: ctx, local: local, remote: remote, st: st, now: s.now,
		rekey: func(spaces, vaults map[string]string) error { return h.SyncRekey(user, spaces, vaults) }}
	save := func() error {
		if cur, err := s.current(); err != nil || cur == nil || cur.Token != c.Token {
			return errStopped
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return st.save(dir)
	}
	R, err := remote.Structure(ctx)
	if err != nil {
		return r, err
	}
	if reason := restored(st.LastSyncAt, home, R.Device); reason != "" {
		// The base describes data one side no longer has: reading the
		// restored side against it would undo everything since. Merge
		// without a base instead (nothing is deleted, differing notes
		// become offline copies), keeping the alignment.
		log.Printf("sync: %s; merging without the last sync's state", reason)
		fresh := newSyncState(st.Key)
		fresh.Aligned, fresh.LastSyncAt = st.Aligned, st.LastSyncAt
		*st = *fresh
		r.union = true
	}
	scopes, err := r.structure(R)
	if err != nil {
		return r, err
	}
	if err := save(); err != nil {
		return r, err
	}
	for _, scope := range scopes {
		if err := r.syncScope(scope); err != nil {
			return r, err
		}
		if err := save(); err != nil {
			return r, err
		}
	}
	// Scopes that no longer exist on the device keep no base.
	live := map[string]bool{}
	for _, scope := range scopes {
		live[scope] = true
	}
	for id := range st.Scopes {
		if !live[id] {
			delete(st.Scopes, id)
		}
	}
	if err := save(); err != nil {
		return r, err
	}
	at, err := remote.done(ctx)
	if errors.Is(err, errRevoked) {
		return r, err
	}
	if err != nil {
		// The server may have recorded the run anyway (the answer got
		// lost); the next run then merges once without a base.
		log.Printf("sync: recording the sync on the server: %v", err)
		return r, nil
	}
	// The state first, then the folder: a crash in between leaves them
	// disagreeing, which only costs one merge without a base.
	st.LastSyncAt = at.UTC().Format(time.RFC3339Nano)
	if err := save(); err != nil {
		return r, err
	}
	if err := writeLastSync(home, st.LastSyncAt); err != nil {
		log.Printf("sync: %v", err)
	}
	return r, nil
}

// lastSyncFile is where the data folder remembers its last complete sync.
func lastSyncFile(home string) string { return filepath.Join(home, ".nexote", "last-sync") }

func writeLastSync(home, at string) error {
	if home == "" {
		return nil
	}
	p := lastSyncFile(home)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, []byte(at+"\n"), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// restored explains why the data folder or the server no longer matches
// the last complete sync (last, from the state), "" when both do or there
// was none yet. A folder or server restored from an older backup carries an
// older (or no) record of it.
func restored(last, home string, device *api.SyncDevice) string {
	if last == "" {
		return ""
	}
	want, err := time.Parse(time.RFC3339Nano, last)
	if err != nil {
		return "unreadable last sync time in the state"
	}
	if home != "" {
		data, err := os.ReadFile(lastSyncFile(home))
		folder, perr := time.Parse(time.RFC3339Nano, strings.TrimSpace(string(data)))
		if err != nil || perr != nil || !folder.Equal(want) {
			return "the data folder doesn't match the last sync (restored from a backup?)"
		}
	}
	if device != nil && !device.LastSyncAt.Equal(want) {
		return "the server doesn't match the last sync (restored from a backup?)"
	}
	return ""
}

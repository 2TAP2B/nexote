package serversync

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// The engine keeps one connection to the server's change stream
// (GET /api/sync/events) while it is paired, and starts a sync whenever the
// server announces a change. Without it a change on the server would reach
// the device only with the next regular sync (syncInterval).

var (
	// listenBackoffMin and listenBackoffMax bound the wait before
	// reconnecting a dropped stream; it doubles per failed attempt.
	listenBackoffMin = time.Second
	listenBackoffMax = 30 * time.Second
	// listenReadTimeout ends a stream that sent nothing for this long; the
	// server's heartbeat comes every 20 s.
	listenReadTimeout = 90 * time.Second
)

// relisten makes the listener drop its connection and look at the pairing
// again (after pairing or disconnecting).
func (s *Service) relisten() {
	sc := &s.sched
	sc.mu.Lock()
	cancel, wake := sc.listenCancel, sc.listenWake
	sc.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if wake != nil {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
}

// listen runs until quit closes: connected while paired, reconnecting with
// backoff, idle (until relisten) while not paired or revoked.
func (s *Service) listen(quit <-chan struct{}, wake <-chan struct{}) {
	sc := &s.sched
	backoff := listenBackoffMin
	connectedBefore := false
	// wait sleeps d (0: until woken); false means quit, woken a new look at
	// the pairing (relisten), which starts the backoff over.
	wait := func(d time.Duration) (ok, woken bool) {
		var timer <-chan time.Time
		if d > 0 {
			t := time.NewTimer(d)
			defer t.Stop()
			timer = t.C
		}
		select {
		case <-quit:
			return false, false
		case <-wake:
			return true, true
		case <-timer:
			return true, false
		}
	}
	for {
		select {
		case <-quit:
			return
		default:
		}
		c, err := s.current()
		if err != nil || c == nil || c.Revoked {
			connectedBefore, backoff = false, listenBackoffMin
			if ok, _ := wait(0); !ok {
				return
			}
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		sc.mu.Lock()
		sc.listenCancel = cancel
		select {
		case <-quit:
			// Close ran in between; it closes quit under this lock.
			cancel()
		default:
		}
		sc.mu.Unlock()
		connected, err := s.stream(ctx, c, connectedBefore)
		// Cancelled from outside (relisten, Close): no error to report.
		stopped := ctx.Err() != nil
		cancel()
		sc.mu.Lock()
		sc.listenCancel = nil
		sc.mu.Unlock()
		if errors.Is(err, errRevoked) {
			s.update(c.Token, func(next *credentials) { next.Revoked = true })
			log.Printf("sync: change stream: %v", err)
			continue
		}
		if connected {
			connectedBefore, backoff = true, listenBackoffMin
		}
		if !stopped {
			log.Printf("sync: change stream dropped (%v); reconnecting in %s", err, backoff)
		}
		ok, woken := wait(backoff)
		if !ok {
			return
		}
		if woken {
			connectedBefore, backoff = false, listenBackoffMin
		} else {
			backoff = min(backoff*2, listenBackoffMax)
		}
	}
}

// stream holds one connection to the change stream and kicks a sync for
// every event. It reports whether the connection was established. A
// reconnect also kicks one: changes may have happened while it was down.
func (s *Service) stream(ctx context.Context, c *credentials, reconnect bool) (bool, error) {
	server, err := ParseServer(c.Server)
	if err != nil {
		return false, err
	}
	// Nothing heard for listenReadTimeout (heartbeats included): the
	// connection is dead even if TCP doesn't know yet.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	deadline := time.AfterFunc(listenReadTimeout, cancel)
	defer deadline.Stop()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.String()+"/api/sync/events", nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Accept", "text/event-stream")
	res, err := s.streamClient().Do(req)
	if err != nil {
		return false, describeError(server, err)
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusUnauthorized:
		return false, errRevoked
	case res.StatusCode != http.StatusOK:
		return false, fmt.Errorf("%s answered %d", server.Host, res.StatusCode)
	}
	sc := &s.sched
	sc.mu.Lock()
	sc.listening = true
	sc.mu.Unlock()
	defer func() {
		sc.mu.Lock()
		sc.listening = false
		sc.mu.Unlock()
	}()
	if reconnect {
		s.SyncNow()
	}
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	event := false
	for scanner.Scan() {
		deadline.Reset(listenReadTimeout)
		line := scanner.Text()
		switch {
		case line == "":
			// An event ends with a blank line; comments (heartbeats) alone
			// don't make one.
			if event {
				s.SyncNow()
			}
			event = false
		case strings.HasPrefix(line, "event:"), strings.HasPrefix(line, "data:"):
			event = true
		}
	}
	if err := scanner.Err(); err != nil {
		return true, err
	}
	return true, errors.New("the server closed the stream")
}

// streamClient is the HTTP client for the change stream: the usual
// transport (connect and TLS limits), but no limit on the whole request,
// which lasts as long as the connection.
func (s *Service) streamClient() *http.Client {
	c := *s.httpClient()
	c.Timeout = 0
	return &c
}

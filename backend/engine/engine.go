// Package engine runs Nexote on one device: the API in local mode (no login,
// one user) plus the frontend's static export, served on 127.0.0.1 behind a
// secret cookie. The gomobile facade (package mobile) and the desktop runner
// (cmd/nexote-local) are thin wrappers around Start.
package engine

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"nexote/api"
	"nexote/engine/serversync"
	"nexote/server"
)

// CookieName is the cookie every request must carry with the secret. Other
// apps on the device can reach 127.0.0.1 too; only the WebView that was
// handed the secret gets in.
const CookieName = "nexote_engine"

// Config is what an engine serves and where.
type Config struct {
	// Home is the data folder, created if missing.
	Home string
	// Port is the preferred port on 127.0.0.1; 0 or a busy port means any
	// free one.
	Port int
	// Secret is the required value of the CookieName cookie.
	Secret string
	// Web holds the frontend's static export (index.html at its root).
	Web fs.FS
	// Host keeps the server connection's secrets and names the device;
	// nil keeps them in memory for the engine's lifetime.
	Host serversync.Host
	// UserCAs is a PEM bundle of user-installed CAs trusted (besides the
	// system roots) when talking to a Nexote server.
	UserCAs string
}

// Engine is a running engine.
type Engine struct {
	home    string
	port    int
	handler *api.Handler
	remote  *serversync.Service
	srv     *http.Server
	done    chan struct{}
	stop    sync.Once
}

// shutdownGrace bounds how long Stop waits for requests in flight.
const shutdownGrace = 5 * time.Second

// Start opens the data folder in local mode and serves it until Stop. The
// folder is fully prepared before the first request is accepted.
func Start(cfg Config) (*Engine, error) {
	if cfg.Secret == "" {
		return nil, errors.New("engine: a secret is required")
	}
	if cfg.Home == "" {
		return nil, errors.New("engine: a data folder is required")
	}
	if cfg.Web == nil {
		return nil, errors.New("engine: a web export is required")
	}
	home, err := filepath.Abs(cfg.Home)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(home, 0o755); err != nil {
		return nil, fmt.Errorf("data folder: %w", err)
	}
	ln, err := listen(cfg.Port)
	if err != nil {
		return nil, err
	}
	addr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		ln.Close()
		return nil, fmt.Errorf("engine: unexpected listener address %v", ln.Addr())
	}
	// The page is opened at exactly this origin, so the API's check of
	// changing requests accepts it and nothing else.
	origin := &url.URL{Scheme: "http", Host: net.JoinHostPort("127.0.0.1", strconv.Itoa(addr.Port))}
	h, err := server.Open(home, origin, server.Options{Local: true})
	if err != nil {
		ln.Close()
		return nil, err
	}
	host := cfg.Host
	if host == nil {
		host = serversync.NewMemoryHost("Nexote engine")
	}
	remote := serversync.New(host, cfg.UserCAs)

	base, cancel := context.WithCancel(context.Background())
	srv := &http.Server{
		Handler:           newHandler(h.Routes(), remote.Handler(), cfg.Web, cfg.Secret, origin.String()),
		ReadHeaderTimeout: 10 * time.Second,
		// Request contexts derive from base, so cancelling it at shutdown
		// ends the long-lived /api/events streams, which Shutdown would
		// otherwise wait for until its deadline.
		BaseContext: func(net.Listener) context.Context { return base },
	}
	srv.RegisterOnShutdown(cancel)
	e := &Engine{home: home, port: addr.Port, handler: h, remote: remote, srv: srv, done: make(chan struct{})}
	go func() {
		defer close(e.done)
		defer cancel()
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("engine: %v", err)
		}
	}()
	return e, nil
}

// listen binds 127.0.0.1 on port, falling back to any free port.
func listen(port int) (net.Listener, error) {
	if port > 0 {
		if ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port))); err == nil {
			return ln, nil
		}
	}
	return net.Listen("tcp", "127.0.0.1:0")
}

// Port is the port the engine listens on.
func (e *Engine) Port() int { return e.port }

// Home is the absolute data folder.
func (e *Engine) Home() string { return e.home }

// SetUserCAs replaces the user-installed CAs trusted for server
// connections (they can change while the engine runs).
func (e *Engine) SetUserCAs(pem string) { e.remote.SetUserCAs(pem) }

// Stop shuts the engine down gracefully and returns once the port is free
// and the folder's background work (git sync) has ended. Safe to call more
// than once.
func (e *Engine) Stop() {
	e.stop.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()
		if err := e.srv.Shutdown(ctx); err != nil {
			e.srv.Close()
		}
		<-e.done
		e.handler.Close()
	})
}

// newHandler gates everything behind the secret cookie, then sends
// /api/local/* to the engine's own routes (the server connection), the rest
// of /api/* to the API and everything else to the frontend export. It never
// wraps the ResponseWriter, so the SSE stream keeps its Flusher.
func newHandler(api, local http.Handler, web fs.FS, secret, origin string) http.Handler {
	static := newStatic(web)
	want := []byte(secret)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(CookieName)
		if err != nil || subtle.ConstantTimeCompare([]byte(c.Value), want) != 1 {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/local/") {
			// The API's rule for changes: only from the page's own origin.
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				if o := r.Header.Get("Origin"); o != "" && o != origin {
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}
			}
			local.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		static.ServeHTTP(w, r)
	})
}

// Package mobile is the gomobile-bindable face of the engine for the Android
// app (Kotlin: app.nexote.mobile.Mobile). Its exported API uses only types
// gomobile can bind.
//
// web/ holds the frontend's static export, embedded into the library.
// android/build-engine.sh fills it from frontend/out before running gomobile
// bind; in git it only holds its .gitignore, which keeps desktop builds of
// ./... working (the engine then serves no pages).
package mobile

import (
	"embed"
	"errors"
	"io/fs"
	"log"
	"path/filepath"
	"sync"
	"time"

	"nexote/engine"
	"nexote/engine/serversync"
)

//go:embed all:web
var embedded embed.FS

var (
	// mu serializes Start and Stop: the app may call them from different
	// threads (activity lifecycle, folder picker).
	mu      sync.Mutex
	running *engine.Engine
	// runningSecret is the running engine's cookie secret.
	runningSecret string
)

// Host is implemented by the app (Kotlin: app.nexote.mobile.Host). It keeps
// the server connection's secrets outside the data folder, which is
// user-visible and may be copied by other sync tools.
type Host interface {
	// LoadSecret returns the secret saved under name, "" if none.
	LoadSecret(name string) (string, error)
	// SaveSecret saves value under name; "" deletes it.
	SaveSecret(name, value string) error
	// DeviceName names this device in the server's list, e.g. "Google Pixel 8".
	DeviceName() string
	// StateDir is the absolute path of an existing app-private directory
	// for the sync state (never the user-visible data folder).
	StateDir() string
}

var (
	// hostMu guards host and userCAs, which the app sets from any thread.
	hostMu  sync.Mutex
	host    Host
	userCAs string
	// fallback keeps secrets for the process's lifetime when no host was
	// set (tests, desktop builds of the package).
	fallback = serversync.NewMemoryHost("Android device")
)

// SetHost sets the app's Host; call it before Start. A running engine uses
// the new host from its next call on.
func SetHost(h Host) {
	hostMu.Lock()
	defer hostMu.Unlock()
	host = h
}

// SetUserCAs sets the PEM bundle of user-installed CAs, trusted besides the
// system roots for server connections; call it before Start. A running
// engine picks it up at once (the user may have installed a CA meanwhile).
func SetUserCAs(pem string) {
	hostMu.Lock()
	userCAs = pem
	hostMu.Unlock()
	mu.Lock()
	defer mu.Unlock()
	if running != nil {
		running.SetUserCAs(pem)
	}
}

func currentUserCAs() string {
	hostMu.Lock()
	defer hostMu.Unlock()
	return userCAs
}

// currentHost hands each call to the host set last, so engines keep working
// across SetHost calls (a recreated activity sets a new one).
type currentHost struct{}

func (currentHost) get() serversync.Host {
	hostMu.Lock()
	defer hostMu.Unlock()
	if host != nil {
		return host
	}
	return fallback
}

func (h currentHost) LoadSecret(name string) (string, error) { return h.get().LoadSecret(name) }
func (h currentHost) SaveSecret(name, value string) error    { return h.get().SaveSecret(name, value) }
func (h currentHost) DeviceName() string                     { return h.get().DeviceName() }
func (h currentHost) StateDir() string                       { return h.get().StateDir() }

// Start serves the data folder home on 127.0.0.1 and returns the port.
// port is the preferred port (0 or busy: any free one). With home already
// running it returns the running port; a different home (or secret)
// restarts the engine on the same port when possible. If home can't be
// used, the previous engine keeps running and Start returns the error.
func Start(home string, port int, secret string) (int, error) {
	mu.Lock()
	defer mu.Unlock()
	return start(home, port, secret)
}

// start is Start with mu held.
func start(home string, port int, secret string) (int, error) {
	abs, err := filepath.Abs(home)
	if err != nil {
		return 0, err
	}
	web, err := fs.Sub(embedded, "web")
	if err != nil {
		return 0, err
	}
	prev, prevSecret := running, runningSecret
	if prev != nil {
		if prev.Home() == abs && prevSecret == secret {
			return prev.Port(), nil
		}
		// The page reloads after a folder change; keeping the port keeps
		// its origin, and with it the WebView's storage and cookie.
		port = prev.Port()
		prev.Stop()
		running, runningSecret = nil, ""
	}
	e, err := engine.Start(config(abs, port, secret, web))
	if err != nil {
		if prev != nil {
			restored, rerr := engine.Start(config(prev.Home(), prev.Port(), prevSecret, web))
			if rerr != nil {
				log.Printf("engine: restart %s: %v", prev.Home(), rerr)
			} else {
				running, runningSecret = restored, prevSecret
			}
		}
		return 0, err
	}
	running, runningSecret = e, secret
	return e.Port(), nil
}

func config(home string, port int, secret string, web fs.FS) engine.Config {
	return engine.Config{Home: home, Port: port, Secret: secret, Web: web, Host: currentHost{}, UserCAs: currentUserCAs()}
}

// StartIfIdle returns the running engine's port, leaving it alone (whatever
// folder it serves), or starts one like Start when none runs. The app's
// background worker uses it: it must never switch the folder under an open
// page.
func StartIfIdle(home string, port int, secret string) (int, error) {
	mu.Lock()
	defer mu.Unlock()
	if running != nil {
		return running.Port(), nil
	}
	return start(home, port, secret)
}

// Stop shuts the engine down; it does nothing when none runs.
func Stop() {
	mu.Lock()
	defer mu.Unlock()
	if running != nil {
		running.Stop()
		running, runningSecret = nil, ""
	}
}

// SyncNow starts a sync with the paired server without waiting (the app
// calls it on resume); it does nothing when not paired or not running.
func SyncNow() {
	mu.Lock()
	defer mu.Unlock()
	if running != nil {
		running.SyncNow()
	}
}

// SyncNowWait syncs with the paired server and blocks until that sync
// finished, at most timeoutSeconds (the app's periodic background job).
// Returns nil at once when not paired, an error when the sync failed, timed
// out or the engine isn't running.
func SyncNowWait(timeoutSeconds int) error {
	mu.Lock()
	e := running
	mu.Unlock()
	if e == nil {
		return errors.New("the engine isn't running")
	}
	// Not under mu: a sync may take a while, and Start/Stop must not wait
	// for it (Stop ends a running sync).
	return e.SyncNowWait(time.Duration(timeoutSeconds) * time.Second)
}

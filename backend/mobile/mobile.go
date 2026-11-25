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
	"io/fs"
	"log"
	"path/filepath"
	"sync"

	"nexote/engine"
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

// Start serves the data folder home on 127.0.0.1 and returns the port.
// port is the preferred port (0 or busy: any free one). With home already
// running it returns the running port; a different home (or secret)
// restarts the engine on the same port when possible. If home can't be
// used, the previous engine keeps running and Start returns the error.
func Start(home string, port int, secret string) (int, error) {
	mu.Lock()
	defer mu.Unlock()
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
	e, err := engine.Start(engine.Config{Home: abs, Port: port, Secret: secret, Web: web})
	if err != nil {
		if prev != nil {
			restored, rerr := engine.Start(engine.Config{Home: prev.Home(), Port: prev.Port(), Secret: prevSecret, Web: web})
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

// Stop shuts the engine down; it does nothing when none runs.
func Stop() {
	mu.Lock()
	defer mu.Unlock()
	if running != nil {
		running.Stop()
		running, runningSecret = nil, ""
	}
}

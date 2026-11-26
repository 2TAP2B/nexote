// Command nexote-local runs the Android app's engine on a desktop for
// development: the API in local mode plus a frontend static export, on
// 127.0.0.1. Build the export with `NEXOTE_EXPORT=1 pnpm build` in frontend/.
// The server connection (pairing) is kept in a 0600 JSON file next to the
// data folder, standing in for the app's encrypted secret store.
//
//	go run ./cmd/nexote-local -home /tmp/nexote-local -secret dev
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"nexote/engine"
)

func main() {
	home := flag.String("home", "", "data folder (required; created if missing)")
	port := flag.Int("port", 8092, "preferred port on 127.0.0.1 (busy: any free one)")
	secret := flag.String("secret", "", "value every request must send in the "+engine.CookieName+" cookie (required)")
	web := flag.String("web", "../frontend/out", "directory holding the frontend's static export")
	secrets := flag.String("secrets", "", "file keeping the server connection (default: <home>.secrets.json)")
	deviceName := flag.String("device-name", "Desktop engine", "name of this device in the server's device list")
	caFile := flag.String("ca", "", "PEM file of extra CAs to trust for the server connection (like user-installed CAs on a phone)")
	flag.Parse()
	if *home == "" || *secret == "" {
		fmt.Fprintln(os.Stderr, "nexote-local: -home and -secret are required")
		flag.Usage()
		os.Exit(2)
	}
	if info, err := os.Stat(*web); err != nil || !info.IsDir() {
		log.Fatalf("no frontend export at %s (build it with NEXOTE_EXPORT=1 pnpm build, or pass -web)", *web)
	}
	absHome, err := filepath.Abs(*home)
	if err != nil {
		log.Fatal(err)
	}
	if *secrets == "" {
		// Next to the folder, not in it: the data folder is what users
		// look at and copy around.
		*secrets = absHome + ".secrets.json"
	}
	var userCAs []byte
	if *caFile != "" {
		if userCAs, err = os.ReadFile(*caFile); err != nil {
			log.Fatal(err)
		}
	}

	e, err := engine.Start(engine.Config{
		Home:    absHome,
		Port:    *port,
		Secret:  *secret,
		Web:     os.DirFS(*web),
		Host:    &fileHost{path: *secrets, name: *deviceName},
		UserCAs: string(userCAs),
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("nexote engine on http://127.0.0.1:%d (home: %s, web: %s)", e.Port(), e.Home(), *web)
	log.Printf("every request needs the cookie %s=%s; in a browser run document.cookie = %q in the console, then reload",
		engine.CookieName, *secret, engine.CookieName+"="+*secret+"; path=/")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	e.Stop()
}

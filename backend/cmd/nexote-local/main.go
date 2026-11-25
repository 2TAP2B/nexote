// Command nexote-local runs the Android app's engine on a desktop for
// development: the API in local mode plus a frontend static export, on
// 127.0.0.1. Build the export with `NEXOTE_EXPORT=1 pnpm build` in frontend/.
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
	"syscall"

	"nexote/engine"
)

func main() {
	home := flag.String("home", "", "data folder (required; created if missing)")
	port := flag.Int("port", 8092, "preferred port on 127.0.0.1 (busy: any free one)")
	secret := flag.String("secret", "", "value every request must send in the "+engine.CookieName+" cookie (required)")
	web := flag.String("web", "../frontend/out", "directory holding the frontend's static export")
	flag.Parse()
	if *home == "" || *secret == "" {
		fmt.Fprintln(os.Stderr, "nexote-local: -home and -secret are required")
		flag.Usage()
		os.Exit(2)
	}
	if info, err := os.Stat(*web); err != nil || !info.IsDir() {
		log.Fatalf("no frontend export at %s (build it with NEXOTE_EXPORT=1 pnpm build, or pass -web)", *web)
	}

	e, err := engine.Start(engine.Config{Home: *home, Port: *port, Secret: *secret, Web: os.DirFS(*web)})
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

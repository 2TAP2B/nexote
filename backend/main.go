// Command nexote serves the notes REST API. Notes are stored as markdown files
// with YAML frontmatter in the directory named by NEXOTE_NOTES_DIR (default
// ".notes-dev"). The server listens on NEXOTE_PORT (default "8080").
package main

import (
	"log"
	"net/http"
	"os"

	"nexote/api"
	"nexote/notes"
)

func main() {
	dir := os.Getenv("NEXOTE_NOTES_DIR")
	if dir == "" {
		dir = ".notes-dev"
	}
	port := os.Getenv("NEXOTE_PORT")
	if port == "" {
		port = "8080"
	}

	store, err := notes.NewStore(dir)
	if err != nil {
		log.Fatalf("init notes store: %v", err)
	}

	h := api.New(store)
	addr := ":" + port
	log.Printf("nexote backend listening on http://localhost%s (notes dir: %s)", addr, dir)
	if err := http.ListenAndServe(addr, h.Routes()); err != nil {
		log.Fatalf("server: %v", err)
	}
}
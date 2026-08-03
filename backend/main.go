// Command nexote serves the notes REST API. Notes are stored as markdown files
// with YAML frontmatter inside vaults. Each vault is a subdirectory under
// ~/.nexote/vaults/. The server listens on NEXOTE_PORT (default "8080").
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"nexote/api"
	"nexote/notes"
)

func main() {
	// Determine the nexote config root: ~/.nexote by default, override with
	// NEXOTE_HOME.
	home := os.Getenv("NEXOTE_HOME")
	if home == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			log.Fatalf("find home dir: %v", err)
		}
		home = filepath.Join(userHome, ".nexote")
	}

	port := os.Getenv("NEXOTE_PORT")
	if port == "" {
		port = "8080"
	}

	registry, err := notes.NewVaultRegistry(home)
	if err != nil {
		log.Fatalf("init vault registry: %v", err)
	}

	h := api.New(registry)
	addr := ":" + port
	log.Printf("nexote backend listening on http://localhost%s (home: %s)", addr, home)
	if err := http.ListenAndServe(addr, h.Routes()); err != nil {
		log.Fatalf("server: %v", err)
	}
}
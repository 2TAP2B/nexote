// Command nexote serves the notes REST API. Notes are stored as markdown files
// with YAML frontmatter inside vaults. Each vault is a subdirectory under
// ~/.nexote/vaults/. The server listens on NEXOTE_PORT (default "8080").
package main

import (
	"fmt"
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

	// Ensure a dedicated "Collections" vault exists. All collections live
	// inside it as folders; the collection definitions are stored in
	// collections.json at the vault root.
	collectionsVaultID := ensureVault(registry, "Collections", "Folder")

	collectionsDir := filepath.Join(home, "collections")
	h := api.New(registry, filepath.Join(home, "journal"), collectionsDir)

	// Migrate legacy type:vinyl notes into a "Vinyls" collection.
	migrateVinyls(registry, h.Collections, collectionsVaultID)

	addr := ":" + port
	log.Printf("nexote backend listening on http://localhost%s (home: %s)", addr, home)
	if err := http.ListenAndServe(addr, h.Routes()); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// ensureVault creates a vault by name if it doesn't exist and returns its id.
func ensureVault(registry *notes.VaultRegistry, name, icon string) string {
	if _, err := registry.Create(name, icon); err == nil {
		// Created fresh — look it up.
	} else {
		// Already exists — look it up.
	}
	vaults, err := registry.List()
	if err != nil {
		log.Fatalf("list vaults: %v", err)
	}
	for _, v := range vaults {
		if v.Name == name {
			return v.ID
		}
	}
	return ""
}

// migrateVinyls converts legacy type:vinyl notes (from the earlier hardcoded
// vinyl feature) into a "Vinyls" collection. It creates the collection
// definition and re-tags each vinyl note with collection=vinyls, mapping the
// old artist/year/genre/wantlist fields into the generic fields map.
func migrateVinyls(registry *notes.VaultRegistry, cr *notes.CollectionRegistry, collectionsVaultID string) {
	if cr == nil || collectionsVaultID == "" {
		return
	}
	// Create the Vinyls collection if it doesn't exist.
	cols, err := cr.List()
	if err != nil {
		return
	}
	hasVinyls := false
	for _, c := range cols {
		if c.ID == "vinyls" {
			hasVinyls = true
			break
		}
	}
	if !hasVinyls {
		if _, err := cr.Create("Vinyls", "Music", []notes.CollectionField{
			{Key: "artist", Label: "Artist", Type: notes.FieldText},
			{Key: "year", Label: "Year", Type: notes.FieldNumber},
			{Key: "genre", Label: "Genre", Type: notes.FieldText},
			{Key: "wantlist", Label: "Wantlist", Type: notes.FieldBoolean},
		}); err != nil {
			return
		}
	}

	// Find all type:vinyl notes across all vaults and re-tag them.
	vaults, err := registry.List()
	if err != nil {
		return
	}
	for _, v := range vaults {
		store, err := registry.Store(v.ID)
		if err != nil {
			continue
		}
		list, err := store.List()
		if err != nil {
			continue
		}
		for _, e := range list.Notes {
			if e.Type != "vinyl" {
				continue
			}
			fields := map[string]string{}
			if e.Artist != "" {
				fields["artist"] = e.Artist
			}
			if e.Year != 0 {
				fields["year"] = fmt.Sprintf("%d", e.Year)
			}
			if e.Genre != "" {
				fields["genre"] = e.Genre
			}
			if e.Wantlist != nil {
				fields["wantlist"] = fmt.Sprintf("%t", *e.Wantlist)
			}
			_, _ = store.Update(e.ID, notes.UpdateInput{
				Type:       strPtr("collection-item"),
				Collection: strPtr("vinyls"),
				Fields:     fields,
			})
		}
	}
}

func strPtr(s string) *string { return &s }
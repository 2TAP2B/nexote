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
	collectionsVaultID := ensureVault(registry, "Collections", "Folder", notes.VaultTypeCollections)

	collectionsDir := filepath.Join(home, "collections")
	h := api.New(registry, filepath.Join(home, "journal"), collectionsDir)
	if collectionsVaultID != "" {
		if cs, err := registry.Store(collectionsVaultID); err == nil {
			h.CollectionsStore = cs
		}
	}

	// Ensure the built-in collections (Vinyls, Books) exist with up-to-date
	// schemas. Never touches user collections or hidden/pinned flags.
	if h.Collections != nil {
		if err := h.Collections.EnsureBuiltIns(); err != nil {
			log.Printf("ensure built-in collections: %v", err)
		}
	}

	// Load the metadata lookup config (Discogs token). The handlers read the
	// file per request, so no in-memory wiring is needed here.
	if mdCfg, err := api.LoadMetadataConfig(home); err == nil && mdCfg.DiscogsToken != "" {
		log.Printf("metadata lookup: discogs token configured")
	}

	// Load git-sync config and attach to all stores if enabled.
	gitCfg, err := notes.LoadGitConfig(home)
	if err != nil {
		log.Printf("git config: %v", err)
	}
	if gitCfg.Enabled {
		gs := notes.NewGitSync(home, gitCfg)
		h.GitSync = gs
		// The registry attaches the hook to every vault store it hands out.
		registry.SetGitSync(gs)
		if h.JournalStore != nil {
			h.JournalStore.SetGitSync(gs)
		}
		if h.CollectionsStore != nil {
			h.CollectionsStore.SetGitSync(gs)
		}
		log.Printf("git sync enabled (remote: %s, branch: %s)", gitCfg.Remote, gitCfg.Branch)
	}

	// Migrate legacy type:vinyl notes into a "Vinyls" collection.
	migrateVinyls(registry, h.Collections, collectionsVaultID)

	// Ensure every registered collection has a matching folder in the
	// Collections vault, so collections created before this fix appear too.
	if h.CollectionsStore != nil && h.Collections != nil {
		if cols, cerr := h.Collections.List(); cerr == nil {
			for _, c := range cols {
				if c.Name != "" {
					_ = h.CollectionsStore.CreateFolder(c.Name)
				}
			}
		}
	}

	// Name every note file after its title. Migrates the legacy "<id>.md"
	// layout once; afterwards it only fixes names changed outside the app.
	normalizeNoteFileNames(registry, h.JournalStore)

	addr := ":" + port
	log.Printf("nexote backend listening on http://localhost%s (home: %s)", addr, home)
	if err := http.ListenAndServe(addr, h.Routes()); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// normalizeNoteFileNames renames note files to their titles in every vault
// and the journal (see Store.NormalizeFileNames). Runs before the server
// listens, so no request can observe a half-renamed vault.
func normalizeNoteFileNames(registry *notes.VaultRegistry, journal *notes.Store) {
	var stores []*notes.Store
	vaults, err := registry.List()
	if err != nil {
		log.Printf("list vaults for file naming: %v", err)
	}
	for _, v := range vaults {
		if s, err := registry.Store(v.ID); err == nil {
			stores = append(stores, s)
		}
	}
	if journal != nil {
		stores = append(stores, journal)
	}
	renamed := 0
	for _, s := range stores {
		n, err := s.NormalizeFileNames()
		renamed += n
		if err != nil {
			log.Printf("name note files in %s: %v", s.Dir, err)
		}
	}
	if renamed > 0 {
		log.Printf("renamed %d note files to their titles", renamed)
	}
}

// ensureVault creates a vault by name if it doesn't exist and returns its id.
// When vaultType is non-empty the vault is tagged with it (idempotent), so
// preexisting vaults created before the type field are migrated too.
func ensureVault(registry *notes.VaultRegistry, name, icon, vaultType string) string {
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
			if vaultType != "" && v.Type != vaultType {
				if err := registry.SetType(v.ID, vaultType); err != nil {
					log.Printf("set vault type: %v", err)
				}
			}
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
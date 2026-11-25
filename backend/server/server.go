// Package server opens a Nexote data directory and returns the API handler
// for it. Both the network server (package main) and the on-device engine
// (package engine) start through Open, so their data handling can't drift
// apart.
package server

import (
	"fmt"
	"log"
	"net/url"
	"path/filepath"

	"nexote/accounts"
	"nexote/api"
	"nexote/notes"
)

// Options changes how Open sets up the handler.
type Options struct {
	// Local runs the API single-user: every request acts as the local user
	// (see api.Handler.StartLocalMode). The on-device engine uses it.
	Local bool
}

// Open prepares the data directory home (registries, accounts, legacy data,
// git sync, note file names) and returns the API handler serving it for
// browsers at origin. It runs before anything listens, so no request can
// observe a half-migrated directory.
func Open(home string, origin *url.URL, opts Options) (*api.Handler, error) {
	registry, err := notes.NewVaultRegistry(home)
	if err != nil {
		return nil, fmt.Errorf("init vault registry: %w", err)
	}
	spaces, err := notes.NewSpaceRegistry(home)
	if err != nil {
		return nil, fmt.Errorf("init spaces: %w", err)
	}
	accts, err := accounts.Open(filepath.Join(home, "auth"))
	if err != nil {
		return nil, fmt.Errorf("init accounts: %w", err)
	}

	// Until the first admin adopts it, data from before spaces existed keeps
	// its global layout: one Collections vault plus collections/collections.json.
	if len(spaces.List()) == 0 {
		if err := prepareLegacyCollections(registry, home); err != nil {
			return nil, err
		}
	}

	h, err := api.New(api.Config{
		Home:     home,
		Registry: registry,
		Spaces:   spaces,
		Accounts: accts,
		Origin:   origin,
	})
	if err != nil {
		return nil, fmt.Errorf("init api: %w", err)
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
		// The registry attaches the hook to every vault store it hands out;
		// the handler attaches it to each user's personal stores.
		registry.SetGitSync(gs)
		log.Printf("git sync enabled (remote: %s, branch: %s)", gitCfg.Remote, gitCfg.Branch)
	}

	// The local user must exist before the adoption below, which gives the
	// legacy data to the first admin.
	if opts.Local {
		if _, err := h.StartLocalMode(); err != nil {
			h.Close()
			return nil, fmt.Errorf("local user: %w", err)
		}
	}

	// Data from before accounts existed belongs to the first admin.
	if err := h.AdoptLegacyData(); err != nil {
		log.Printf("adopt pre-account data: %v", err)
	}

	// Name every note file after its title. Migrates the legacy "<id>.md"
	// layout once; afterwards it only fixes names changed outside the app.
	normalizeNoteFileNames(registry, home)
	return h, nil
}

// prepareLegacyCollections keeps pre-spaces data consistent until it is
// adopted: the global Collections vault, the built-in collections and the
// legacy vinyl migration. Only an unreadable vault registry is an error;
// the rest is best-effort.
func prepareLegacyCollections(registry *notes.VaultRegistry, home string) error {
	collectionsVaultID, err := ensureVault(registry, "Collections", "Folder", notes.VaultTypeCollections)
	if err != nil {
		return err
	}
	cr, err := notes.NewCollectionRegistry(filepath.Join(home, "collections"))
	if err != nil {
		log.Printf("collections registry: %v", err)
		return nil
	}
	if err := cr.EnsureBuiltIns(); err != nil {
		log.Printf("ensure built-in collections: %v", err)
	}
	migrateVinyls(registry, cr, collectionsVaultID)
	// Every registered collection needs a folder in the Collections vault.
	if cs, err := registry.Store(collectionsVaultID); err == nil {
		if cols, err := cr.List(); err == nil {
			for _, c := range cols {
				if c.Name != "" {
					_ = cs.CreateFolder(c.Name)
				}
			}
		}
	}
	return nil
}

// normalizeNoteFileNames renames note files to their titles in every vault
// and every user's journal and home store (see Store.NormalizeFileNames).
// Runs before the server listens, so no request can observe a half-renamed
// vault.
func normalizeNoteFileNames(registry *notes.VaultRegistry, home string) {
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
	personal, _ := filepath.Glob(filepath.Join(home, "users", "*", "*"))
	for _, dir := range personal {
		if s, err := notes.NewStore(dir); err == nil {
			stores = append(stores, s)
		}
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

// ensureVault creates a legacy (space-less) vault by name if it doesn't
// exist and returns its id. When vaultType is non-empty the vault is tagged
// with it (idempotent), so preexisting vaults created before the type field
// are migrated too.
func ensureVault(registry *notes.VaultRegistry, name, icon, vaultType string) (string, error) {
	_, _ = registry.Create(name, icon, "") // fails harmlessly when it exists
	vaults, err := registry.List()
	if err != nil {
		return "", fmt.Errorf("list vaults: %w", err)
	}
	for _, v := range vaults {
		if v.Name == name && v.SpaceID == "" {
			if vaultType != "" && v.Type != vaultType {
				if err := registry.SetType(v.ID, vaultType); err != nil {
					log.Printf("set vault type: %v", err)
				}
			}
			return v.ID, nil
		}
	}
	return "", nil
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
			{Key: "wantlist", Label: "On my wantlist", Type: notes.FieldBoolean},
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

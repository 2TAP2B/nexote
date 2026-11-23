// Command nexote serves the notes REST API. Notes are stored as markdown files
// with YAML frontmatter inside vaults. Each vault is a subdirectory under
// ~/.nexote/vaults/ and belongs to a space; accounts live in ~/.nexote/auth.
// The server listens on NEXOTE_PORT (default "8080").
//
// Settings (environment):
//   - NEXOTE_HOME: data directory (default ~/.nexote)
//   - NEXOTE_PORT: listen port (default 8080)
//   - NEXOTE_PUBLIC_URL: the address people open in the browser, e.g.
//     https://notes.example.com (default http://localhost:3000). Passkeys
//     are bound to its host name.
//
// Maintenance: "nexote recover <username>" prints a single-use link that adds
// a passkey to an account (for someone who lost all their devices).
package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	"nexote/accounts"
	"nexote/api"
	"nexote/notes"
)

func main() {
	if len(os.Args) > 1 {
		os.Exit(runCommand(os.Args[1:]))
	}
	home := nexoteHome()
	origin := publicOrigin()

	port := os.Getenv("NEXOTE_PORT")
	if port == "" {
		port = "8080"
	}

	registry, err := notes.NewVaultRegistry(home)
	if err != nil {
		log.Fatalf("init vault registry: %v", err)
	}
	spaces, err := notes.NewSpaceRegistry(home)
	if err != nil {
		log.Fatalf("init spaces: %v", err)
	}
	accts, err := accounts.Open(filepath.Join(home, "auth"))
	if err != nil {
		log.Fatalf("init accounts: %v", err)
	}

	// Until the first admin adopts it, data from before spaces existed keeps
	// its global layout: one Collections vault plus collections/collections.json.
	if len(spaces.List()) == 0 {
		prepareLegacyCollections(registry, home)
	}

	h, err := api.New(api.Config{
		Home:     home,
		Registry: registry,
		Spaces:   spaces,
		Accounts: accts,
		Origin:   origin,
	})
	if err != nil {
		log.Fatalf("init api: %v", err)
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

	// Data from before accounts existed belongs to the first admin.
	if err := h.AdoptLegacyData(); err != nil {
		log.Printf("adopt pre-account data: %v", err)
	}

	// Name every note file after its title. Migrates the legacy "<id>.md"
	// layout once; afterwards it only fixes names changed outside the app.
	normalizeNoteFileNames(registry, home)

	addr := ":" + port
	log.Printf("nexote backend listening on http://localhost%s (home: %s, public URL: %s)", addr, home, origin)
	if code := h.SetupCode(); code != "" {
		log.Printf("No account exists yet. Open %s and create the admin account with the setup code: %s", origin, code)
	}
	if err := http.ListenAndServe(addr, h.Routes()); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// nexoteHome is the data directory: $NEXOTE_HOME or ~/.nexote.
func nexoteHome() string {
	if home := os.Getenv("NEXOTE_HOME"); home != "" {
		return home
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("find home dir: %v", err)
	}
	return filepath.Join(userHome, ".nexote")
}

// publicOrigin reads NEXOTE_PUBLIC_URL and warns when passkeys can't work
// with it.
func publicOrigin() *url.URL {
	raw := os.Getenv("NEXOTE_PUBLIC_URL")
	if raw == "" {
		raw = "http://localhost:3000"
	}
	origin, err := accounts.PublicOrigin(raw)
	if err != nil {
		log.Fatal(err)
	}
	host := origin.Hostname()
	if net.ParseIP(host) != nil {
		log.Printf("warning: NEXOTE_PUBLIC_URL %s uses an IP address; passkeys need a domain name (or localhost)", origin)
	} else if origin.Scheme != "https" && host != "localhost" {
		log.Printf("warning: NEXOTE_PUBLIC_URL %s is not https; browsers only allow passkeys over https (or on localhost)", origin)
	}
	return origin
}

// runCommand runs a maintenance subcommand and returns the exit code.
func runCommand(args []string) int {
	switch args[0] {
	case "recover":
		if len(args) != 2 {
			fmt.Fprintln(os.Stderr, "usage: nexote recover <username>")
			return 2
		}
		return recoverAccount(args[1])
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\nusage: nexote [recover <username>]\n", args[0])
		return 2
	}
}

// recoverAccount prints a single-use link that adds a passkey to the
// account, for someone (e.g. the only admin) who lost all their devices.
func recoverAccount(username string) int {
	accts, err := accounts.Open(filepath.Join(nexoteHome(), "auth"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	users, err := accts.Users()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, u := range users {
		if u.Username != accounts.NormalizeUsername(username) {
			continue
		}
		token, inv, err := accts.CreateInvite(accounts.Invite{Kind: accounts.InviteRecovery, UserID: u.ID}, api.RecoveryTTL)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		fmt.Printf("Recovery link for %s (single use, valid until %s):\n%s\n",
			u.Username, inv.ExpiresAt.Local().Format("2006-01-02 15:04"), api.InviteURL(publicOrigin(), token))
		if u.Disabled {
			fmt.Println("Note: this account is deactivated; an admin must reactivate it first.")
		}
		return 0
	}
	fmt.Fprintf(os.Stderr, "no account named %q\n", username)
	return 1
}

// prepareLegacyCollections keeps pre-spaces data consistent until it is
// adopted: the global Collections vault, the built-in collections and the
// legacy vinyl migration.
func prepareLegacyCollections(registry *notes.VaultRegistry, home string) {
	collectionsVaultID := ensureVault(registry, "Collections", "Folder", notes.VaultTypeCollections)
	cr, err := notes.NewCollectionRegistry(filepath.Join(home, "collections"))
	if err != nil {
		log.Printf("collections registry: %v", err)
		return
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
func ensureVault(registry *notes.VaultRegistry, name, icon, vaultType string) string {
	_, _ = registry.Create(name, icon, "") // fails harmlessly when it exists
	vaults, err := registry.List()
	if err != nil {
		log.Fatalf("list vaults: %v", err)
	}
	for _, v := range vaults {
		if v.Name == name && v.SpaceID == "" {
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
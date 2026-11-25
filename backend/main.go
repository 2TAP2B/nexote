// Command nexote serves the notes REST API. Notes are stored as markdown files
// with YAML frontmatter inside vaults. Each vault is a subdirectory under
// ~/.nexote/vaults/ and belongs to a space; accounts live in ~/.nexote/auth.
// The server listens on NEXOTE_PORT (default "8080"). Opening the data
// directory (registries, legacy data, git sync, file names) lives in package
// server, shared with the on-device engine.
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
	"nexote/server"
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

	h, err := server.Open(home, origin, server.Options{})
	if err != nil {
		log.Fatal(err)
	}

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

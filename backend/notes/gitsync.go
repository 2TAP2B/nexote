package notes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/storer"
	"github.com/go-git/go-git/v5/plumbing/transport"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
	gitssh "github.com/go-git/go-git/v5/plumbing/transport/ssh"
)

// GitConfig is the persisted git-sync configuration. It lives at
// <NEXOTE_HOME>/git.json (written 0600, since it may carry the remote
// credentials — required for timed auto-sync, which runs without a UI
// roundtrip).
type GitConfig struct {
	Enabled          bool   `json:"enabled"`
	Remote           string `json:"remote"`
	Branch           string `json:"branch"`
	AuthorName       string `json:"authorName"`
	AuthorEmail      string `json:"authorEmail"`
	IncludeImages    bool   `json:"includeImages"`
	AutoPush         bool   `json:"autoPush"`
	// AutoSyncMinutes: commit+push every N minutes (0 = off, clamped 1..60).
	AutoSyncMinutes  int    `json:"autoSyncMinutes,omitempty"`
	// Credentials — persisted so background sync can authenticate without
	// a settings roundtrip; git.json holds them at 0600.
	Username         string `json:"username,omitempty"`
	Password         string `json:"password,omitempty"`
	// ReadableNames: commit a mirror with vault/folder/titled file names
	// (.gitsync/ tree) instead of the cryptic internal <id>.md layout.
	ReadableNames    bool   `json:"readableNames,omitempty"`
}

var DefaultGitConfig = GitConfig{
	Enabled:       false,
	Branch:        "main",
	AuthorName:    "Nexote",
	AuthorEmail:   "nexote@localhost",
	IncludeImages: true,
}

func LoadGitConfig(root string) (GitConfig, error) {
	data, err := os.ReadFile(filepath.Join(root, "git.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultGitConfig, nil
		}
		return DefaultGitConfig, err
	}
	var cfg GitConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return DefaultGitConfig, nil
	}
	if cfg.Branch == "" {
		cfg.Branch = "main"
	}
	if cfg.AuthorName == "" {
		cfg.AuthorName = "Nexote"
	}
	if cfg.AuthorEmail == "" {
		cfg.AuthorEmail = "nexote@localhost"
	}
	if cfg.AutoSyncMinutes < 0 || cfg.AutoSyncMinutes > 60 {
		cfg.AutoSyncMinutes = 0
	}
	return cfg, nil
}

func SaveGitConfig(root string, cfg GitConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	// 0600: the file may hold the remote password/token.
	return os.WriteFile(filepath.Join(root, "git.json"), data, 0o600)
}

// GitCommitLog is a single commit entry for UI display.
type GitCommitLog struct {
	Hash    string    `json:"hash"`
	Message string    `json:"message"`
	Author  string    `json:"author"`
	When    time.Time `json:"when"`
}

// GitStatusInfo describes the repo's current state for the UI.
type GitStatusInfo struct {
	Enabled   bool   `json:"enabled"`
	HasRepo   bool   `json:"hasRepo"`
	Clean     bool   `json:"clean"`
	Ahead     int    `json:"ahead"`
	Behind     int    `json:"behind"`
	Branch    string `json:"branch"`
	Remote    string `json:"remote"`
	DirtyFiles int   `json:"dirtyFiles"`
}

// GitCredentials are passed per push/pull — never persisted.
type GitCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// GitSync manages a git repository at the given root. It is safe for
// concurrent use: commits are debounced so a burst of edits produces one
// commit, and push/pull are serialized by a mutex.
type GitSync struct {
	root string
	cfg  GitConfig

	mu            sync.Mutex
	commitMu      sync.Mutex
	repo          *git.Repository
	timer         *time.Timer
	autosyncTimer *time.Timer
}

// NewGitSync creates a GitSync for the given root. If a git repo already
// exists it is opened; otherwise it is created lazily on the first commit.
func NewGitSync(root string, cfg GitConfig) *GitSync {
	gs := &GitSync{root: root, cfg: cfg}
	if repo, err := git.PlainOpen(root); err == nil {
		gs.repo = repo
	}
	gs.scheduleAutoSync()
	return gs
}

// SetConfig updates the config and re-opens the repo if needed.
func (gs *GitSync) SetConfig(cfg GitConfig) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.cfg = cfg
	if repo, err := git.PlainOpen(gs.root); err == nil {
		gs.repo = repo
	} else {
		gs.repo = nil
	}
	// Mirror the configured URL into the repo's origin remote, so a URL
	// corrected in the settings (after the repo was initialized) is honored
	// instead of writes silently going to the stale original remote.
	if gs.repo != nil {
		_ = gs.ensureRemote()
	}
	// Keep the root .gitignore in step with the current mode (e.g. toggling
	// ReadableNames or the image include) without requiring a re-init.
	_ = gs.writeGitignoreLocked()
	gs.scheduleAutoSync()
}

// scheduleAutoSync restarts the periodic commit+push timer, matching the
// configured interval. Caller must hold gs.mu.
func (gs *GitSync) scheduleAutoSync() {
	if gs.autosyncTimer != nil {
		gs.autosyncTimer.Stop()
		gs.autosyncTimer = nil
	}
	if !gs.cfg.Enabled || gs.cfg.AutoSyncMinutes <= 0 {
		return
	}
	interval := time.Duration(gs.cfg.AutoSyncMinutes) * time.Minute
	gs.autosyncTimer = time.AfterFunc(interval, gs.runAutoSync)
}

// runAutoSync is the timer body: commit + push, then re-arm. It must not hold
// gs.mu across Commit/Push — both take the lock themselves, and holding it
// here deadlocked every later git call (manual push/pull spun forever).
func (gs *GitSync) runAutoSync() {
	gs.mu.Lock()
	enabled := gs.cfg.Enabled && gs.cfg.AutoSyncMinutes > 0
	gs.mu.Unlock()
	if enabled {
		_ = gs.Commit("Auto-sync from Nexote")
		_ = gs.Push(context.Background(), GitCredentials{})
	}
	gs.mu.Lock()
	gs.scheduleAutoSync()
	gs.mu.Unlock()
}

// ensureRemote makes the repo's origin match gs.cfg.Remote: creates it when
// missing and rewrites it when the URL changed. Caller must hold gs.mu.
func (gs *GitSync) ensureRemote() error {
	if gs.repo == nil || gs.cfg.Remote == "" {
		return nil
	}
	cfg, err := gs.repo.Config()
	if err != nil {
		return fmt.Errorf("read git config: %w", err)
	}
	remote := gs.cfg.Remote
	if cr, ok := cfg.Remotes["origin"]; ok && len(cr.URLs) > 0 && cr.URLs[0] == remote {
		return nil // already correct
	}
	if _, ok := cfg.Remotes["origin"]; ok {
		if err := gs.repo.DeleteRemote("origin"); err != nil {
			return fmt.Errorf("delete stale remote: %w", err)
		}
	}
	if _, err := gs.repo.CreateRemote(&config.RemoteConfig{
		Name: "origin",
		URLs: []string{remote},
	}); err != nil {
		return fmt.Errorf("create remote: %w", err)
	}
	return nil
}

// Config returns the current config.
func (gs *GitSync) Config() GitConfig {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	return gs.cfg
}

// InitRepo initializes a git repo at the root, creates a .gitignore, and
// makes the initial commit. If a repo already exists, it is opened instead.
func (gs *GitSync) InitRepo() error {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	if gs.repo != nil {
		return nil // already initialized
	}
	repo, err := git.PlainInit(gs.root, false)
	if err != nil {
		if err == git.ErrRepositoryAlreadyExists {
			repo, err = git.PlainOpen(gs.root)
			if err != nil {
				return fmt.Errorf("open repo: %w", err)
			}
		} else {
			return fmt.Errorf("init repo: %w", err)
		}
	}
	gs.repo = repo

	// Write .gitignore (exclude .history/ snapshots; optionally images).
	if err := gs.writeGitignoreLocked(); err != nil {
		return err
	}

	// Set remote if configured (also rewrites a stale/different origin).
	if err := gs.ensureRemote(); err != nil {
		return err
	}

	// Store the readable mirror tree (visible to git) when enabled.
	_ = gs.writeMirrorLocked()

	// Initial commit.
	return gs.commitLocked("Initial commit (Nexote)")
}

// mirrorDirName is the directory inside NEXOTE_HOME where the readable
// snapshot lives. When ReadableNames is enabled, .gitignore hides everything
// except this tree — the remote sees real vault/folder/note names instead of
// the internal <id>.md file layout.
const mirrorDirName = ".gitsync"

// writeMirrorLocked rebuilds .gitsync/ from the live vaults when
// ReadableNames is on; when it is off it removes a leftover mirror (and any
// stale .gitignore entries for it are gone after the next writeGitignore).
// Caller must hold gs.mu.
func (gs *GitSync) writeMirrorLocked() error {
	mirror := filepath.Join(gs.root, mirrorDirName)
	if !gs.cfg.ReadableNames {
		_ = os.RemoveAll(mirror)
		return nil
	}
	if err := os.RemoveAll(mirror); err != nil {
		return fmt.Errorf("clear mirror: %w", err)
	}
	if err := os.MkdirAll(mirror, 0o755); err != nil {
		return err
	}

	// Entries: vault dirs (from vaults.json) + the journal store dir.
	type src struct{ name, dir string }
	var sources []src
	// vaults.json may be a bare array (legacy) or {"vaults":[...]}.
	var arr []struct {
		Name string `json:"name"`
		Type string `json:"type"`
		Path string `json:"path"`
	}
	if data, err := os.ReadFile(filepath.Join(gs.root, "vaults.json")); err == nil {
		var ok bool
		if ok = json.Unmarshal(data, &arr) == nil; !ok {
			var wrapped struct {
				Vaults []struct {
					Name string `json:"name"`
					Type string `json:"type"`
					Path string `json:"path"`
				} `json:"vaults"`
			}
			if json.Unmarshal(data, &wrapped) == nil {
				arr = wrapped.Vaults
			}
		}
		for _, v := range arr {
			if v.Path == "" {
				continue
			}
			name := v.Name
			if name == "" {
				name = filepath.Base(v.Path)
			}
			sources = append(sources, src{name: name, dir: v.Path})
		}
	}
	if journalDir := filepath.Join(gs.root, "journal"); true {
		sources = append(sources, src{name: "Journal", dir: journalDir})
	}

	for _, s := range sources {
		err := filepath.WalkDir(s.dir, func(p string, d os.DirEntry, err error) error {
			if err != nil || p == s.dir {
				return err //nolint:errcheck
			}
			rel, _ := filepath.Rel(s.dir, p)
			rel = filepath.ToSlash(rel)
			if d.IsDir() {
				if d.Name() == historyDirName || strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.HasPrefix(d.Name(), ".") {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if ext == ".md" {
				data, err := os.ReadFile(p)
				if err != nil {
					return nil // unreadable: skip, failed listing shouldn't block
				}
				doc, err := Decode(data)
				title := sanitizeMirrorName(doc.Meta.Title)
				id := doc.Meta.ID
				if id == "" {
					id = strings.TrimSuffix(d.Name(), ".md")
				}
				if doc.Meta.Path != "" {
					rel = doc.Meta.Path + "/" + filepath.Base(p)
				}
				name := title
				if name == "" {
					name = strings.TrimSuffix(d.Name(), ".md")
				}
				name = fmt.Sprintf("%s [%s].md", name, id)
				dst := filepath.Join(mirror, sanitizeMirrorSegment(s.name))
				for _, seg := range strings.Split(path.Dir(rel), "/") {
					if seg != "" && seg != "." {
						dst = filepath.Join(dst, sanitizeMirrorSegment(seg))
					}
				}
				dst = filepath.Join(dst, name)
				if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
					return nil
				}
				if err := os.WriteFile(dst, data, 0o644); err != nil {
					return nil
				}
				return nil
			}
			// Non-note files: images & attachments, kept unchanged when enabled.
			if !gs.cfg.IncludeImages && imageExtensions[ext] {
				return nil
			}
			dir := filepath.Dir(rel)
			dst := filepath.Join(mirror, sanitizeMirrorSegment(s.name))
			for _, seg := range strings.Split(dir, "/") {
				if seg != "" && seg != "." {
					dst = filepath.Join(dst, sanitizeMirrorSegment(seg))
				}
			}
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return nil
			}
			out, err := os.ReadFile(p)
			if err == nil {
				_ = os.WriteFile(filepath.Join(dst, d.Name()), out, 0o644)
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("mirror %s: %w", s.name, err)
		}
	}
	return nil
}

// sanitizeMirrorName makes a note title safe as a file name: strips path
// separators, controls and trims dot/space edges. Usage of the trailing
// " [<id>]" suffix keeps names unique regardless of duplicates.
func sanitizeMirrorName(name string) string {
	repl := strings.NewReplacer(
		"/", "-", "\\", "-", ":", "-", "\n", " ", "\r", " ", "\t", " ",
	)
	name = strings.TrimSpace(repl.Replace(name))
	name = strings.Trim(name, ". ")
	if len(name) > 120 {
		name = name[:120]
	}
	return strings.TrimSpace(name)
}

func sanitizeMirrorSegment(seg string) string {
	return sanitizeMirrorName(seg)
}

// writeGitignoreLocked writes the root .gitignore matching the current mode:
// with ReadableNames, git only sees the .gitsync/ mirror; without it, the
// whole home is committed except history snapshots (and images when excluded).
// Caller must hold gs.mu.
func (gs *GitSync) writeGitignoreLocked() error {
	var lines []string
	if gs.cfg.ReadableNames {
		// Only the readable mirror is visible to git. vaults/, journal/ and
		// the root-level vault note files (internal <id>.md layout) are
		// hidden; .gitsync/ carries the human-readable names.
		lines = []string{
			"/vaults/", "/vaults/**",
			"/journal/", "/journal/**",
			"/.history/", "/.history/**",
			"/vaults.json", "/collections.json", "/metadata.json", "/git.json",
			"/*.md",
		}
		if !gs.cfg.IncludeImages {
			lines = append(lines,
				"*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.avif", "*.svg", "*.bmp")
		}
	} else {
		// git.json holds the remote credentials: never commit it.
		lines = append(lines, "*/.history/", ".history/", "/git.json")
		if !gs.cfg.IncludeImages {
			lines = append(lines,
				"*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.avif", "*.svg", "*.bmp")
		}
	}
	content := strings.Join(lines, "\n") + "\n"
	if cur, err := os.ReadFile(filepath.Join(gs.root, ".gitignore")); err != nil || string(cur) != content {
		if err := os.WriteFile(filepath.Join(gs.root, ".gitignore"), []byte(content), 0o644); err != nil {
			return fmt.Errorf("write .gitignore: %w", err)
		}
	}
	return nil
}

// ensureRepo opens the repo if not yet loaded.
func (gs *GitSync) ensureRepo() error {	if gs.repo != nil {
		return nil
	}
	repo, err := git.PlainOpen(gs.root)
	if err != nil {
		return err
	}
	gs.repo = repo
	return nil
}

// commitDebounced schedules a commit after a short delay. Multiple calls
// within the debounce window coalesce into one commit.
func (gs *GitSync) commitDebounced() {
	if !gs.Config().Enabled {
		return
	}
	gs.commitMu.Lock()
	defer gs.commitMu.Unlock()
	if gs.timer != nil {
		gs.timer.Stop()
	}
	gs.timer = time.AfterFunc(500*time.Millisecond, func() {
		_ = gs.Commit("Auto-commit from Nexote")
		if gs.Config().AutoPush {
			_ = gs.Push(context.Background(), GitCredentials{})
		}
	})
}

// Commit stages all changes and creates a commit with the given message.
func (gs *GitSync) Commit(msg string) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	return gs.commitLocked(msg)
}

func (gs *GitSync) commitLocked(msg string) error {
	if err := gs.ensureRepo(); err != nil {
		return err
	}
	// Keep .gitignore current (repos initialized by older builds lack the
	// git.json rule) and rebuild the readable mirror before staging so the
	// committed tree always reflects the current vault contents.
	if err := gs.writeGitignoreLocked(); err != nil {
		return err
	}
	if err := gs.writeMirrorLocked(); err != nil {
		return err
	}
	wt, err := gs.repo.Worktree()
	if err != nil {
		return fmt.Errorf("worktree: %w", err)
	}

	// Stage everything (add -A).
	if err := wt.AddWithOptions(&git.AddOptions{All: true}); err != nil {
		// If there's nothing to stage, that's fine.
		_ = err
	}
	// git.json (credentials) may already be tracked from an older build;
	// drop it from the index so the next commit stops carrying it. The file
	// on disk stays.
	if idx, err := gs.repo.Storer.Index(); err == nil {
		if _, err := idx.Remove("git.json"); err == nil {
			if err := gs.repo.Storer.SetIndex(idx); err != nil {
				return fmt.Errorf("untrack git.json: %w", err)
			}
		}
	}

	// Check if there are any changes to commit.
	status, err := wt.Status()
	if err == nil && status.IsClean() {
		return nil // nothing to commit
	}

	head, _ := gs.repo.Head()
	var parentHashes []plumbing.Hash
	if head != nil {
		parentHashes = []plumbing.Hash{head.Hash()}
	}

	hash, err := wt.Commit(msg, &git.CommitOptions{
		Author: &object.Signature{
			Name:  gs.cfg.AuthorName,
			Email: gs.cfg.AuthorEmail,
			When:  time.Now().UTC(),
		},
		Parents: parentHashes,
	})
	if err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	// Update the branch ref.
	branch := gs.cfg.Branch
	if branch == "" {
		branch = "main"
	}
	ref := plumbing.NewBranchReferenceName(branch)
	if err := gs.repo.Storer.SetReference(plumbing.NewHashReference(ref, hash)); err != nil {
		return fmt.Errorf("set branch ref: %w", err)
	}

	return nil
}

// gitNetworkTimeout bounds one push/pull. Without it an unreachable remote
// left the request (and the UI's busy state) hanging, with gs.mu held so
// every other git call queued behind it.
const gitNetworkTimeout = 90 * time.Second

// authLocked picks the transport auth for the configured remote: HTTP(S)
// takes basic auth (per-request creds, else the stored ones); SSH uses the
// ssh-agent or a default key in ~/.ssh (key passphrase = stored password).
// Caller must hold gs.mu.
func (gs *GitSync) authLocked(creds GitCredentials) (transport.AuthMethod, error) {
	user, pass := creds.Username, creds.Password
	if user == "" && pass == "" {
		user, pass = gs.cfg.Username, gs.cfg.Password
	}
	ep, err := transport.NewEndpoint(gs.cfg.Remote)
	if err != nil {
		return nil, fmt.Errorf("invalid remote URL: %w", err)
	}
	switch ep.Protocol {
	case "http", "https":
		if user == "" && pass == "" {
			return nil, nil
		}
		if user == "" {
			user = "git" // token-only: GitHub/GitLab/Gitea ignore the name
		}
		return &http.BasicAuth{Username: user, Password: pass}, nil
	case "ssh":
		sshUser := ep.User
		if sshUser == "" {
			sshUser = "git"
		}
		if os.Getenv("SSH_AUTH_SOCK") != "" {
			if a, err := gitssh.NewSSHAgentAuth(sshUser); err == nil {
				return a, nil
			}
		}
		if home, err := os.UserHomeDir(); err == nil {
			for _, name := range []string{"id_ed25519", "id_ecdsa", "id_rsa"} {
				p := filepath.Join(home, ".ssh", name)
				if _, err := os.Stat(p); err != nil {
					continue
				}
				keys, err := gitssh.NewPublicKeysFromFile(sshUser, p, pass)
				if err != nil {
					return nil, fmt.Errorf("load SSH key %s: %w", p, err)
				}
				return keys, nil
			}
		}
		return nil, fmt.Errorf("SSH remote needs a key: no ssh-agent and no key in ~/.ssh on the server — use an HTTPS remote with a token instead")
	default:
		return nil, nil // file:// and other local transports
	}
}

// remoteErr turns go-git's terse transport errors into actionable messages.
func remoteErr(op string, err error) error {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return fmt.Errorf("%s timed out after %s — is the remote reachable?", op, gitNetworkTimeout)
	case errors.Is(err, transport.ErrAuthenticationRequired), errors.Is(err, transport.ErrAuthorizationFailed):
		return fmt.Errorf("%s: authentication failed — check username and password/token", op)
	case errors.Is(err, transport.ErrRepositoryNotFound):
		return fmt.Errorf("%s: remote repository not found — check the URL", op)
	case errors.Is(err, git.ErrNonFastForwardUpdate):
		return fmt.Errorf("%s: local and remote history have diverged — the remote has commits this vault doesn't (or vice versa) and they can't be fast-forwarded", op)
	case strings.Contains(err.Error(), "knownhosts"):
		return fmt.Errorf("%s: SSH host key unknown — add the host to ~/.ssh/known_hosts on the server (%v)", op, err)
	}
	return fmt.Errorf("%s: %w", op, err)
}

// remoteReadyLocked opens the repo, syncs origin and returns the branch.
// Caller must hold gs.mu.
func (gs *GitSync) remoteReadyLocked() (string, error) {
	if err := gs.ensureRepo(); err != nil {
		return "", fmt.Errorf("no git repository yet — enable sync or press Init repo first")
	}
	if gs.cfg.Remote == "" {
		return "", fmt.Errorf("no remote configured")
	}
	if err := gs.ensureRemote(); err != nil {
		return "", err
	}
	if gs.cfg.Branch == "" {
		return "main", nil
	}
	return gs.cfg.Branch, nil
}

// Push commits pending changes and pushes the branch to the configured
// remote. "Already up to date" counts as success.
func (gs *GitSync) Push(ctx context.Context, creds GitCredentials) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	branch, err := gs.remoteReadyLocked()
	if err != nil {
		return err
	}
	// Push what the user sees: edits since the last debounced commit too.
	if err := gs.commitLocked("Sync from Nexote"); err != nil {
		return err
	}
	auth, err := gs.authLocked(creds)
	if err != nil {
		return err
	}
	// Push the configured branch when it exists locally (i.e. the repo was
	// initialized with the same branch). If the user's repo predates a branch
	// rename in the settings (common: master → main), fall back to pushing
	// HEAD so the current history still reaches the remote branch.
	localRef := plumbing.NewBranchReferenceName(branch)
	if _, err := gs.repo.Reference(localRef, true); err != nil {
		localRef = plumbing.HEAD
	}
	refSpec := fmt.Sprintf("%s:refs/heads/%s", localRef.String(), branch)
	ctx, cancel := context.WithTimeout(ctx, gitNetworkTimeout)
	defer cancel()
	err = gs.repo.PushContext(ctx, &git.PushOptions{
		RemoteName: "origin",
		RefSpecs:   []config.RefSpec{config.RefSpec(refSpec)},
		Auth:       auth,
	})
	if err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate) {
		return remoteErr("push", err)
	}
	// Record what the remote now has so Status' ahead count drops to 0.
	if ref, rerr := gs.repo.Reference(localRef, true); rerr == nil {
		_ = gs.repo.Storer.SetReference(plumbing.NewHashReference(
			plumbing.NewRemoteReferenceName("origin", branch), ref.Hash()))
	}
	return nil
}

// Pull commits pending changes (go-git refuses to pull into a dirty
// worktree) and fast-forwards from the configured remote. "Already up to
// date" and a remote without the branch yet count as success.
func (gs *GitSync) Pull(ctx context.Context, creds GitCredentials) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	branch, err := gs.remoteReadyLocked()
	if err != nil {
		return err
	}
	if err := gs.commitLocked("Sync from Nexote"); err != nil {
		return err
	}
	auth, err := gs.authLocked(creds)
	if err != nil {
		return err
	}
	wt, err := gs.repo.Worktree()
	if err != nil {
		return fmt.Errorf("worktree: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, gitNetworkTimeout)
	defer cancel()
	err = wt.PullContext(ctx, &git.PullOptions{
		RemoteName:    "origin",
		ReferenceName: plumbing.NewBranchReferenceName(branch),
		Auth:          auth,
	})
	switch {
	case err == nil, errors.Is(err, git.NoErrAlreadyUpToDate):
		return nil
	case errors.Is(err, transport.ErrEmptyRemoteRepository):
		return nil // nothing on the remote yet — the first push creates it
	case errors.Is(err, plumbing.ErrReferenceNotFound):
		return fmt.Errorf("pull: remote has no branch %q — check the branch setting (or push first)", branch)
	}
	return remoteErr("pull", err)
}

// Status returns the current repo status for UI display.
func (gs *GitSync) Status() (GitStatusInfo, error) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	info := GitStatusInfo{
		Enabled: gs.cfg.Enabled,
		Branch:  gs.cfg.Branch,
		Remote:  gs.cfg.Remote,
	}
	if err := gs.ensureRepo(); err != nil {
		info.HasRepo = false
		return info, nil // no repo yet — not an error
	}
	info.HasRepo = true

	wt, err := gs.repo.Worktree()
	if err != nil {
		return info, fmt.Errorf("worktree: %w", err)
	}
	status, err := wt.Status()
	if err != nil {
		return info, fmt.Errorf("status: %w", err)
	}
	info.Clean = status.IsClean()
	info.DirtyFiles = len(status)

	// Count ahead/behind relative to remote.
	branch := gs.cfg.Branch
	if branch == "" {
		branch = "main"
	}
	localRef, err := gs.repo.Reference(plumbing.NewBranchReferenceName(branch), true)
	if err == nil {
		remoteRef, err := gs.repo.Reference(plumbing.NewRemoteReferenceName("origin", branch), true)
		if err == nil {
			localHash := localRef.Hash()
			remoteHash := remoteRef.Hash()
			if localHash != remoteHash {
				info.Ahead = gs.countUntilLocked(localHash, remoteHash)
				info.Behind = gs.countUntilLocked(remoteHash, localHash)
			}
		}
	}

	return info, nil
}

// countUntilLocked counts commits reachable from `from` before hitting
// `stop` (0 when the log can't be read). Caller must hold gs.mu.
func (gs *GitSync) countUntilLocked(from, stop plumbing.Hash) int {
	iter, err := gs.repo.Log(&git.LogOptions{From: from})
	if err != nil {
		return 0
	}
	defer iter.Close()
	n := 0
	_ = iter.ForEach(func(c *object.Commit) error {
		if c.Hash == stop {
			return storer.ErrStop
		}
		n++
		return nil
	})
	return n
}

// Log returns the last limit commits for UI display.
func (gs *GitSync) Log(limit int) ([]GitCommitLog, error) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if err := gs.ensureRepo(); err != nil {
		return nil, err
	}
	head, err := gs.repo.Head()
	if err != nil {
		return nil, err
	}
	iter, err := gs.repo.Log(&git.LogOptions{From: head.Hash()})
	if err != nil {
		return nil, err
	}
	defer iter.Close()
	var result []GitCommitLog
	count := 0
	err = iter.ForEach(func(c *object.Commit) error {
		if count >= limit {
			return plumbing.ErrReferenceNotFound
		}
		count++
		result = append(result, GitCommitLog{
			Hash:    c.Hash.String()[:7],
			Message: c.Message,
			Author:  c.Author.Name,
			When:    c.Author.When,
		})
		return nil
	})
	if err != nil && err != plumbing.ErrReferenceNotFound {
		return nil, err
	}
	return result, nil
}
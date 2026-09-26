package notes

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
)

// GitConfig is the persisted git-sync configuration. It lives at
// <NEXOTE_HOME>/git.json. Credentials are never stored here — they are
// passed per push/pull request.
type GitConfig struct {
	Enabled        bool   `json:"enabled"`
	Remote         string `json:"remote"`
	Branch         string `json:"branch"`
	AuthorName     string `json:"authorName"`
	AuthorEmail    string `json:"authorEmail"`
	IncludeImages  bool   `json:"includeImages"`
	AutoPush       bool   `json:"autoPush"`
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
	return cfg, nil
}

func SaveGitConfig(root string, cfg GitConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(root, "git.json"), data, 0o644)
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

	mu       sync.Mutex
	commitMu sync.Mutex
	repo     *git.Repository
	timer    *time.Timer
}

// NewGitSync creates a GitSync for the given root. If a git repo already
// exists it is opened; otherwise it is created lazily on the first commit.
func NewGitSync(root string, cfg GitConfig) *GitSync {
	gs := &GitSync{root: root, cfg: cfg}
	if repo, err := git.PlainOpen(root); err == nil {
		gs.repo = repo
	}
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
	gitignore := "*/.history/\n.history/\n"
	if !gs.cfg.IncludeImages {
		gitignore += "*.png\n*.jpg\n*.jpeg\n*.gif\n*.webp\n*.avif\n*.svg\n*.bmp\n"
	}
	if err := os.WriteFile(filepath.Join(gs.root, ".gitignore"), []byte(gitignore), 0o644); err != nil {
		return fmt.Errorf("write .gitignore: %w", err)
	}

	// Set remote if configured (also rewrites a stale/different origin).
	if err := gs.ensureRemote(); err != nil {
		return err
	}

	// Initial commit.
	return gs.commitLocked("Initial commit (Nexote)")
}

// ensureRepo opens the repo if not yet loaded.
func (gs *GitSync) ensureRepo() error {
	if gs.repo != nil {
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
	if !gs.cfg.Enabled {
		return
	}
	gs.commitMu.Lock()
	defer gs.commitMu.Unlock()
	if gs.timer != nil {
		gs.timer.Stop()
	}
	gs.timer = time.AfterFunc(500*time.Millisecond, func() {
		_ = gs.Commit("Auto-commit from Nexote")
		if gs.cfg.AutoPush {
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
	wt, err := gs.repo.Worktree()
	if err != nil {
		return fmt.Errorf("worktree: %w", err)
	}

	// Stage everything (add -A).
	if err := wt.AddWithOptions(&git.AddOptions{All: true}); err != nil {
		// If there's nothing to stage, that's fine.
		_ = err
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

// Push pushes the current branch to the configured remote.
func (gs *GitSync) Push(ctx context.Context, creds GitCredentials) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if err := gs.ensureRepo(); err != nil {
		return err
	}
	if err := gs.ensureRemote(); err != nil {
		return err
	}
	if gs.cfg.Remote == "" {
		return fmt.Errorf("no remote configured")
	}
	branch := gs.cfg.Branch
	if branch == "" {
		branch = "main"
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
	opts := &git.PushOptions{
		RemoteName: "origin",
		RefSpecs:   []config.RefSpec{config.RefSpec(refSpec)},
	}
	if creds.Username != "" || creds.Password != "" {
		opts.Auth = &http.BasicAuth{
			Username: creds.Username,
			Password: creds.Password,
		}
	}
	return gs.repo.PushContext(ctx, opts)
}

// Pull fetches and merges from the configured remote into the current branch.
func (gs *GitSync) Pull(ctx context.Context, creds GitCredentials) error {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if err := gs.ensureRepo(); err != nil {
		return err
	}
	if err := gs.ensureRemote(); err != nil {
		return err
	}
	if gs.cfg.Remote == "" {
		return fmt.Errorf("no remote configured")
	}
	wt, err := gs.repo.Worktree()
	if err != nil {
		return fmt.Errorf("worktree: %w", err)
	}
	branch := gs.cfg.Branch
	if branch == "" {
		branch = "main"
	}
	opts := &git.PullOptions{
		RemoteName:    "origin",
		ReferenceName: plumbing.NewBranchReferenceName(branch),
	}
	if creds.Username != "" || creds.Password != "" {
		opts.Auth = &http.BasicAuth{
			Username: creds.Username,
			Password: creds.Password,
		}
	}
	return wt.PullContext(ctx, opts)
}

// Status returns the current repo status for UI display.
func (gs *GitSync) Status() (GitStatusInfo, error) {
	info := GitStatusInfo{
		Enabled: gs.cfg.Enabled,
		Branch:  gs.cfg.Branch,
		Remote:  gs.cfg.Remote,
	}
	gs.mu.Lock()
	defer gs.mu.Unlock()
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
				// Count commits ahead/behind by walking the log.
				localIter, _ := gs.repo.Log(&git.LogOptions{From: localHash})
				ahead := 0
				localIter.ForEach(func(c *object.Commit) error {
					if c.Hash == remoteHash {
						return plumbing.ErrReferenceNotFound
					}
					ahead++
					return nil
				})
				localIter.Close()
				info.Ahead = ahead

				remoteIter, _ := gs.repo.Log(&git.LogOptions{From: remoteHash})
				behind := 0
				remoteIter.ForEach(func(c *object.Commit) error {
					if c.Hash == localHash {
						return plumbing.ErrReferenceNotFound
					}
					behind++
					return nil
				})
				remoteIter.Close()
				info.Behind = behind
			}
		}
	}

	return info, nil
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
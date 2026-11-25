package notes

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-git/go-git/v5"
)

// newSyncedPair returns a GitSync over a fresh home with one note, wired to
// a local bare repository as origin.
func newSyncedPair(t *testing.T, cfg GitConfig) (*GitSync, string) {
	t.Helper()
	bare := filepath.Join(t.TempDir(), "remote.git")
	if _, err := git.PlainInit(bare, true); err != nil {
		t.Fatalf("init bare: %v", err)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.md"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg.Enabled = true
	cfg.Remote = "file://" + bare
	cfg.Branch = "main"
	cfg.AuthorName, cfg.AuthorEmail = "t", "t@example.com"
	gs := NewGitSync(root, cfg)
	if err := gs.InitRepo(); err != nil {
		t.Fatalf("InitRepo: %v", err)
	}
	return gs, root
}

func TestGitSyncPushPullRepeatAndDirty(t *testing.T) {
	gs, root := newSyncedPair(t, GitConfig{})
	ctx := context.Background()
	if err := gs.Push(ctx, GitCredentials{}); err != nil {
		t.Fatalf("first push: %v", err)
	}
	// Nothing new: must succeed, not surface "already up-to-date".
	if err := gs.Push(ctx, GitCredentials{}); err != nil {
		t.Fatalf("repeat push: %v", err)
	}
	// Uncommitted edit: pull must not fail on a dirty worktree, and the
	// next push must carry the edit.
	if err := os.WriteFile(filepath.Join(root, "b.md"), []byte("dirty"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := gs.Pull(ctx, GitCredentials{}); err != nil {
		t.Fatalf("pull with dirty worktree: %v", err)
	}
	if err := gs.Push(ctx, GitCredentials{}); err != nil {
		t.Fatalf("push after edit: %v", err)
	}
	st, err := gs.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !st.Clean || st.Ahead != 0 {
		t.Fatalf("after push: clean=%v ahead=%d, want clean and 0 ahead", st.Clean, st.Ahead)
	}
}

func TestGitSyncNeverCommitsCredentials(t *testing.T) {
	gs, root := newSyncedPair(t, GitConfig{Username: "u", Password: "secret"})
	if err := SaveGitConfig(root, gs.Config()); err != nil {
		t.Fatal(err)
	}
	if err := gs.Commit("c"); err != nil {
		t.Fatalf("commit: %v", err)
	}
	head, err := gs.repo.Head()
	if err != nil {
		t.Fatal(err)
	}
	commit, err := gs.repo.CommitObject(head.Hash())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := commit.File("git.json"); err == nil {
		t.Fatal("git.json (credentials) was committed")
	}
}

// The auto-sync timer body once held gs.mu while calling Commit/Push (which
// lock it too), deadlocking every later git call — the UI spun forever.
func TestGitSyncAutoSyncReleasesLock(t *testing.T) {
	gs, _ := newSyncedPair(t, GitConfig{AutoSyncMinutes: 60})
	done := make(chan struct{})
	go func() {
		gs.runAutoSync()
		_ = gs.Push(context.Background(), GitCredentials{})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("auto-sync left gs.mu locked: push blocked")
	}
}

// The on-device engine stops a folder's GitSync when it closes the folder;
// nothing may commit there in the background afterwards.
func TestGitSyncStopEndsBackgroundCommits(t *testing.T) {
	gs, root := newSyncedPair(t, GitConfig{AutoSyncMinutes: 60, AutoPush: true})
	head := func() string {
		t.Helper()
		ref, err := gs.repo.Head()
		if err != nil {
			t.Fatal(err)
		}
		return ref.Hash().String()
	}
	before := head()
	if err := os.WriteFile(filepath.Join(root, "b.md"), []byte("edit"), 0o644); err != nil {
		t.Fatal(err)
	}
	gs.commitDebounced()
	gs.Stop()
	// Timers that fire or get armed after Stop do nothing.
	gs.commitDebounced()
	gs.runAutoSync()
	time.Sleep(time.Second) // past the 500 ms commit debounce
	if after := head(); after != before {
		t.Fatal("committed in the background after Stop")
	}
	gs.mu.Lock()
	armed := gs.autosyncTimer != nil
	gs.mu.Unlock()
	if armed {
		t.Fatal("auto-sync timer re-armed after Stop")
	}
	// Explicit commits still work (and prove the edit was there to commit).
	if err := gs.Commit("manual"); err != nil {
		t.Fatalf("commit after Stop: %v", err)
	}
	if head() == before {
		t.Fatal("manual commit after Stop made no commit")
	}
}

package serversync

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"nexote/api"
)

// syncState is the device's memory of the last successful sync (the base
// of the three-way merge), per pairing. It lives in the host's private
// state directory, never in the data folder: it describes this device's
// relation to one server account, not the notes.
type syncState struct {
	// Key names the pairing and the data folder the state belongs to
	// (stateKey); another pairing or folder starts over (alignment, no
	// base), so a folder switch can never read as "everything deleted".
	Key string `json:"key"`
	// Aligned is set once the first sync re-keyed the device's built-in
	// space and vaults to the server's ids.
	Aligned bool `json:"aligned"`
	// StructureSynced is set after the first complete structure step: from
	// then on a pref missing from Prefs was "" in the base.
	StructureSynced bool `json:"structureSynced"`
	// LastSyncAt is the time the server recorded for the last complete run
	// (its answer to /api/sync/done), also written to the data folder's
	// .nexote/last-sync. If either the folder or the server disagrees at
	// the next run, one of them was restored from a backup: the base no
	// longer describes it, and the run merges without one.
	LastSyncAt string `json:"lastSyncAt,omitempty"`

	Spaces      map[string]api.SyncSpace `json:"spaces"`
	Vaults      map[string]api.SyncVault `json:"vaults"`
	Collections map[string]string        `json:"collections"` // "<space>/<id>" → hash
	Prefs       map[string]string        `json:"prefs"`
	Scopes      map[string]*scopeBase    `json:"scopes"`
}

// scopeBase is one scope as both sides last agreed on it.
type scopeBase struct {
	// Synced is set once the scope was synced completely: from then on a
	// label or list missing from the base was empty there.
	Synced bool `json:"synced"`

	Notes       map[string]baseNote `json:"notes"`
	Attachments map[string]int64    `json:"attachments"`
	Folders     map[string]bool     `json:"folders"`
	Labels      map[string]string   `json:"labels"`
	Bookmarks   []string            `json:"bookmarks"`
	Shortcuts   []string            `json:"shortcuts"`
}

type baseNote struct {
	Hash      string `json:"hash"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

func newSyncState(key string) *syncState {
	return &syncState{
		Key:         key,
		Spaces:      map[string]api.SyncSpace{},
		Vaults:      map[string]api.SyncVault{},
		Collections: map[string]string{},
		Prefs:       map[string]string{},
		Scopes:      map[string]*scopeBase{},
	}
}

func newScopeBase() *scopeBase {
	return &scopeBase{
		Notes:       map[string]baseNote{},
		Attachments: map[string]int64{},
		Folders:     map[string]bool{},
		Labels:      map[string]string{},
	}
}

// scope returns the base of a scope, empty when there is none yet.
func (st *syncState) scope(id string) *scopeBase {
	b := st.Scopes[id]
	if b == nil {
		b = newScopeBase()
		st.Scopes[id] = b
	}
	if b.Notes == nil {
		b.Notes = map[string]baseNote{}
	}
	if b.Attachments == nil {
		b.Attachments = map[string]int64{}
	}
	if b.Folders == nil {
		b.Folders = map[string]bool{}
	}
	if b.Labels == nil {
		b.Labels = map[string]string{}
	}
	return b
}

// stateFile is the file of one key: each data folder the app has used with
// this pairing keeps its own base, so switching folders back and forth
// loses nothing.
func stateFile(key string) string {
	sum := sha256.Sum256([]byte(key))
	return "sync-state-" + hex.EncodeToString(sum[:8]) + ".json"
}

// stateKey identifies a pairing (device id) with one data folder (its local
// user and the folder's id, see engine.folderID; not its path, which a
// wiped or replaced folder keeps).
func stateKey(deviceID, userID, folder string) string {
	return deviceID + "|" + userID + "|" + folder
}

// loadState reads the state for key from dir; a missing, unreadable or
// other key's file starts over.
func loadState(dir, key string) (*syncState, error) {
	data, err := os.ReadFile(filepath.Join(dir, stateFile(key)))
	if errors.Is(err, fs.ErrNotExist) {
		return newSyncState(key), nil
	}
	if err != nil {
		return nil, err
	}
	st := newSyncState(key)
	if err := json.Unmarshal(data, st); err != nil || st.Key != key {
		return newSyncState(key), nil
	}
	for _, m := range []*map[string]string{&st.Collections, &st.Prefs} {
		if *m == nil {
			*m = map[string]string{}
		}
	}
	if st.Spaces == nil {
		st.Spaces = map[string]api.SyncSpace{}
	}
	if st.Vaults == nil {
		st.Vaults = map[string]api.SyncVault{}
	}
	if st.Scopes == nil {
		st.Scopes = map[string]*scopeBase{}
	}
	return st, nil
}

// save writes the state atomically (0600: it lists what the account holds).
func (st *syncState) save(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(st)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".sync-state-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, stateFile(st.Key)))
}

// removeState forgets every base (after unpairing).
func removeState(dir string) {
	if dir == "" {
		return
	}
	files, _ := filepath.Glob(filepath.Join(dir, "sync-state-*.json"))
	for _, f := range files {
		_ = os.Remove(f)
	}
}

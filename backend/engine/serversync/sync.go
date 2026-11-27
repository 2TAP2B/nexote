package serversync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"nexote/api"
	"nexote/notes"
)

// One sync run: the device's data (local) against the server account
// (remote), three-way per item with the base of the last successful run.
//
// Rules, per item (L local, R remote, B base):
//   - L == R: becomes the base.
//   - only one side changed: that change goes to the other side (written
//     with the other side's current hash as expectation; a mismatch means
//     it changed meanwhile and the item waits for the next run).
//   - both changed: notes → the server's version stays, the device's
//     becomes a new note "<title> (offline copy)" on both sides (the
//     Notepad and daily notes are merged instead); deleted on one side and
//     changed on the other → the change wins (recreated, same id);
//     attachments and folders → union; names, icons, labels, prefs,
//     collection definitions → the server's.
//   - spaces and vaults: creations propagate with the same id; a deletion
//     propagates only if the other side changed nothing inside since the
//     base, else the space or vault is recreated on the deleting side.
//
// An item enters the base only when it was reconciled; anything that
// failed is decided again next run. Deleted notes go to their store's
// history first (there is no trash).
type run struct {
	ctx    context.Context
	local  side
	remote side
	st     *syncState
	now    func() time.Time
	// rekey re-keys the device's spaces and vaults (local only).
	rekey func(spaces, vaults map[string]string) error
	// union is set when this run merges without a base (a side was
	// restored from a backup).
	union bool

	// conflicts counts offline copies made in this run, skipped the items
	// left for the next run.
	conflicts int
	skipped   int
	// problems are scopes left out of this run (an unreadable note), for
	// the status line.
	problems []string
	// prefs are the account prefs after the structure step (they say where
	// the Notepad lives).
	prefs map[string]string
}

// ok reports whether a step succeeded. Errors that only leave this item
// for the next run (changed meanwhile, refused, gone) are absorbed; any
// other error is returned and ends the run.
func (r *run) ok(what string, err error) (bool, error) {
	if err == nil {
		return true, nil
	}
	if errors.Is(err, api.ErrSyncConflict) || errors.Is(err, api.ErrSyncRefused) || errors.Is(err, notes.ErrNotFound) || errors.Is(err, notes.ErrInvalidID) {
		log.Printf("sync: %s: %v", what, err)
		r.skipped++
		return false, nil
	}
	return false, err
}

// soft is ok for steps whose success changes nothing for the caller.
func (r *run) soft(what string, err error) error {
	_, err = r.ok(what, err)
	return err
}

// --- structure ---

func indexSpaces(s api.SyncStructure) map[string]api.SyncSpace {
	m := map[string]api.SyncSpace{}
	for _, sp := range s.Spaces {
		m[sp.ID] = sp
	}
	return m
}

func indexVaults(s api.SyncStructure) map[string]api.SyncVault {
	m := map[string]api.SyncVault{}
	for _, v := range s.Vaults {
		m[v.ID] = v
	}
	return m
}

// orderedIDs lists the keys of the maps in a stable order: remote order
// first (the server's structure is the reference), then local, then base.
func orderedIDs(lists ...[]string) []string {
	seen := map[string]bool{}
	var out []string
	for _, l := range lists {
		for _, id := range l {
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	return out
}

func spaceIDs(s api.SyncStructure) []string {
	out := make([]string, len(s.Spaces))
	for i, sp := range s.Spaces {
		out[i] = sp.ID
	}
	return out
}

func vaultIDs(s api.SyncStructure) []string {
	out := make([]string, len(s.Vaults))
	for i, v := range s.Vaults {
		out[i] = v.ID
	}
	return out
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// pick is the three-way rule for one field: the side that changed wins,
// the server when both did.
func pick(l, r, b string, hasBase bool) string {
	switch {
	case l == r:
		return l
	case hasBase && l == b:
		return r
	case hasBase && r == b:
		return l
	default:
		return r
	}
}

// align maps the device's built-in space and vaults to the server's on the
// first sync after pairing: the oldest owned space to the server's oldest,
// and in it the first regular vault and the Collections vault to the
// server's. Everything else keeps its id and unions. Reports whether
// anything was re-keyed.
func (r *run) align(L, R api.SyncStructure) (bool, error) {
	if len(L.Spaces) == 0 || len(R.Spaces) == 0 {
		return false, nil
	}
	lSpace, rSpace := L.Spaces[0], R.Spaces[0]
	lSpaces, lVaults := indexSpaces(L), indexVaults(L)
	spaces, vaults := map[string]string{}, map[string]string{}
	if lSpace.ID != rSpace.ID {
		if _, taken := lSpaces[rSpace.ID]; taken {
			return false, nil
		}
		spaces[lSpace.ID] = rSpace.ID
	}
	first := func(s api.SyncStructure, spaceID, vaultType string) string {
		for _, v := range s.Vaults {
			if v.SpaceID == spaceID && v.Type == vaultType {
				return v.ID
			}
		}
		return ""
	}
	for _, t := range []string{"", notes.VaultTypeCollections} {
		lid, rid := first(L, lSpace.ID, t), first(R, rSpace.ID, t)
		if lid == "" || rid == "" || lid == rid {
			continue
		}
		if _, taken := lVaults[rid]; taken {
			continue
		}
		vaults[lid] = rid
	}
	if len(spaces)+len(vaults) == 0 {
		return false, nil
	}
	if err := r.rekey(spaces, vaults); err != nil {
		return true, fmt.Errorf("re-key: %w", err)
	}
	return true, nil
}

// scopeChanged reports whether a side added or changed anything in a scope
// since the base (deleting things inside isn't a change worth keeping a
// deleted vault for). An unreadable scope counts as changed.
func (r *run) scopeChanged(sd side, scope string) (bool, error) {
	m, err := sd.Manifest(r.ctx, scope)
	if errors.Is(err, notes.ErrNotFound) {
		return false, nil
	}
	if errors.Is(err, api.ErrSyncUnreadable) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	b := r.st.Scopes[scope]
	if b == nil {
		return len(m.Notes) > 0 || len(m.Attachments) > 0, nil
	}
	for id, info := range m.Notes {
		if bn, ok := b.Notes[id]; !ok || bn.Hash != info.Hash {
			return true, nil
		}
	}
	for p := range m.Attachments {
		if _, ok := b.Attachments[p]; !ok {
			return true, nil
		}
	}
	return false, nil
}

// structure syncs spaces, vaults, collection definitions and prefs against
// the server's structure R, and returns the scopes to sync.
func (r *run) structure(R api.SyncStructure) ([]string, error) {
	L, err := r.local.Structure(r.ctx)
	if err != nil {
		return nil, err
	}
	if !r.st.Aligned {
		rekeyed, err := r.align(L, R)
		if err != nil {
			return nil, err
		}
		if rekeyed {
			if L, err = r.local.Structure(r.ctx); err != nil {
				return nil, err
			}
		}
		r.st.Aligned = true
	}

	lSp, rSp := indexSpaces(L), indexSpaces(R)
	lV, rV := indexVaults(L), indexVaults(R)
	handled := map[string]bool{} // vaults dealt with together with their space

	// recreate puts a space with all its vaults and collection definitions
	// on side dst (from src's structure). Each item enters the base only
	// when dst took it; the vaults' bases are dropped, so their contents
	// copy over as new.
	recreate := func(dst side, src api.SyncStructure, sp api.SyncSpace) error {
		ok, err := r.ok("space "+sp.Name, dst.PutSpace(r.ctx, sp))
		if err != nil || !ok {
			markHandled(handled, src, sp.ID)
			return err
		}
		r.st.Spaces[sp.ID] = sp
		for _, v := range src.Vaults {
			if v.SpaceID != sp.ID {
				continue
			}
			handled[v.ID] = true
			delete(r.st.Scopes, v.ID)
			ok, err := r.ok("vault "+v.Name, dst.PutVault(r.ctx, v))
			if err != nil {
				return err
			}
			if ok {
				r.st.Vaults[v.ID] = v
			}
		}
		for _, col := range src.Collections[sp.ID] {
			ok, err := r.ok("collection "+col.Name, dst.PutCollection(r.ctx, sp.ID, col))
			if err != nil {
				return err
			}
			if ok {
				r.st.Collections[sp.ID+"/"+col.ID] = collectionHash(col)
			}
		}
		return nil
	}
	spaceChanged := func(sd side, s api.SyncStructure, sp api.SyncSpace) (bool, error) {
		if b, ok := r.st.Spaces[sp.ID]; !ok || b.Name != sp.Name || b.Icon != sp.Icon {
			return true, nil
		}
		for _, v := range s.Vaults {
			if v.SpaceID != sp.ID {
				continue
			}
			if _, ok := r.st.Vaults[v.ID]; !ok {
				return true, nil
			}
			changed, err := r.scopeChanged(sd, v.ID)
			if err != nil || changed {
				return true, err
			}
		}
		return false, nil
	}

	// Spaces.
	for _, id := range orderedIDs(spaceIDs(R), spaceIDs(L), sortedKeys(r.st.Spaces)) {
		l, lok := lSp[id]
		rs, rok := rSp[id]
		b, bok := r.st.Spaces[id]
		switch {
		case lok && rok:
			merged := rs
			merged.Name = pick(l.Name, rs.Name, b.Name, bok)
			merged.Icon = pick(l.Icon, rs.Icon, b.Icon, bok)
			done := true
			if merged.Name != l.Name || merged.Icon != l.Icon {
				ok, err := r.ok("space "+merged.Name, r.local.PutSpace(r.ctx, merged))
				if err != nil {
					return nil, err
				}
				done = done && ok
			}
			if merged.Name != rs.Name || merged.Icon != rs.Icon {
				ok, err := r.ok("space "+merged.Name, r.remote.PutSpace(r.ctx, merged))
				if err != nil {
					return nil, err
				}
				done = done && ok
			}
			if done {
				r.st.Spaces[id] = merged
			}
		case lok && !bok:
			if err := recreate(r.remote, L, l); err != nil {
				return nil, err
			}
		case rok && !bok:
			if err := recreate(r.local, R, rs); err != nil {
				return nil, err
			}
		case lok: // deleted on the server
			changed, err := spaceChanged(r.local, L, l)
			if err != nil {
				return nil, err
			}
			if !changed {
				err := r.local.DeleteSpace(r.ctx, id)
				if err == nil {
					r.forgetSpace(id, L)
					markHandled(handled, L, id)
					continue
				}
				if !errors.Is(err, api.ErrSyncRefused) {
					return nil, err
				}
			}
			if err := recreate(r.remote, L, l); err != nil {
				return nil, err
			}
		case rok: // deleted on the device
			changed, err := spaceChanged(r.remote, R, rs)
			if err != nil {
				return nil, err
			}
			if !changed {
				err := r.remote.DeleteSpace(r.ctx, id)
				if err == nil {
					r.forgetSpace(id, R)
					markHandled(handled, R, id)
					continue
				}
				if !errors.Is(err, api.ErrSyncRefused) {
					return nil, err
				}
			}
			if err := recreate(r.local, R, rs); err != nil {
				return nil, err
			}
		default:
			delete(r.st.Spaces, id)
		}
	}

	// Vaults of spaces both sides have.
	for _, id := range orderedIDs(vaultIDs(R), vaultIDs(L), sortedKeys(r.st.Vaults)) {
		if handled[id] {
			continue
		}
		l, lok := lV[id]
		rv, rok := rV[id]
		b, bok := r.st.Vaults[id]
		switch {
		case lok && rok:
			merged := rv
			merged.Name = pick(l.Name, rv.Name, b.Name, bok)
			merged.Icon = pick(l.Icon, rv.Icon, b.Icon, bok)
			if merged.Type == "" {
				merged.Type = l.Type
			}
			done := true
			if merged != l {
				ok, err := r.ok("vault "+merged.Name, r.local.PutVault(r.ctx, merged))
				if err != nil {
					return nil, err
				}
				done = done && ok
			}
			if merged != rv {
				ok, err := r.ok("vault "+merged.Name, r.remote.PutVault(r.ctx, merged))
				if err != nil {
					return nil, err
				}
				done = done && ok
			}
			if done {
				r.st.Vaults[id] = merged
			}
		case lok && !bok:
			ok, err := r.ok("vault "+l.Name, r.remote.PutVault(r.ctx, l))
			if err != nil {
				return nil, err
			}
			if ok {
				r.st.Vaults[id] = l
			}
		case rok && !bok:
			ok, err := r.ok("vault "+rv.Name, r.local.PutVault(r.ctx, rv))
			if err != nil {
				return nil, err
			}
			if ok {
				r.st.Vaults[id] = rv
			}
		case lok: // deleted on the server
			if err := r.vaultDeleted(r.local, r.remote, l); err != nil {
				return nil, err
			}
		case rok: // deleted on the device
			if err := r.vaultDeleted(r.remote, r.local, rv); err != nil {
				return nil, err
			}
		default:
			delete(r.st.Vaults, id)
			delete(r.st.Scopes, id)
		}
	}

	// Collection definitions, per space and id.
	lC, rC := collectionIndex(L), collectionIndex(R)
	for _, key := range orderedIDs(sortedKeys(rC), sortedKeys(lC), sortedKeys(r.st.Collections)) {
		if err := r.collection(key, lC, rC); err != nil {
			return nil, err
		}
	}

	if err := r.syncPrefs(L.Prefs, R.Prefs); err != nil {
		return nil, err
	}

	// The scopes are what the device has now.
	final, err := r.local.Structure(r.ctx)
	if err != nil {
		return nil, err
	}
	scopes := []string{"journal", "home"}
	for _, v := range final.Vaults {
		scopes = append(scopes, v.ID)
	}
	return scopes, nil
}

// syncPrefs merges the account prefs per key. A key one side never set
// takes the other side's value (a fresh phone mustn't reset the account,
// nor the account the phone's settings); set on both, the three-way rule.
func (r *run) syncPrefs(L, R map[string]string) error {
	r.prefs = map[string]string{}
	toLocal, toRemote := map[string]string{}, map[string]string{}
	base := map[string]string{}
	for _, k := range orderedIDs(sortedKeys(R), sortedKeys(L), sortedKeys(r.st.Prefs)) {
		lv, lok := L[k]
		rv, rok := R[k]
		b, bok := r.st.Prefs[k]
		var v string
		switch {
		case lok && rok:
			v = pick(lv, rv, b, bok || r.st.StructureSynced)
		case lok:
			v = lv
		case rok:
			v = rv
		default:
			continue
		}
		r.prefs[k] = v
		if !lok || v != lv {
			toLocal[k] = v
		}
		if !rok || v != rv {
			toRemote[k] = v
		}
		base[k] = v
	}
	if len(toLocal) > 0 {
		if err := r.local.PutPrefs(r.ctx, toLocal); err != nil {
			return err
		}
	}
	if len(toRemote) > 0 {
		ok, err := r.ok("prefs", r.remote.PutPrefs(r.ctx, toRemote))
		if err != nil {
			return err
		}
		if !ok {
			// Keep the old base for what the server didn't take.
			for k := range toRemote {
				if b, had := r.st.Prefs[k]; had {
					base[k] = b
				} else {
					delete(base, k)
				}
			}
		}
	}
	r.st.Prefs = base
	r.st.StructureSynced = true
	return nil
}

func markHandled(handled map[string]bool, s api.SyncStructure, spaceID string) {
	for _, v := range s.Vaults {
		if v.SpaceID == spaceID {
			handled[v.ID] = true
		}
	}
}

// forgetSpace drops a deleted space and its vaults from the base.
func (r *run) forgetSpace(id string, s api.SyncStructure) {
	delete(r.st.Spaces, id)
	for _, v := range s.Vaults {
		if v.SpaceID == id {
			delete(r.st.Vaults, v.ID)
			delete(r.st.Scopes, v.ID)
		}
	}
	for key := range r.st.Collections {
		if strings.HasPrefix(key, id+"/") {
			delete(r.st.Collections, key)
		}
	}
}

// vaultDeleted handles a vault that still exists on keeper but was deleted
// on the other side: deleted on keeper too unless keeper changed something
// in it (or refuses), else recreated on the other side.
func (r *run) vaultDeleted(keeper, other side, v api.SyncVault) error {
	changed, err := r.scopeChanged(keeper, v.ID)
	if err != nil {
		return err
	}
	if !changed {
		err := keeper.DeleteVault(r.ctx, v.ID)
		if err == nil {
			delete(r.st.Vaults, v.ID)
			delete(r.st.Scopes, v.ID)
			return nil
		}
		if !errors.Is(err, api.ErrSyncRefused) {
			return err
		}
	}
	ok, err := r.ok("vault "+v.Name, other.PutVault(r.ctx, v))
	if err != nil {
		return err
	}
	if ok {
		// Recreated empty: its contents copy over as new.
		delete(r.st.Scopes, v.ID)
		r.st.Vaults[v.ID] = v
	}
	return nil
}

func collectionHash(c notes.CollectionMeta) string {
	data, _ := json.Marshal(c)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func collectionIndex(s api.SyncStructure) map[string]notes.CollectionMeta {
	m := map[string]notes.CollectionMeta{}
	for spaceID, cols := range s.Collections {
		for _, c := range cols {
			m[spaceID+"/"+c.ID] = c
		}
	}
	return m
}

func (r *run) collection(key string, lC, rC map[string]notes.CollectionMeta) error {
	spaceID, _, _ := strings.Cut(key, "/")
	l, lok := lC[key]
	rc, rok := rC[key]
	b, bok := r.st.Collections[key]
	// put writes c to sd and records it as the base when sd took it.
	put := func(sd side, c notes.CollectionMeta) error {
		ok, err := r.ok("collection "+c.Name, sd.PutCollection(r.ctx, spaceID, c))
		if ok {
			r.st.Collections[key] = collectionHash(c)
		}
		return err
	}
	switch {
	case lok && rok:
		lh, rh := collectionHash(l), collectionHash(rc)
		switch {
		case lh == rh:
			r.st.Collections[key] = rh
		case bok && rh == b:
			return put(r.remote, l)
		default:
			return put(r.local, rc)
		}
	case lok:
		if bok && collectionHash(l) == b {
			err := r.local.DeleteCollection(r.ctx, spaceID, l.ID)
			if err == nil {
				delete(r.st.Collections, key)
				return nil
			}
			if !errors.Is(err, api.ErrSyncRefused) {
				return err
			}
		}
		return put(r.remote, l)
	case rok:
		if bok && collectionHash(rc) == b {
			err := r.remote.DeleteCollection(r.ctx, spaceID, rc.ID)
			if err == nil {
				delete(r.st.Collections, key)
				return nil
			}
			if !errors.Is(err, api.ErrSyncRefused) {
				return err
			}
		}
		return put(r.local, rc)
	default:
		delete(r.st.Collections, key)
	}
	return nil
}

// --- scope contents ---

var dateTitle = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

const notepadTitle = "Notepad"

// singletonKey names the notes there must be only one of: the Notepad (at
// the location the prefs give, default the root of home) and the daily
// note of a date (journal store, folder Journal). "" for other notes.
func (r *run) singletonKey(scope string, info api.SyncNoteInfo) string {
	vault := r.prefs["notepadVault"]
	if vault == "" {
		vault = "home"
	}
	if scope == vault && info.Title == notepadTitle && info.Collection == "" && info.Path == r.prefs["notepadFolder"] {
		return "notepad"
	}
	if scope == "journal" && info.Path == "Journal" && dateTitle.MatchString(info.Title) {
		return "daily:" + info.Title
	}
	return ""
}

// mergeBodies merges two versions of a singleton note, the server's first.
func mergeBodies(key, server, other string) string {
	if key == "notepad" {
		return MergeNotepad(server, other)
	}
	return MergeDaily(server, other, key[len("daily:"):])
}

// scopeRun is the state of one scope during a run.
type scopeRun struct {
	*run
	scope string
	lm    api.SyncManifest
	rm    api.SyncManifest
	b     *scopeBase
	// skip are notes this run leaves alone (a singleton merge that didn't
	// go through): their base stays, the next run decides again.
	skip map[string]bool
	// copied are attachments this run placed on a side. The manifests were
	// taken before that, so the deletion step must not read their absence
	// as "deleted on the other side" (a cover only the frontmatter
	// references has no refs to protect it either).
	copied map[string]bool
}

// syncScope brings one scope in line on both sides. A scope with an
// unreadable note is left out of the run (reported in the status), so the
// note can't look deleted.
func (r *run) syncScope(scope string) error {
	lm, err := r.local.Manifest(r.ctx, scope)
	if err == nil {
		var rm api.SyncManifest
		if rm, err = r.remote.Manifest(r.ctx, scope); err == nil {
			return r.syncScopeWith(scope, lm, rm)
		}
	}
	if errors.Is(err, api.ErrSyncUnreadable) {
		log.Printf("sync: scope %s left out: %v", scope, err)
		r.problems = append(r.problems, err.Error())
		return nil
	}
	return r.soft("scope "+scope, err)
}

func (r *run) syncScopeWith(scope string, lm, rm api.SyncManifest) error {
	b := r.st.scope(scope)
	// A side that is suddenly empty where the base had several items was
	// most likely wiped or replaced, not cleaned up note by note: its
	// "deletions" aren't propagated, the scope merges as if it had never
	// been synced. Deleting the one note a scope had syncs normally (the
	// deletion keeps the last version in history).
	hadContent := len(b.Notes)+len(b.Attachments) >= 2
	empty := func(m api.SyncManifest) bool { return len(m.Notes) == 0 && len(m.Attachments) == 0 }
	if hadContent && (empty(lm) || empty(rm)) {
		log.Printf("sync: scope %s is empty on one side; not deleting its %d notes on the other", scope, len(b.Notes))
		b = newScopeBase()
		r.st.Scopes[scope] = b
	}
	s := &scopeRun{run: r, scope: scope, lm: lm, rm: rm, b: b, skip: map[string]bool{}, copied: map[string]bool{}}
	for _, step := range []func() error{s.singletons, s.copyAttachments, s.notes, s.deleteAttachments, s.folders, s.lists} {
		if err := step(); err != nil {
			return err
		}
	}
	s.b.Synced = true
	return nil
}

func (s *scopeRun) setBase(id string, info api.SyncNoteInfo) {
	s.b.Notes[id] = baseNote{Hash: info.Hash, UpdatedAt: info.UpdatedAt.UTC().Format(time.RFC3339Nano)}
}

// singletons merges a Notepad or daily note that is new on the device into
// a different note with the same role on the server (its id survives), so
// they don't end up side by side.
func (s *scopeRun) singletons() error {
	for _, xid := range sortedKeys(s.lm.Notes) {
		x, still := s.lm.Notes[xid]
		if !still || s.skip[xid] {
			continue
		}
		key := s.singletonKey(s.scope, x)
		if key == "" {
			continue
		}
		if _, onRemote := s.rm.Notes[xid]; onRemote {
			continue
		}
		if _, inBase := s.b.Notes[xid]; inBase {
			continue
		}
		yid := ""
		for _, id := range sortedKeys(s.rm.Notes) {
			if id != xid && !s.skip[id] && s.singletonKey(s.scope, s.rm.Notes[id]) == key {
				yid = id
				break
			}
		}
		if yid == "" {
			continue
		}
		ok, err := s.ok("merge "+key, s.mergeInto(key, xid, yid))
		if err != nil {
			return err
		}
		if !ok {
			// Half done (e.g. the note changed meanwhile): neither note is
			// touched again this run, or the device's one would be copied
			// to the server as a second Notepad.
			s.skip[xid], s.skip[yid] = true, true
		}
	}
	return nil
}

// mergeInto merges the device's note xid into the server's note yid and
// gives the result yid on both sides; the device's xid goes last.
func (s *scopeRun) mergeInto(key, xid, yid string) error {
	y, err := s.remote.GetNote(s.ctx, s.scope, yid)
	if err != nil {
		return err
	}
	x, err := s.local.GetNote(s.ctx, s.scope, xid)
	if err != nil {
		return err
	}
	body := mergeBodies(key, y.Body, x.Body)
	if ly, ok := s.lm.Notes[yid]; ok && ly.Hash != s.rm.Notes[yid].Hash {
		lyNote, err := s.local.GetNote(s.ctx, s.scope, yid)
		if err != nil {
			return err
		}
		body = mergeBodies(key, body, lyNote.Body)
	}
	merged := y
	if body != y.Body {
		merged.Body = body
		merged.Meta.UpdatedAt = s.now().UTC()
		info, err := s.remote.PutNote(s.ctx, s.scope, merged, s.rm.Notes[yid].Hash)
		if err != nil {
			return err
		}
		s.rm.Notes[yid] = info
	}
	info, err := s.local.PutNote(s.ctx, s.scope, merged, s.lm.Notes[yid].Hash)
	if err != nil {
		return err
	}
	s.lm.Notes[yid] = info
	s.setBase(yid, info)
	if err := s.local.DeleteNote(s.ctx, s.scope, xid, s.lm.Notes[xid].Hash); err != nil {
		return err
	}
	delete(s.lm.Notes, xid)
	return nil
}

// copyNote moves a note's current version from one side to the other.
func (s *scopeRun) copyNote(from, to side, id, expect string) (api.SyncNoteInfo, error) {
	n, err := from.GetNote(s.ctx, s.scope, id)
	if err != nil {
		return api.SyncNoteInfo{}, err
	}
	return to.PutNote(s.ctx, s.scope, n, expect)
}

func (s *scopeRun) notes() error {
	ids := orderedIDs(sortedKeys(s.rm.Notes), sortedKeys(s.lm.Notes), sortedKeys(s.b.Notes))
	for _, id := range ids {
		if s.skip[id] {
			continue
		}
		l, lok := s.lm.Notes[id]
		rn, rok := s.rm.Notes[id]
		b, bok := s.b.Notes[id]
		var err error
		switch {
		case lok && rok:
			err = s.both(id, l, rn, b.Hash, bok)
		case lok && (!bok || l.Hash != b.Hash):
			// New on the device, or changed there while the server deleted
			// it: the server gets it (same id).
			var info api.SyncNoteInfo
			if info, err = s.copyNote(s.local, s.remote, id, ""); err == nil {
				s.setBase(id, info)
			}
		case lok:
			if err = s.local.DeleteNote(s.ctx, s.scope, id, l.Hash); err == nil {
				delete(s.b.Notes, id)
			}
		case rok && (!bok || rn.Hash != b.Hash):
			var info api.SyncNoteInfo
			if info, err = s.copyNote(s.remote, s.local, id, ""); err == nil {
				s.setBase(id, info)
			}
		case rok:
			if err = s.remote.DeleteNote(s.ctx, s.scope, id, rn.Hash); err == nil {
				delete(s.b.Notes, id)
			}
		default:
			delete(s.b.Notes, id)
		}
		if err := s.soft("note "+id, err); err != nil {
			return err
		}
	}
	return nil
}

// both handles a note both sides have.
func (s *scopeRun) both(id string, l, rn api.SyncNoteInfo, base string, hasBase bool) error {
	switch {
	case l.Hash == rn.Hash:
		s.setBase(id, rn)
		return nil
	case hasBase && l.Hash == base:
		info, err := s.copyNote(s.remote, s.local, id, l.Hash)
		if err == nil {
			s.setBase(id, info)
		}
		return err
	case hasBase && rn.Hash == base:
		info, err := s.copyNote(s.local, s.remote, id, rn.Hash)
		if err == nil {
			s.setBase(id, info)
		}
		return err
	}
	// Changed on both sides (or never synced and different).
	ln, err := s.local.GetNote(s.ctx, s.scope, id)
	if err != nil {
		return err
	}
	srv, err := s.remote.GetNote(s.ctx, s.scope, id)
	if err != nil {
		return err
	}
	if key := s.singletonKey(s.scope, rn); key != "" {
		merged := srv
		merged.Body = mergeBodies(key, srv.Body, ln.Body)
		if merged.Body != srv.Body {
			merged.Meta.UpdatedAt = s.now().UTC()
			if _, err := s.remote.PutNote(s.ctx, s.scope, merged, rn.Hash); err != nil {
				return err
			}
		}
		info, err := s.local.PutNote(s.ctx, s.scope, merged, l.Hash)
		if err == nil {
			s.setBase(id, info)
		}
		return err
	}
	// The device's version becomes an offline copy on both sides first;
	// only then does the server's version replace it on the device, so a
	// run that stops halfway can't lose it.
	cp := ln
	now := s.now().UTC()
	cp.Meta.ID = notes.NewID()
	cp.Meta.Title = ln.Meta.Title + " (offline copy)"
	cp.Meta.CreatedAt, cp.Meta.UpdatedAt = now, now
	cpInfo, err := s.remote.PutNote(s.ctx, s.scope, cp, "")
	if err != nil {
		return err
	}
	if _, err := s.local.PutNote(s.ctx, s.scope, cp, ""); err != nil {
		return err
	}
	s.setBase(cp.Meta.ID, cpInfo)
	s.conflicts++
	// The device's version is safe in the copy now: it counts as the base,
	// so if replacing it fails below, the next run just takes the server's
	// version instead of making a second copy.
	s.setBase(id, l)
	info, err := s.local.PutNote(s.ctx, s.scope, srv, l.Hash)
	if err != nil {
		return err
	}
	s.setBase(id, info)
	return nil
}

// copyAttachments: presence-based (names are random, so a file never
// changes): new files go to the other side; the same path with a different
// size → the server's. Deletions wait until the notes are reconciled.
func (s *scopeRun) copyAttachments() error {
	for _, p := range orderedIDs(sortedKeys(s.rm.Attachments), sortedKeys(s.lm.Attachments)) {
		ls, lok := s.lm.Attachments[p]
		rs, rok := s.rm.Attachments[p]
		_, bok := s.b.Attachments[p]
		var err error
		switch {
		case lok && rok:
			if ls != rs {
				err = s.copyAttachment(s.remote, s.local, p)
			}
			if err == nil {
				s.b.Attachments[p] = rs
			}
		case lok && (!bok || s.referenced(p)):
			if err = s.copyAttachment(s.local, s.remote, p); err == nil {
				s.b.Attachments[p] = ls
				s.copied[p] = true
			}
		case rok && (!bok || s.referenced(p)):
			if err = s.copyAttachment(s.remote, s.local, p); err == nil {
				s.b.Attachments[p] = rs
				s.copied[p] = true
			}
		}
		if err := s.soft("attachment "+p, err); err != nil {
			return err
		}
	}
	return nil
}

// deleteAttachments propagates attachment deletions, never of a file a note
// on either side still points to, and never of a file this run just copied:
// the manifests predate the copy, so their silence about the other side
// means "was never there", not "was deleted".
func (s *scopeRun) deleteAttachments() error {
	for _, p := range orderedIDs(sortedKeys(s.rm.Attachments), sortedKeys(s.lm.Attachments), sortedKeys(s.b.Attachments)) {
		if s.copied[p] {
			continue
		}
		_, lok := s.lm.Attachments[p]
		_, rok := s.rm.Attachments[p]
		_, bok := s.b.Attachments[p]
		var err error
		switch {
		case lok && rok, !bok:
			continue
		case !lok && !rok:
			delete(s.b.Attachments, p)
			continue
		case s.referenced(p):
			continue // copied over by copyAttachments
		case lok:
			if err = s.local.DeleteAttachment(s.ctx, s.scope, p); err == nil {
				delete(s.b.Attachments, p)
			}
		default:
			if err = s.remote.DeleteAttachment(s.ctx, s.scope, p); err == nil {
				delete(s.b.Attachments, p)
			}
		}
		if err := s.soft("attachment "+p, err); err != nil {
			return err
		}
	}
	return nil
}

// referenced reports whether a note on either side (as the run started)
// points to the attachment. Notes only move between the sides in a run, so
// that covers every body there is after the notes step too.
func (s *scopeRun) referenced(p string) bool {
	return slices.Contains(s.lm.Refs, p) || slices.Contains(s.rm.Refs, p)
}

func (s *scopeRun) copyAttachment(from, to side, p string) error {
	data, err := from.GetAttachment(s.ctx, s.scope, p)
	if err != nil {
		return err
	}
	return to.PutAttachment(s.ctx, s.scope, p, data)
}

// folders: union; a folder goes only when the other side still has it as
// in the base, and only while it's empty. Labels per folder, the server's
// when both changed. The base changes only if both sides took the change.
func (s *scopeRun) folders() error {
	lf, rf := set(s.lm.Folders), set(s.rm.Folders)
	var toLocal, toRemote api.SyncFolderChange
	next := map[string]bool{}
	for _, p := range orderedIDs(s.rm.Folders, s.lm.Folders, sortedKeys(s.b.Folders)) {
		switch {
		case lf[p] && rf[p]:
			next[p] = true
		case lf[p] && !s.b.Folders[p]:
			toRemote.Create = append(toRemote.Create, p)
			next[p] = true
		case lf[p]:
			toLocal.Remove = append(toLocal.Remove, p)
		case rf[p] && !s.b.Folders[p]:
			toLocal.Create = append(toLocal.Create, p)
			next[p] = true
		case rf[p]:
			toRemote.Remove = append(toRemote.Remove, p)
		}
	}
	labels := map[string]string{}
	for _, p := range orderedIDs(sortedKeys(s.rm.Labels), sortedKeys(s.lm.Labels), sortedKeys(s.b.Labels)) {
		b, bok := s.b.Labels[p]
		v := pick(s.lm.Labels[p], s.rm.Labels[p], b, bok || s.b.Synced)
		if v != s.lm.Labels[p] {
			if toLocal.Labels == nil {
				toLocal.Labels = map[string]string{}
			}
			toLocal.Labels[p] = v
		}
		if v != s.rm.Labels[p] {
			if toRemote.Labels == nil {
				toRemote.Labels = map[string]string{}
			}
			toRemote.Labels[p] = v
		}
		if v != "" {
			labels[p] = v
		}
	}
	done := true
	if len(toLocal.Create)+len(toLocal.Remove)+len(toLocal.Labels) > 0 {
		ok, err := s.ok("folders", s.local.ChangeFolders(s.ctx, s.scope, toLocal))
		if err != nil {
			return err
		}
		done = done && ok
	}
	if len(toRemote.Create)+len(toRemote.Remove)+len(toRemote.Labels) > 0 {
		ok, err := s.ok("folders", s.remote.ChangeFolders(s.ctx, s.scope, toRemote))
		if err != nil {
			return err
		}
		done = done && ok
	}
	if done {
		s.b.Folders = next
		s.b.Labels = labels
	}
	return nil
}

func set(items []string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, i := range items {
		m[i] = true
	}
	return m
}

// mergeList is the three-way rule for bookmarks and shortcuts: the side
// that changed wins; when both did, the union, the server's order first.
func mergeList(l, r, b []string, hasBase bool) []string {
	switch {
	case slices.Equal(l, r):
		return r
	case hasBase && slices.Equal(l, b):
		return r
	case hasBase && slices.Equal(r, b):
		return l
	}
	out := slices.Clone(r)
	seen := set(r)
	for _, id := range l {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func (s *scopeRun) lists() error {
	hasBase := s.b.Synced
	bm := mergeList(s.lm.Bookmarks, s.rm.Bookmarks, s.b.Bookmarks, hasBase)
	sc := mergeList(s.lm.Shortcuts, s.rm.Shortcuts, s.b.Shortcuts, hasBase)
	var toLocal, toRemote api.SyncLists
	if !slices.Equal(bm, s.lm.Bookmarks) {
		toLocal.Bookmarks = bm
	}
	if !slices.Equal(sc, s.lm.Shortcuts) {
		toLocal.Shortcuts = sc
	}
	if !slices.Equal(bm, s.rm.Bookmarks) {
		toRemote.Bookmarks = bm
	}
	if !slices.Equal(sc, s.rm.Shortcuts) {
		toRemote.Shortcuts = sc
	}
	done := true
	if toLocal.Bookmarks != nil || toLocal.Shortcuts != nil {
		ok, err := s.ok("lists", s.local.PutLists(s.ctx, s.scope, toLocal))
		if err != nil {
			return err
		}
		done = done && ok
	}
	if toRemote.Bookmarks != nil || toRemote.Shortcuts != nil {
		ok, err := s.ok("lists", s.remote.PutLists(s.ctx, s.scope, toRemote))
		if err != nil {
			return err
		}
		done = done && ok
	}
	if done {
		// A non-nil empty list records "synced, empty" as base.
		s.b.Bookmarks = append([]string{}, bm...)
		s.b.Shortcuts = append([]string{}, sc...)
	}
	return nil
}

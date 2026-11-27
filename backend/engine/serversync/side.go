package serversync

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"nexote/api"
	"nexote/notes"
)

// side is one end of a sync: the same primitives on the engine's own data
// (localSide, direct calls) and on the server (remoteSide, the /api/sync/
// routes). Errors: api.ErrSyncConflict (the item changed since it was
// read), api.ErrSyncRefused (a structure change the side won't make),
// notes.ErrNotFound, errRevoked (remote only), anything else aborts the run.
type side interface {
	Structure(ctx context.Context) (api.SyncStructure, error)
	PutPrefs(ctx context.Context, prefs map[string]string) error
	PutSpace(ctx context.Context, s api.SyncSpace) error
	DeleteSpace(ctx context.Context, id string) error
	PutVault(ctx context.Context, v api.SyncVault) error
	DeleteVault(ctx context.Context, id string) error
	PutCollection(ctx context.Context, spaceID string, col notes.CollectionMeta) error
	DeleteCollection(ctx context.Context, spaceID, id string) error

	Manifest(ctx context.Context, scope string) (api.SyncManifest, error)
	GetNote(ctx context.Context, scope, id string) (api.SyncNote, error)
	PutNote(ctx context.Context, scope string, note api.SyncNote, expect string) (api.SyncNoteInfo, error)
	DeleteNote(ctx context.Context, scope, id, expect string) error
	GetAttachment(ctx context.Context, scope, path string) ([]byte, error)
	PutAttachment(ctx context.Context, scope, path string, data []byte) error
	DeleteAttachment(ctx context.Context, scope, path string) error
	ChangeFolders(ctx context.Context, scope string, change api.SyncFolderChange) error
	PutLists(ctx context.Context, scope string, lists api.SyncLists) error
}

// errRevoked: the server refused the device token.
var errRevoked = errors.New("This device was disconnected on the server. Pair it again to keep syncing.")

// localSide is the engine's own data, as its local user.
type localSide struct {
	h    *api.Handler
	user string
}

func (l localSide) Structure(context.Context) (api.SyncStructure, error) {
	return l.h.SyncStructure(l.user)
}
func (l localSide) PutPrefs(_ context.Context, prefs map[string]string) error {
	return l.h.SyncPutPrefs(l.user, prefs)
}
func (l localSide) PutSpace(_ context.Context, s api.SyncSpace) error {
	return l.h.SyncPutSpace(l.user, s)
}
func (l localSide) DeleteSpace(_ context.Context, id string) error {
	return l.h.SyncDeleteSpace(l.user, id)
}
func (l localSide) PutVault(_ context.Context, v api.SyncVault) error {
	return l.h.SyncPutVault(l.user, v)
}
func (l localSide) DeleteVault(_ context.Context, id string) error {
	return l.h.SyncDeleteVault(l.user, id)
}
func (l localSide) PutCollection(_ context.Context, spaceID string, col notes.CollectionMeta) error {
	return l.h.SyncPutCollection(l.user, spaceID, col)
}
func (l localSide) DeleteCollection(_ context.Context, spaceID, id string) error {
	return l.h.SyncDeleteCollection(l.user, spaceID, id)
}
func (l localSide) Manifest(_ context.Context, scope string) (api.SyncManifest, error) {
	return l.h.SyncManifest(l.user, scope)
}
func (l localSide) GetNote(_ context.Context, scope, id string) (api.SyncNote, error) {
	return l.h.SyncGetNote(l.user, scope, id)
}
func (l localSide) PutNote(_ context.Context, scope string, note api.SyncNote, expect string) (api.SyncNoteInfo, error) {
	return l.h.SyncPutNote(l.user, scope, note, expect)
}
func (l localSide) DeleteNote(_ context.Context, scope, id, expect string) error {
	return l.h.SyncDeleteNote(l.user, scope, id, expect)
}
func (l localSide) GetAttachment(_ context.Context, scope, path string) ([]byte, error) {
	return l.h.SyncReadAttachment(l.user, scope, path)
}
func (l localSide) PutAttachment(_ context.Context, scope, path string, data []byte) error {
	return l.h.SyncWriteAttachment(l.user, scope, path, data)
}
func (l localSide) DeleteAttachment(_ context.Context, scope, path string) error {
	return l.h.SyncDeleteAttachment(l.user, scope, path)
}
func (l localSide) ChangeFolders(_ context.Context, scope string, change api.SyncFolderChange) error {
	return l.h.SyncChangeFolders(l.user, scope, change)
}
func (l localSide) PutLists(_ context.Context, scope string, lists api.SyncLists) error {
	return l.h.SyncPutLists(l.user, scope, lists)
}

// remoteSide is the server's sync API with the device token.
type remoteSide struct {
	s      *Service
	server *url.URL
	token  string
}

// syncError turns the server's answer into the errors the algorithm knows.
func (r remoteSide) syncError(err error) error {
	var se *serverError
	if !errors.As(err, &se) {
		return err
	}
	switch {
	case se.status == http.StatusUnauthorized:
		return errRevoked
	case se.code == "conflict":
		return api.ErrSyncConflict
	case se.code == "refused":
		return fmt.Errorf("%w: %s", api.ErrSyncRefused, se.message)
	case se.code == "unreadable":
		return fmt.Errorf("%w (on the server): %s", api.ErrSyncUnreadable, se.message)
	case se.status == http.StatusNotFound:
		return notes.ErrNotFound
	}
	return err
}

func (r remoteSide) do(ctx context.Context, method, path string, body, out any) error {
	return r.syncError(r.s.call(ctx, r.server, method, path, r.token, body, out))
}

func scopePath(scope string) string { return "/api/sync/scopes/" + url.PathEscape(scope) }

// attachmentPath escapes each segment of an attachment's path.
func attachmentPath(scope, path string) string {
	parts := strings.Split(path, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return scopePath(scope) + "/attachments/" + strings.Join(parts, "/")
}

func (r remoteSide) Structure(ctx context.Context) (api.SyncStructure, error) {
	var s api.SyncStructure
	err := r.do(ctx, http.MethodGet, "/api/sync/structure", nil, &s)
	return s, err
}
func (r remoteSide) PutPrefs(ctx context.Context, prefs map[string]string) error {
	return r.do(ctx, http.MethodPut, "/api/sync/prefs", prefs, nil)
}
func (r remoteSide) PutSpace(ctx context.Context, s api.SyncSpace) error {
	return r.do(ctx, http.MethodPut, "/api/sync/spaces/"+url.PathEscape(s.ID), s, nil)
}
func (r remoteSide) DeleteSpace(ctx context.Context, id string) error {
	return r.do(ctx, http.MethodDelete, "/api/sync/spaces/"+url.PathEscape(id), nil, nil)
}
func (r remoteSide) PutVault(ctx context.Context, v api.SyncVault) error {
	return r.do(ctx, http.MethodPut, "/api/sync/vaults/"+url.PathEscape(v.ID), v, nil)
}
func (r remoteSide) DeleteVault(ctx context.Context, id string) error {
	return r.do(ctx, http.MethodDelete, "/api/sync/vaults/"+url.PathEscape(id), nil, nil)
}
func (r remoteSide) PutCollection(ctx context.Context, spaceID string, col notes.CollectionMeta) error {
	return r.do(ctx, http.MethodPut, "/api/sync/spaces/"+url.PathEscape(spaceID)+"/collections/"+url.PathEscape(col.ID), col, nil)
}
func (r remoteSide) DeleteCollection(ctx context.Context, spaceID, id string) error {
	return r.do(ctx, http.MethodDelete, "/api/sync/spaces/"+url.PathEscape(spaceID)+"/collections/"+url.PathEscape(id), nil, nil)
}
func (r remoteSide) Manifest(ctx context.Context, scope string) (api.SyncManifest, error) {
	var m api.SyncManifest
	err := r.do(ctx, http.MethodGet, scopePath(scope), nil, &m)
	return m, err
}
func (r remoteSide) GetNote(ctx context.Context, scope, id string) (api.SyncNote, error) {
	var n api.SyncNote
	err := r.do(ctx, http.MethodGet, scopePath(scope)+"/notes/"+url.PathEscape(id), nil, &n)
	return n, err
}
func (r remoteSide) PutNote(ctx context.Context, scope string, note api.SyncNote, expect string) (api.SyncNoteInfo, error) {
	var info api.SyncNoteInfo
	body := struct {
		Note   api.SyncNote `json:"note"`
		Expect string       `json:"expect"`
	}{note, expect}
	err := r.do(ctx, http.MethodPut, scopePath(scope)+"/notes/"+url.PathEscape(note.Meta.ID), body, &info)
	return info, err
}
func (r remoteSide) DeleteNote(ctx context.Context, scope, id, expect string) error {
	return r.do(ctx, http.MethodDelete, scopePath(scope)+"/notes/"+url.PathEscape(id)+"?expect="+url.QueryEscape(expect), nil, nil)
}
func (r remoteSide) GetAttachment(ctx context.Context, scope, path string) ([]byte, error) {
	data, err := r.s.callRaw(ctx, r.server, http.MethodGet, attachmentPath(scope, path), r.token, nil)
	return data, r.syncError(err)
}
func (r remoteSide) PutAttachment(ctx context.Context, scope, path string, data []byte) error {
	_, err := r.s.callRaw(ctx, r.server, http.MethodPut, attachmentPath(scope, path), r.token, data)
	return r.syncError(err)
}
func (r remoteSide) DeleteAttachment(ctx context.Context, scope, path string) error {
	return r.do(ctx, http.MethodDelete, attachmentPath(scope, path), nil, nil)
}
func (r remoteSide) ChangeFolders(ctx context.Context, scope string, change api.SyncFolderChange) error {
	return r.do(ctx, http.MethodPost, scopePath(scope)+"/folders", change, nil)
}
func (r remoteSide) PutLists(ctx context.Context, scope string, lists api.SyncLists) error {
	return r.do(ctx, http.MethodPut, scopePath(scope)+"/lists", lists, nil)
}

// done tells the server the device finished a sync and returns the time
// the server recorded for it.
func (r remoteSide) done(ctx context.Context) (time.Time, error) {
	var out struct {
		LastSyncAt time.Time `json:"lastSyncAt"`
	}
	err := r.do(ctx, http.MethodPost, "/api/sync/done", struct{}{}, &out)
	return out.LastSyncAt, err
}

// callRaw sends and receives raw bytes (attachments). It uses the
// attachment client, whose time limit fits a large PDF on a slow network.
func (s *Service) callRaw(ctx context.Context, server *url.URL, method, path, token string, body []byte) ([]byte, error) {
	var payload io.Reader
	if body != nil {
		payload = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, server.String()+path, payload)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	res, err := s.attachmentClient().Do(req)
	if err != nil {
		return nil, describeError(server, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxAttachment))
	if err != nil {
		return nil, describeError(server, err)
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, newServerError(server, res.StatusCode, data)
	}
	return data, nil
}

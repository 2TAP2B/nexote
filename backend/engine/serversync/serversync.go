// Package serversync connects the app's engine to a Nexote server. Pairing
// trades the one-time code from the server's QR code for a device token that
// may only call the server's sync API (/api/sync/*); the connection (server,
// token, device, user) is kept by the Host, never in the data folder, which
// is user-visible and may be copied around by other sync tools.
//
// The engine serves this package's routes under /api/local/sync behind its
// secret cookie: GET (state, re-checking the token at most once a minute),
// POST …/pair, DELETE (unpair).
package serversync

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Host keeps secrets outside the data folder (on Android: encrypted with a
// key in the AndroidKeyStore) and names the device for the server's list.
type Host interface {
	// LoadSecret returns the secret saved under name, "" if none.
	LoadSecret(name string) (string, error)
	// SaveSecret saves value under name; "" deletes it.
	SaveSecret(name, value string) error
	// DeviceName is how the server lists this device, e.g. "Google Pixel 8".
	DeviceName() string
	// StateDir is an existing app-private directory for the sync state
	// (the base of the last sync), never the user-visible data folder.
	StateDir() string
}

// secretName is the Host secret holding the connection as JSON.
const secretName = "sync"

const (
	// recheckInterval bounds how often a status request asks the server
	// whether the token still works.
	recheckInterval = 60 * time.Second
	// unpairTimeout bounds the best-effort unpair calls, so disconnecting
	// from an unreachable server doesn't keep the user waiting long.
	unpairTimeout = 10 * time.Second
	// maxBody bounds what is read from the page and from the server (a
	// sync manifest of a large vault is several MB).
	maxBody = 64 << 20
	// maxAttachment bounds a downloaded attachment (PDFs may be 50 MB).
	maxAttachment = 64 << 20
	// attachmentTimeout bounds one attachment transfer.
	attachmentTimeout = 5 * time.Minute

	defaultDeviceName = "Android device"
	maxDeviceName     = 64
)

// User is the server account a device is paired with.
type User struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

// Device is this device's entry on the server.
type Device struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// credentials is the saved connection (the Host secret "sync").
type credentials struct {
	// Server is the origin the device talks to, as the user entered it.
	Server string `json:"server"`
	Token  string `json:"token"`
	Device Device `json:"device"`
	User   User   `json:"user"`
	// Revoked is set when the server rejected the token; the connection is
	// kept so the page can say so until the user disconnects or pairs again.
	Revoked bool `json:"revoked,omitempty"`
}

// Service is the engine's connection to a Nexote server.
type Service struct {
	host Host
	now  func() time.Time

	clientMu sync.Mutex
	client   *http.Client
	userCAs  string

	// ops serializes pairing and disconnecting, which talk to the server
	// before changing the saved connection.
	ops sync.Mutex

	mu        sync.Mutex
	loaded    bool
	creds     *credentials
	lastCheck time.Time

	// sched is the sync scheduler, running while a local handler is
	// attached (see scheduler.go).
	sched scheduler
	// localHook wraps the device's side of a run (tests inject failures).
	localHook func(side) side
}

// New returns a Service keeping its connection in host and trusting the
// device's roots plus userCAs (a PEM bundle, may be empty).
func New(host Host, userCAs string) *Service {
	return &Service{host: host, now: time.Now, userCAs: userCAs}
}

// SetUserCAs replaces the user-installed CAs trusted for server connections.
func (s *Service) SetUserCAs(pem string) {
	s.clientMu.Lock()
	defer s.clientMu.Unlock()
	if pem == s.userCAs {
		return
	}
	s.userCAs = pem
	if s.client != nil {
		s.client.CloseIdleConnections()
		s.client = nil
	}
}

func (s *Service) httpClient() *http.Client {
	s.clientMu.Lock()
	defer s.clientMu.Unlock()
	if s.client == nil {
		s.client = newHTTPClient(s.userCAs)
	}
	return s.client
}

// attachmentClient is httpClient with a time limit fit for large files.
func (s *Service) attachmentClient() *http.Client {
	c := *s.httpClient()
	c.Timeout = attachmentTimeout
	return &c
}

// current returns the saved connection (nil if none), reading it from the
// host the first time.
func (s *Service) current() (*credentials, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.loaded {
		raw, err := s.host.LoadSecret(secretName)
		if err != nil {
			return nil, fmt.Errorf("Can't read the saved server connection: %v", err)
		}
		if raw != "" {
			var c credentials
			if err := json.Unmarshal([]byte(raw), &c); err != nil || c.Server == "" || c.Token == "" {
				// Nothing can be done with it; the user pairs again.
				log.Printf("sync: ignoring an unreadable saved connection")
			} else {
				s.creds = &c
			}
		}
		s.loaded = true
	}
	return s.creds, nil
}

// save replaces the saved connection (nil forgets it). Callers hold s.mu.
func (s *Service) save(c *credentials) error {
	value := ""
	if c != nil {
		data, err := json.Marshal(c)
		if err != nil {
			return err
		}
		value = string(data)
	}
	if err := s.host.SaveSecret(secretName, value); err != nil {
		return err
	}
	s.creds, s.loaded = c, true
	return nil
}

// update applies change to the saved connection if it still holds token
// (a pairing or disconnect may have replaced it meanwhile).
func (s *Service) update(token string, change func(*credentials)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.creds == nil || s.creds.Token != token {
		return
	}
	next := *s.creds
	change(&next)
	if next == *s.creds {
		return
	}
	if err := s.save(&next); err != nil {
		log.Printf("sync: saving the connection: %v", err)
	}
}

// status returns the connection, first asking the server whether the token
// still works when the last answer is older than recheckInterval. Requests
// arriving during a check get the state from before it.
func (s *Service) status(ctx context.Context) (*credentials, error) {
	c, err := s.current()
	if err != nil || c == nil {
		return nil, err
	}
	if c.Revoked || !s.dueForCheck() {
		return c, nil
	}
	server, err := ParseServer(c.Server)
	if err != nil {
		return c, nil
	}
	var hello helloResponse
	err = s.call(ctx, server, http.MethodGet, "/api/sync/hello", c.Token, nil, &hello)
	var rejected *serverError
	switch {
	case err == nil:
		s.update(c.Token, func(next *credentials) {
			next.User = hello.User
			next.Device = hello.Device
		})
	case errors.As(err, &rejected) && rejected.status == http.StatusUnauthorized:
		s.update(c.Token, func(next *credentials) { next.Revoked = true })
	default:
		// Offline or the server is down: nothing is known about the token.
	}
	c, err = s.current()
	return c, err
}

func (s *Service) dueForCheck() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if !s.lastCheck.IsZero() && now.Sub(s.lastCheck) < recheckInterval {
		return false
	}
	s.lastCheck = now
	return true
}

// pairInput is the page's request: a pairing link, or server and code.
type pairInput struct {
	Link   string `json:"link"`
	Server string `json:"server"`
	Code   string `json:"code"`
}

func (in pairInput) target() (*url.URL, string, error) {
	if strings.TrimSpace(in.Link) != "" {
		return ParseLink(in.Link)
	}
	server, err := ParseServer(in.Server)
	if err != nil {
		return nil, "", err
	}
	code, err := NormalizeCode(in.Code)
	if err != nil {
		return nil, "", err
	}
	return server, code, nil
}

type pairRequest struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Platform string `json:"platform"`
}

type pairResponse struct {
	Token  string `json:"token"`
	Device Device `json:"device"`
	User   User   `json:"user"`
	Origin string `json:"origin"`
}

type helloResponse struct {
	User   User   `json:"user"`
	Device Device `json:"device"`
	Origin string `json:"origin"`
}

// pair redeems a pairing code, checks the new token and saves the
// connection, replacing (and unpairing) an earlier one.
func (s *Service) pair(ctx context.Context, in pairInput) (*credentials, error) {
	server, code, err := in.target()
	if err != nil {
		return nil, err
	}
	s.ops.Lock()
	defer s.ops.Unlock()

	var paired pairResponse
	req := pairRequest{Code: code, Name: deviceName(s.host), Platform: "android"}
	if err := s.call(ctx, server, http.MethodPost, "/api/auth/pair", "", req, &paired); err != nil {
		var rejected *serverError
		if errors.As(err, &rejected) && rejected.status == http.StatusNotFound {
			return nil, fmt.Errorf("%s doesn't offer device pairing. Is it a Nexote server, and is it up to date?", server.Host)
		}
		return nil, err
	}
	if paired.Token == "" || paired.Device.ID == "" {
		return nil, fmt.Errorf("%s didn't answer like a Nexote server.", server.Host)
	}

	var hello helloResponse
	if err := s.call(ctx, server, http.MethodGet, "/api/sync/hello", paired.Token, nil, &hello); err != nil {
		s.unpair(server, paired.Token)
		return nil, fmt.Errorf("%s accepted the code but not the new device: %v", server.Host, err)
	}
	next := &credentials{Server: server.String(), Token: paired.Token, Device: hello.Device, User: hello.User}

	s.mu.Lock()
	previous := s.creds
	err = s.save(next)
	if err == nil {
		s.lastCheck = s.now()
	}
	s.mu.Unlock()
	if err != nil {
		s.unpair(server, paired.Token)
		return nil, fmt.Errorf("Paired, but this device couldn't save the connection: %v", err)
	}
	if previous != nil && !previous.Revoked {
		// The old token would otherwise stay listed on its server as a
		// device nobody uses.
		if old, err := ParseServer(previous.Server); err == nil {
			go s.unpair(old, previous.Token)
		}
	}
	s.cancelRun()
	s.resetStatus()
	// The first sync aligns the device with the account right away.
	s.SyncNow()
	return next, nil
}

// disconnect unpairs on the server as far as it can be reached, then
// forgets the connection.
func (s *Service) disconnect() error {
	s.ops.Lock()
	defer s.ops.Unlock()
	c, err := s.current()
	if err != nil {
		return err
	}
	if c == nil {
		return nil
	}
	s.cancelRun()
	if server, err := ParseServer(c.Server); err == nil && !c.Revoked {
		s.unpair(server, c.Token)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.save(nil); err != nil {
		return fmt.Errorf("Can't forget the server connection: %v", err)
	}
	removeState(s.host.StateDir())
	s.resetStatus()
	return nil
}

// unpair asks the server to revoke token, best effort.
func (s *Service) unpair(server *url.URL, token string) {
	ctx, cancel := context.WithTimeout(context.Background(), unpairTimeout)
	defer cancel()
	if err := s.call(ctx, server, http.MethodDelete, "/api/sync/device", token, nil, nil); err != nil {
		log.Printf("sync: unpairing from %s: %v", server.Host, err)
	}
}

// deviceName is the host's name for this device, fit for the server.
func deviceName(host Host) string {
	name := strings.TrimSpace(host.DeviceName())
	if utf8.RuneCountInString(name) > maxDeviceName {
		name = strings.TrimSpace(string([]rune(name)[:maxDeviceName]))
	}
	if name == "" {
		return defaultDeviceName
	}
	return name
}

// serverError is a non-2xx answer from the server; its message is the
// server's own error text when it sent one.
type serverError struct {
	host    string
	status  int
	message string
	// code is the sync API's error code ("conflict", "refused", …).
	code string
}

func (e *serverError) Error() string {
	if e.message != "" {
		return e.message
	}
	return fmt.Sprintf("%s answered with an error (%d %s).", e.host, e.status, http.StatusText(e.status))
}

// newServerError reads the server's {"error", "code"} answer.
func newServerError(server *url.URL, status int, data []byte) *serverError {
	var answer struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(data, &answer)
	return &serverError{host: server.Host, status: status, message: strings.TrimSpace(answer.Error), code: answer.Code}
}

// call sends a JSON request (body may be nil) to server, authenticated with
// token when set, and decodes a 2xx answer into out (nil: ignored).
func (s *Service) call(ctx context.Context, server *url.URL, method, path, token string, body, out any) error {
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, server.String()+path, payload)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := s.httpClient().Do(req)
	if err != nil {
		return describeError(server, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		return describeError(server, err)
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return newServerError(server, res.StatusCode, data)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("%s didn't answer like a Nexote server.", server.Host)
	}
	return nil
}

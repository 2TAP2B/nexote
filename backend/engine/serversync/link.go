package serversync

import (
	"errors"
	"net/url"
	"strings"
)

// codeAlphabet is Crockford's base32: no I, L, O or U, so a code read off a
// screen can't be mistyped into another valid one.
const codeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// codeLength is the number of characters in a pairing code (80 bits).
const codeLength = 16

var (
	errNotLink   = errors.New("This isn't a pairing link. Scan the QR code on the server's Devices page, or enter the server address and the code.")
	errNoServer  = errors.New("Enter the address of your Nexote server, like https://notes.example.com.")
	errNotHTTPS  = errors.New("The server address has to start with https:// (plain http only works for localhost).")
	errNotACode  = errors.New("This isn't a pairing code. It has 16 letters and digits, like ABCD-EFGH-JKMN-PQRS.")
	errBadServer = errors.New("This isn't a valid server address. It looks like https://notes.example.com.")
)

// ParseServer applies the server URL rule: https only, except plain http to
// the loopback names used in development (adb reverse). Only the origin
// counts; path, query and fragment are dropped. An address without a scheme
// is taken as https, since that's how people type host names.
func ParseServer(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errNoServer
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Opaque != "" || u.User != nil || u.Hostname() == "" || !validPort(u.Port()) {
		return nil, errBadServer
	}
	origin := &url.URL{Scheme: strings.ToLower(u.Scheme), Host: strings.ToLower(u.Host)}
	switch origin.Scheme {
	case "https":
		return origin, nil
	case "http":
		if isLoopbackName(origin.Hostname()) {
			return origin, nil
		}
	}
	return nil, errNotHTTPS
}

// validPort accepts no port or 1–5 digits (url.Parse lets "host:" through).
func validPort(port string) bool {
	if len(port) > 5 {
		return false
	}
	for _, c := range port {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// isLoopbackName is the http exception: exactly these three names, not any
// address that happens to be on the loopback network.
func isLoopbackName(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}

// ParseLink splits a pairing link (<origin>/pair#CODE) into the server's
// origin and the normalized code. The code sits in the fragment so it never
// reaches a server log; the path is not checked, the code is.
func ParseLink(raw string) (*url.URL, string, error) {
	raw = strings.TrimSpace(raw)
	hash := strings.IndexByte(raw, '#')
	if hash < 0 {
		return nil, "", errNotLink
	}
	fragment, err := url.PathUnescape(raw[hash+1:])
	if err != nil {
		return nil, "", errNotLink
	}
	code, err := NormalizeCode(fragment)
	if err != nil {
		return nil, "", errNotLink
	}
	server, err := ParseServer(raw[:hash])
	if err != nil {
		return nil, "", err
	}
	return server, code, nil
}

// NormalizeCode returns a pairing code in its display form
// (ABCD-EFGH-JKMN-PQRS): case, spaces and dashes don't matter, and the
// letters people confuse with digits (I, L, O) count as those digits.
func NormalizeCode(raw string) (string, error) {
	var b strings.Builder
	n := 0
	for _, c := range strings.ToUpper(raw) {
		switch c {
		case ' ', '-', '\t':
			continue
		case 'I', 'L':
			c = '1'
		case 'O':
			c = '0'
		}
		if !strings.ContainsRune(codeAlphabet, c) || n == codeLength {
			return "", errNotACode
		}
		if n > 0 && n%4 == 0 {
			b.WriteByte('-')
		}
		b.WriteRune(c)
		n++
	}
	if n != codeLength {
		return "", errNotACode
	}
	return b.String(), nil
}

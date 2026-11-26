package serversync

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

const (
	connectTimeout = 10 * time.Second
	requestTimeout = 30 * time.Second
)

// androidCertDirs are Android's root stores, newest first. Since Android 14
// the roots are updatable through the Conscrypt module in /apex; the copy in
// /system is frozen with the OS image and may still hold roots that have
// been distrusted since. Go only reads /system, so the apex store is loaded
// here and, when present, used instead.
var androidCertDirs = []string{
	"/apex/com.android.conscrypt/cacerts",
	"/system/etc/security/cacerts",
}

var (
	systemRootsOnce sync.Once
	systemRoots     *x509.CertPool
)

// baseRoots is the device's trusted roots, loaded once per process (reading
// a few hundred files isn't free). Callers get a copy to add to.
func baseRoots() *x509.CertPool {
	systemRootsOnce.Do(func() {
		if runtime.GOOS == "android" {
			for _, dir := range androidCertDirs {
				pool := x509.NewCertPool()
				if loadCertDir(pool, dir) > 0 {
					systemRoots = pool
					return
				}
			}
		}
		pool, err := x509.SystemCertPool()
		if err != nil {
			log.Printf("sync: no system roots: %v", err)
			pool = x509.NewCertPool()
		}
		systemRoots = pool
	})
	return systemRoots.Clone()
}

// loadCertDir adds every certificate file in dir to pool and returns how
// many were added. Android's files hold a text dump before the PEM block,
// which the PEM decoder skips.
func loadCertDir(pool *x509.CertPool, dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	n := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err == nil && pool.AppendCertsFromPEM(data) {
			n++
		}
	}
	return n
}

// newHTTPClient talks to Nexote servers: the device's roots plus the
// user-installed CAs (self-hosted servers often use a private CA), bounded
// connect and request times, and redirects only within the same origin, so
// a server can't bounce the device token to another host.
func newHTTPClient(userCAs string) *http.Client {
	roots := baseRoots()
	if userCAs != "" && !roots.AppendCertsFromPEM([]byte(userCAs)) {
		log.Printf("sync: the user CA bundle holds no certificate")
	}
	dialer := &net.Dialer{Timeout: connectTimeout, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialer.DialContext,
		TLSClientConfig:       &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout:   connectTimeout,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          4,
		IdleConnTimeout:       90 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   requestTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if !sameOrigin(req.URL, via[0].URL) {
				return fmt.Errorf("redirect to another server (%s)", req.URL.Host)
			}
			return nil
		},
	}
}

func sameOrigin(a, b *url.URL) bool {
	return a.Scheme == b.Scheme && a.Host == b.Host
}

// describeError turns a failed request into a sentence for the user.
func describeError(server *url.URL, err error) error {
	host := server.Host
	var unknownCA x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	var verify *tls.CertificateVerificationError
	var record tls.RecordHeaderError
	switch {
	case errors.As(err, &unknownCA):
		return fmt.Errorf("The connection to %s isn't trusted: its certificate comes from an unknown authority. If the server uses its own CA, install that certificate on this device.", host)
	case errors.As(err, &hostname):
		return fmt.Errorf("The connection to %s isn't trusted: its certificate is for a different name.", host)
	case errors.As(err, &invalid):
		return fmt.Errorf("The connection to %s isn't trusted: its certificate isn't valid (%v).", host, invalid)
	case errors.As(err, &verify):
		return fmt.Errorf("The connection to %s isn't trusted (%v).", host, verify.Err)
	case errors.As(err, &record):
		return fmt.Errorf("%s doesn't speak https on this address.", host)
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return fmt.Errorf("%s didn't answer in time. Check the address and your connection.", host)
	}
	return fmt.Errorf("Can't reach %s. Check the address and your connection.", host)
}

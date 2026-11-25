package engine

import (
	"bytes"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

// contentTypes covers the frontend export's file types explicitly: Android
// has no system MIME table, and Go's built-in one lacks some of them
// (.webmanifest, .woff2).
var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json",
	".map":         "application/json",
	".webmanifest": "application/manifest+json",
	".txt":         "text/plain; charset=utf-8",
	".woff2":       "font/woff2",
	".woff":        "font/woff",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".webp":        "image/webp",
	".ico":         "image/x-icon",
	".wasm":        "application/wasm",
}

func contentType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if t, ok := contentTypes[ext]; ok {
		return t
	}
	return mime.TypeByExtension(ext)
}

// static serves a Next.js static export like the standalone server would:
// clean URLs map to their .html files, the app's client-side routes fall
// back to index.html.
type static struct {
	web fs.FS
}

func newStatic(web fs.FS) *static { return &static{web: web} }

func (s *static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Cleaning first also keeps "/m//host" from turning into a
	// protocol-relative redirect.
	clean := path.Clean("/" + r.URL.Path)
	// The old phone routes live on as plain paths (frontend page.tsx).
	if clean == "/m" || strings.HasPrefix(clean, "/m/") {
		target := strings.TrimPrefix(clean, "/m")
		if target == "" {
			target = "/"
		}
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusFound)
		return
	}
	name := strings.TrimPrefix(clean, "/")
	if file, ok := s.find(name); ok {
		s.serve(w, r, file, http.StatusOK)
		return
	}
	if spaRoute(name) {
		s.serve(w, r, "index.html", http.StatusOK)
		return
	}
	if s.isFile("404.html") {
		s.serve(w, r, "404.html", http.StatusNotFound)
		return
	}
	http.NotFound(w, r)
}

// find maps a clean URL path to a file of the export: the exact file, then
// "x.html", then "x/index.html".
func (s *static) find(name string) (string, bool) {
	if name == "" {
		name = "index.html"
	}
	for _, candidate := range []string{name, name + ".html", name + "/index.html"} {
		if s.isFile(candidate) {
			return candidate, true
		}
	}
	return "", false
}

// isFile reports whether name is a regular file of the export. The web
// directory's .gitignore (it keeps the directory in git) is never served.
func (s *static) isFile(name string) bool {
	if path.Base(name) == ".gitignore" || !fs.ValidPath(name) {
		return false
	}
	info, err := fs.Stat(s.web, name)
	return err == nil && info.Mode().IsRegular()
}

// spaRoute reports whether a path is one of the app's client-side routes,
// which the export renders from index.html: /note/{vaultId}/{noteId},
// /journal/{noteId} and /dashboard.
func spaRoute(name string) bool {
	parts := strings.Split(name, "/")
	switch {
	case len(parts) == 3 && parts[0] == "note":
		return parts[1] != "" && parts[2] != ""
	case len(parts) == 2 && parts[0] == "journal":
		return parts[1] != ""
	default:
		return name == "dashboard"
	}
}

// serve writes one file of the export with its content type and cache
// policy: hashed build files never change, everything else is revalidated
// so an updated app shows up at once.
func (s *static) serve(w http.ResponseWriter, r *http.Request, name string, status int) {
	f, err := s.web.Open(name)
	if err != nil {
		http.Error(w, "file unavailable", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	if t := contentType(name); t != "" {
		w.Header().Set("Content-Type", t)
	}
	if strings.HasPrefix(name, "_next/static/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	if status == http.StatusOK {
		// embed.FS and os.DirFS files can seek, which gives HEAD and range
		// requests for free; anything else is read into memory once.
		if rs, ok := f.(io.ReadSeeker); ok {
			http.ServeContent(w, r, name, time.Time{}, rs)
			return
		}
		data, err := io.ReadAll(f)
		if err != nil {
			http.Error(w, "file unavailable", http.StatusInternalServerError)
			return
		}
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
		return
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, f)
	}
}

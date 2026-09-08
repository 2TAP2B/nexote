// Metadata lookup endpoints for collection items. The browser cannot call
// Discogs / Google Books directly (CORS + keeping the Discogs token
// server-side), so requests stream through these handlers — the same pattern
// as ai.go. Results are normalized into a shared shape the frontend maps
// onto collection fields.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"nexote/notes"
)

// MetadataConfig is the persisted lookup configuration. It lives at
// <NEXOTE_HOME>/metadata.json. Only the Discogs token is needed (Google
// Books works key-less, an optional key can be added later).
type MetadataConfig struct {
	DiscogsToken string `json:"discogsToken"`
}

func LoadMetadataConfig(root string) (MetadataConfig, error) {
	data, err := os.ReadFile(root + "/metadata.json")
	if err != nil {
		if os.IsNotExist(err) {
			return MetadataConfig{}, nil
		}
		return MetadataConfig{}, err
	}
	var cfg MetadataConfig
	_ = json.Unmarshal(data, &cfg)
	return cfg, nil
}

func SaveMetadataConfig(root string, cfg MetadataConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(root+"/metadata.json", data, 0o644)
}

// metadataFetch is the shared HTTP client for upstream metadata calls.
var metadataHTTPClient = &http.Client{Timeout: 15 * time.Second}

// MetadataResult is the normalized lookup result shared by all sources.
type MetadataResult struct {
	Source      string   `json:"source"` // "discogs" | "googlebooks" | "openlibrary"
	ExternalID  string   `json:"externalId"`
	Title       string   `json:"title"`
	Artists     []string `json:"artists,omitempty"` // discogs: artists; books: authors
	Year        string   `json:"year,omitempty"`
	Genres      []string `json:"genres,omitempty"`
	Label       string   `json:"label,omitempty"` // discogs: label; books: publisher
	CatNo       string   `json:"catno,omitempty"` // discogs: catalog number
	Pages       string   `json:"pages,omitempty"` // books only
	CoverURL    string   `json:"coverUrl,omitempty"`
	Description string   `json:"description,omitempty"`
}

// MetadataSearchResult is one entry of a search response.
type MetadataSearchResult struct {
	Source     string `json:"source"`
	ExternalID string `json:"externalId"`
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle,omitempty"` // artist / author / year summary
	CoverURL   string `json:"coverUrl,omitempty"`
}

// ── Discogs ────────────────────────────────────────────────────────

const discogsBase = "https://api.discogs.com"

func discogsRequest(ctx context.Context, path string, token string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discogsBase+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Discogs token="+token)
	req.Header.Set("User-Agent", "Nexote/1.0")
	resp, err := metadataHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("discogs %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return io.ReadAll(io.LimitReader(resp.Body, 2<<20))
}

func (h *Handler) getMetadataConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := LoadMetadataConfig(h.Registry.Root())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *Handler) setMetadataConfig(w http.ResponseWriter, r *http.Request) {
	var cfg MetadataConfig
	if err := decodeBody(r, &cfg); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := SaveMetadataConfig(h.Registry.Root(), cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// discogsRelease returns the normalized data of a single Discogs release.
func (h *Handler) discogsRelease(w http.ResponseWriter, r *http.Request) {
	cfg, err := LoadMetadataConfig(h.Registry.Root())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if cfg.DiscogsToken == "" {
		writeError(w, http.StatusBadRequest, errors.New("discogs token not configured"))
		return
	}
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, errors.New("id is required"))
		return
	}
	data, err := discogsRequest(r.Context(), "/releases/"+url.PathEscape(id), cfg.DiscogsToken)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	var raw struct {
		ID     int             `json:"id"`
		Title  string          `json:"title"`
		Year   json.RawMessage `json:"year"`
		Genres []string        `json:"genres"`
		Labels []struct {
			Name  string `json:"name"`
			Catno string `json:"catno"`
		} `json:"labels"`
		Artists []struct {
			Name string `json:"name"`
		} `json:"artists"`
		Images []struct {
			URL  string `json:"uri"`
			Type string `json:"type"`
		} `json:"images"`
		Tracklist []struct {
			Title string `json:"title"`
		} `json:"tracklist"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	res := MetadataResult{
		Source:     "discogs",
		ExternalID: strconv.Itoa(raw.ID),
		Title:      raw.Title,
		Year:       yearToString(raw.Year),
		Label:      firstLabel(raw.Labels),
		CatNo:      firstCatno(raw.Labels),
	}
	for _, a := range raw.Artists {
		res.Artists = append(res.Artists, a.Name)
	}
	res.Genres = raw.Genres
	res.CoverURL = firstImage(raw.Images)
	writeJSON(w, http.StatusOK, res)
}

// discogsSearch performs a free-text release search on Discogs.
func (h *Handler) discogsSearch(w http.ResponseWriter, r *http.Request) {
	cfg, err := LoadMetadataConfig(h.Registry.Root())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if cfg.DiscogsToken == "" {
		writeError(w, http.StatusBadRequest, errors.New("discogs token not configured"))
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, http.StatusBadRequest, errors.New("q is required"))
		return
	}
	data, err := discogsRequest(r.Context(), "/database/search?type=release&per_page=10&q="+url.QueryEscape(q), cfg.DiscogsToken)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	var raw struct {
		Results []struct {
			ID       int             `json:"id"`
			Title    string          `json:"title"`
			Year     json.RawMessage `json:"year"`
			Catno    string          `json:"catno"`
			Label    []string        `json:"label"`
			CoverURL string          `json:"thumb"`
		} `json:"results"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	results := make([]MetadataSearchResult, 0, len(raw.Results))
	for _, rr := range raw.Results {
		results = append(results, MetadataSearchResult{
			Source:     "discogs",
			ExternalID: strconv.Itoa(rr.ID),
			Title:      rr.Title,
			Subtitle:   strings.TrimSpace(strings.Join(rr.Label, ", ")),
			CoverURL:   rr.CoverURL,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// yearToString normalizes a raw JSON year value to a string. Discogs emits
// year as a JSON number (e.g. 1994); accepting both forms keeps unmarshaling
// robust across API quirks.
func yearToString(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return string(raw)
}

func firstLabel(labels []struct {
	Name  string `json:"name"`
	Catno string `json:"catno"`
}) string {
	for _, l := range labels {
		if l.Name != "" {
			return l.Name
		}
	}
	return ""
}

func firstCatno(labels []struct {
	Name  string `json:"name"`
	Catno string `json:"catno"`
}) string {
	for _, l := range labels {
		if l.Catno != "" {
			return l.Catno
		}
	}
	return ""
}

func firstImage(images []struct {
	URL  string `json:"uri"`
	Type string `json:"type"`
}) string {
	for _, img := range images {
		if img.Type == "primary" && img.URL != "" {
			return img.URL
		}
	}
	for _, img := range images {
		if img.URL != "" {
			return img.URL
		}
	}
	return ""
}

// ── Books (Google Books + Open Library fallback) ───────────────────

const googleBooksBase = "https://www.googleapis.com/books/v1/volumes"

// bookLookup resolves a book by ISBN. Google Books first; if nothing is
// found, Open Library is tried as a fallback.
func (h *Handler) bookLookup(w http.ResponseWriter, r *http.Request) {
	isbn := strings.TrimSpace(r.URL.Query().Get("isbn"))
	if isbn == "" {
		writeError(w, http.StatusBadRequest, errors.New("isbn is required"))
		return
	}

	// Google Books first (better cover + description data).
	res, found, err := googleBooksLookup(r.Context(), "isbn:"+isbn, isbn)
	if err == nil && found {
		writeJSON(w, http.StatusOK, res)
		return
	}

	// Open Library fallback.
	res, found, err = openLibraryLookup(r.Context(), isbn)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "no book found for isbn"})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// bookSearch performs a free-text book search on Google Books.
func (h *Handler) bookSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, http.StatusBadRequest, errors.New("q is required"))
		return
	}
	data, err := googleBooksGet(r.Context(), googleBooksBase+"?q="+url.QueryEscape(q)+"&maxResults=10")
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	var raw struct {
		Items []struct {
			VolumeInfo struct {
				Title         string   `json:"title"`
				Authors       []string `json:"authors"`
				PublishedDate string   `json:"publishedDate"`
				Publisher     string   `json:"publisher"`
				PageCount     int      `json:"pageCount"`
				Categories    []string `json:"categories"`
				ImageLinks    struct {
					Thumbnail string `json:"thumbnail"`
				} `json:"imageLinks"`
			} `json:"volumeInfo"`
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	results := make([]MetadataSearchResult, 0, len(raw.Items))
	for _, it := range raw.Items {
		vi := it.VolumeInfo
		sub := strings.Join(vi.Authors, ", ")
		if vi.PublishedDate != "" {
			if sub != "" {
				sub += " · "
			}
			sub += vi.PublishedDate
		}
		cover := strings.Replace(vi.ImageLinks.Thumbnail, "http://", "https://", 1)
		results = append(results, MetadataSearchResult{
			Source:     "googlebooks",
			ExternalID: it.ID,
			Title:      vi.Title,
			Subtitle:   sub,
			CoverURL:   cover,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func googleBooksGet(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := metadataHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return []byte(`{"totalItems":0}`), nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google books: %s", resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 2<<20))
}

func googleBooksLookup(ctx context.Context, q, isbn string) (MetadataResult, bool, error) {
	data, err := googleBooksGet(ctx, googleBooksBase+"?q="+url.QueryEscape(q))
	if err != nil {
		return MetadataResult{}, false, err
	}
	var raw struct {
		TotalItems int `json:"totalItems"`
		Items      []struct {
			VolumeInfo struct {
				Title         string   `json:"title"`
				Subtitle      string   `json:"subtitle"`
				Authors       []string `json:"authors"`
				PublishedDate string   `json:"publishedDate"`
				Publisher     string   `json:"publisher"`
				PageCount     int      `json:"pageCount"`
				Categories    []string `json:"categories"`
				Description   string   `json:"description"`
				ImageLinks    struct {
					Thumbnail string `json:"thumbnail"`
				} `json:"imageLinks"`
			} `json:"volumeInfo"`
		} `json:"items"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return MetadataResult{}, false, err
	}
	if raw.TotalItems == 0 || len(raw.Items) == 0 {
		return MetadataResult{}, false, nil
	}
	vi := raw.Items[0].VolumeInfo
	year := vi.PublishedDate
	if i := strings.Index(year, "-"); i > 0 {
		year = year[:i]
	}
	return MetadataResult{
		Source:     "googlebooks",
		ExternalID: isbn,
		Title: strings.TrimSpace(vi.Title + (func() string {
			if vi.Subtitle != "" {
				return ": " + vi.Subtitle
			}
			return ""
		}())),
		Artists:     vi.Authors,
		Year:        year,
		Genres:      vi.Categories,
		Label:       vi.Publisher,
		Pages:       strconv.Itoa(vi.PageCount),
		CoverURL:    strings.Replace(vi.ImageLinks.Thumbnail, "http://", "https://", 1),
		Description: vi.Description,
	}, true, nil
}

func openLibraryLookup(ctx context.Context, isbn string) (MetadataResult, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://openlibrary.org/api/books?bibkeys=ISBN:"+isbn+"&format=json&jscmd=data", nil)
	if err != nil {
		return MetadataResult{}, false, err
	}
	resp, err := metadataHTTPClient.Do(req)
	if err != nil {
		return MetadataResult{}, false, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return MetadataResult{}, false, err
	}
	var raw map[string]struct {
		Title    string `json:"title"`
		Subtitle string `json:"subtitle"`
		Authors  []struct {
			Name string `json:"name"`
		} `json:"authors"`
		Publishers []struct {
			Name string `json:"name"`
		} `json:"publishers"`
		PublishDate string `json:"publish_date"`
		NumberPages int    `json:"number_of_pages"`
		Subjects    []struct {
			Name string `json:"name"`
		} `json:"subjects"`
		Cover struct {
			Large  string `json:"large"`
			Medium string `json:"medium"`
		} `json:"cover"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return MetadataResult{}, false, err
	}
	book, ok := raw["ISBN:"+isbn]
	if !ok {
		return MetadataResult{}, false, nil
	}
	authors := make([]string, 0, len(book.Authors))
	for _, a := range book.Authors {
		authors = append(authors, a.Name)
	}
	genres := make([]string, 0, len(book.Subjects))
	for _, s := range book.Subjects {
		genres = append(genres, s.Name)
	}
	cover := book.Cover.Large
	if cover == "" {
		cover = book.Cover.Medium
	}
	publisher := ""
	for _, p := range book.Publishers {
		if p.Name != "" {
			publisher = p.Name
			break
		}
	}
	return MetadataResult{
		Source:     "openlibrary",
		ExternalID: isbn,
		Title: strings.TrimSpace(book.Title + (func() string {
			if book.Subtitle != "" {
				return ": " + book.Subtitle
			}
			return ""
		}())),
		Artists:  authors,
		Year:     book.PublishDate,
		Genres:   genres,
		Label:    publisher,
		Pages:    strconv.Itoa(book.NumberPages),
		CoverURL: cover,
	}, true, nil
}

// metadataCover downloads a remote cover image and stores it as a local
// image file in the note's folder via the existing SaveImage pipeline. The
// returned URL is served locally, so covers stay available offline.
func (h *Handler) metadataCover(w http.ResponseWriter, r *http.Request) {
	var in struct {
		VaultID string `json:"vaultId"`
		NoteID  string `json:"noteId"`
		URL     string `json:"url"`
	}
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if in.VaultID == "" || in.NoteID == "" || in.URL == "" {
		writeError(w, http.StatusBadRequest, errors.New("vaultId, noteId and url are required"))
		return
	}
	parsed, err := url.Parse(in.URL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		writeError(w, http.StatusBadRequest, errors.New("invalid cover url"))
		return
	}

	// Resolve the store: journal items live in the journal pseudo-vault.
	var store *notes.Store
	if in.VaultID == "journal" {
		if h.JournalStore == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("journal store not available"))
			return
		}
		store = h.JournalStore
	} else {
		var err error
		store, err = h.Registry.Store(in.VaultID)
		if err != nil {
			h.writeRegistryError(w, err)
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, in.URL, nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	req.Header.Set("User-Agent", "Nexote/1.0")
	resp, err := metadataHTTPClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, fmt.Errorf("cover download: %s", resp.Status))
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}

	ext := imageExtFromContentType(resp.Header.Get("Content-Type"), parsed.Path)
	if ext == "" {
		writeError(w, http.StatusBadRequest, errors.New("unsupported cover image type"))
		return
	}
	meta, err := store.SaveImage(in.NoteID, ext, in.VaultID, data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": meta.URL})
}

func imageExtFromContentType(contentType, urlPath string) string {
	ct := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch ct {
	case "image/jpeg":
		return "jpg"
	case "image/png":
		return "png"
	case "image/gif":
		return "gif"
	case "image/webp":
		return "webp"
	case "image/svg+xml":
		return "svg"
	}
	// Fall back to the URL path extension.
	lower := strings.ToLower(urlPath)
	for _, ext := range []string{".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".avif"} {
		if strings.HasSuffix(lower, ext) {
			if ext == ".jpeg" {
				return "jpg"
			}
			return strings.TrimPrefix(ext, ".")
		}
	}
	return ""
}

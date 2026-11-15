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
// <NEXOTE_HOME>/metadata.json. Google Books works key-less, but anonymous
// requests are rate-limited hard per IP (HTTP 429); a free API key raises
// the quota. A key from the GOOGLE_BOOKS_API_KEY env var takes precedence.
type MetadataConfig struct {
	DiscogsToken   string `json:"discogsToken"`
	GoogleBooksKey string `json:"googleBooksKey,omitempty"`
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
	Source      string   `json:"source"` // "discogs" | "googlebooks" | "openlibrary" | "dnb"
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

// getMetadataConfig returns the lookup API keys (admins only: lookups run
// server-side for everyone, the keys themselves are secrets).
func (h *Handler) getMetadataConfig(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	cfg, err := LoadMetadataConfig(h.Registry.Root())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *Handler) setMetadataConfig(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	// Clients send only the fields their settings forms know: the mobile
	// view sends just the Discogs token, desktop may also send the Google
	// Books key. Patch, don't replace — absent fields keep their value.
	var in struct {
		DiscogsToken   string  `json:"discogsToken"`
		GoogleBooksKey *string `json:"googleBooksKey"`
	}
	// Plain decode (unknown fields tolerated): the desktop settings panel
	// sends the full draft, older mobile builds only the token field.
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil && err != io.EOF {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cfg, err := LoadMetadataConfig(h.Registry.Root())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	cfg.DiscogsToken = strings.TrimSpace(in.DiscogsToken)
	if in.GoogleBooksKey != nil {
		cfg.GoogleBooksKey = strings.TrimSpace(*in.GoogleBooksKey)
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

// normalizeISBN strips dashes/spaces and uppercases the check digit so
// hand-typed (or scanned) ISBN-10/13 with separators resolve the same way
// bare digits do.
func normalizeISBN(s string) string {
	s = strings.ToUpper(strings.Map(func(r rune) rune {
		if r == '-' || r == ' ' {
			return -1
		}
		return r
	}, strings.TrimSpace(s)))
	return s
}

// Book ids from the search list: an ISBN, or (for hits without one) a source
// id with one of these prefixes, resolved against that source directly.
const (
	googleVolumePrefix = "gb:"
	openLibraryPrefix  = "ol:"
)

// bookLookup resolves a book by ISBN (or a prefixed search-hit id). ISBNs go
// through Google Books, Open Library's books API, Open Library's search index
// and finally the Deutsche Nationalbibliothek, which knows most German books
// the others lack.
func (h *Handler) bookLookup(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("isbn"))
	if raw == "" {
		writeError(w, http.StatusBadRequest, errors.New("isbn is required"))
		return
	}
	ctx := r.Context()
	apiKey := googleBooksKey(h.Registry.Root())

	switch {
	case strings.HasPrefix(raw, googleVolumePrefix):
		res, found, err := googleBooksVolume(ctx, strings.TrimPrefix(raw, googleVolumePrefix), apiKey)
		writeBookResult(w, res, found, err, raw)
		return
	case strings.HasPrefix(raw, openLibraryPrefix):
		res, found, err := openLibraryWork(ctx, strings.TrimPrefix(raw, openLibraryPrefix))
		writeBookResult(w, res, found, err, raw)
		return
	}

	isbn := normalizeISBN(raw)
	var lastErr error
	google := func() (MetadataResult, bool, error) { return googleBooksLookup(ctx, "isbn:"+isbn, isbn, apiKey) }
	olBooks := func() (MetadataResult, bool, error) { return openLibraryLookup(ctx, isbn) }
	olSearch := func() (MetadataResult, bool, error) { return openLibrarySearchISBN(ctx, isbn) }
	dnb := func() (MetadataResult, bool, error) { return dnbLookup(ctx, isbn) }
	// Google Books first (better cover + description data), then Open
	// Library's books API (full records), its search index (editions the
	// books API doesn't list) and the German national library. German-
	// language ISBNs (group 3) ask the national library right after Google:
	// its records are complete where Open Library's often lack authors/year.
	lookups := []func() (MetadataResult, bool, error){google, olBooks, olSearch, dnb}
	if strings.HasPrefix(isbn, "9783") || (len(isbn) == 10 && isbn[0] == '3') {
		lookups = []func() (MetadataResult, bool, error){google, dnb, olBooks, olSearch}
	}
	for _, lookup := range lookups {
		res, found, err := lookup()
		if err == nil && found {
			writeJSON(w, http.StatusOK, res)
			return
		}
		if err != nil {
			lastErr = err
		}
	}
	writeBookResult(w, MetadataResult{}, false, lastErr, isbn)
}

// writeBookResult answers a single-source lookup: the result, a 404 with a
// hint, or 502 when the source failed.
func writeBookResult(w http.ResponseWriter, res MetadataResult, found bool, err error, key string) {
	switch {
	case found:
		writeJSON(w, http.StatusOK, res)
	case err != nil:
		writeError(w, http.StatusBadGateway, err)
	default:
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "no book found for " + key,
			"hint":  "Not in Google Books, Open Library or the Deutsche Nationalbibliothek. Check the ISBN, or configure a Google Books API key in Settings → Metadata for wider coverage.",
		})
	}
}

// maxBookResults caps a merged search list.
const maxBookResults = 20

// bookSearch performs a free-text book search: Google Books, or Open Library
// when Google fails (it 429s quickly without a key) or finds nothing. German
// national library hits are appended, minus titles already listed, so German
// books missing from both still show up.
func (h *Handler) bookSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, http.StatusBadRequest, errors.New("q is required"))
		return
	}
	ctx := r.Context()
	var dnb []MetadataSearchResult
	var dnbErr error
	dnbDone := make(chan struct{})
	go func() {
		defer close(dnbDone)
		dnb, dnbErr = dnbSearch(ctx, q)
	}()

	results, err := googleBooksSearch(ctx, q, googleBooksKey(h.Registry.Root()))
	if err != nil || len(results) == 0 {
		if ol, olErr := openLibrarySearch(ctx, q); olErr == nil {
			results, err = ol, nil
		} else if err == nil {
			err = olErr
		}
	}
	<-dnbDone
	results = mergeBookResults(results, dnb)
	if len(results) == 0 {
		if err == nil {
			err = dnbErr
		}
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// mergeBookResults appends extra hits whose ISBN and title aren't listed yet.
func mergeBookResults(results, extra []MetadataSearchResult) []MetadataSearchResult {
	seenID := make(map[string]bool, len(results)+len(extra))
	seenTitle := make(map[string]bool, len(results)+len(extra))
	out := make([]MetadataSearchResult, 0, min(len(results)+len(extra), maxBookResults))
	add := func(r MetadataSearchResult) {
		title := strings.ToLower(strings.TrimSpace(r.Title))
		if len(out) >= maxBookResults || (r.ExternalID != "" && seenID[r.ExternalID]) || seenTitle[title] {
			return
		}
		seenID[r.ExternalID] = true
		seenTitle[title] = true
		out = append(out, r)
	}
	for _, r := range results {
		add(r)
	}
	for _, r := range extra {
		add(r)
	}
	return out
}

// gbVolumeInfo is a Google Books volume's metadata.
type gbVolumeInfo struct {
	Title               string   `json:"title"`
	Subtitle            string   `json:"subtitle"`
	Authors             []string `json:"authors"`
	PublishedDate       string   `json:"publishedDate"`
	Publisher           string   `json:"publisher"`
	PageCount           int      `json:"pageCount"`
	Categories          []string `json:"categories"`
	Description         string   `json:"description"`
	IndustryIdentifiers []struct {
		Type       string `json:"type"`
		Identifier string `json:"identifier"`
	} `json:"industryIdentifiers"`
	ImageLinks struct {
		Thumbnail string `json:"thumbnail"`
	} `json:"imageLinks"`
}

// isbn returns the volume's ISBN-13, else its ISBN-10, else "".
func (vi gbVolumeInfo) isbn() string {
	var isbn10 string
	for _, id := range vi.IndustryIdentifiers {
		switch id.Type {
		case "ISBN_13":
			return id.Identifier
		case "ISBN_10":
			isbn10 = id.Identifier
		}
	}
	return isbn10
}

func (vi gbVolumeInfo) cover() string {
	return strings.Replace(vi.ImageLinks.Thumbnail, "http://", "https://", 1)
}

func (vi gbVolumeInfo) result(externalID string) MetadataResult {
	title := vi.Title
	if vi.Subtitle != "" {
		title += ": " + vi.Subtitle
	}
	year := vi.PublishedDate
	if i := strings.Index(year, "-"); i > 0 {
		year = year[:i]
	}
	return MetadataResult{
		Source:      "googlebooks",
		ExternalID:  externalID,
		Title:       strings.TrimSpace(title),
		Artists:     vi.Authors,
		Year:        year,
		Genres:      vi.Categories,
		Label:       vi.Publisher,
		Pages:       strconv.Itoa(vi.PageCount),
		CoverURL:    vi.cover(),
		Description: vi.Description,
	}
}

func googleBooksSearch(ctx context.Context, q, apiKey string) ([]MetadataSearchResult, error) {
	data, err := googleBooksGet(ctx, googleBooksBase+"?q="+url.QueryEscape(q)+"&maxResults=10", apiKey)
	if err != nil {
		return nil, err
	}
	var raw struct {
		Items []struct {
			ID         string       `json:"id"`
			VolumeInfo gbVolumeInfo `json:"volumeInfo"`
		} `json:"items"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
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
		// The ISBN when there is one (so the lookup and the ISBN field get a
		// real key), else the volume id.
		id := vi.isbn()
		if id == "" {
			id = googleVolumePrefix + it.ID
		}
		results = append(results, MetadataSearchResult{
			Source:     "googlebooks",
			ExternalID: id,
			Title:      vi.Title,
			Subtitle:   sub,
			CoverURL:   vi.cover(),
		})
	}
	return results, nil
}

// googleBooksKey returns the optional Google Books API key: the
// GOOGLE_BOOKS_API_KEY env var first, then the persisted metadata config.
func googleBooksKey(root string) string {
	if k := os.Getenv("GOOGLE_BOOKS_API_KEY"); k != "" {
		return strings.TrimSpace(k)
	}
	cfg, err := LoadMetadataConfig(root)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(cfg.GoogleBooksKey)
}

func googleBooksGet(ctx context.Context, rawURL, apiKey string) ([]byte, error) {
	// Attach the configured API key (optional) — with a key the per-IP
	// anonymous rate limit (which 429s quickly) becomes a per-key quota.
	if apiKey != "" {
		sep := "?"
		if strings.Contains(rawURL, "?") {
			sep = "&"
		}
		rawURL = rawURL + sep + "key=" + url.QueryEscape(apiKey)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
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

func googleBooksLookup(ctx context.Context, q, isbn, apiKey string) (MetadataResult, bool, error) {
	data, err := googleBooksGet(ctx, googleBooksBase+"?q="+url.QueryEscape(q), apiKey)
	if err != nil {
		return MetadataResult{}, false, err
	}
	var raw struct {
		Items []struct {
			VolumeInfo gbVolumeInfo `json:"volumeInfo"`
		} `json:"items"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return MetadataResult{}, false, err
	}
	if len(raw.Items) == 0 {
		return MetadataResult{}, false, nil
	}
	return raw.Items[0].VolumeInfo.result(isbn), true, nil
}

// googleBooksVolume resolves a search hit without an ISBN by its volume id.
func googleBooksVolume(ctx context.Context, id, apiKey string) (MetadataResult, bool, error) {
	data, err := googleBooksGet(ctx, googleBooksBase+"/"+url.PathEscape(id), apiKey)
	if err != nil {
		return MetadataResult{}, false, err
	}
	var raw struct {
		VolumeInfo gbVolumeInfo `json:"volumeInfo"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return MetadataResult{}, false, err
	}
	if raw.VolumeInfo.Title == "" {
		return MetadataResult{}, false, nil
	}
	return raw.VolumeInfo.result(raw.VolumeInfo.isbn()), true, nil
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

// olDoc is one Open Library search document (a work, summarized over its
// editions).
type olDoc struct {
	Key              string   `json:"key"` // "/works/OL82563W"
	Title            string   `json:"title"`
	Authors          []string `json:"author_name"`
	FirstPublishYear int      `json:"first_publish_year"`
	CoverID          int      `json:"cover_i"`
	Isbns            []string `json:"isbn"`
	Pages            int      `json:"number_of_pages_median"`
}

func (d olDoc) cover() string {
	if d.CoverID == 0 {
		return ""
	}
	return fmt.Sprintf("https://covers.openlibrary.org/b/id/%d-M.jpg", d.CoverID)
}

// result maps the summary onto a lookup result (no publisher: the work's
// editions list many).
func (d olDoc) result(externalID string) MetadataResult {
	res := MetadataResult{
		Source:     "openlibrary",
		ExternalID: externalID,
		Title:      d.Title,
		Artists:    d.Authors,
		CoverURL:   d.cover(),
	}
	if d.FirstPublishYear > 0 {
		res.Year = strconv.Itoa(d.FirstPublishYear)
	}
	if d.Pages > 0 {
		res.Pages = strconv.Itoa(d.Pages)
	}
	return res
}

// openLibraryDocs queries Open Library's search API.
func openLibraryDocs(ctx context.Context, q string, limit int) ([]olDoc, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://openlibrary.org/search.json?q="+url.QueryEscape(q)+"&limit="+strconv.Itoa(limit)+
			"&fields=key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median", nil)
	if err != nil {
		return nil, err
	}
	resp, err := metadataHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("open library: %s", resp.Status)
	}
	var raw struct {
		Docs []olDoc `json:"docs"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&raw); err != nil {
		return nil, err
	}
	return raw.Docs, nil
}

// openLibrarySearchISBN resolves an ISBN via Open Library's search index
// (which knows editions the full-record books API does not list).
func openLibrarySearchISBN(ctx context.Context, isbn string) (MetadataResult, bool, error) {
	docs, err := openLibraryDocs(ctx, "isbn:"+isbn, 1)
	if err != nil || len(docs) == 0 {
		return MetadataResult{}, false, err
	}
	return docs[0].result(isbn), true, nil
}

// openLibraryWork resolves a search hit without an ISBN by its work key.
func openLibraryWork(ctx context.Context, key string) (MetadataResult, bool, error) {
	docs, err := openLibraryDocs(ctx, "key:"+key, 1)
	if err != nil || len(docs) == 0 {
		return MetadataResult{}, false, err
	}
	return docs[0].result(""), true, nil
}

// openLibrarySearch performs a free-text search on Open Library's search
// API. The external id is a real ISBN (13-digit preferred) so picking a
// result feeds a lookup-able key into the ISBN field; works without any
// ISBN fall back to their work key.
func openLibrarySearch(ctx context.Context, q string) ([]MetadataSearchResult, error) {
	docs, err := openLibraryDocs(ctx, q, 10)
	if err != nil {
		return nil, err
	}
	externalID := func(d olDoc) string {
		var first string
		for _, s := range d.Isbns {
			if first == "" {
				first = s
			}
			if len(s) == 13 {
				return s
			}
		}
		if first == "" {
			return openLibraryPrefix + d.Key
		}
		return first
	}
	results := make([]MetadataSearchResult, 0, len(docs))
	for _, d := range docs {
		sub := strings.Join(d.Authors, ", ")
		if d.FirstPublishYear > 0 {
			if sub != "" {
				sub += " · "
			}
			sub += strconv.Itoa(d.FirstPublishYear)
		}
		results = append(results, MetadataSearchResult{
			Source:     "openlibrary",
			ExternalID: externalID(d),
			Title:      d.Title,
			Subtitle:   sub,
			CoverURL:   d.cover(),
		})
	}
	return results, nil
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

	// Resolve the store (a vault the user may edit, or their own journal).
	store, err := h.storeFor(currentUser(r), in.VaultID, notes.SpaceEditor)
	if err != nil {
		h.writeRegistryError(w, err)
		return
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

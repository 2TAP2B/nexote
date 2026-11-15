package api

// Deutsche Nationalbibliothek (German national library) book source: its SRU
// catalog API is free and key-less and lists nearly every book published in
// Germany, which Google Books (rate-limited without a key) and Open Library
// often lack. Records come as Dublin Core; covers come from the DNB's cover
// service.

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"unicode"
)

const (
	dnbSRU      = "https://services.dnb.de/sru/dnb"
	dnbCoverURL = "https://portal.dnb.de/opac/mvb/cover?isbn="
)

type dnbRecord struct {
	Titles      []string `xml:"http://purl.org/dc/elements/1.1/ title"`
	Creators    []string `xml:"http://purl.org/dc/elements/1.1/ creator"`
	Publishers  []string `xml:"http://purl.org/dc/elements/1.1/ publisher"`
	Dates       []string `xml:"http://purl.org/dc/elements/1.1/ date"`
	Languages   []string `xml:"http://purl.org/dc/elements/1.1/ language"`
	Subjects    []string `xml:"http://purl.org/dc/elements/1.1/ subject"`
	Identifiers []struct {
		Type  string `xml:"http://www.w3.org/2001/XMLSchema-instance type,attr"`
		Value string `xml:",chardata"`
	} `xml:"http://purl.org/dc/elements/1.1/ identifier"`
}

// dnbQuery runs a CQL query and returns up to max records.
func dnbQuery(ctx context.Context, cql string, max int) ([]dnbRecord, error) {
	u := fmt.Sprintf("%s?version=1.1&operation=searchRetrieve&recordSchema=oai_dc&maximumRecords=%d&query=%s",
		dnbSRU, max, url.QueryEscape(cql))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := metadataHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("deutsche nationalbibliothek: %s", resp.Status)
	}
	return parseDNB(resp.Body)
}

// parseDNB decodes an SRU response with Dublin Core records.
func parseDNB(r io.Reader) ([]dnbRecord, error) {
	var raw struct {
		Records []dnbRecord `xml:"records>record>recordData>dc"`
	}
	if err := xml.NewDecoder(r).Decode(&raw); err != nil {
		return nil, err
	}
	return raw.Records, nil
}

// title turns "[Fitzek] ; Das Kalendermädchen : Thriller / Sebastian Fitzek"
// into "Das Kalendermädchen: Thriller" (drops the collective title and the
// statement of responsibility).
func (r dnbRecord) title() string {
	if len(r.Titles) == 0 {
		return ""
	}
	t := r.Titles[0]
	if i := strings.Index(t, " / "); i >= 0 {
		t = t[:i]
	}
	if strings.HasPrefix(t, "[") {
		if i := strings.Index(t, "] ; "); i >= 0 {
			t = t[i+len("] ; "):]
		}
	}
	return strings.TrimSpace(strings.ReplaceAll(t, " : ", ": "))
}

// authors returns the creators marked [Verfasser] (or unmarked), as
// "First Last". With all is set, any creator counts when none is an author
// (anthologies list only editors).
func (r dnbRecord) authors(all bool) []string {
	var out, others []string
	for _, c := range r.Creators {
		name, role := c, ""
		if i := strings.Index(c, " ["); i >= 0 {
			name, role = c[:i], strings.Trim(c[i+1:], "[]")
		}
		if last, first, ok := strings.Cut(name, ", "); ok {
			name = first + " " + last
		}
		name = strings.TrimSpace(name)
		if role == "" || role == "Verfasser" {
			out = append(out, name)
		} else {
			others = append(others, name)
		}
	}
	if len(out) == 0 && all {
		return others
	}
	return out
}

// isbn returns the record's ISBN-13 (else ISBN-10) without dashes.
func (r dnbRecord) isbn() string {
	var isbn10 string
	for _, id := range r.Identifiers {
		if id.Type != "tel:ISBN" {
			continue
		}
		v := normalizeISBN(strings.Fields(id.Value + " ")[0])
		switch len(v) {
		case 13:
			return v
		case 10:
			isbn10 = v
		}
	}
	return isbn10
}

// year returns the first four-digit year in the record's date.
func (r dnbRecord) year() string {
	for _, d := range r.Dates {
		digits := 0
		for i, c := range d {
			if !unicode.IsDigit(c) {
				digits = 0
				continue
			}
			if digits++; digits == 4 {
				return d[i-3 : i+1]
			}
		}
	}
	return ""
}

// publisher drops the place: "München : Droemer" → "Droemer".
func (r dnbRecord) publisher() string {
	if len(r.Publishers) == 0 {
		return ""
	}
	p := r.Publishers[0]
	if i := strings.LastIndex(p, " : "); i >= 0 {
		p = p[i+3:]
	}
	return strings.TrimSpace(p)
}

// genres drops the classification code: "830 Deutsche Literatur" →
// "Deutsche Literatur", "B Belletristik" → "Belletristik".
func (r dnbRecord) genres() []string {
	out := make([]string, 0, len(r.Subjects))
	for _, s := range r.Subjects {
		if code, rest, ok := strings.Cut(s, " "); ok && len(code) <= 4 {
			s = rest
		}
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func (r dnbRecord) german() bool {
	for _, l := range r.Languages {
		if l == "ger" {
			return true
		}
	}
	return len(r.Languages) == 0
}

// dnbCover returns the cover URL if the DNB's cover service has one.
func dnbCover(ctx context.Context, isbn string) string {
	if isbn == "" {
		return ""
	}
	u := dnbCoverURL + isbn
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, u, nil)
	if err != nil {
		return ""
	}
	resp, err := metadataHTTPClient.Do(req)
	if err != nil {
		return ""
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "image/") {
		return ""
	}
	return u
}

func dnbLookup(ctx context.Context, isbn string) (MetadataResult, bool, error) {
	records, err := dnbQuery(ctx, "num="+isbn, 1)
	if err != nil || len(records) == 0 {
		return MetadataResult{}, false, err
	}
	r := records[0]
	return MetadataResult{
		Source:     "dnb",
		ExternalID: isbn,
		Title:      r.title(),
		Artists:    r.authors(true),
		Year:       r.year(),
		Genres:     r.genres(),
		Label:      r.publisher(),
		CoverURL:   dnbCover(ctx, isbn),
	}, true, nil
}

// dnbSearch finds German books by free text (every word must match). Only
// records with an ISBN and an author count — the catalog also lists editions
// in other languages and merchandise (socks with cover art) under an author.
func dnbSearch(ctx context.Context, q string) ([]MetadataSearchResult, error) {
	var terms []string
	for _, w := range strings.Fields(q) {
		w = strings.Trim(strings.ReplaceAll(w, `"`, ""), `\`)
		if w != "" {
			terms = append(terms, `WOE="`+w+`"`)
		}
	}
	if len(terms) == 0 {
		return nil, nil
	}
	records, err := dnbQuery(ctx, strings.Join(terms, " and "), 30)
	if err != nil {
		return nil, err
	}
	results := dnbSearchResults(records)
	// Covers in parallel: one HEAD request each.
	var wg sync.WaitGroup
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i].CoverURL = dnbCover(ctx, results[i].ExternalID)
		}()
	}
	wg.Wait()
	return results, nil
}

// dnbSearchResults keeps up to 10 German books with an ISBN and an author,
// one per title.
func dnbSearchResults(records []dnbRecord) []MetadataSearchResult {
	var results []MetadataSearchResult
	seen := map[string]bool{}
	for _, r := range records {
		isbn, authors, title := r.isbn(), r.authors(false), r.title()
		key := strings.ToLower(title)
		if isbn == "" || len(authors) == 0 || title == "" || !r.german() || seen[key] {
			continue
		}
		seen[key] = true
		sub := strings.Join(authors, ", ")
		if y := r.year(); y != "" {
			sub += " · " + y
		}
		results = append(results, MetadataSearchResult{Source: "dnb", ExternalID: isbn, Title: title, Subtitle: sub})
		if len(results) == 10 {
			break
		}
	}
	return results
}

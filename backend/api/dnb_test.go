package api

import (
	"reflect"
	"strings"
	"testing"
)

// Trimmed from a real SRU response: a German book with a collective title
// and a translator, its e-book (same title), socks with cover art listed
// under the author as editor, and a Slovak translation.
const dnbSample = `<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><numberOfRecords>4</numberOfRecords><records>
<record><recordData><dc xmlns="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>[Les enfants sont rois] ; Die Kinder sind Könige : Roman / Delphine de Vigan ; aus dem Französischen von Doris Heinemann</dc:title>
  <dc:creator>Vigan, Delphine de [Verfasser]</dc:creator>
  <dc:creator>Heinemann, Doris [Übersetzer]</dc:creator>
  <dc:publisher>Köln : DuMont</dc:publisher>
  <dc:date>2022</dc:date>
  <dc:language>ger</dc:language>
  <dc:identifier xsi:type="tel:URN">urn:nbn:de:101:1-2022</dc:identifier>
  <dc:identifier xsi:type="tel:ISBN">978-3-8321-8188-8 Festeinband : EUR 24.00</dc:identifier>
  <dc:subject>843 Französische Literatur</dc:subject>
  <dc:subject>B Belletristik</dc:subject>
</dc></recordData></record>
<record><recordData><dc xmlns="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Die Kinder sind Könige : Roman / Delphine de Vigan</dc:title>
  <dc:creator>Vigan, Delphine de [Verfasser]</dc:creator>
  <dc:language>ger</dc:language>
  <dc:identifier xsi:type="tel:ISBN">978-3-8321-7177-3</dc:identifier>
</dc></recordData></record>
<record><recordData><dc xmlns="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Fitzek-Socken "Das Kalendermädchen" Größe 36 - 41 : Socken</dc:title>
  <dc:creator>Fitzek, Sebastian [Herausgeber]</dc:creator>
  <dc:language>ger</dc:language>
  <dc:identifier xsi:type="tel:ISBN">978-3-0000-0000-2</dc:identifier>
</dc></recordData></record>
<record><recordData><dc xmlns="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>[Fitzek] ; Dievča z kalendára / Sebastian Fitzek</dc:title>
  <dc:creator>Fitzek, Sebastian [Verfasser]</dc:creator>
  <dc:language>slo</dc:language>
  <dc:identifier xsi:type="tel:ISBN">978-80-000-0000-1</dc:identifier>
</dc></recordData></record>
</records></searchRetrieveResponse>`

func TestDNBRecordFields(t *testing.T) {
	records, err := parseDNB(strings.NewReader(dnbSample))
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 4 {
		t.Fatalf("got %d records, want 4", len(records))
	}
	r := records[0]
	if got := r.title(); got != "Die Kinder sind Könige: Roman" {
		t.Errorf("title = %q", got)
	}
	if got := r.authors(true); !reflect.DeepEqual(got, []string{"Delphine de Vigan"}) {
		t.Errorf("authors = %q (translator must not count)", got)
	}
	if got := r.isbn(); got != "9783832181888" {
		t.Errorf("isbn = %q", got)
	}
	if got := r.publisher(); got != "DuMont" {
		t.Errorf("publisher = %q", got)
	}
	if got := r.year(); got != "2022" {
		t.Errorf("year = %q", got)
	}
	if got := r.genres(); !reflect.DeepEqual(got, []string{"Französische Literatur", "Belletristik"}) {
		t.Errorf("genres = %q", got)
	}
	// A lookup by ISBN still names the editor when there is no author.
	if got := records[2].authors(true); !reflect.DeepEqual(got, []string{"Sebastian Fitzek"}) {
		t.Errorf("editor fallback = %q", got)
	}
}

func TestDNBSearchResultsFilter(t *testing.T) {
	records, err := parseDNB(strings.NewReader(dnbSample))
	if err != nil {
		t.Fatal(err)
	}
	got := dnbSearchResults(records)
	// Socks (editor only), the Slovak edition and the e-book duplicate drop out.
	want := []MetadataSearchResult{{
		Source:     "dnb",
		ExternalID: "9783832181888",
		Title:      "Die Kinder sind Könige: Roman",
		Subtitle:   "Delphine de Vigan · 2022",
	}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("results = %+v, want %+v", got, want)
	}
}

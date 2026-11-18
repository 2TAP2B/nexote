package notes

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var minimalPDF = []byte("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")

func TestSavePDF(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{Title: "Contract", Path: "Work"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.SavePDF(doc.Meta.ID, "fake.pdf", "v1", []byte("<html><script>alert(1)</script></html>")); !errors.Is(err, ErrInvalidPDF) {
		t.Fatalf("non-PDF bytes: err = %v, want ErrInvalidPDF", err)
	}

	meta, err := s.SavePDF(doc.Meta.ID, "Lease (2026) Müller.pdf", "v1", minimalPDF)
	if err != nil {
		t.Fatalf("SavePDF: %v", err)
	}
	// A readable name without spaces or parentheses (they'd end a markdown
	// link), in the note's folder.
	if !regexp.MustCompile(`^Lease-2026-Müller-[A-Za-z0-9_-]{6}\.pdf$`).MatchString(meta.Name) {
		t.Fatalf("name = %q", meta.Name)
	}
	if meta.Path != "Work" || meta.URL != "/api/vaults/v1/images/Work/"+meta.Name {
		t.Fatalf("path %q url %q", meta.Path, meta.URL)
	}
	data, err := s.ReadImage("Work/" + meta.Name)
	if err != nil || string(data) != string(minimalPDF) {
		t.Fatalf("ReadImage = %q, %v", data, err)
	}

	// A name made only of unsafe characters still gets a usable one.
	meta2, err := s.SavePDF(doc.Meta.ID, "().pdf", "v1", minimalPDF)
	if err != nil || !strings.HasPrefix(meta2.Name, "document-") {
		t.Fatalf("fallback name = %q, %v", meta2.Name, err)
	}
}

// PDFs move with their note like images do.
func TestMigrateMovesPDF(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{Title: "Contract", Path: "Old"})
	if err != nil {
		t.Fatal(err)
	}
	meta, err := s.SavePDF(doc.Meta.ID, "lease.pdf", "v1", minimalPDF)
	if err != nil {
		t.Fatal(err)
	}
	body := "![lease.pdf](" + meta.URL + ")"
	moved, err := s.MigrateImagesForBody(body, "Old", "New")
	if err != nil {
		t.Fatal(err)
	}
	if want := "![lease.pdf](/api/vaults/v1/images/New/" + meta.Name + ")"; moved != want {
		t.Fatalf("body = %q, want %q", moved, want)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "New", meta.Name)); err != nil {
		t.Fatalf("PDF not moved: %v", err)
	}
}

package notes

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveAndListImage(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{Title: "Pic", Path: "Foo"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	meta, err := s.SaveImage(doc.Meta.ID, "png", "v1", []byte("pngdata"))
	if err != nil {
		t.Fatalf("SaveImage: %v", err)
	}
	if !strings.HasPrefix(meta.Name, "img-") || !strings.HasSuffix(meta.Name, ".png") {
		t.Errorf("name = %q, want img-*.png", meta.Name)
	}
	wantURL := "/api/vaults/v1/images/Foo/" + meta.Name
	if meta.URL != wantURL {
		t.Errorf("url = %q, want %q", meta.URL, wantURL)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "Foo", meta.Name)); err != nil {
		t.Fatalf("image file not written: %v", err)
	}

	// Attach a reference in the note body.
	doc.Body = "![x](" + meta.URL + ")"
	if err := s.write(doc); err != nil {
		t.Fatalf("write: %v", err)
	}

	images, err := s.ListImages("v1")
	if err != nil {
		t.Fatalf("ListImages: %v", err)
	}
	if len(images) != 1 {
		t.Fatalf("len(images) = %d, want 1", len(images))
	}
	if len(images[0].UsedBy) != 1 || images[0].UsedBy[0].NoteID != doc.Meta.ID {
		t.Errorf("usedBy = %+v, want note %q", images[0].UsedBy, doc.Meta.ID)
	}
}

func TestMigrateImagesForBody(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{Title: "Pic", Path: "Foo"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	meta, err := s.SaveImage(doc.Meta.ID, "jpg", "v1", []byte("jpgdata"))
	if err != nil {
		t.Fatalf("SaveImage: %v", err)
	}
	oldURL := "/api/vaults/v1/images/Foo/" + meta.Name

	newBody, err := s.MigrateImagesForBody("![a]("+oldURL+")", "Foo", "Bar/Baz")
	if err != nil {
		t.Fatalf("MigrateImagesForBody: %v", err)
	}
	wantURL := "/api/vaults/v1/images/Bar/Baz/" + meta.Name
	if !strings.Contains(newBody, wantURL) {
		t.Errorf("body = %q, want it to contain %q", newBody, wantURL)
	}
	// File physically moved.
	if _, err := os.Stat(filepath.Join(s.Dir, "Bar", "Baz", meta.Name)); err != nil {
		t.Fatalf("image not moved: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "Foo", meta.Name)); !os.IsNotExist(err) {
		t.Errorf("old image still exists")
	}
}

func TestMigrateImagesTo(t *testing.T) {
	src := newTestStore(t)
	dst := newTestStore(t)
	doc, err := src.Create(CreateInput{Title: "Pic", Path: "Foo"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	meta, err := src.SaveImage(doc.Meta.ID, "png", "v1", []byte("pngdata"))
	if err != nil {
		t.Fatalf("SaveImage: %v", err)
	}
	body := "![a](/api/vaults/v1/images/Foo/" + meta.Name + ")"

	newBody, err := src.MigrateImagesTo(body, dst, "v2")
	if err != nil {
		t.Fatalf("MigrateImagesTo: %v", err)
	}
	wantURL := "/api/vaults/v2/images/Foo/" + meta.Name
	if !strings.Contains(newBody, wantURL) {
		t.Errorf("body = %q, want it to contain %q", newBody, wantURL)
	}
	if _, err := os.Stat(filepath.Join(dst.Dir, "Foo", meta.Name)); err != nil {
		t.Fatalf("image not moved to dst: %v", err)
	}
	if _, err := os.Stat(filepath.Join(src.Dir, "Foo", meta.Name)); !os.IsNotExist(err) {
		t.Errorf("src image still exists")
	}
}

func TestReadAndDeleteImage(t *testing.T) {
	s := newTestStore(t)
	doc, err := s.Create(CreateInput{Title: "Pic"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	meta, err := s.SaveImage(doc.Meta.ID, "gif", "v1", []byte("gifdata"))
	if err != nil {
		t.Fatalf("SaveImage: %v", err)
	}

	data, err := s.ReadImage(meta.Name)
	if err != nil {
		t.Fatalf("ReadImage: %v", err)
	}
	if string(data) != "gifdata" {
		t.Errorf("data = %q, want gifdata", data)
	}

	// Traversal must be rejected.
	if _, err := s.ReadImage("../"+meta.Name); err == nil {
		t.Errorf("ReadImage accepted traversal")
	}
	if err := s.DeleteImage(meta.Name); err != nil {
		t.Fatalf("DeleteImage: %v", err)
	}
	if _, err := s.ReadImage(meta.Name); err == nil {
		t.Errorf("image still readable after delete")
	}
}

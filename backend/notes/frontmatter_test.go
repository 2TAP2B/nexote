package notes

import (
	"strings"
	"testing"
	"time"
)

func TestEncodeDecodeRoundTrip(t *testing.T) {
	created, _ := time.Parse(time.RFC3339, "2026-07-30T18:21:39.993Z")
	updated, _ := time.Parse(time.RFC3339, "2026-07-30T18:22:00.000Z")

	in := Document{
		Meta: Meta{
			ID:        "b3xiI9Ya2mQh",
			Title:     "Hello World",
			CreatedAt: created,
			UpdatedAt: updated,
		},
		Body: "# Hello\n\nThis is **markdown**.\n",
	}

	data, err := Encode(in)
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}

	// Sanity: the fence and fields are present.
	s := string(data)
	if !strings.HasPrefix(s, "---\n") {
		t.Fatalf("missing opening fence: %q", s)
	}
	if !strings.Contains(s, "id: b3xiI9Ya2mQh") {
		t.Fatalf("missing id field: %q", s)
	}

	out, err := Decode(data)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if out.Meta.ID != in.Meta.ID {
		t.Errorf("id = %q, want %q", out.Meta.ID, in.Meta.ID)
	}
	if out.Meta.Title != in.Meta.Title {
		t.Errorf("title = %q, want %q", out.Meta.Title, in.Meta.Title)
	}
	if !out.Meta.CreatedAt.Equal(in.Meta.CreatedAt) {
		t.Errorf("createdAt = %v, want %v", out.Meta.CreatedAt, in.Meta.CreatedAt)
	}
	if !out.Meta.UpdatedAt.Equal(in.Meta.UpdatedAt) {
		t.Errorf("updatedAt = %v, want %v", out.Meta.UpdatedAt, in.Meta.UpdatedAt)
	}
	if out.Body != in.Body {
		t.Errorf("body = %q, want %q", out.Body, in.Body)
	}
}

func TestDecodeNoFrontmatter(t *testing.T) {
	// A file with no frontmatter is treated entirely as body.
	data := []byte("# Just a title\n\nNo frontmatter here.\n")
	out, err := Decode(data)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if out.Body != string(data) {
		t.Errorf("body = %q, want %q", out.Body, string(data))
	}
	if out.Meta.ID != "" {
		t.Errorf("id should be empty, got %q", out.Meta.ID)
	}
}

func TestDecodeEmptyBody(t *testing.T) {
	// Existing notes have an empty body after the closing fence.
	data := []byte("---\nid: abc\ntitle: T\ncreatedAt: 2026-07-30T18:00:00Z\nupdatedAt: 2026-07-30T18:00:00Z\n---\n")
	out, err := Decode(data)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if out.Meta.ID != "abc" {
		t.Errorf("id = %q, want %q", out.Meta.ID, "abc")
	}
	if out.Body != "" {
		t.Errorf("body = %q, want empty", out.Body)
	}
}

func TestDecodeUnclosedFrontmatter(t *testing.T) {
	data := []byte("---\nid: abc\n")
	if _, err := Decode(data); err == nil {
		t.Fatal("expected error for unclosed frontmatter, got nil")
	}
}
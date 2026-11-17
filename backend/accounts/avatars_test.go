package accounts

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

// A minimal PNG header is enough for content sniffing.
var pngBytes = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)

func TestAvatarLifecycle(t *testing.T) {
	s, now := newTestStore(t)
	u := mustUser(t, s, "alice", RoleMember)

	for name, data := range map[string][]byte{
		"svg (could carry script)": []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"empty":                    nil,
		"too large":                append(append([]byte{}, pngBytes...), make([]byte, MaxAvatarBytes)...),
	} {
		if _, err := s.SetAvatar(u.ID, data); !errors.Is(err, ErrInvalidAvatar) {
			t.Fatalf("%s: err = %v, want ErrInvalidAvatar", name, err)
		}
	}
	if _, _, err := s.Avatar(u.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Avatar before upload: err = %v, want ErrNotFound", err)
	}

	first, err := s.SetAvatar(u.ID, pngBytes)
	if err != nil {
		t.Fatalf("SetAvatar: %v", err)
	}
	data, contentType, err := s.Avatar(u.ID)
	if err != nil || contentType != "image/png" || !bytes.Equal(data, pngBytes) {
		t.Fatalf("Avatar = %d bytes, %q, %v; want the PNG", len(data), contentType, err)
	}

	// A new upload gets a new version, so cached URLs don't show the old one.
	*now = now.Add(time.Second)
	second, err := s.SetAvatar(u.ID, pngBytes)
	if err != nil {
		t.Fatalf("second SetAvatar: %v", err)
	}
	if first.Avatar == "" || second.Avatar == first.Avatar {
		t.Fatalf("versions %q then %q, want two different non-empty ones", first.Avatar, second.Avatar)
	}

	removed, err := s.RemoveAvatar(u.ID)
	if err != nil || removed.Avatar != "" {
		t.Fatalf("RemoveAvatar = %q, %v", removed.Avatar, err)
	}
	if _, _, err := s.Avatar(u.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Avatar after removal: err = %v, want ErrNotFound", err)
	}
	if _, _, err := s.Avatar("../../etc/passwd"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Avatar of an unknown id: err = %v, want ErrNotFound", err)
	}
}

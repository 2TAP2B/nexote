package accounts

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

// Profile pictures live next to users.json as auth/avatars/<user id>; the
// format is sniffed from the bytes when served. The browser crops and scales
// them before upload, so the size limit is generous.

// MaxAvatarBytes is the largest accepted profile picture.
const MaxAvatarBytes = 2 << 20

// ErrInvalidAvatar rejects uploads that aren't a small raster image.
var ErrInvalidAvatar = errors.New("the picture must be a PNG, JPEG, GIF or WebP image up to 2 MB")

// Raster formats only: an SVG could carry script.
var avatarTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
}

func (s *Store) avatarPath(userID string) string {
	return filepath.Join(s.dir, "avatars", userID)
}

// SetAvatar stores data as the user's profile picture.
func (s *Store) SetAvatar(userID string, data []byte) (User, error) {
	if len(data) == 0 || len(data) > MaxAvatarBytes || !avatarTypes[http.DetectContentType(data)] {
		return User{}, ErrInvalidAvatar
	}
	// The id comes from the store, never from the request path.
	if _, err := s.User(userID); err != nil {
		return User{}, err
	}
	if err := os.MkdirAll(filepath.Join(s.dir, "avatars"), 0o700); err != nil {
		return User{}, err
	}
	if err := writeFileAtomic(s.avatarPath(userID), data); err != nil {
		return User{}, err
	}
	return s.UpdateUser(userID, func(u *User) error {
		u.Avatar = strconv.FormatInt(s.now().UnixMilli(), 36)
		return nil
	})
}

// RemoveAvatar deletes the user's profile picture.
func (s *Store) RemoveAvatar(userID string) (User, error) {
	u, err := s.UpdateUser(userID, func(u *User) error {
		u.Avatar = ""
		return nil
	})
	if err != nil {
		return User{}, err
	}
	if err := os.Remove(s.avatarPath(userID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return User{}, err
	}
	return u, nil
}

// Avatar returns the user's profile picture and its content type, or
// ErrNotFound when the user has none.
func (s *Store) Avatar(userID string) ([]byte, string, error) {
	u, err := s.User(userID)
	if err != nil {
		return nil, "", err
	}
	if u.Avatar == "" {
		return nil, "", ErrNotFound
	}
	data, err := os.ReadFile(s.avatarPath(u.ID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return data, http.DetectContentType(data), nil
}

package notes

import (
	"crypto/rand"
	"encoding/base64"
)

// NewID generates a random 16-character base64url id (no padding).
// e.g. "b3xiI9Ya2mQh" style used by existing notes.
func NewID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
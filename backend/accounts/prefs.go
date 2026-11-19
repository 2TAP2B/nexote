package accounts

import (
	"errors"
	"maps"
)

// Account preferences: the few settings that must be the same on every
// device of an account, because they point at data (the quick-notes Notepad
// must be one note, wherever you open it). Everything else stays a setting
// of the device. Only known keys are kept; values are short ids and paths.

// PrefKeys are the accepted preference names.
var PrefKeys = map[string]bool{
	"notepadVault":   true,
	"notepadFolder":  true,
	"notepadInTree":  true,
	"memoNoteVault":  true,
	"memoNoteFolder": true,
}

const maxPrefValue = 512

// ErrInvalidPref rejects unknown keys and overlong values.
var ErrInvalidPref = errors.New("unknown preference or value too long")

// SetPrefs merges patch into the user's preferences ("" is a value, e.g. the
// personal store; it doesn't delete) and returns the result.
func (s *Store) SetPrefs(userID string, patch map[string]string) (map[string]string, error) {
	for k, v := range patch {
		if !PrefKeys[k] || len(v) > maxPrefValue {
			return nil, ErrInvalidPref
		}
	}
	u, err := s.UpdateUser(userID, func(u *User) error {
		if u.Prefs == nil {
			u.Prefs = map[string]string{}
		}
		maps.Copy(u.Prefs, patch)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return u.Prefs, nil
}

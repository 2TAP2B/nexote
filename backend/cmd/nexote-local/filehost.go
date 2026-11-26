package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

// fileHost is the desktop stand-in for the app's secret store: one JSON
// object in a 0600 file outside the data folder, like the app keeps its
// secrets outside the user-visible folder.
type fileHost struct {
	path string
	name string
	mu   sync.Mutex
}

func (h *fileHost) read() (map[string]string, error) {
	data, err := os.ReadFile(h.path)
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	secrets := map[string]string{}
	if err := json.Unmarshal(data, &secrets); err != nil {
		return nil, fmt.Errorf("%s: %w", h.path, err)
	}
	return secrets, nil
}

func (h *fileHost) LoadSecret(name string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	secrets, err := h.read()
	if err != nil {
		return "", err
	}
	return secrets[name], nil
}

func (h *fileHost) SaveSecret(name, value string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	secrets, err := h.read()
	if err != nil {
		return err
	}
	if value == "" {
		delete(secrets, name)
	} else {
		secrets[name] = value
	}
	data, err := json.MarshalIndent(secrets, "", "  ")
	if err != nil {
		return err
	}
	// Written to a temporary file and renamed, so a crash can't leave half
	// a file; CreateTemp makes it 0600.
	tmp, err := os.CreateTemp(filepath.Dir(h.path), ".secrets-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), h.path)
}

func (h *fileHost) DeviceName() string { return h.name }

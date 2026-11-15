package notes

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Image extensions we treat as uploadable/displayable images.
var imageExtensions = map[string]bool{
	".png":  true,
	".jpg":  true,
	".jpeg": true,
	".gif":  true,
	".webp": true,
	".avif": true,
	".svg":  true,
	".bmp":  true,
}

// imageFileRe matches generated image filenames (img-<id>.<ext>) inside a
// note body so we can find which images a note references.
var imageFileRe = regexp.MustCompile(`(?i)img-[a-z0-9_-]+\.(?:png|jpe?g|gif|webp|avif|svg|bmp)`)

// imageURLRe matches image URLs stored in note bodies:
// /api/vaults/<vaultId>/images/<relative-path>. The captured path may include
// a folder, e.g. "Foo/img-abc.png".
var imageURLRe = regexp.MustCompile(`/api/vaults/([a-zA-Z0-9_-]+)/images/([^\s()]+)`)

// ImageNote is a note that references an image.
type ImageNote struct {
	NoteID string `json:"noteId"`
	Title  string `json:"title"`
}

// ImageMeta describes an image file within a vault.
type ImageMeta struct {
	Name      string      `json:"name"`
	Path      string      `json:"path"` // folder relative to the vault root, "" = root
	URL       string      `json:"url"`
	Size      int64       `json:"size"`
	UpdatedAt time.Time   `json:"updatedAt"`
	UsedBy    []ImageNote `json:"usedBy,omitempty"`
}

// IsImageName reports whether the given filename has an image extension.
func IsImageName(name string) bool {
	return imageExtensions[strings.ToLower(filepath.Ext(name))]
}

// SaveImage writes an uploaded image into the folder of the given note
// (the vault root when the note has no folder). The file is named
// img-<NewID>.<ext> so it never collides. Returns the saved metadata.
func (s *Store) SaveImage(noteID, ext string, vaultID string, data []byte) (ImageMeta, error) {
	doc, err := s.read(noteID)
	if err != nil {
		return ImageMeta{}, err
	}
	ext = strings.ToLower(ext)
	if !imageExtensions["."+ext] {
		return ImageMeta{}, fmt.Errorf("unsupported image extension %q", ext)
	}
	name := "img-" + NewID() + "." + ext
	dir := s.imageDir(doc.Meta.Path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ImageMeta{}, fmt.Errorf("create image dir: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
		return ImageMeta{}, fmt.Errorf("write image: %w", err)
	}
	meta := ImageMeta{
		Name:      name,
		Path:      doc.Meta.Path,
		URL:       s.imageURL(vaultID, doc.Meta.Path, name),
		Size:      int64(len(data)),
		UpdatedAt: time.Now().UTC(),
	}
	return meta, nil
}

// ListImages walks the vault and returns every image file, annotated with the
// notes that reference it. Results are sorted newest-first.
func (s *Store) ListImages(vaultID string) ([]ImageMeta, error) {
	// name -> set of referencing notes (in vaultID terms).
	usedBy := map[string][]ImageNote{}

	list, err := s.List()
	if err != nil {
		return nil, err
	}
	for _, e := range list.Notes {
		doc, err := s.read(e.ID)
		if err != nil {
			continue
		}
		for _, m := range imageFileRe.FindAllString(doc.Body, -1) {
			usedBy[strings.ToLower(m)] = append(usedBy[strings.ToLower(m)], ImageNote{
				NoteID: e.ID,
				Title:  e.Title,
			})
		}
	}

	var images []ImageMeta
	err = filepath.WalkDir(s.Dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		name := d.Name()
		if !IsImageName(name) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(s.Dir, filepath.Dir(p))
		folder := filepath.ToSlash(rel)
		if folder == "." || folder == "" {
			folder = ""
		}
		images = append(images, ImageMeta{
			Name:      name,
			Path:      folder,
			URL:       s.imageURL(vaultID, folder, name),
			Size:      info.Size(),
			UpdatedAt: info.ModTime().UTC(),
			UsedBy:    usedBy[strings.ToLower(name)],
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk images: %w", err)
	}

	sort.Slice(images, func(i, j int) bool {
		return images[i].UpdatedAt.After(images[j].UpdatedAt)
	})
	return images, nil
}

// ReadImage returns the bytes of an image at a vault-relative path (e.g.
// "Foo/img-abc.png", or "img-abc.png" for the root). Traversal outside the
// vault is rejected.
func (s *Store) ReadImage(relPath string) ([]byte, error) {
	p, ok := s.safeImagePath(relPath)
	if !ok {
		return nil, fmt.Errorf("invalid image path")
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read image: %w", err)
	}
	return data, nil
}

// DeleteImage removes an image at a vault-relative path. Missing files are
// treated as success for idempotency.
func (s *Store) DeleteImage(relPath string) error {
	p, ok := s.safeImagePath(relPath)
	if !ok {
		return fmt.Errorf("invalid image path")
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("delete image: %w", err)
	}
	return nil
}

// MigrateImagesForBody moves every image file referenced in the given body
// from the old note folder to newPath and rewrites the body's image URLs to
// the new folder. Returns the rewritten body. Safe to call when
// oldPath == newPath (no-op). Used when a note moves between folders.
func (s *Store) MigrateImagesForBody(body, oldPath, newPath string) (string, error) {
	if oldPath == newPath {
		return body, nil
	}
	newBody := body
	for _, m := range imageURLRe.FindAllStringSubmatch(body, -1) {
		rel := m[2]
		fileName := filepath.Base(rel)
		if !IsImageName(fileName) {
			continue
		}
		folder := strings.Trim(path.Dir(rel), "./")
		if folder != strings.Trim(sanitizePath(oldPath), "/") {
			continue
		}
		src := filepath.Join(s.imageDir(folder), fileName)
		dst := filepath.Join(s.imageDir(newPath), fileName)
		if _, err := os.Stat(src); err == nil {
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return body, fmt.Errorf("create target image dir: %w", err)
			}
			if err := os.Rename(src, dst); err != nil {
				return body, fmt.Errorf("move image %q: %w", fileName, err)
			}
		}
		oldURL := "/api/vaults/" + m[1] + "/images/" + rel
		newURL := "/api/vaults/" + m[1] + "/images/" + s.imageRel(newPath, fileName)
		newBody = strings.ReplaceAll(newBody, oldURL, newURL)
	}
	return newBody, nil
}

// MigrateImagesTo moves image files referenced in the given body from this
// store to the destination store (keeping the same relative folder) and
// rewrites the body's image URLs to use dstVaultID. Returns the rewritten
// body. Used when a note moves between vaults.
func (s *Store) MigrateImagesTo(body string, dst *Store, dstVaultID string) (string, error) {
	newBody := body
	for _, m := range imageURLRe.FindAllStringSubmatch(body, -1) {
		rel := m[2]
		fileName := filepath.Base(rel)
		if !IsImageName(fileName) {
			continue
		}
		folder := strings.Trim(path.Dir(rel), "./")
		src := filepath.Join(s.Dir, filepath.FromSlash(folder), fileName)
		dstFile := filepath.Join(dst.Dir, filepath.FromSlash(folder), fileName)
		if _, err := os.Stat(src); err == nil {
			if err := os.MkdirAll(filepath.Dir(dstFile), 0o755); err != nil {
				return body, fmt.Errorf("create target image dir: %w", err)
			}
			if err := os.Rename(src, dstFile); err != nil {
				return body, fmt.Errorf("move image %q: %w", fileName, err)
			}
		}
		oldURL := "/api/vaults/" + m[1] + "/images/" + rel
		newURL := "/api/vaults/" + dstVaultID + "/images/" + rel
		newBody = strings.ReplaceAll(newBody, oldURL, newURL)
	}
	return newBody, nil
}

// CopyImagesTo copies the image files the body references under srcVaultID
// from this store into dst (keeping the relative folder) and rewrites those
// URLs to dstVaultID; other image URLs stay as they are. Used when text
// leaves a personal store for a vault others can see (a quick-capture memo
// made into a note), so collaborators can load the images. Copies, not
// moves: the source text may keep referencing them.
func (s *Store) CopyImagesTo(body, srcVaultID string, dst *Store, dstVaultID string) (string, error) {
	newBody := body
	for _, m := range imageURLRe.FindAllStringSubmatch(body, -1) {
		if m[1] != srcVaultID {
			continue
		}
		rel := m[2]
		if !IsImageName(filepath.Base(rel)) {
			continue
		}
		src, ok := s.safeImagePath(rel)
		if !ok {
			continue
		}
		dstFile, ok := dst.safeImagePath(rel)
		if !ok {
			continue
		}
		data, err := os.ReadFile(src)
		if err != nil {
			continue // a dangling reference stays dangling
		}
		if err := os.MkdirAll(filepath.Dir(dstFile), 0o755); err != nil {
			return body, fmt.Errorf("create target image dir: %w", err)
		}
		if err := os.WriteFile(dstFile, data, 0o644); err != nil {
			return body, fmt.Errorf("copy image %q: %w", rel, err)
		}
		newBody = strings.ReplaceAll(newBody,
			"/api/vaults/"+srcVaultID+"/images/"+rel,
			"/api/vaults/"+dstVaultID+"/images/"+rel)
	}
	return newBody, nil
}

// imageDir returns the on-disk directory for images of a note in the given
// folder (empty = vault root).
func (s *Store) imageDir(folder string) string {
	if folder == "" {
		return s.Dir
	}
	return filepath.Join(s.Dir, filepath.FromSlash(sanitizePath(folder)))
}

// imageRel builds the URL path segment for an image in the given folder
// (empty = vault root).
func (s *Store) imageRel(folder, name string) string {
	p := strings.Trim(sanitizePath(folder), "/")
	if p == "" {
		return name
	}
	return p + "/" + name
}

// imageURL builds the server-relative URL served by GET /api/vaults/{id}/images/....
func (s *Store) imageURL(vaultID, folder, name string) string {
	return "/api/vaults/" + vaultID + "/images/" + s.imageRel(folder, name)
}

// safeImagePath resolves a vault-relative image path to an on-disk path,
// refusing path traversal outside the vault root.
func (s *Store) safeImagePath(relPath string) (string, bool) {
	clean := filepath.ToSlash(filepath.Clean(strings.ReplaceAll(relPath, "\\", "/")))
	if clean == "." || clean == "" || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") {
		return "", false
	}
	p := filepath.Join(s.Dir, filepath.FromSlash(clean))
	// Belt-and-braces: ensure the resolved path stays under Dir.
	rel, err := filepath.Rel(s.Dir, p)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return p, true
}

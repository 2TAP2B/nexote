// Package notes handles serialization of notes as markdown files with YAML
// frontmatter. The on-disk format is:
//
//	---
//	id: <id>
//	title: <title>
//	path: <optional folder path, e.g. "Journal/2026">
//	createdAt: <RFC3339>
//	updatedAt: <RFC3339>
//	---
//	<markdown body>
//
// The id is the filename (without .md); the path is the folder the file lives
// in, relative to the store root. This keeps notes organized in a tree while
// the id remains the stable handle for API operations.
package notes

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Meta is the YAML frontmatter block of a note.
type Meta struct {
	ID        string            `yaml:"id"`
	Title     string            `yaml:"title"`
	Path      string            `yaml:"path,omitempty"`
	CreatedAt time.Time         `yaml:"createdAt"`
	UpdatedAt time.Time         `yaml:"updatedAt"`
	Tags      []string          `yaml:"tags,omitempty"`
	Type      string            `yaml:"type,omitempty"`
	Artist    string            `yaml:"artist,omitempty"`
	Year      int               `yaml:"year,omitempty"`
	Genre     string            `yaml:"genre,omitempty"`
	Wantlist  *bool             `yaml:"wantlist,omitempty"`
	Cover      string            `yaml:"cover,omitempty"`
	Icon       string            `yaml:"icon,omitempty"`
	Collection string            `yaml:"collection,omitempty"`
	Fields    map[string]string `yaml:"fields,omitempty"`
}

// Document is a parsed note: its metadata plus the markdown body.
type Document struct {
	Meta Meta
	Body string
}

// frontmatterDelim is the fence that surrounds the YAML block.
const frontmatterDelim = "---"

// Encode serializes a document to the on-disk markdown+frontmatter format.
func Encode(d Document) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteString(frontmatterDelim + "\n")
	enc := yaml.NewEncoder(&buf)
	if err := enc.Encode(d.Meta); err != nil {
		return nil, err
	}
	if err := enc.Close(); err != nil {
		return nil, err
	}
	buf.WriteString(frontmatterDelim + "\n")
	buf.WriteString(d.Body)
	return buf.Bytes(), nil
}

// Decode parses the on-disk format. It tolerates a missing frontmatter block
// (the whole file is treated as body) and a missing trailing newline after
// the closing fence.
func Decode(data []byte) (Document, error) {
	doc := Document{}

	r := bufio.NewReader(bytes.NewReader(data))

	// Peek at the first line without consuming it.
	first, err := r.ReadBytes('\n')
	if err != nil && err != io.EOF {
		return doc, err
	}
	firstRaw := first
	first = bytes.TrimRight(first, "\r\n")

	// No frontmatter: treat the whole file as body. Reassemble using the raw
	// first line (with its newline) so the body is byte-identical to the input.
	if string(first) != frontmatterDelim {
		var buf bytes.Buffer
		buf.Write(firstRaw)
		if _, err := io.Copy(&buf, r); err != nil {
			return doc, err
		}
		doc.Body = buf.String()
		return doc, nil
	}

	// Read the YAML block up to the closing fence.
	var yamlBuf bytes.Buffer
	for {
		line, err := r.ReadBytes('\n')
		if err == io.EOF {
			return doc, errors.New("frontmatter: closing delimiter not found")
		}
		if err != nil {
			return doc, err
		}
		trimmed := bytes.TrimRight(line, "\r\n")
		if string(trimmed) == frontmatterDelim {
			break
		}
		yamlBuf.Write(line)
	}
	if err := yaml.Unmarshal(yamlBuf.Bytes(), &doc.Meta); err != nil {
		return doc, err
	}

	// Remainder is the markdown body. Drop a single leading newline so the
	// body does not start with a blank line.
	rest, err := io.ReadAll(r)
	if err != nil {
		return doc, err
	}
	doc.Body = strings.TrimPrefix(string(rest), "\n")
	return doc, nil
}
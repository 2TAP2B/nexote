package notes

import (
	"html"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Preview snippets: plain text derived from a markdown body for note lists,
// history entries and search hits. Must stay in sync with makeSnippet in
// frontend/src/lib/note-utils.ts.

// Backslash escapes are swapped for private-use runes before any syntax is
// stripped (so "\*" survives emphasis removal and "\#" is not a heading) and
// restored at the end.
const escBase = 0xE000

var (
	reEscape     = regexp.MustCompile("\\\\([\\\\`*_{}\\[\\]()#+\\-.!|>~$=<&:])")
	reFence      = regexp.MustCompile("^(```|~~~)")
	reHR         = regexp.MustCompile(`^([-*_])(\s*[-*_]){2,}$`)
	reTableSep   = regexp.MustCompile(`^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$`)
	reRefDef     = regexp.MustCompile(`^\[[^\]]+\]:\s`)
	reBlockquote = regexp.MustCompile(`^(>\s?)+`)
	reCallout    = regexp.MustCompile(`^\[![^\]]+\][+-]?\s*`)
	reHeading    = regexp.MustCompile(`^#{1,6}(\s+|$)`)
	reListMarker = regexp.MustCompile(`^(?:[-+*]|\d+[.)])(?:\s+|$)`)
	reTaskBox    = regexp.MustCompile(`^\[[ xX/-]\](?:\s+|$)`)
	reComment    = regexp.MustCompile(`<!--.*?-->`)
	reAutolink   = regexp.MustCompile(`<((?:https?|mailto|ftp):[^>\s]+)>`)
	reHTMLTag    = regexp.MustCompile(`</?[A-Za-z][^>]*>`)
	reWikiEmbed  = regexp.MustCompile(`!\[\[[^\]]*\]\]`)
	reImage      = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	reWikiLink   = regexp.MustCompile(`\[\[([^\]|]+)(?:\|([^\]]+))?\]\]`)
	reLink       = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	reRefLink    = regexp.MustCompile(`\[([^\]]+)\]\[[^\]]*\]`)
	reFootnote   = regexp.MustCompile(`\[\^[^\]]+\]`)
	reMarks      = regexp.MustCompile("\\*+|~~|==|`+")
	reUnderLead  = regexp.MustCompile(`(^|[^\p{L}\p{N}])_+`)
	reUnderTail  = regexp.MustCompile(`_+([^\p{L}\p{N}]|$)`)
	reSpaces     = regexp.MustCompile(`\s+`)
)

func protectEscapes(s string) string {
	return reEscape.ReplaceAllStringFunc(s, func(m string) string {
		return string(rune(escBase + int(m[1])))
	})
}

// restoreEscapes maps protected escapes back and drops zero-width runes.
func restoreEscapes(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= escBase && r < escBase+128:
			return r - escBase
		case r == '\u200b' || r == '\ufeff':
			return -1
		}
		return r
	}, s)
}

// cleanLine strips block markers and inline markdown/HTML from a single
// trimmed line whose escapes are already protected.
func cleanLine(t string) string {
	t = reBlockquote.ReplaceAllString(t, "")
	t = reCallout.ReplaceAllString(t, "")
	t = reHeading.ReplaceAllString(t, "")
	// Nested markers like "* [ ] task" or "- - item".
	for {
		n := reTaskBox.ReplaceAllString(reListMarker.ReplaceAllString(t, ""), "")
		if n == t {
			break
		}
		t = n
	}
	if strings.HasPrefix(t, "|") {
		t = strings.Trim(t, "| ")
		t = strings.ReplaceAll(t, "|", " ")
	}
	t = reComment.ReplaceAllString(t, " ")
	t = reAutolink.ReplaceAllString(t, "$1")
	t = reHTMLTag.ReplaceAllString(t, " ")
	t = reWikiEmbed.ReplaceAllString(t, "")
	t = reImage.ReplaceAllString(t, "")
	t = reWikiLink.ReplaceAllStringFunc(t, func(m string) string {
		sub := reWikiLink.FindStringSubmatch(m)
		if sub[2] != "" {
			return sub[2]
		}
		return sub[1]
	})
	t = reLink.ReplaceAllString(t, "$1")
	t = reRefLink.ReplaceAllString(t, "$1")
	t = reFootnote.ReplaceAllString(t, "")
	t = reMarks.ReplaceAllString(t, "")
	t = reUnderLead.ReplaceAllString(t, "$1")
	t = reUnderTail.ReplaceAllString(t, "$1")
	t = html.UnescapeString(t)
	return strings.TrimSpace(restoreEscapes(t))
}

// truncateRunes cuts s to at most limit runes, appending an ellipsis when cut.
func truncateRunes(s string, limit int) string {
	if utf8.RuneCountInString(s) <= limit {
		return s
	}
	i := 0
	for range limit {
		_, size := utf8.DecodeRuneInString(s[i:])
		i += size
	}
	return strings.TrimSpace(s[:i]) + "…"
}

// makeSnippet extracts a plain-text preview from a note body: skips the
// leading title heading, fenced code and $$ math blocks, horizontal rules,
// table separators and reference definitions, and strips markdown/HTML
// syntax, escapes and entities. Returns at most limit runes.
func makeSnippet(body string, limit int) string {
	var b strings.Builder
	runes := 0
	titleChecked := false
	inFence, inMath := false, false
	for _, line := range strings.Split(body, "\n") {
		// Editors leave zero-width spaces on "empty" paragraphs.
		t := strings.TrimSpace(strings.Trim(line, "\u200b\ufeff"))
		if t == "" {
			continue
		}
		if !titleChecked {
			titleChecked = true
			if reHeading.MatchString(t) {
				continue
			}
		}
		if reFence.MatchString(t) {
			inFence = !inFence
			continue
		}
		if t == "$$" || (strings.HasPrefix(t, "$$") && !(len(t) > 4 && strings.HasSuffix(t, "$$"))) {
			inMath = !inMath
			continue
		}
		if inFence || inMath || reHR.MatchString(t) || reTableSep.MatchString(t) || reRefDef.MatchString(t) {
			continue
		}
		t = reSpaces.ReplaceAllString(cleanLine(protectEscapes(t)), " ")
		if t == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteByte(' ')
			runes++
		}
		b.WriteString(t)
		runes += utf8.RuneCountInString(t)
		if runes > limit {
			break
		}
	}
	return truncateRunes(b.String(), limit)
}

// contentSnippet builds a matched-context preview around the first hit
// (assumed to be a byte offset in lower(body) projected back to original
// body — adequate for the predominantly-latin case). Markdown is stripped
// per line and newlines collapse.
func contentSnippet(body string, idx int, q string, limit int) string {
	if idx < 0 || limit <= 0 {
		return ""
	}
	start := max(idx-limit/3, 0)
	end := min(idx+len(q)+limit, len(body))
	for start > 0 && !utf8.RuneStart(body[start]) {
		start--
	}
	for end < len(body) && !utf8.RuneStart(body[end]) {
		end++
	}
	var parts []string
	for _, line := range strings.Split(body[start:end], "\n") {
		t := strings.TrimSpace(line)
		if t == "" || reFence.MatchString(t) || reHR.MatchString(t) || reTableSep.MatchString(t) {
			continue
		}
		if t = cleanLine(protectEscapes(t)); t != "" {
			parts = append(parts, t)
		}
	}
	window := reSpaces.ReplaceAllString(strings.Join(parts, " "), " ")
	if start > 0 {
		window = "…" + window
	}
	if end < len(body) {
		window += "…"
	}
	return truncateRunes(window, limit)
}

package serversync

import (
	"regexp"
	"sort"
	"strings"
)

// When the server and the device each have their own Notepad (or their own
// daily note for a date), both are "the" note, so a sync must merge them into
// one instead of keeping two. These functions do that on the bodies alone.

var (
	notepadHeading = regexp.MustCompile(`^###\s+(\d{4}-\d{2}-\d{2})\s*$`)
	notepadItem    = regexp.MustCompile(`^[-*]\s+(\d{1,2}:\d{2})(?:\s+(.*))?$`)
	notepadIndent  = regexp.MustCompile(`^\s{2,}\S`)
	// Same as IMAGE_LINE in frontend/src/lib/notepad.ts.
	notepadImage = regexp.MustCompile(`^!\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)$`)
)

const pinMark = "📌"

type notepadEntry struct {
	day, time, text string
	pinned          bool
}

// key identifies an entry across notes: the pin is ignored so pinning a memo
// on one side doesn't duplicate it, and "9:05" equals "09:05".
func (e notepadEntry) key() string { return e.day + "\x00" + padTime(e.time) + "\x00" + e.text }

func padTime(t string) string {
	if len(t) == 4 {
		return "0" + t
	}
	return t
}

// render mirrors formatNotepadItem in frontend/src/lib/notepad.ts.
func (e notepadEntry) render() string {
	lines := strings.Split(e.text, "\n")
	pin := ""
	if e.pinned {
		pin = pinMark + " "
	}
	out := []string{"- " + e.time + " " + pin + lines[0]}
	for _, l := range lines[1:] {
		if strings.TrimSpace(l) == "" {
			out = append(out, "")
		} else {
			out = append(out, "  "+l)
		}
	}
	return strings.Join(out, "\n")
}

type notepadDoc struct {
	preamble string
	entries  []notepadEntry
	// Days in order of appearance (a heading without items still counts), and
	// per day the lines that are neither items nor part of one, so merging
	// never drops text someone typed between the items.
	days   []string
	strays map[string][]string
}

// parseNotepadDoc mirrors parseNotepad in frontend/src/lib/notepad.ts, plus an
// unindented image line directly after an item belonging to it (that's how
// the rich editor re-serializes a memo's picture).
func parseNotepadDoc(body string) notepadDoc {
	doc := notepadDoc{strays: map[string][]string{}}
	lines := strings.Split(body, "\n")
	started := false
	var pre []string
	day := ""
	open := -1 // index into doc.entries; a pointer would go stale on append
	blanks := 0
	seenDay := map[string]bool{}
	addDay := func(d string) {
		if !seenDay[d] {
			seenDay[d] = true
			doc.days = append(doc.days, d)
		}
	}
	for _, line := range lines {
		if m := notepadHeading.FindStringSubmatch(line); m != nil {
			started = true
			day = m[1]
			addDay(day)
			open = -1
			continue
		}
		if m := notepadItem.FindStringSubmatch(line); m != nil {
			started = true
			addDay(day)
			raw := m[2]
			pinned := strings.HasPrefix(raw, pinMark)
			text := raw
			if pinned {
				text = strings.TrimLeft(raw[len(pinMark):], " \t\r\n\f\v")
			}
			doc.entries = append(doc.entries, notepadEntry{day: day, time: m[1], text: text, pinned: pinned})
			open = len(doc.entries) - 1
			blanks = 0
			continue
		}
		if !started {
			pre = append(pre, line)
			continue
		}
		if strings.TrimSpace(line) == "" {
			blanks++
			continue
		}
		if open >= 0 && (notepadIndent.MatchString(line) || (blanks == 0 && notepadImage.MatchString(line))) {
			doc.entries[open].text += strings.Repeat("\n", blanks+1) + strings.TrimSpace(line)
			blanks = 0
			continue
		}
		open = -1
		doc.strays[day] = append(doc.strays[day], strings.TrimSpace(line))
	}
	doc.preamble = strings.Join(trimBlankLines(pre), "\n")
	return doc
}

// trimBlankLines drops leading and trailing whitespace-only lines.
func trimBlankLines(lines []string) []string {
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// MergeNotepad unions two quick-capture Notepads: the server's preamble, then
// the days in ascending order with their items sorted by time. An item in
// both (same day, time and text) is kept once, as the server has it.
func MergeNotepad(server, other string) string {
	s, o := parseNotepadDoc(server), parseNotepadDoc(other)

	preamble := s.preamble
	if o.preamble != "" && !strings.Contains(preamble, o.preamble) {
		if preamble != "" {
			preamble += "\n\n"
		}
		preamble += o.preamble
	}

	seen := map[string]bool{}
	byDay := map[string][]notepadEntry{}
	for _, e := range append(s.entries, o.entries...) {
		if k := e.key(); !seen[k] {
			seen[k] = true
			byDay[e.day] = append(byDay[e.day], e)
		}
	}
	strays := map[string][]string{}
	seenStray := map[string]bool{}
	for _, doc := range []notepadDoc{s, o} {
		for d, ls := range doc.strays {
			for _, l := range ls {
				if k := d + "\x00" + l; !seenStray[k] {
					seenStray[k] = true
					strays[d] = append(strays[d], l)
				}
			}
		}
	}

	daySet := map[string]bool{}
	var days []string
	for _, d := range append(s.days, o.days...) {
		if !daySet[d] {
			daySet[d] = true
			days = append(days, d)
		}
	}
	sort.Strings(days) // "" (items before any heading) sorts first

	var sections []string
	if preamble != "" {
		sections = append(sections, preamble)
	}
	for _, d := range days {
		entries := byDay[d]
		sort.SliceStable(entries, func(i, j int) bool { return padTime(entries[i].time) < padTime(entries[j].time) })
		var b strings.Builder
		if d != "" {
			b.WriteString("### " + d)
		}
		for i, e := range entries {
			if d != "" || i > 0 {
				b.WriteString("\n")
			}
			b.WriteString(e.render())
		}
		if ls := strays[d]; len(ls) > 0 {
			// The blank line keeps the stray text from reading as an image
			// line of the last item when parsed again.
			if b.Len() > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString(strings.Join(ls, "\n"))
		}
		if b.Len() > 0 {
			sections = append(sections, b.String())
		}
	}
	if len(sections) == 0 {
		return ""
	}
	return strings.Join(sections, "\n\n") + "\n"
}

// MergeDaily appends the other daily note's text, without its "## <date>"
// heading, to the server's, unless the server already has it.
func MergeDaily(server, other, date string) string {
	lines := trimBlankLines(strings.Split(other, "\n"))
	heading := regexp.MustCompile(`^##\s+` + regexp.QuoteMeta(date) + `\s*$`)
	if len(lines) > 0 && heading.MatchString(lines[0]) {
		lines = trimBlankLines(lines[1:])
	}
	rest := strings.TrimRight(strings.Join(lines, "\n"), " \t\r\n")
	if strings.TrimSpace(rest) == "" || strings.Contains(server, rest) {
		return server
	}
	if strings.TrimSpace(server) == "" {
		return other
	}
	return strings.TrimRight(server, " \t\r\n") + "\n\n" + rest + "\n"
}

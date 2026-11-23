// Markdown edits for the plain-text composers (quick notes, thread posts):
// the full-screen toolbar's buttons and list continuation on Enter. Each one
// returns the span to replace and the selection afterwards, so the composer
// applies it as a single native insert (the browser's undo keeps working)
// and puts the caret back.

export type TextEdit = {
  from: number;
  to: number;
  insert: string;
  /** The selection after the edit. */
  selStart: number;
  selEnd: number;
};

export function applyTextEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Bold, italic, strikethrough, highlight, code: wraps the selection in
 * `marker`, or takes the markers away when they're already there. A caret
 * inside a word wraps the word; a caret elsewhere gets an empty pair to type
 * into. Spaces at the selection's edges stay outside ("**word **" isn't
 * bold), and each line gets its own pair (emphasis doesn't cross lines).
 */
export function toggleInline(text: string, start: number, end: number, marker: string): TextEdit {
  const m = marker.length;
  if (text.slice(start - m, start) === marker && text.slice(end, end + m) === marker) {
    return { from: start - m, to: end + m, insert: text.slice(start, end), selStart: start - m, selEnd: end - m };
  }
  const selected = text.slice(start, end);
  if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, -m);
    return { from: start, to: end, insert: inner, selStart: start, selEnd: start + inner.length };
  }
  if (start === end) {
    let from = start;
    let to = end;
    while (from > 0 && WORD_CHAR.test(text[from - 1])) from--;
    while (to < text.length && WORD_CHAR.test(text[to])) to++;
    if (from < start && to > end) {
      return { from, to, insert: marker + text.slice(from, to) + marker, selStart: start + m, selEnd: start + m };
    }
    return { from: start, to: end, insert: marker + marker, selStart: start + m, selEnd: start + m };
  }
  const lines = selected.split("\n");
  const insert = lines
    .map((line) => {
      const core = line.trim();
      if (!core) return line;
      const lead = line.slice(0, line.length - line.trimStart().length);
      const trail = line.slice(line.trimEnd().length);
      return lead + marker + core + marker + trail;
    })
    .join("\n");
  if (lines.length === 1) {
    const lead = selected.length - selected.trimStart().length;
    const selStart = start + lead + m;
    return { from: start, to: end, insert, selStart, selEnd: selStart + selected.trim().length };
  }
  return { from: start, to: end, insert, selStart: start, selEnd: start + insert.length };
}

export type LineKind = "bullet" | "ordered" | "task" | "quote";

const LINE_PREFIX: Record<LineKind, RegExp> = {
  task: /^(\s*)[-*+] \[[ xX]\] /,
  bullet: /^(\s*)[-*+] (?!\[[ xX]\] )/,
  ordered: /^(\s*)\d+[.)] /,
  quote: /^(\s*)> ?/,
};
// Any list or quote marker: switching kinds replaces it.
const ANY_PREFIX = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)/;

const markerFor = (kind: LineKind, n: number) =>
  kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : kind === "ordered" ? `${n}. ` : "> ";

/**
 * Lists and quotes: puts the marker in front of every line the selection
 * touches (a numbered list counts up), turns another kind into this one, or
 * takes the marker away when all lines already have it.
 */
export function toggleLinePrefix(text: string, start: number, end: number, kind: LineKind): TextEdit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  // A selection ending right at a line start doesn't take that line in.
  const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const nl = text.indexOf("\n", last);
  const lineEnd = nl < 0 ? text.length : nl;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const filled = lines.filter((l) => l.trim() !== "");
  const remove = filled.length > 0 && filled.every((l) => LINE_PREFIX[kind].test(l));

  let n = 0;
  // Each line: [old marker length, new line].
  const changed = lines.map((line): [number, string] => {
    if (remove) {
      const m = line.match(LINE_PREFIX[kind]);
      return m ? [m[0].length, m[1] + line.slice(m[0].length)] : [0, line];
    }
    if (line.trim() === "" && lines.length > 1) return [0, line];
    const m = line.match(ANY_PREFIX);
    const indent = m ? m[1] : line.slice(0, line.length - line.trimStart().length);
    const rest = line.slice(m ? m[0].length : indent.length);
    n += 1;
    return [m ? m[0].length : indent.length, indent + markerFor(kind, n) + rest];
  });
  const insert = changed.map(([, l]) => l).join("\n");

  if (start !== end) return { from: lineStart, to: lineEnd, insert, selStart: lineStart, selEnd: lineStart + insert.length };
  // The caret stays on its text, after the first line's new marker.
  const [oldPrefix, first] = changed[0];
  const newPrefix = first.length - (lines[0].length - oldPrefix);
  const offset = start - lineStart;
  const caret = lineStart + newPrefix + Math.max(0, offset - oldPrefix);
  return { from: lineStart, to: lineEnd, insert, selStart: caret, selEnd: caret };
}

/**
 * Enter on a list or quote line: the next line gets the same marker (a
 * numbered list the next number, a task an open box). Enter on an empty item
 * ends the list: its marker goes, and after a filled line a blank line
 * follows — Markdown would count the next line as part of the last item
 * otherwise. Null when the line isn't one (a plain new line).
 */
export function continueList(text: string, start: number, end: number): TextEdit | null {
  if (start !== end) return null;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const m = text.slice(lineStart, start).match(/^(\s*)(?:([-*+]) \[[ xX]\] |([-*+]) |(\d+)([.)]) |(>) ?)/);
  if (!m) return null;
  const nl = text.indexOf("\n", start);
  const lineEnd = nl < 0 ? text.length : nl;
  const indent = m[1];
  if (text.slice(lineStart + m[0].length, lineEnd).trim() === "") {
    const prevLine = lineStart > 0 ? text.slice(text.lastIndexOf("\n", lineStart - 2) + 1, lineStart - 1) : "";
    const insert = prevLine.trim() ? `\n${indent}` : indent;
    return { from: lineStart, to: lineEnd, insert, selStart: lineStart + insert.length, selEnd: lineStart + insert.length };
  }
  const next = m[2] ? `${m[2]} [ ] ` : m[3] ? `${m[3]} ` : m[4] ? `${Number(m[4]) + 1}${m[5]} ` : "> ";
  const insert = `\n${indent}${next}`;
  // Splitting an item mid-line: the spaces at the split don't start the new one.
  let to = start;
  while (to < lineEnd && text[to] === " ") to++;
  return { from: start, to, insert, selStart: start + insert.length, selEnd: start + insert.length };
}

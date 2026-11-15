import { api } from "./api";
import { localDateKey } from "./note-utils";

// The "Notepad" note quick capture posts into: entries are "- HH:MM text" list
// items grouped under "### YYYY-MM-DD" day headings — plain markdown that reads
// fine in the editor and in any other markdown tool. A multi-line entry keeps
// its continuation lines indented by two spaces, so it stays one list item.
// Linked notes are Obsidian wikilinks ("[[Title]]"); attached images are
// image lines ("![](url)") inside the entry.

export const NOTEPAD_TITLE = "Notepad";

/** The personal store (pseudo vault id): only its owner sees it, in no tree. */
export const HOME_VAULT = "home";

export type NotepadLocation = { vaultId: string; folder: string };

/** Where the Notepad lives per Settings › Features ("" vault = personal store). */
export function notepadLocation(s: { notepadVault: string; notepadFolder: string }): NotepadLocation {
  return s.notepadVault ? { vaultId: s.notepadVault, folder: s.notepadFolder } : { vaultId: HOME_VAULT, folder: "" };
}

/** The Notepad's id at a location (same folder first, then anywhere there), or null. */
export async function findNotepad(loc: NotepadLocation): Promise<string | null> {
  const res = await api.list(loc.vaultId);
  const candidates = (res.notes ?? []).filter((n) => n.title === NOTEPAD_TITLE && !n.collection);
  return (candidates.find((n) => (n.path ?? "") === loc.folder) ?? candidates[0])?.id ?? null;
}

export type NotepadEntry = {
  day: string;
  time: string;
  text: string;
  /** Line range of the entry in the body: [start, end). */
  start: number;
  end: number;
};

/** [[Title]] or [[Title|label]]. */
export const MENTION_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

const IMAGE_LINE = /^!\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)$/;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The list item for one entry; blank lines inside the text stay blank. */
export function formatNotepadItem(time: string, text: string): string {
  const [first, ...rest] = text.split("\n");
  return [`- ${time} ${first}`, ...rest.map((l) => (l.trim() ? `  ${l}` : ""))].join("\n");
}

// Appends text under today's heading, starting that heading when the last one
// is another day.
export function appendNotepadEntry(body: string, text: string, now = new Date()): string {
  const heading = `### ${localDateKey(now)}`;
  const item = formatNotepadItem(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`, text);
  const trimmed = body.replace(/\s+$/, "");
  const lastHeading = trimmed.match(/^### .*$/gm)?.pop()?.trim();
  return lastHeading === heading ? `${trimmed}\n${item}\n` : `${trimmed}\n\n${heading}\n${item}\n`;
}

// Replaces one entry's text, keeping its day and time. The entry is looked up
// by content in the given (latest) body, so edits made elsewhere in the
// meantime are kept; null when the entry no longer exists there.
export function replaceNotepadEntry(
  body: string,
  target: Pick<NotepadEntry, "day" | "time" | "text">,
  text: string,
): string | null {
  const entry = findNotepadEntry(parseNotepad(body), target);
  if (!entry) return null;
  const lines = body.split("\n");
  lines.splice(entry.start, entry.end - entry.start, ...formatNotepadItem(entry.time, text).split("\n"));
  return lines.join("\n");
}

// Takes one entry out (looked up like replaceNotepadEntry), with its day
// heading when it was that day's last entry; null when it no longer exists.
export function removeNotepadEntry(body: string, target: Pick<NotepadEntry, "day" | "time" | "text">): string | null {
  const entries = parseNotepad(body);
  const entry = findNotepadEntry(entries, target);
  if (!entry) return null;
  const lines = body.split("\n");
  let start = entry.start;
  if (entry.day && entries.filter((e) => e.day === entry.day).length === 1) {
    for (let i = entry.start - 1; i >= 0; i--) {
      if (/^###\s+/.test(lines[i])) {
        start = i;
        break;
      }
    }
  }
  lines.splice(start, entry.end - start);
  // Don't leave a double blank line where the entry was.
  while (start > 0 && start < lines.length && !lines[start - 1].trim() && !lines[start].trim()) lines.splice(start, 1);
  return lines.join("\n").replace(/\n+$/, "\n");
}

function findNotepadEntry(entries: NotepadEntry[], target: Pick<NotepadEntry, "day" | "time" | "text">) {
  return entries.find((e) => e.day === target.day && e.time === target.time && e.text === target.text);
}

/**
 * A note made from a memo: the first text line, links reduced to their text,
 * becomes the title. With a title heading the heading replaces that line,
 * unless the line says more (links, cut off), then it stays below.
 */
export function memoToNote(entry: NotepadEntry, titleHeading: boolean): { title: string; body: string } {
  const lines = entry.text.split("\n");
  const firstIndex = lines.findIndex((l) => l.trim() && !IMAGE_LINE.test(l.trim()));
  const first = firstIndex >= 0 ? lines[firstIndex].trim() : "";
  let title = first.replace(MENTION_RE, (_m, target: string, label?: string) => (label ?? target).trim()).trim();
  if (title.length > 80) {
    const cut = title.slice(0, 80);
    const space = cut.lastIndexOf(" ");
    title = (space > 40 ? cut.slice(0, space) : cut).trim();
  }
  if (!title) title = `Memo ${entry.day} ${entry.time}`.trim();
  if (!titleHeading) return { title, body: `${entry.text}\n` };
  const rest = title === first ? lines.filter((_, i) => i !== firstIndex) : lines;
  const restText = rest.join("\n").trim();
  return { title, body: `## ${title}\n\n${restText ? `${restText}\n` : ""}` };
}

// Reads the entries back. Accepts "*" bullets and blank lines between items
// too: that's how the rich editor re-serializes the list once the note has
// been edited there.
export function parseNotepad(body: string): NotepadEntry[] {
  const entries: NotepadEntry[] = [];
  const lines = body.split("\n");
  let day = "";
  // The entry continuation lines attach to, and blank lines seen since its
  // last line (kept when an indented line follows).
  let open: NotepadEntry | null = null;
  let blanks = 0;
  lines.forEach((line, i) => {
    const heading = line.match(/^###\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (heading) {
      day = heading[1];
      open = null;
      return;
    }
    const item = line.match(/^[-*]\s+(\d{1,2}:\d{2})(?:\s+(.*))?$/);
    if (item) {
      open = { day, time: item[1], text: item[2] ?? "", start: i, end: i + 1 };
      entries.push(open);
      blanks = 0;
      return;
    }
    if (!open) return;
    if (!line.trim()) {
      blanks++;
      return;
    }
    if (/^\s{2,}\S/.test(line)) {
      open.text += "\n".repeat(blanks + 1) + line.trim();
      open.end = i + 1;
      blanks = 0;
      return;
    }
    open = null;
  });
  return entries;
}

/** Splits an entry into its text and the images on their own lines. */
export function splitMemo(text: string): { text: string; images: string[] } {
  const images: string[] = [];
  const rest: string[] = [];
  for (const line of text.split("\n")) {
    const image = line.trim().match(IMAGE_LINE);
    if (image) images.push(image[1].replace(/^<|>$/g, ""));
    else rest.push(line);
  }
  return { text: rest.join("\n").trim(), images };
}

/** The entry text for some text plus images (one image line each). */
export function joinMemo(text: string, images: string[]): string {
  const imageLines = images.map((url) => (/[\s()]/.test(url) ? `![](<${url}>)` : `![](${url})`));
  return [text.trim(), ...imageLines].filter(Boolean).join("\n");
}

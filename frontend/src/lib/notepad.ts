import { localDateKey } from "./note-utils";

// The "Notepad" note quick capture posts into: entries are "- HH:MM text"
// list items grouped under "### YYYY-MM-DD" day headings, plain markdown that
// reads fine in the editor and in any other markdown tool.

export const NOTEPAD_TITLE = "Notepad";

export type NotepadEntry = { day: string; time: string; text: string };

const pad2 = (n: number) => String(n).padStart(2, "0");

// Appends text under today's heading, starting that heading when the last one
// is another day. Continuation lines are indented so a multi-line entry stays
// one list item.
export function appendNotepadEntry(body: string, text: string, now = new Date()): string {
  const heading = `### ${localDateKey(now)}`;
  const [first, ...rest] = text.split("\n");
  const item = [`- ${pad2(now.getHours())}:${pad2(now.getMinutes())} ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
  const trimmed = body.replace(/\s+$/, "");
  const lastHeading = trimmed.match(/^### .*$/gm)?.pop()?.trim();
  return lastHeading === heading ? `${trimmed}\n${item}\n` : `${trimmed}\n\n${heading}\n${item}\n`;
}

// Reads the entries back. Accepts "*" bullets and blank lines between items
// too: that's how the rich editor re-serializes the list once the note has
// been edited there.
export function parseNotepad(body: string): NotepadEntry[] {
  const entries: NotepadEntry[] = [];
  let day = "";
  for (const line of body.split("\n")) {
    const heading = line.match(/^###\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (heading) {
      day = heading[1];
      continue;
    }
    const item = line.match(/^[-*]\s+(\d{1,2}:\d{2})\s+(.*)$/);
    if (item) {
      entries.push({ day, time: item[1], text: item[2] });
      continue;
    }
    if (entries.length > 0 && /^\s{2,}\S/.test(line)) {
      entries[entries.length - 1].text += "\n" + line.trim();
    }
  }
  return entries;
}

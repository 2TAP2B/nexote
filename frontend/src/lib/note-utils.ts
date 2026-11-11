"use client";

// The note title is an H2 (##) heading at the start of the body.
// (H1 was avoided because a custom Ctrl+A handler that excluded the H1 title
// caused the editor to scroll-jump; with H2 the native Ctrl+A runs, which
// doesn't jump.) These helpers also migrate legacy H1 titles to H2 on save.
export function extractTitleHeading(body: string): string | null {
  const m = body.match(/^##? (.+)$/m);
  return m ? m[1].trim() : null;
}

export function replaceOrAddTitleHeading(body: string, title: string): string {
  const heading = `## ${title}`;
  if (/^##? .+$/m.test(body)) {
    return body.replace(/^##? .+$/m, heading);
  }
  return body ? `${heading}\n\n${body}` : heading;
}

// Local-time YYYY-MM-DD — the journal's day key (toISOString would shift
// days across UTC midnight).
export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Plain-text preview of a markdown body for note lists. Mirrors makeSnippet
// in backend/notes/snippet.go — keep both in sync.
const ESC_BASE = 0xe000;
const RE_ESCAPE = /\\([\\`*_{}[\]()#+\-.!|>~$=<&:])/g;
const RE_FENCE = /^(```|~~~)/;
const RE_HR = /^([-*_])(\s*[-*_]){2,}$/;
const RE_TABLE_SEP = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/;
const RE_REF_DEF = /^\[[^\]]+\]:\s/;
const RE_HEADING = /^#{1,6}(\s+|$)/;
const RE_LIST_MARKER = /^(?:[-+*]|\d+[.)])(?:\s+|$)/;
const RE_TASK_BOX = /^\[[ xX/-]\](?:\s+|$)/;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function cleanLine(line: string): string {
  let t = line.replace(RE_ESCAPE, (_, c: string) => String.fromCharCode(ESC_BASE + c.charCodeAt(0)));
  t = t.replace(/^(>\s?)+/, "").replace(/^\[![^\]]+\][+-]?\s*/, "").replace(RE_HEADING, "");
  for (;;) {
    const n = t.replace(RE_LIST_MARKER, "").replace(RE_TASK_BOX, "");
    if (n === t) break;
    t = n;
  }
  if (t.startsWith("|")) t = t.replace(/^[|\s]+|[|\s]+$/g, "").replace(/\|/g, " ");
  t = t
    .replace(/<!--.*?-->/g, " ")
    .replace(/<((?:https?|mailto|ftp):[^>\s]+)>/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a: string, b?: string) => b || a)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/\*+|~~|==|`+/g, "")
    .replace(/(^|[^\p{L}\p{N}])_+/gu, "$1")
    .replace(/_+([^\p{L}\p{N}]|$)/gu, "$1");
  t = decodeEntities(t).replace(/[\ue000-\ue07f]/g, (c) => String.fromCharCode(c.charCodeAt(0) - ESC_BASE));
  return t.replace(/[\u200b\ufeff]/g, "").replace(/\s+/g, " ").trim();
}

export function makeSnippet(body: string | undefined, limit = 150): string {
  if (!body) return "";
  const parts: string[] = [];
  let length = 0;
  let titleChecked = false;
  let inFence = false;
  let inMath = false;
  for (const raw of body.split("\n")) {
    // Editors leave zero-width spaces on "empty" paragraphs.
    const line = raw.replace(/^[\s\u200b\ufeff]+|[\s\u200b\ufeff]+$/g, "");
    if (!line) continue;
    if (!titleChecked) {
      titleChecked = true;
      if (RE_HEADING.test(line)) continue;
    }
    if (RE_FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (line === "$$" || (line.startsWith("$$") && !(line.length > 4 && line.endsWith("$$")))) {
      inMath = !inMath;
      continue;
    }
    if (inFence || inMath || RE_HR.test(line) || RE_TABLE_SEP.test(line) || RE_REF_DEF.test(line)) continue;
    const t = cleanLine(line);
    if (!t) continue;
    parts.push(t);
    length += t.length + 1;
    if (length > limit) break;
  }
  const chars = Array.from(parts.join(" "));
  return chars.length > limit ? chars.slice(0, limit).join("").trimEnd() + "…" : chars.join("");
}

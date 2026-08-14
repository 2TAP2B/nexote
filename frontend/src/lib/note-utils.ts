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

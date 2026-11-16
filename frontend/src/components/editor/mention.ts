// "@" (or Obsidian's "[[") at the caret opens a note picker; picking inserts
// a [[wikilink]] chip. The plugin only reports the live trigger and forwards
// keys; the list is rendered by the editor component.

import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export type MentionState = { query: string; from: number; to: number };

const MAX_RESULTS = 8;

/** "@query" (after a space or at the line start) or "[[query" right before the caret. */
export function computeMention(view: EditorView): MentionState | null {
  const { selection } = view.state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const link = /\[\[([^\]\n\ufffc]{0,60})$/.exec(before);
  if (link) return { query: link[1], from: $from.pos - link[0].length, to: $from.pos };
  const at = /(?:^|[\s(])@([^\s@\ufffc]{0,40})$/.exec(before);
  if (at) return { query: at[1], from: $from.pos - at[1].length - 1, to: $from.pos };
  return null;
}

/** Note titles matching the query: prefix matches first, then by name. */
export function mentionCandidates(titles: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const unique = [...new Set(titles.filter(Boolean))];
  return unique
    .filter((t) => t.toLowerCase().includes(q))
    .sort((a, b) => {
      const pa = a.toLowerCase().startsWith(q) ? 0 : 1;
      const pb = b.toLowerCase().startsWith(q) ? 0 : 1;
      return pa - pb || a.localeCompare(b);
    })
    .slice(0, MAX_RESULTS);
}

/** Replaces the trigger text with a link chip (plus a space to keep typing). */
export function insertMention(view: EditorView, mention: MentionState, title: string): void {
  const type = view.state.schema.nodes.wikilink;
  if (!type) return;
  const tr = view.state.tr.replaceWith(mention.from, mention.to, type.create({ target: title, label: "" }));
  view.dispatch(tr.insertText(" ").scrollIntoView());
  view.focus();
}

export function mentionPlugin(opts: {
  onChange: (state: MentionState | null, view: EditorView) => void;
  /** Keys while the picker is open; true when handled. */
  onKey: (e: KeyboardEvent) => boolean;
}) {
  return new Plugin({
    key: new PluginKey("nexote-mention"),
    view: (view) => {
      opts.onChange(computeMention(view), view);
      return { update: (v) => opts.onChange(computeMention(v), v) };
    },
    props: {
      handleDOMEvents: {
        // DOM keydown runs before every keymap (the base keymap binds
        // Escape, Enter and the arrows), so the open picker gets them first.
        keydown: (_view, e) => {
          if (!opts.onKey(e)) return false;
          e.preventDefault();
          return true;
        },
        blur: (view) => {
          opts.onChange(null, view);
          return false;
        },
      },
    },
  });
}

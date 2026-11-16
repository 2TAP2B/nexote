// "Code" from the / menu or toolbar: with a selection it toggles inline code
// on it; at a bare caret it starts a typing session where everything typed
// right there becomes inline code. Milkdown's inline code mark isn't
// inclusive (typing at its end leaves it), so a stored mark alone would only
// cover the first character. The session works on document changes
// (appendTransaction), so composed input from phone keyboards counts too.
// It ends when the caret moves away, on a new line, or when deleting past
// its start.

import { toggleMark } from "@milkdown/kit/prose/commands";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

type Session = { active: boolean; start: number; end: number };

const OFF: Session = { active: false, start: 0, end: 0 };
const key = new PluginKey<Session>("nexote-inline-code-typing");

export function startInlineCode(view: EditorView): void {
  const { state } = view;
  const mark = state.schema.marks.inlineCode;
  if (!mark) return;
  const { from, empty } = state.selection;
  if (!empty) {
    toggleMark(mark)(state, view.dispatch);
    return;
  }
  view.dispatch(state.tr.setMeta(key, { active: true, start: from, end: from } satisfies Session));
}

const session = (state: EditorState): Session => key.getState(state) ?? OFF;

export const inlineCodeTypingPlugin = new Plugin<Session>({
  key,
  state: {
    init: () => OFF,
    apply(tr, value) {
      const meta = tr.getMeta(key) as Session | undefined;
      if (meta) return meta;
      if (!value.active || !tr.docChanged) return value;
      // The start stays before text typed at it; the end follows the caret.
      return { active: true, start: tr.mapping.map(value.start, -1), end: tr.mapping.map(value.end, 1) };
    },
  },
  appendTransaction(trs, _old, state) {
    const s = session(state);
    if (!s.active) return null;
    const { selection, doc, schema } = state;
    const head = selection.head;
    const stop = () => state.tr.setMeta(key, OFF);
    if (!trs.some((tr) => tr.docChanged)) {
      // Selection-only change: still at the run's end keeps the session.
      return selection.empty && head === s.end ? null : stop();
    }
    if (!selection.empty || head < s.start || !doc.resolve(s.start).sameParent(selection.$head)) return stop();
    const mark = schema.marks.inlineCode;
    if (!mark) return stop();
    const tr = state.tr.setMeta(key, { active: true, start: s.start, end: head } satisfies Session);
    if (head > s.start) tr.addMark(s.start, head, mark.create());
    return tr;
  },
});

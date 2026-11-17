// ==Highlights== (Obsidian syntax) in the rich editor: a mark that renders as
// <mark> and is written back as "==text==". Other tools that don't know the
// syntax show the text with the equals signs, still readable.

import { markRule } from "@milkdown/kit/prose";
import { toggleMark } from "@milkdown/kit/prose/commands";
import type { Mark } from "@milkdown/kit/prose/model";
import { $command, $inputRule, $markSchema, $remark } from "@milkdown/kit/utils";

// "==" text "==" on one line; the text neither starts nor ends with a space
// or "=" (so "a == b" and "===" stay plain text).
const HIGHLIGHT_RE = /==([^=\s\n](?:[^=\n]*[^=\s\n])?)==/g;

type MdNode = { type: string; value?: string; children?: MdNode[] };
type Info = { before: string; after: string };
type MdState = {
  enter: (name: string) => () => void;
  containerPhrasing: (node: MdNode, info: Info) => string;
};

// Splits "==text==" out of text nodes into highlight nodes, and teaches the
// serializer to write them back.
function remarkHighlight(this: { data: () => Record<string, unknown> }) {
  const data = this.data();
  const extensions = (data.toMarkdownExtensions as unknown[] | undefined) ?? [];
  extensions.push({
    handlers: {
      highlight: (node: MdNode, _parent: unknown, state: MdState) => {
        const exit = state.enter("emphasis");
        const inner = state.containerPhrasing(node, { before: "=", after: "=" });
        exit();
        return `==${inner}==`;
      },
    },
  });
  data.toMarkdownExtensions = extensions;

  const skip: Record<string, true> = { code: true, inlineCode: true, html: true };
  const walk = (node: MdNode) => {
    if (!node.children || skip[node.type]) return;
    const out: MdNode[] = [];
    for (const child of node.children) {
      if (child.type !== "text" || !child.value?.includes("==")) {
        walk(child);
        out.push(child);
        continue;
      }
      const value = child.value;
      let last = 0;
      for (const m of value.matchAll(HIGHLIGHT_RE)) {
        const at = m.index ?? 0;
        if (at > last) out.push({ type: "text", value: value.slice(last, at) });
        out.push({ type: "highlight", children: [{ type: "text", value: m[1] }] });
        last = at + m[0].length;
      }
      if (last < value.length) out.push({ type: "text", value: value.slice(last) });
    }
    node.children = out;
  };
  return (tree: MdNode) => walk(tree);
}

export const highlightRemark = $remark("nexote-highlight", () => remarkHighlight as never);

export const highlightSchema = $markSchema("highlight", () => ({
  parseDOM: [{ tag: "mark" }],
  toDOM: () => ["mark", { class: "nexote-highlight" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "highlight",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: Mark) => mark.type.name === "highlight",
    runner: (state, mark: Mark) => {
      state.withMark(mark, "highlight");
    },
  },
}));

// Typing the closing "==" of "==text==" highlights it right away.
export const highlightInputRule = $inputRule((ctx) =>
  markRule(/==([^=\s](?:[^=]*[^=\s])?)==$/, highlightSchema.type(ctx)),
);

export const toggleHighlightCommand = $command("ToggleHighlight", (ctx) => () => toggleMark(highlightSchema.type(ctx)));

export const highlightPlugins = [highlightRemark, highlightSchema, highlightInputRule, toggleHighlightCommand].flat();

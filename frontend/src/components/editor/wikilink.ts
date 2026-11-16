// [[Wikilinks]] in the rich editor (Obsidian syntax, also written by quick
// notes): "[[Title]]" or "[[Title|label]]" becomes an inline chip that opens
// the note. Without this the markdown serializer escapes the brackets
// ("\[\[Title]]") and the link breaks once the note is edited.

import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $inputRule, $node, $remark } from "@milkdown/kit/utils";

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

type MdNode = { type: string; value?: string; children?: MdNode[]; target?: string; label?: string };

// Splits "[[…]]" out of text nodes into wikiLink nodes, and teaches the
// serializer to write them back verbatim (no bracket escaping).
function remarkWikilink(this: { data: () => Record<string, unknown> }) {
  const data = this.data();
  const extensions = (data.toMarkdownExtensions as unknown[] | undefined) ?? [];
  extensions.push({
    handlers: {
      wikiLink: (node: MdNode) => `[[${node.target ?? ""}${node.label ? `|${node.label}` : ""}]]`,
    },
  });
  data.toMarkdownExtensions = extensions;

  const skip: Record<string, true> = { code: true, inlineCode: true, link: true, linkReference: true, html: true };
  const walk = (node: MdNode) => {
    if (!node.children || skip[node.type]) return;
    const next: MdNode[] = [];
    for (const child of node.children) {
      if (child.type !== "text" || !child.value?.includes("[[")) {
        walk(child);
        next.push(child);
        continue;
      }
      let last = 0;
      for (const m of child.value.matchAll(WIKILINK_RE)) {
        const at = m.index ?? 0;
        if (at > last) next.push({ type: "text", value: child.value.slice(last, at) });
        next.push({ type: "wikiLink", target: m[1].trim(), label: m[2]?.trim() || undefined });
        last = at + m[0].length;
      }
      if (last < child.value.length) next.push({ type: "text", value: child.value.slice(last) });
    }
    node.children = next;
  };
  return (tree: MdNode) => walk(tree);
}

export const wikilinkRemark = $remark("nexote-wikilink", () => remarkWikilink as never);

export const wikilinkNode = $node("wikilink", () => ({
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: { target: { default: "" }, label: { default: "" } },
  parseDOM: [
    {
      tag: "span[data-wikilink]",
      getAttrs: (dom: HTMLElement) => ({
        target: dom.getAttribute("data-wikilink") ?? "",
        label: dom.getAttribute("data-label") ?? "",
      }),
    },
  ],
  toDOM: (node: ProseNode) => [
    "span",
    {
      class: "nexote-wikilink",
      "data-wikilink": node.attrs.target,
      "data-label": node.attrs.label || null,
      title: node.attrs.target,
    },
    node.attrs.label || node.attrs.target,
  ],
  // Plain text (clipboard, textContent) keeps the link syntax.
  leafText: (node: ProseNode) =>
    `[[${node.attrs.target}${node.attrs.label ? `|${node.attrs.label}` : ""}]]`,
  parseMarkdown: {
    match: (node) => node.type === "wikiLink",
    runner: (state, node, type) => {
      state.addNode(type, { target: String(node.target ?? ""), label: String(node.label ?? "") });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "wikilink",
    runner: (state, node) => {
      state.addNode("wikiLink", undefined, undefined, {
        target: node.attrs.target,
        label: node.attrs.label || undefined,
      });
    },
  },
}));

// Typing the closing "]]" of "[[Title]]" turns it into a link right away.
export const wikilinkInputRule = $inputRule((ctx) =>
  new InputRule(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]$/, (state, match, start, end) => {
    const type = wikilinkNode.type(ctx);
    return state.tr.replaceWith(start, end, type.create({ target: match[1].trim(), label: match[2]?.trim() ?? "" }));
  }),
);

export const wikilinkPlugins = [wikilinkRemark, wikilinkNode, wikilinkInputRule].flat();

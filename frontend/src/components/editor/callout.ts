// Callouts (Obsidian syntax, a superset of GitHub alerts) in the rich editor:
//
//   > [!info] Optional title
//   > Body text, any blocks.
//
// The callout is a block node with a title line (inline content) followed by
// blocks, written back exactly in this form: the type as written (case kept),
// the fold marker ("+"/"-") and the title. Tools without callouts show an
// ordinary quote, still readable. Without this the serializer would escape
// the marker ("\[!info]") and break the callout in other tools.

import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { blockquoteSchema } from "@milkdown/kit/preset/commonmark";
import { $command, $inputRule, $nodeSchema, $prose, $remark, $view } from "@milkdown/kit/utils";

// ---------------------------------------------------------------- kinds

type Kind = { label: string; color: string; icon: string };

// fill:none inline: Crepe's menus set `fill` on icons (theirs are filled).
const svg = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="fill:none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS: Record<string, string> = {
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  todo: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
};

// Obsidian's built-in callout types (GitHub's five alerts map onto them).
const KINDS: Record<string, Kind> = {
  note: { label: "Note", color: "#448aff", icon: "pencil" },
  abstract: { label: "Abstract", color: "#00b0ff", icon: "clipboard" },
  info: { label: "Info", color: "#448aff", icon: "info" },
  todo: { label: "Todo", color: "#448aff", icon: "todo" },
  tip: { label: "Tip", color: "#00bfa5", icon: "flame" },
  success: { label: "Success", color: "#00c853", icon: "check" },
  question: { label: "Question", color: "#ffab00", icon: "help" },
  warning: { label: "Warning", color: "#ff9100", icon: "warning" },
  failure: { label: "Failure", color: "#ff5252", icon: "x" },
  danger: { label: "Danger", color: "#ff1744", icon: "zap" },
  bug: { label: "Bug", color: "#f50057", icon: "bug" },
  example: { label: "Example", color: "#7c4dff", icon: "list" },
  quote: { label: "Quote", color: "#9e9e9e", icon: "quote" },
};

const ALIASES: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

/** Style of a callout type; unknown types look like notes, labelled with their name. */
export function calloutKind(type: string): Kind & { key: string } {
  const lower = type.toLowerCase();
  const key = KINDS[lower] ? lower : ALIASES[lower];
  if (key) return { key, ...KINDS[key], label: KINDS[lower]?.label ?? lower.charAt(0).toUpperCase() + lower.slice(1) };
  return { key: "note", ...KINDS.note, label: type ? type.charAt(0).toUpperCase() + type.slice(1) : "Note" };
}

/** Types offered when inserting a callout (toolbar, "/" menu). */
export const CALLOUT_INSERT_TYPES = ["info", "tip", "warning", "danger", "note"] as const;

/** Display name of a callout type ("Info"). */
export const calloutLabel = (type: string) => calloutKind(type).label;

/** The type's icon as an SVG string (Crepe menus take HTML strings). */
export const calloutIconSvg = (type: string) => svg(ICONS[calloutKind(type).icon]);

// ---------------------------------------------------------------- markdown

const MARKER_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)(?:[ \t]+|(?=\n)|$)/;

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  calloutType?: string;
  fold?: string;
};
type Info = { before: string; after: string };
type MdState = {
  enter: (name: string) => () => void;
  containerPhrasing: (node: MdNode, info: Info) => string;
  containerFlow: (node: MdNode, info: unknown) => string;
  indentLines: (value: string, map: (line: string, index: number, blank: boolean) => string) => string;
};

// A blockquote whose first line starts with "[!type]" becomes a callout:
// the rest of that line is the title, everything after it the body.
function toCallout(quote: MdNode): MdNode | null {
  const [first, ...rest] = quote.children ?? [];
  if (first?.type !== "paragraph" || !first.children?.length) return null;
  const lead = first.children[0];
  if (lead.type !== "text" || !lead.value) return null;
  const m = MARKER_RE.exec(lead.value);
  if (!m) return null;

  const inline = [{ ...lead, value: lead.value.slice(m[0].length) }, ...first.children.slice(1)];
  const title: MdNode[] = [];
  let body: MdNode[] = [];
  for (let i = 0; i < inline.length; i++) {
    const node = inline[i];
    if (node.type === "break") {
      body = inline.slice(i + 1);
      break;
    }
    const nl = node.type === "text" ? (node.value ?? "").indexOf("\n") : -1;
    if (nl >= 0) {
      const before = (node.value ?? "").slice(0, nl);
      const after = (node.value ?? "").slice(nl + 1);
      if (before) title.push({ type: "text", value: before });
      body = [...(after ? [{ type: "text", value: after }] : []), ...inline.slice(i + 1)];
      break;
    }
    if (node.type !== "text" || node.value) title.push(node);
  }
  // Trailing spaces of the title line aren't part of the title.
  const tail = title[title.length - 1];
  if (tail?.type === "text") {
    tail.value = (tail.value ?? "").replace(/[ \t]+$/, "");
    if (!tail.value) title.pop();
  }

  return {
    type: "callout",
    calloutType: m[1],
    fold: m[2],
    children: [
      { type: "calloutTitle", children: title },
      ...(body.length ? [{ type: "paragraph", children: body }] : []),
      ...rest,
    ],
  };
}

function remarkCallout(this: { data: () => Record<string, unknown> }) {
  const data = this.data();
  const extensions = (data.toMarkdownExtensions as unknown[] | undefined) ?? [];
  extensions.push({
    handlers: {
      callout: (node: MdNode, _parent: unknown, state: MdState, info: unknown) => {
        const exit = state.enter("blockquote");
        const [first, ...others] = node.children ?? [];
        const hasTitle = first?.type === "calloutTitle";
        const title = hasTitle ? state.containerPhrasing(first, { before: " ", after: "\n" }) : "";
        const body = hasTitle ? others : (node.children ?? []);
        const flow = body.length ? state.containerFlow({ type: "callout", children: body }, info) : "";
        exit();
        const head = `[!${node.calloutType || "note"}]${node.fold ?? ""}${title ? ` ${title}` : ""}`;
        // A body that can't interrupt a paragraph (table, indented code, HTML)
        // needs an empty "> " line after the title, or other tools read it
        // as part of the title line. Text and lists follow directly
        // (Obsidian style).
        const gap = body[0] && ["table", "code", "html"].includes(body[0].type) ? "\n" : "";
        return state.indentLines(flow ? `${head}\n${gap}${flow}` : head, (line, _i, blank) => `>${blank ? "" : " "}${line}`);
      },
      calloutTitle: (node: MdNode, _parent: unknown, state: MdState) =>
        state.containerPhrasing(node, { before: " ", after: "\n" }),
    },
  });
  data.toMarkdownExtensions = extensions;

  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.map((child) => (child.type === "blockquote" ? (toCallout(child) ?? child) : child));
    node.children.forEach(walk);
  };
  return (tree: MdNode) => walk(tree);
}

export const calloutRemark = $remark("nexote-callout", () => remarkCallout as never);

// ---------------------------------------------------------------- schema

export const calloutTitleSchema = $nodeSchema("callout_title", () => ({
  content: "inline*",
  defining: true,
  parseDOM: [{ tag: "div.nexote-callout-title" }],
  toDOM: () => ["div", { class: "nexote-callout-title" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "calloutTitle",
    runner: (state, node, type) => {
      state.openNode(type);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "callout_title",
    runner: (state, node) => {
      state.openNode("calloutTitle");
      state.next(node.content);
      state.closeNode();
    },
  },
}));

export const calloutSchema = $nodeSchema("callout", () => ({
  group: "block",
  content: "callout_title block*",
  defining: true,
  attrs: { type: { default: "note" }, fold: { default: "" } },
  parseDOM: [
    {
      tag: "div.nexote-callout",
      getAttrs: (dom) =>
        dom instanceof HTMLElement
          ? { type: dom.dataset.calloutType || "note", fold: dom.dataset.fold || "" }
          : false,
    },
  ],
  toDOM: (node) => [
    "div",
    { class: "nexote-callout", "data-callout-type": node.attrs.type, "data-fold": node.attrs.fold },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "callout",
    runner: (state, node, type) => {
      state.openNode(type, { type: node.calloutType || "note", fold: node.fold || "" });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "callout",
    runner: (state, node) => {
      state.openNode("callout", undefined, { calloutType: node.attrs.type, fold: node.attrs.fold });
      state.next(node.content);
      state.closeNode();
    },
  },
}));

// ---------------------------------------------------------------- editing

/** Wraps the selected blocks (or the current one) in a callout of `type`,
 *  caret in its title. An empty paragraph becomes an empty callout. */
export const insertCalloutCommand = $command("InsertCallout", (ctx) => (type: string = "info") => (state, dispatch) => {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  if (!range) return false;
  const blocks: ProseNode[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) blocks.push(range.parent.child(i));
  if (blocks.some((b) => b.type.name === "callout_title")) return false;
  const body = blocks.length === 1 && blocks[0].type.name === "paragraph" && blocks[0].content.size === 0 ? [] : blocks;
  const node = calloutSchema.type(ctx).createChecked({ type, fold: "" }, [calloutTitleSchema.type(ctx).create(), ...body]);
  if (dispatch) {
    const tr = state.tr.replaceWith(range.start, range.end, node);
    tr.setSelection(TextSelection.create(tr.doc, range.start + 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
});

// Typing "[!type] " at the start of a quote's first line turns the quote into
// a callout (like Obsidian's live preview).
export const calloutInputRule = $inputRule(
  (ctx) =>
    new InputRule(/^\[!([A-Za-z][\w-]*)\]([+-]?)\s$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      if ($start.depth < 2 || $start.parentOffset !== 0) return null;
      const quote = $start.node(-1);
      if (quote.type !== blockquoteSchema.type(ctx) || $start.index(-1) !== 0) return null;
      const quotePos = $start.before(-1);
      const titleContent = $start.parent.content.cut(end - $start.start());
      const rest: ProseNode[] = [];
      quote.forEach((child, _offset, index) => {
        if (index > 0) rest.push(child);
      });
      const callout = calloutSchema.type(ctx).createChecked({ type: match[1], fold: match[2] }, [
        calloutTitleSchema.type(ctx).create(null, titleContent),
        ...rest,
      ]);
      const tr = state.tr.replaceWith(quotePos, quotePos + quote.nodeSize, callout);
      return tr.setSelection(TextSelection.create(tr.doc, quotePos + 2));
    }),
);

// The type label stands in for an empty title (Obsidian shows "Info").
const placeholderKey = new PluginKey<DecorationSet>("nexote-callout-placeholder");
export const calloutPlaceholder = $prose(
  () =>
    new Plugin({
      key: placeholderKey,
      props: {
        decorations: (state) => {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === "callout_title" && node.content.size === 0) {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "is-empty" }));
            }
            return node.isBlock;
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
    }),
);

// The box: icon (a type picker on click) + the editable title and body.
const PICKER_TYPES = Object.keys(KINDS);

export const calloutView = $view(calloutSchema.node, () => (initial, view, getPos) => {
  const dom = document.createElement("div");
  dom.className = "nexote-callout";
  const icon = document.createElement("span");
  icon.className = "nexote-callout-icon";
  icon.contentEditable = "false";
  const glyph = document.createElement("span");
  glyph.className = "nexote-callout-glyph";
  const picker = document.createElement("select");
  picker.className = "nexote-callout-picker";
  picker.setAttribute("aria-label", "Callout type");
  picker.title = "Change the callout type";
  for (const type of PICKER_TYPES) picker.add(new Option(KINDS[type].label, type));
  icon.append(glyph, picker);
  const content = document.createElement("div");
  content.className = "nexote-callout-content";
  dom.append(icon, content);

  let node = initial;
  const apply = (n: ProseNode) => {
    const type = String(n.attrs.type);
    const fold = String(n.attrs.fold);
    const kind = calloutKind(type);
    dom.dataset.callout = kind.key;
    dom.dataset.fold = fold;
    dom.style.setProperty("--callout-color", kind.color);
    dom.style.setProperty("--callout-label", JSON.stringify(kind.label));
    dom.style.setProperty("--callout-raw", JSON.stringify(`[!${type}]${fold} `));
    glyph.innerHTML = svg(ICONS[kind.icon]);
    // A custom type (e.g. "[!recipe]") stays selectable as itself.
    if (![...picker.options].some((o) => o.value === type)) picker.add(new Option(kind.label, type));
    picker.value = type;
    picker.disabled = !view.editable;
  };
  apply(node);

  picker.addEventListener("change", () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos === undefined) return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, type: picker.value }));
    view.focus();
  });

  return {
    dom,
    contentDOM: content,
    update: (next: ProseNode) => {
      if (next.type !== node.type) return false;
      node = next;
      apply(next);
      return true;
    },
    stopEvent: (event: Event) => event.target instanceof Node && icon.contains(event.target),
    ignoreMutation: (mutation) =>
      icon.contains(mutation.target) || (mutation.type === "attributes" && mutation.target === dom),
  };
});

export const calloutPlugins = [
  calloutRemark,
  calloutTitleSchema,
  calloutSchema,
  calloutView,
  calloutInputRule,
  insertCalloutCommand,
  calloutPlaceholder,
].flat();

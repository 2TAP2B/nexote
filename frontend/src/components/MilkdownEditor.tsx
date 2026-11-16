"use client";

import { Crepe, CrepeFeature } from "@milkdown/crepe";
import type { CrepeConfig } from "@milkdown/crepe";
import type { AIPromptContext } from "@milkdown/crepe/feature/ai";
import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, editorViewCtx, parserCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import {
  blockquoteSchema,
  bulletListSchema,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
  headingSchema,
  listItemSchema,
  orderedListSchema,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import { insertTableCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { DOMParser, DOMSerializer, type NodeType, type Slice } from "@milkdown/kit/prose/model";
import { streamingPluginKey } from "@milkdown/kit/plugin/streaming";
import { $prose, replaceAll } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import { EditorState, NodeSelection, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  Table,
  TextQuote,
} from "lucide-react";

import { api } from "@/lib/api";
import { cacheImage } from "@/lib/image-cache";
import { useVisualViewport } from "./mobile/useVirtualKeyboardInset";

import {
  bulletListIcon,
  codeBlockIcon,
  h1Icon,
  h2Icon,
  h3Icon,
  orderedListIcon,
  quoteIcon,
} from "./toolbar-icons";

// Crepe theme CSS is imported in src/app/globals.css so the cascade order
// relative to our .milkdown overrides is deterministic (keeps the editor in
// sync with the app theme, including dark mode).

// ProseMirror plugin that decorates #hashtags in text nodes with a CSS class
// so they appear highlighted in the editor. Matches #tagword where the tag
// starts with a lowercase letter or digit (same rule as the backend extraction).
const tagPluginKey = new PluginKey<DecorationSet>("nexote-tag-highlight");
const tagRegex = /(?:^|\s)\\?#(\s*)([a-z0-9][\w-]*)/g;

function findTagDecorations(doc: ReturnType<typeof Object>): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants(
    (
      node: { textContent: string; isText: boolean },
      pos: number,
      parent: { type: { name: string } },
    ) => {
      if (!node.isText) return;
      if (parent.type.name === "code_block") return;
      const text = node.textContent;
      let match;
      tagRegex.lastIndex = 0;
      while ((match = tagRegex.exec(text)) !== null) {
        const prefixLen = match[0].length - match[1].length - match[2].length - 1; // everything before #
        const hashStart = pos + match.index + prefixLen;
        const tagEnd = hashStart + 1 + match[1].length + match[2].length; // # + optional space + tagname
        decos.push(Decoration.inline(hashStart, tagEnd, { class: "nexote-tag" }));
      }
    },
  );
  return DecorationSet.create(doc, decos);
}

const tagHighlightPlugin = new Plugin<DecorationSet>({
  key: tagPluginKey,
  state: {
    init(_, { doc }) {
      return findTagDecorations(doc);
    },
    apply(tr, old) {
      if (tr.docChanged) {
        return findTagDecorations(tr.doc);
      }
      return old;
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

// Watches the streaming plugin's active state to detect when an AI session
// starts and ends. Serializes the doc at each transition (using the incoming
// state, so the value is correct even before the view has updated) and
// dispatches a window event with the markdown. The editor component uses
// these to show the plain-text Accept/Reject review overlay instead of the
// per-word diff review.
const aiStreamingWatchKey = new PluginKey("nexote-ai-streaming-watch");
const aiStreamingWatchPlugin = $prose((ctx) =>
  new Plugin<null>({
    key: aiStreamingWatchKey,
    state: {
      init: () => null,
      apply(_tr, _old, oldState, newState) {
        const prevActive = streamingPluginKey.getState(oldState)?.active ?? false;
        const nextActive = streamingPluginKey.getState(newState)?.active ?? false;
        if (prevActive !== nextActive) {
          const markdown = ctx.get(serializerCtx)(newState.doc);
          window.dispatchEvent(
            new CustomEvent(
              nextActive ? "nexote:ai-start" : "nexote:ai-end",
              { detail: markdown },
            ),
          );
        }
        return null;
      },
    },
  }),
);

// True when the editor has a non-empty text selection (mirrors the Crepe
// toolbar's shouldShow so the pinned mobile bar can reappear on select).
function hasTextSelection(state: EditorState): boolean {
  const { doc, selection } = state;
  if (selection.empty) return false;
  if (!doc.textBetween(selection.from, selection.to).length) return false;
  return true;
}

// Watches the selection and dispatches a window event when it transitions
// between empty and non-empty. The mobile note view uses this to keep the
// pinned format bar visible while the user has text selected, even when the
// scroll-chrome logic would have hidden it.
const selectionWatchKey = new PluginKey("nexote-selection-watch");
const selectionWatchPlugin = $prose((ctx) =>
  new Plugin<boolean>({
    key: selectionWatchKey,
    state: {
      init: (_c, state) => hasTextSelection(state),
      apply(_tr, prev, _old, newState) {
        const next = hasTextSelection(newState);
        if (next !== prev) {
          window.dispatchEvent(
            new CustomEvent("nexote:selection-change", { detail: next }),
          );
        }
        return next;
      },
    },
  }),
);

// Table of contents: a watch plugin that mirrors the document's top-level
// headings (title, sections, subsections) to the TOC pane. Nested headings
// inside lists, quotes or other containers are skipped — only the document
// outline (direct doc children) is listed. The list is broadcast via
// nexote:headings only when it actually changes, so typing never causes churn.
// nexote:toc-request asks the (possibly just-mounted) editor to re-broadcast
// its current list, and nexote:toc-jump scrolls the chosen heading into view.
export type TocHeading = { level: number; text: string; pos: number };

function collectHeadings(doc: {
  descendants: (
    fn: (
      node: { type: { name: string }; attrs: { level?: number }; textContent: string },
      pos: number,
      parent: { type: { name: string } } | null,
    ) => void,
  ) => unknown;
}): TocHeading[] {
  const out: TocHeading[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.name === "heading" && parent?.type.name === "doc") {
      out.push({ level: node.attrs.level ?? 1, text: node.textContent, pos });
    }
  });
  return out;
}

function headingsEqual(a: TocHeading[], b: TocHeading[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.level !== y.level || x.text !== y.text || x.pos !== y.pos) return false;
  }
  return true;
}

function publishHeadings(noteId: string, list: TocHeading[]): void {
  window.dispatchEvent(
    new CustomEvent("nexote:headings", { detail: { noteId, headings: list } }),
  );
}

const tocWatchKey = new PluginKey<TocHeading[]>("nexote-toc-headings");
// Created per editor instance so it can close over the note id: consumers
// (mobile TOC pane / desktop TOC panel) use it to ignore heading broadcasts
// from a note they're not showing.
function makeTocWatchPlugin(noteId: string) {
  return $prose(
    () =>
      new Plugin<TocHeading[]>({
        key: tocWatchKey,
        state: {
          init: (_c, state) => collectHeadings(state.doc),
          apply(tr, _old, _oldState, newState) {
            return tr.docChanged ? collectHeadings(newState.doc) : _old;
          },
        },
        view: (view) => {
          // Broadcast the current list on mount (or when a TOC pane asks —
          // the pane may mount before this editor, or re-mount when switching
          // notes/panes). Fresh editors already have the right doc, so the
          // mount broadcast alone covers late-mounting panes.
          const emit = () => {
            publishHeadings(noteId, tocWatchKey.getState(view.state) ?? []);
          };
          const onRequest = emit;
          // Jump the requested heading into view. Smooth-scrolls its DOM node
          // so the scroll happens in whatever container actually scrolls
          // (mobile editor pane vs desktop editor area); focus is left to the
          // caller.
          const onJump = (event: Event) => {
            const index = (event as CustomEvent<{ index?: number }>).detail?.index;
            if (typeof index !== "number") return;
            const list = tocWatchKey.getState(view.state) ?? [];
            const item = list[index];
            if (!item) return;
            const dom = view.nodeDOM(item.pos);
            if (dom instanceof HTMLElement) {
              dom.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          };
          window.addEventListener("nexote:toc-request", onRequest);
          window.addEventListener("nexote:toc-jump", onJump);
          emit();
          return {
            update: (view, prevState) => {
              const next = tocWatchKey.getState(view.state) ?? [];
              const prev = tocWatchKey.getState(prevState) ?? [];
              if (!headingsEqual(prev, next)) publishHeadings(noteId, next);
            },
            destroy: () => {
              window.removeEventListener("nexote:toc-request", onRequest);
              window.removeEventListener("nexote:toc-jump", onJump);
            },
          };
        },
      }),
  );
}

// Structural tags that carry no formatting of their own. Mobile browsers wrap
// copied plain text in a payload made up of these (plus <meta>), e.g. iOS
// emits <meta charset='utf-8'><pre>text</pre> and Android wraps lines in
// <div>s. Genuinely formatted clipboard content (bold, links, lists, images,
// code blocks, …) contains other elements, so it is left to the normal
// clipboard handling.
const plainTextWrapperTags = new Set(["meta", "style", "head", "body", "pre", "div", "p", "span", "br"]);

// True when the clipboard's HTML payload carries no formatting and just
// wraps the same plain text. In that case the text/plain content should win
// so the markdown parser can render it instead of inserting the source literally.
function isPlainTextWrapper(html: string, text: string): boolean {
  if (!html) return true;
  const el = document.createElement("div");
  el.innerHTML = html;
  const stripped = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (stripped.length === 0 || stripped !== text.replace(/\s+/g, " ").trim()) return false;
  for (const n of Array.from(el.querySelectorAll("*"))) {
    if (!plainTextWrapperTags.has(n.tagName.toLowerCase())) return false;
  }
  return true;
}

// The plain-text clipboard (what mail and chat apps paste) is the selection
// as markdown, minus how the editor stores line breaks: "<br />" lines (empty
// paragraphs) become empty lines, hard breaks ("\" at a line end, inline
// <br>) plain line breaks. Code blocks stay verbatim.
function clipboardPlainText(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      out.push(line);
      continue;
    }
    if (/^\s*<br\s*\/?>\s*$/i.test(line)) {
      // One empty line per empty paragraph: drop the separator after it.
      out.push("");
      if (lines[i + 1] === "") i++;
      continue;
    }
    const trailing = /\\+$/.exec(line)?.[0].length ?? 0;
    out.push((trailing % 2 === 1 ? line.slice(0, -1) : line).replace(/<br\s*\/?>/gi, "\n"));
  }
  return out.join("\n").trimEnd();
}

export type MilkdownEditorHandle = {
  focus: () => void;
  selectHeading: () => void;
  focusEnd: () => void;
  format: (action: FormatAction) => void;
  insertImageFile: (file: File) => void;
  askAI: () => void;
  runAI: (instruction: string, label?: string) => void;
};

export type FormatAction =
  | "bold"
  | "italic"
  | "strike"
  | "h1"
  | "h2"
  | "h3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "quote"
  | "code-block"
  | "table";

export type AIConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

// A live "/command" being typed at the caret. from/to bound the "/query" text
// in the document so selecting an item can strip it before applying the format.
type SlashState = {
  query: string;
  from: number;
  to: number;
};

// True when the caret sits in a plain paragraph whose text currently ends with
// "/query" (query being letters/digits/hyphens). The trigger must be at the
// start of the paragraph or right after whitespace so mid-phrase "/" (paths,
// fractions, code) doesn't pop the menu.
function computeSlashState(view: EditorView): SlashState | null {
  const { state } = view;
  const { empty, $from } = state.selection;
  if (!empty || !view.hasFocus() || !view.editable) return null;
  if ($from.depth === 0) return null;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph") return null;
  const prefix = parent.textContent.slice(0, $from.parentOffset);
  const m = /(^|\s)\/([a-zA-Z0-9-]*)$/.exec(prefix);
  if (!m) return null;
  const slashStart = prefix.lastIndexOf("/");
  return {
    query: m[2],
    from: $from.start() + slashStart,
    to: $from.pos,
  };
}

type SlashItem = {
  id: FormatAction | "image";
  label: string;
  hint: string;
  icon: ComponentType<{ size?: number }>;
  keywords: string;
};

const SLASH_ITEMS: SlashItem[] = [
  { id: "h1", label: "Heading 1", hint: "## ", icon: Heading1, keywords: "heading h1 title" },
  { id: "h2", label: "Heading 2", hint: "### ", icon: Heading2, keywords: "heading h2" },
  { id: "h3", label: "Heading 3", hint: "#### ", icon: Heading3, keywords: "heading h3" },
  { id: "bullet-list", label: "Bullet list", hint: "- item", icon: List, keywords: "list bullet ul unordered" },
  { id: "ordered-list", label: "Ordered list", hint: "1. item", icon: ListOrdered, keywords: "list ordered ol numbered" },
  { id: "task-list", label: "Task list", hint: "- [ ] item", icon: ListTodo, keywords: "task todo checkbox checklist" },
  { id: "quote", label: "Quote", hint: "> ", icon: TextQuote, keywords: "quote blockquote" },
  { id: "code-block", label: "Code block", hint: "```", icon: Code2, keywords: "code block" },
  { id: "table", label: "Table", hint: "| a | b |", icon: Table, keywords: "table grid" },
  { id: "image", label: "Image", hint: "![alt](url)", icon: ImageIcon, keywords: "image img picture" },
];

// Shared command dispatch for the mobile "format" handle and the slash menu so
// both expose the exact same formatting set.
function runFormatAction(ctx: Ctx, action: Exclude<FormatAction, "image">) {
  const commands = ctx.get(commandsCtx);
  switch (action) {
    case "bold":
      commands.call(toggleStrongCommand.key);
      break;
    case "italic":
      commands.call(toggleEmphasisCommand.key);
      break;
    case "strike":
      commands.call(toggleStrikethroughCommand.key);
      break;
    case "h1":
    case "h2":
    case "h3":
      commands.call(setBlockTypeCommand.key, {
        nodeType: headingSchema.type(ctx),
        attrs: { level: Number(action[1]) },
      });
      break;
    case "bullet-list":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: bulletListSchema.type(ctx),
      });
      break;
    case "ordered-list":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: orderedListSchema.type(ctx),
      });
      break;
    case "task-list":
      // Mirrors Crepe's block-edit "Task List" menu item: wrap the current
      // paragraph in a list item with the checkbox attribute set (checked:false
      // → unchecked box), so the must-be-checked list_item schema accepts it.
      commands.call(clearTextInCurrentBlockCommand.key);
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: listItemSchema.type(ctx),
        attrs: { checked: false },
      });
      break;
    case "quote":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: blockquoteSchema.type(ctx),
      });
      break;
    case "code-block":
      commands.call(setBlockTypeCommand.key, {
        nodeType: codeBlockSchema.type(ctx),
      });
      break;
    case "table":
      commands.call(insertTableCommand.key, { row: 3, col: 2 });
      break;
  }
}

type MilkdownEditorProps = {
  defaultValue: string;
  onChange: (markdown: string) => void;
  aiConfig: AIConfig;
  vaultId: string;
  noteId: string;
  mobile?: boolean;
  onAskAI?: () => void;
  // Viewers of a shared space: the note renders but can't be edited.
  readOnly?: boolean;
};

const AI_SYSTEM_PROMPT = `You are a writing assistant embedded in a markdown editor.

Rules:
- Output markdown only. Never wrap your output in code fences (e.g. \`\`\`markdown ... \`\`\`).
- Never include preambles, explanations, or sign-offs — output only the edited or generated content itself.
- Preserve the original markdown structure (headings, lists, links, code blocks) unless the instruction explicitly asks to change it.
- If a <selection> is provided, return only the replacement for that selection — do not repeat surrounding document context.
- If no <selection> is provided, return content to insert at the cursor that flows with the surrounding document.`;

function buildAIUserMessage(context: AIPromptContext): string {
  const parts: string[] = [`<document>\n${context.document}\n</document>`];
  if (context.selection) {
    parts.push(`<selection>\n${context.selection}\n</selection>`);
  }
  parts.push(`<instruction>\n${context.instruction}\n</instruction>`);
  return parts.join("\n\n");
}

// Streams an OpenAI-compatible chat completion through the local backend
// (/api/ai/chat → Go proxy). The browser never talks to the upstream API
// directly, which avoids CORS failures and keeps the API key server-side.
async function* nexoteAIProvider(
  aiConfig: AIConfig,
  context: AIPromptContext,
  signal: AbortSignal,
): AsyncIterable<string> {
  const baseUrl = aiConfig.baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "");

  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      baseUrl,
      apiKey: aiConfig.apiKey.trim() || undefined,
      model: aiConfig.model.trim(),
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: buildAIUserMessage(context) },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    let message = `AI request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to the status-based message
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    if (signal.aborted) return;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const event = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore non-JSON keep-alive lines
      }
    }
  }
}

// True when the current block node is of the given schema type.
function isBlockOfType(ctx: Ctx, schema: { type: (ctx: Ctx) => NodeType }): boolean {
  const view = ctx.get(editorViewCtx);
  return view.state.selection.$from.parent.type === schema.type(ctx);
}

// Pins the actual scroll container of the editor (the first ancestor whose
// overflow-y is auto/scroll) to its current scrollTop, rejecting any scroll
// for a short window. ProseMirror v1.42 has no working manual scroll
// preservation, so setting a DOM selection to an off-screen range (select-all,
// or the block handle's NodeSelection) makes the browser scroll it into view
// — the page "jumps". Listening to the `scroll` event and snapping back
// catches the jump whether it fires synchronously or in a later animation
// frame, regardless of which ProseMirror/Crepe code path triggered it.
function findScrollContainer(from: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = from;
  while (el && el !== document.documentElement) {
    const oy = el.style.overflowY || getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  // Window-scroll layout: no inner overflow-y ancestor, so the document
  // scrolling element (the <html>) is the scroller.
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function pinContainer(
  container: HTMLElement,
  top: number,
  opts?: { noTimeout?: boolean },
): () => void {
  let stopped = false;
  // When pinning the window scroller, scroll events fire on `window` and
  // scrollTop is read/written via the documentElement.
  const isRoot =
    container === document.scrollingElement || container === document.documentElement;
  const scrollTarget = isRoot ? window : container;
  const getTop = () => (isRoot ? window.scrollY : (container as HTMLElement).scrollTop);
  const setTop = (v: number) => {
    if (isRoot) window.scrollTo(0, v);
    else (container as HTMLElement).scrollTop = v;
  };
  const onScroll = () => {
    if (getTop() !== top) setTop(top);
  };
  scrollTarget.addEventListener("scroll", onScroll, { passive: true });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    window.cancelAnimationFrame(raf);
    scrollTarget.removeEventListener("scroll", onScroll);
  };
  // noTimeout: outlives the gesture. Only used for pins with explicit
  // release paths (mouseup settle pin until the selection settles; the
  // whole-drag pin until an edge is reached) — an uncapped rAF pin that no
  // one releases would freeze scrolling forever.
  let timer: number | undefined = opts?.noTimeout ? undefined : window.setTimeout(stop, 200);
  const tick = () => {
    if (stopped) return;
    if (getTop() !== top) setTop(top);
    raf = window.requestAnimationFrame(tick);
  };
  let raf = window.requestAnimationFrame(tick);
  return stop;
}

function pinScroll(view: EditorView): () => void {
  const container = findScrollContainer(view.dom as HTMLElement);
  if (!container) return () => {};
  return pinContainer(container, container.scrollTop);
}

// Inner editor lives inside MilkdownProvider so it can use the editor hooks.
const MilkdownEditor = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownEditor({ defaultValue, onChange, aiConfig, vaultId, noteId, mobile, onAskAI, readOnly = false }, ref) {
    const crepeRef = useRef<Crepe | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onAskAIRef = useRef(onAskAI);
    onAskAIRef.current = onAskAI;
    // Read at build time so a role change toggles the view instead of
    // rebuilding the editor (the effect below applies later changes).
    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;
    useEffect(() => {
      crepeRef.current?.setReadonly(readOnly);
    }, [readOnly]);

    const aiBeforeRef = useRef("");
    const [aiReview, setAiReview] = useState<{
      before: string;
      after: string;
    } | null>(null);

    // Listens for the streaming-watch plugin's start/end events and shows the
    // plain-text review overlay when the AI run actually changed the content.
    useEffect(() => {
      const handleStart = (event: Event) => {
        aiBeforeRef.current = (event as CustomEvent<string>).detail ?? "";
      };
      const handleEnd = (event: Event) => {
        const after = (event as CustomEvent<string>).detail ?? "";
        const before = aiBeforeRef.current;
        if (after.trim() !== before.trim()) {
          setAiReview({ before, after });
        }
      };
      window.addEventListener("nexote:ai-start", handleStart);
      window.addEventListener("nexote:ai-end", handleEnd);
      return () => {
        window.removeEventListener("nexote:ai-start", handleStart);
        window.removeEventListener("nexote:ai-end", handleEnd);
      };
    }, []);

    // Gallery insert: the Images view dispatches nexote:insert-image with an
    // image URL; insert it at the current cursor as an inline image node.
    useEffect(() => {
      const onInsertImage = (event: Event) => {
        const url = (event as CustomEvent<{ url?: string }>).detail?.url;
        if (!url) return;
        const editor = crepeRef.current?.editor;
        if (!editor) return;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const type = view.state.schema.nodes.image;
          if (!type) return;
          const node = type.create({ src: url, alt: "" });
          view.dispatch(view.state.tr.replaceSelectionWith(node));
          view.focus();
        });
      };
      window.addEventListener("nexote:insert-image", onInsertImage);
      return () => window.removeEventListener("nexote:insert-image", onInsertImage);
    }, [noteId]);

    // Toolbar "+" button: drops a "/" in the document at the caret and
    // focuses, which surfaces the slash command sheet via the watcher below.
    // If the caret is wedged in a block that can't trigger the menu (e.g. the
    // title heading), insert a fresh body paragraph after it first.
    useEffect(() => {
      if (!mobile) return;
      const onSlashOpen = () => {
        const editor = crepeRef.current?.editor;
        if (!editor) return;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          let tr = state.tr;
          if (!state.selection.empty) tr = tr.deleteSelection();
          const $pos = tr.selection.$from;
          if ($pos.parent.type.name !== "paragraph") {
            const after = $pos.after($pos.depth);
            tr = tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
            tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
          }
          const slashFrom = tr.selection.from;
          tr = tr.insertText("/", slashFrom).scrollIntoView();
          view.dispatch(tr);
          view.focus();
          // If the editor was blurred when "+" was tapped, the watcher's
          // update already ran with hasFocus() === false and returned null; the
          // focus call doesn't dispatch a transaction, so open the sheet from
          // the position we just wrote to make the menu appear regardless.
          applySlash({ query: "", from: slashFrom, to: slashFrom + 1 });
        });
      };
      window.addEventListener("nexote:slash-open", onSlashOpen);
      return () => window.removeEventListener("nexote:slash-open", onSlashOpen);
    }, [mobile]);

    // Slash command menu (mobile). A ProseMirror watcher plumbs the live
    // "/query" state up to React whenever the caret moves or the doc changes;
    // the sheet itself is a fixed panel pinned just above the format bar so it
    // can never sit under the on-screen keyboard. See computeSlashState.
    const [slash, setSlash] = useState<SlashState | null>(null);
    const slashRef = useRef<SlashState | null>(null);
    const slashImageRef = useRef<HTMLInputElement | null>(null);
    const vv = useVisualViewport();

    const applySlash = (s: SlashState | null) => {
      slashRef.current = s;
      setSlash(s);
    };

    // The format bar dismisses itself when the on-screen keyboard closes;
    // drop the slash panel too so it doesn't linger floating above content.
    const prevKeyboardOpen = useRef(vv.isKeyboardOpen);
    useEffect(() => {
      if (prevKeyboardOpen.current && !vv.isKeyboardOpen) {
        applySlash(null);
      }
      prevKeyboardOpen.current = vv.isKeyboardOpen;
    }, [vv.isKeyboardOpen]);

    const slashItems = slash
      ? SLASH_ITEMS.filter((item) => {
          const q = slash.query.trim().toLowerCase();
          return (
            !q ||
            item.label.toLowerCase().includes(q) ||
            item.keywords.toLowerCase().includes(q)
          );
        })
      : [];

    const gap = vv.isKeyboardOpen ? 12 : 80;
    // Anchored to the VISUAL viewport's bottom edge, measured from the screen
    // bottom. Fixed panels are pinned to the layout viewport, which does not
    // shrink when the touch keyboard opens, so vv.inset (the keyboard height in
    // layout px) is used to lift the sheet above the keyboard + format bar
    // (gap + 52 bar + 12 sheet gap); without this it would render behind the
    // keyboard on iOS/Chrome.
    // The sheet grows upward from that edge. Its max height is clamped to both
    // the visual viewport's remaining space and the layout viewport's remaining
    // space, so it always fits on screen and scrolls when it doesn't. Clamping
    // against the live layout height (window.innerHeight, not the hook state)
    // covers the frame where Android has already resized the layout viewport
    // but the visualViewport state hasn't caught up yet.
    const slashBottom = `calc(${vv.inset}px + env(safe-area-inset-bottom, 0px) + ${gap + 52 + 12}px)`;
    const availVisual = Math.max(0, vv.height - (gap + 52 + 12) - 16);
    const availLayout = Math.max(0, window.innerHeight - (vv.inset + gap + 52 + 12));
    const slashMaxHeight = Math.min(availVisual, availLayout);

    const uploadImageFile = (file: File) => {
      if (!file) return;
      void api.uploadImage(vaultId, noteId, file).then((meta) => {
        void cacheImage(meta.url, file);
        window.dispatchEvent(
          new CustomEvent("nexote:image-uploaded", { detail: meta.url }),
        );
        if (meta.url) {
          window.dispatchEvent(
            new CustomEvent("nexote:insert-image", { detail: { url: meta.url } }),
          );
        }
      }).catch((err) => {
        console.error("[nexote-image]", err);
      });
    };

    const selectSlashItem = (item: SlashItem) => {
      const editor = crepeRef.current?.editor;
      if (!editor) return;
      const action = item.id;
      if (action === "image") {
        applySlash(null);
        slashImageRef.current?.click();
        return;
      }
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        // Recompute the "/query" range from the live state instead of trusting
        // the last snapshot: if the caret moved or the sheet was opened from
        // the "+" button the stored range can be stale, and deleting it would
        // abort the whole command. A missing range just skips the deletion.
        const range = computeSlashState(view);
        if (range) view.dispatch(view.state.tr.delete(range.from, range.to));
        runFormatAction(ctx, action);
        view.focus();
      });
      applySlash(null);
    };

    // Some mobile browsers swallow the click that follows a preventDefault'd
    // pointerdown (and a blur can tear the sheet down between the two), so the
    // sheet items act on pointerdown. The guard stops a late/inherited click
    // from running the same item twice.
    const slashActingRef = useRef(false);
    const runSlashItem = (item: SlashItem) => {
      if (slashActingRef.current) return;
      slashActingRef.current = true;
      window.setTimeout(() => {
        slashActingRef.current = false;
      }, 250);
      selectSlashItem(item);
    };

    useEditor((root) => {
      const baseUrl = aiConfig.baseUrl
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/v1$/i, "");

      // Uploads an image into the current note's folder and broadcasts the
      // new URL so the Images gallery can refresh itself.
      const uploadImageFile = async (file: File): Promise<string> => {
        try {
          const meta = await api.uploadImage(vaultId, noteId, file);
          // Persist the bytes locally so the image survives a reload even
          // before the body is saved or if the backend is unreachable.
          void cacheImage(meta.url, file);
          window.dispatchEvent(
            new CustomEvent("nexote:image-uploaded", { detail: meta.url }),
          );
          return meta.url;
        } catch (err) {
          console.error("[nexote-image]", err);
          return "";
        }
      };

      const featureConfigs: NonNullable<CrepeConfig["featureConfigs"]> = {
        [Crepe.Feature.Cursor]: {
          // Configuration: never use the "virtual cursor" widget. It mounts
          // a plain <div> widget at doc position 0 — as .ProseMirror's FIRST
          // child until the first focus/selection-change gives it the
          // positioning class, which makes the H1 margin + font styles flip
          // (0px→8px margin, fsc) and the document visibly "jumps a line"
          // on the first text selection. With virtual:false the plugin is
          // not mounted at all and the native caret renders everywhere.
          virtual: false,
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: (file: File) => uploadImageFile(file),
        },
        [Crepe.Feature.LinkTooltip]: {
          inputPlaceholder: "Paste a link…",
        },
        [Crepe.Feature.Placeholder]: {
          text: "Start writing, or type / for commands…",
          mode: "block",
        },
        [Crepe.Feature.Toolbar]: {
          buildToolbar(builder) {
            // Headings follow the default formatting buttons.
            const addHeading = (level: number, icon: string) => ({
              icon,
              active: (ctx: Ctx) => {
                const view = ctx.get(editorViewCtx);
                const node = view.state.selection.$from.parent;
                return (
                  node.type === headingSchema.type(ctx) &&
                  node.attrs.level === level
                );
              },
              onRun: (ctx: Ctx) => {
                const commands = ctx.get(commandsCtx);
                commands.call(setBlockTypeCommand.key, {
                  nodeType: headingSchema.type(ctx),
                  attrs: { level },
                });
              },
            });
            builder
              .getGroup("formatting")
              .addItem("h1", addHeading(1, h1Icon))
              .addItem("h2", addHeading(2, h2Icon))
              .addItem("h3", addHeading(3, h3Icon));

            // Lists, quote and code block join the default function group.
            const functionGroup = builder.getGroup("function");
            functionGroup
              .addItem("bullet-list", {
                icon: bulletListIcon,
                active: (ctx: Ctx) => isBlockOfType(ctx, bulletListSchema),
                onRun: (ctx: Ctx) => {
                  const commands = ctx.get(commandsCtx);
                  commands.call(wrapInBlockTypeCommand.key, {
                    nodeType: bulletListSchema.type(ctx),
                  });
                },
              })
              .addItem("ordered-list", {
                icon: orderedListIcon,
                active: (ctx: Ctx) => isBlockOfType(ctx, orderedListSchema),
                onRun: (ctx: Ctx) => {
                  const commands = ctx.get(commandsCtx);
                  commands.call(wrapInBlockTypeCommand.key, {
                    nodeType: orderedListSchema.type(ctx),
                  });
                },
              })
              .addItem("quote", {
                icon: quoteIcon,
                active: (ctx: Ctx) => isBlockOfType(ctx, blockquoteSchema),
                onRun: (ctx: Ctx) => {
                  const commands = ctx.get(commandsCtx);
                  commands.call(wrapInBlockTypeCommand.key, {
                    nodeType: blockquoteSchema.type(ctx),
                  });
                },
              })
              .addItem("code-block", {
                icon: codeBlockIcon,
                active: (ctx: Ctx) => isBlockOfType(ctx, codeBlockSchema),
                onRun: (ctx: Ctx) => {
                  const commands = ctx.get(commandsCtx);
                  commands.call(setBlockTypeCommand.key, {
                    nodeType: codeBlockSchema.type(ctx),
                  });
                },
              });
          },
        },
      };

      // Enable the AI feature only when an OpenAI-compatible endpoint is
      // configured. The AI button appears in the toolbar only when a
      // provider is present, so it stays hidden until configured.
      const features: NonNullable<CrepeConfig["features"]> = {
        [Crepe.Feature.ImageBlock]: true,
        // On mobile the floating selection toolbar is disabled; a pinned
        // bottom bar (MobileFormatBar) drives the same commands instead.
        [Crepe.Feature.Toolbar]: !mobile,
        // The block handle (+ button and drag grip) needs a mouse hover to
        // appear; there is no room for it on a touch-only layout, so leave
        // it off on mobile.
        [Crepe.Feature.BlockEdit]: !mobile,
      };
      if (baseUrl) {
        features[Crepe.Feature.AI] = true;
        featureConfigs[Crepe.Feature.AI] = {
          provider: (context: AIPromptContext, signal: AbortSignal) =>
            nexoteAIProvider(aiConfig, context, signal),
          diffReviewOnEnd: false,
          onError: (error) => {
            console.error("[nexote-ai]", error.message);
          },
        };
      }

      const crepe = new Crepe({
        root,
        defaultValue,
        featureConfigs,
        features,
      });
      if (readOnlyRef.current) crepe.setReadonly(true);

      // Block-to-block arrow navigation: when ArrowUp is pressed at the
      // start of a block, jump to the start of the previous block. When
      // ArrowDown is pressed at the end of a block, jump to the start of
      // the next block.
      crepe.editor.config((ctx) => {
        const opts = ctx.get("editorViewOptions" as never) as Record<string, unknown>;
        ctx.set("editorViewOptions" as never, {
          ...opts,
          // Copy: plain text without the editor's line-break markup (see
          // clipboardPlainText). A selection inside one paragraph copies as
          // its text, like milkdown's own serializer does.
          clipboardTextSerializer: (slice: Slice) => {
            const content = slice.content;
            const only = content.childCount === 1 ? content.firstChild : null;
            if (only?.type.name === "paragraph" && slice.openStart > 0) {
              return content.textBetween(0, content.size, "\n\n", (leaf) =>
                leaf.type.name === "hardbreak" ? "\n" : "",
              );
            }
            const doc = ctx.get(schemaCtx).topNodeType.createAndFill(undefined, content);
            if (!doc) return content.textBetween(0, content.size, "\n\n");
            return clipboardPlainText(ctx.get(serializerCtx)(doc));
          },
          handlePaste: (view: EditorView, event: ClipboardEvent) => {
            // OS-clipboard image paste: the clipboard plugin only handles
            // text, so intercept image files, upload them into the note's
            // folder and insert the resulting URL as an inline image.
            const items = event.clipboardData?.items;
            if (items) {
              for (const item of items) {
                if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
                const file = item.getAsFile();
                if (!file) continue;
                event.preventDefault();
                void uploadImageFile(file).then((url) => {
                  if (!url) return;
                  const type = view.state.schema.nodes.image;
                  if (!type) return;
                  const node = type.create({ src: url, alt: "" });
                  view.dispatch(view.state.tr.replaceSelectionWith(node));
                  view.focus();
                });
                return true;
              }
            }

            // Markdown pastes: milkdown's clipboard plugin parses plain text
            // as markdown only when the clipboard carries no HTML. Mobile
            // browsers wrap copied plain text in an HTML payload that is just
            // the same text with no formatting; in that case parse text/plain
            // with the markdown parser so headings, lists, tasks and code
            // blocks render instead of appearing as literal source.
            if (view.state.selection.$from.node().type.spec.code) return false;
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const html = event.clipboardData?.getData("text/html") ?? "";
            if (html && text.trim() && isPlainTextWrapper(html, text)) {
              try {
                const doc = ctx.get(parserCtx)(text.replace(/\r\n?/g, "\n"));
                if (doc && typeof doc !== "string") {
                  const domParser = DOMParser.fromSchema(ctx.get(schemaCtx));
                  const dom = DOMSerializer.fromSchema(ctx.get(schemaCtx)).serializeFragment(doc.content);
                  const slice = domParser.parseSlice(dom);
                  view.dispatch(
                    view.state.tr
                      .replaceSelection(slice)
                      .scrollIntoView()
                      .setMeta("paste", true)
                      .setMeta("uiEvent", "paste"),
                  );
                  return true;
                }
              } catch {
                // Fall through to the default clipboard handling.
              }
            }
            return false;
          },
          handleKeyDown: (_view: EditorView, event: KeyboardEvent) => {
            // Legacy: when the note title was an H1, Ctrl/Cmd+A here selected
            // everything except that title. The title is now an H2, so this
            // branch no longer matches new notes — native Ctrl+A runs (which
            // doesn't scroll-jump). Kept for older notes still carrying an H1
            // title until they're saved (which migrates them to H2); pinScroll
            // suppresses the jump for that transition case.
            if (event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey)) {
              const view = ctx.get("editorView" as never) as EditorView;
              const doc = view.state.doc;
              const first = doc.firstChild;
              if (first && first.type.name === "heading" && (first.attrs.level as number) === 1) {
                const from = first.nodeSize;
                const to = doc.content.size;
                if (from < to) {
                  pinScroll(view);
                  view.dispatch(
                    view.state.tr.setSelection(TextSelection.create(doc, from, to)),
                  );
                }
                return true;
              }
              return false;
            }
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
            const view = ctx.get("editorView" as never) as EditorView;
            const { state, dispatch } = view;
            const { selection } = state;
            if (event.key === "ArrowUp") {
              if (!selection.empty) return false;
              const $head = selection.$head;
              if ($head.parentOffset === 0) {
                const doc = state.doc;
                const pos = $head.before($head.depth);
                if (pos <= 0) return false;
                const prevNode = doc.resolve(pos - 1).nodeBefore;
                if (!prevNode) return false;
                const targetPos = pos - prevNode.nodeSize;
                dispatch(
                  state.tr.setSelection(
                    TextSelection.create(doc, targetPos + 1),
                  ),
                );
                view.focus();
                return true;
              }
            } else {
              if (!selection.empty) return false;
              const $head = selection.$head;
              if ($head.parentOffset === $head.parent.content.size) {
                const doc = state.doc;
                if ($head.depth === 0) return false;
                const pos = $head.after($head.depth);
                // Ensure there IS a next block to jump to.
                if (pos + 1 >= doc.content.size) return false;
                dispatch(
                  state.tr.setSelection(
                    TextSelection.create(doc, pos + 1),
                  ),
                );
                view.focus();
                return true;
              }
            }
            return false;
          },
          // Mobile bottom toolbar: announce when the caret enters or leaves
          // the editor so the bar knows whether to show. Return false so the
          // default focus/blur handling is untouched.
          handleDOMEvents: {
            focus: () => {
              if (mobile) window.dispatchEvent(new CustomEvent("nexote:editor-focus"));
              return false;
            },
            blur: () => {
              if (mobile) window.dispatchEvent(new CustomEvent("nexote:editor-blur"));
              return false;
            },
          },
          // Mobile: keep some room around the caret when ProseMirror scrolls
          // it into view — the top bar overlays the editor's top edge, and a
          // line or two above the format bar keeps the next line visible.
          ...(mobile
            ? {
                scrollMargin: { top: 72, bottom: 48, left: 0, right: 0 },
                scrollThreshold: { top: 72, bottom: 48, left: 0, right: 0 },
              }
            : {}),
        } as never);
      });

      crepe.on((listener) => {
        listener.markdownUpdated((_, markdown) => {
          onChangeRef.current(markdown);
        });
      });

      // Highlight #hashtags inline via a ProseMirror decoration plugin.
      crepe.editor.use($prose(() => tagHighlightPlugin));

      // Emit AI session start/end events for the review overlay.
      crepe.editor.use(aiStreamingWatchPlugin);

      // Emit selection empty/non-empty transitions for the mobile format bar.
      crepe.editor.use(selectionWatchPlugin);

      // Mirror the document's top-level headings to the TOC pane.
      crepe.editor.use(makeTocWatchPlugin(noteId));

      // Mobile slash commands: track when the caret types "/query" and surface
      // it to React (falling back to null when the trigger is gone), so the
      // sheet can be rendered and dismissed from the same source of truth.
      // Escape, scrolling, or leaving the editor closes it. Return values are
      // always false so none of ProseMirror's default handling is bypassed.
      if (mobile) {
        const slashWatchPlugin = new Plugin<unknown>({
          key: new PluginKey("nexote-slash-watch"),
          view: (_view) => {
            // Scroll doesn't bubble, but capture-phase on window sees every
            // container's scroll, which reads/taps a floating sheet should
            // dismiss. Close only if actually open to avoid re-render churn.
            const onScroll = () => {
              if (slashRef.current) applySlash(null);
            };
            window.addEventListener("scroll", onScroll, true);
            return {
              update: (view) => {
                applySlash(computeSlashState(view));
              },
              destroy: () => {
                window.removeEventListener("scroll", onScroll, true);
              },
            };
          },
          props: {
            handleKeyDown: (_view, e) => {
              if (e.key === "Escape") {
                applySlash(null);
                return true;
              }
              return false;
            },
            handleDOMEvents: {
              blur: () => {
                applySlash(null);
                return false;
              },
            },
          },
        });
        crepe.editor.use($prose(() => slashWatchPlugin));
      }

      // Clicking a highlighted tag pill opens the Tags view with that tag
      // selected (the sidebar listens for this event and switches views).
      const onRootClick = (e: MouseEvent) => {
        const t = e.target as Node | null;
        const el = t instanceof Element ? t : t?.parentElement ?? null;
        const pill = el?.closest?.(".nexote-tag");
        if (!pill) return;
        const raw = pill.textContent ?? "";
        const tag = raw.replace(/^#\s*/, "").trim();
        if (tag) {
          window.dispatchEvent(new CustomEvent("nexote:select-tag", { detail: tag }));
        }
      };
      root.addEventListener("click", onRootClick);

      // Clicking the block handle (the "six dots") selects the whole block as
      // a NodeSelection, which the formatting toolbar refuses to show for
      // (it only renders for text selections). Convert the selection to a
      // TextSelection over the block's text so the bold/italic menu opens.
      // Handled on mousedown (not click): the handle is draggable, so even a
      // slight move suppresses click, and mousedown fires before the native
      // drag begins. Dragging still moves the block because the block service
      // captures its drag slice before this conversion runs. The "+" button
      // suppresses mousedown via pointerdown/preventDefault and is also
      // excluded explicitly by checking the first handle item.
      //
      // Crepe's block service calls view.focus() on mousedown (and again in a
      // rAF on mouseup), setting the DOM selection to the NodeSelection,
      // which Chrome scrolls into view — so the page jumps. pinScroll() locks
      // the scroll container for ~120ms, rejecting that jump whether it fires
      // synchronously or in a later frame (ProseMirror v1.42 has no working
      // manual scroll preservation of its own).
      const isBlockHandle = (e: MouseEvent): HTMLElement | null => {
        const target = e.target as Node | null;
        const el = target instanceof Element ? target : target?.parentElement ?? null;
        const handle = el?.closest?.(".milkdown-block-handle") as HTMLElement | null;
        if (!handle) return null;
        const addButton = handle.firstElementChild;
        if (addButton && addButton.contains(el)) return null;
        return handle;
      };
      // Capture phase: record the scroll container + scrollTop before Crepe's
      // own mousedown handler runs and scrolls. Pure DOM — no editor ctx.
      let pinned: { container: HTMLElement; top: number } | null = null;
      root.addEventListener(
        "mousedown",
        (e: MouseEvent) => {
          if (e.button !== 0 || !isBlockHandle(e)) return;
          const container = findScrollContainer(root);
          if (container) pinned = { container, top: container.scrollTop };
        },
        true,
      );
      // Bubble phase: Crepe has now created the NodeSelection (and already
      // scrolled). Pin the container back to the captured scrollTop (undoing
      // Crepe's scroll) and hold it ~200ms to also catch Crepe's mouseup rAF
      // re-focus. Then convert the NodeSelection to a TextSelection so the
      // formatting toolbar shows.
      const onBlockHandleMouseDown = (e: MouseEvent) => {
        if (e.button !== 0 || !isBlockHandle(e)) return;
        if (pinned) {
          pinContainer(pinned.container, pinned.top);
          pinned = null;
        }
        crepe.editor.action((ctx) => {
          const editorView = ctx.get(editorViewCtx);
          const { selection } = editorView.state;
          if (!(selection instanceof NodeSelection)) return;
          const node = selection.node;
          if (node.isAtom) return;
          const from = selection.from + 1;
          const to = selection.from + node.nodeSize - 1;
          editorView.dispatch(
            editorView.state.tr.setSelection(
              TextSelection.create(editorView.state.doc, from, to),
            ),
          );
        });
      };
      root.addEventListener("mousedown", onBlockHandleMouseDown);

      // Pin the scroll container on any mouse press inside the editor so that
      // click/double-click/triple-click selections — and the click that
      // collapses a previous (off-screen-head) selection like Ctrl+A — don't
      // trigger Chrome's native scroll-selection-into-view nudge. The pin is
      // released early if the press turns into a drag (mouse moves beyond a
      // small threshold) so drag-selecting to the viewport edge can still
      // auto-scroll to extend the selection.
      const onEditorMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        // Ignore presses on the block handle (already handled above).
        const target = e.target as Node | null;
        const el = target instanceof Element ? target : target?.parentElement ?? null;
        if (el?.closest?.(".milkdown-block-handle")) return;
        const container = findScrollContainer(root);
        if (!container) return;
        // Pin for the WHOLE drag: Chrome re-scrolls the DOM selection on
        // every pointer move, and when a block overlapping the top edge is
        // partially clipped (tall first headline under the 64px padding)
        // that scroll lands ~150px away — the editor visibly jumped on
        // every text selection. The pin is released early only when the
        // drag approaches the container's top/bottom edge, so Chrome's own
        // edge auto-scroll can still extend the selection there. On mouseup
        // the pin returns until the selection settles (selectionchange,
        // wheel or the next mousedown release it), and user scrolling is
        // always honored afterwards.
        const top = container.scrollTop;
        let pinned = true;
        let stop = pinContainer(container, top, { noTimeout: true });
        const onMove = (ev: MouseEvent) => {
          if (!pinned) return;
          const r = container.getBoundingClientRect();
          const margin = 48;
          if (ev.clientY - r.top < margin || r.bottom - ev.clientY < margin) {
            // Edge drag: hand scrolling back to Chrome so the selection can
            // auto-extend beyond the visible area.
            stop();
            pinned = false;
            window.removeEventListener("mousemove", onMove);
          }
        };
        window.addEventListener("mousemove", onMove);
        const onUp = () => {
          // The whole-drag pin ends here. Give the final selection scroll
          // (Chrome fires one more selectionchange pass after mouseup) a
          // bounded 600ms settle pin; after that scrolling is fully free.
          stop();
          const settle = pinContainer(container, top);
          window.removeEventListener("mousemove", onMove);
        };
        window.addEventListener("mouseup", onUp, { once: true });
      };
      root.addEventListener("mousedown", onEditorMouseDown, true);

      crepeRef.current = crepe;
      return crepe;
    }, [aiConfig, vaultId, noteId, mobile]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const editor = crepeRef.current?.editor;
          if (!editor) return;
          editor.action((ctx) => {
            const editorView = ctx.get("editorView") as EditorView;
            editorView.focus();
          });
        },
        selectHeading: () => {
          const editor = crepeRef.current?.editor;
          if (!editor) return;
          editor.action((ctx) => {
            const editorView = ctx.get("editorView") as EditorView;
            const { state, dispatch } = editorView;
            const firstNode = state.doc.firstChild;
            if (firstNode && firstNode.type.name === "heading") {
              // Positions: 0 = before the heading, 1 = inside the heading
              // text, nodeSize-1 = after the last text char.
              const textStart = 1;
              const textEnd = firstNode.nodeSize - 1;
              dispatch(
                state.tr.setSelection(
                  new TextSelection(
                    state.doc.resolve(textStart),
                    state.doc.resolve(textEnd),
                  ),
                ),
              );
              editorView.focus();
            } else {
              editorView.focus();
            }
          });
        },
        focusEnd: () => {
          const editor = crepeRef.current?.editor;
          if (!editor) return;
          editor.action((ctx) => {
            const editorView = ctx.get("editorView") as EditorView;
            const { state, dispatch } = editorView;
            const doc = state.doc;
            // Walk to the last block-level node and place cursor at its end.
            if (doc.childCount === 0) {
              editorView.focus();
              return;
            }
            let pos = 0;
            doc.forEach((child) => {
              pos += child.nodeSize;
            });
            // pos is now at the end of the last child (before the closing
            // of the doc). Place the cursor one position before that
            // (inside the last block's closing boundary).
            const target = Math.max(0, pos - 1);
            dispatch(
              state.tr.setSelection(
                TextSelection.create(doc, target),
              ),
            );
            editorView.focus();
          });
        },
        format: (action: FormatAction) => {
          const editor = crepeRef.current?.editor;
          if (!editor) return;
          editor.action((ctx) => {
            runFormatAction(ctx, action);
          });
        },
        insertImageFile: (file: File) => {
          uploadImageFile(file);
        },
        askAI: () => {
          // Open our custom AI command panel (preset actions + custom prompt)
          // instead of Crepe's floating instruction tooltip, which positions
          // unreliably (clipped by the scroll container, or hidden when the
          // selection moves on click). The panel is rendered by the parent
          // (EditorPane / MobileNoteView) and calls runAI() with the chosen
          // instruction.
          onAskAIRef.current?.();
        },
        runAI: (instruction: string, label?: string) => {
          const editor = crepeRef.current?.editor;
          if (!editor) return;
          editor.action((ctx) => {
            const commands = ctx.get(commandsCtx);
            // Call the AI command by its registered NAME rather than the
            // runAICmd key: our imported copy of runAICmd can be a separate
            // bundle instance from the one Crepe registered internally, so its
            // `.key` (a Symbol) wouldn't match the editor's command registry.
            // Resolving by name ("RunAI") works regardless of module identity.
            commands.call("RunAI", { instruction, label });
          });
        },
      }),
      [],
    );

      const acceptReview = () => {
        setAiReview(null);
      };

      const rejectReview = () => {
        const editor = crepeRef.current?.editor;
        if (editor && aiReview) {
          editor.action(replaceAll(aiReview.before));
        }
        setAiReview(null);
      };

      return (
        <>
          <Milkdown />
          {mobile &&
            slash &&
            // Portaled to document.body: same reason as the AI command panel —
            // the editor mounts inside the pager's transformed track, where a
            // position:fixed sheet anchors to the track instead of the visual
            // viewport and can end up outside the visible area entirely.
            createPortal(
              <div
                className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3 mob-shell-root"
                style={{
                  bottom: slashBottom,
                  opacity: 1,
                  transition: "opacity 0.15s ease",
                }}
              >
              <div
                onPointerDown={(e) => e.preventDefault()}
                className="pointer-events-auto no-scrollbar w-full max-w-2xl overflow-y-auto rounded-2xl border px-1 py-1"
                style={{
                  maxHeight: slashMaxHeight,
                  background: "var(--mob-surface)",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
                  borderColor: "color-mix(in srgb, var(--mob-text) 14%, transparent)",
                }}
              >
                <div
                  className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--mob-muted)" }}
                >
                  Commands
                </div>
                {slashItems.length === 0 && (
                  <div
                    className="px-3 py-3 text-[13px]"
                    style={{ color: "var(--mob-muted)" }}
                  >
                    No matching commands
                  </div>
                )}
                {slashItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      runSlashItem(item);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      runSlashItem(item);
                    }}
                    className="flex w-full shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-left transition-opacity active:opacity-70"
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: "color-mix(in srgb, var(--mob-text) 10%, transparent)",
                        color: "var(--mob-accent)",
                      }}
                    >
                      <item.icon size={18} />
                    </span>
                    <span
                      className="flex-1 text-[13px] font-medium"
                      style={{ color: "var(--mob-text)" }}
                    >
                      {item.label}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--mob-muted)" }}
                    >
                      {item.hint}
                    </span>
                  </button>
                ))}
                <input
                  ref={slashImageRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadImageFile(file);
                    e.target.value = "";
                  }}
                />
              </div>
              </div>,
              document.body,
            )}
          {aiReview &&
            createPortal(
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-start sm:p-4 sm:pt-[10vh] backdrop-blur-sm">
                <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl sm:max-h-[70vh]">
                  <div className="shrink-0 border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold text-foreground">
                      AI suggestion
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Review the edited text below and accept or reject it.
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                      {aiReview.after}
                    </pre>
                  </div>
                  <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
                    <button
                      type="button"
                      onClick={rejectReview}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={acceptReview}
                      className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Accept
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )}
        </>
      );
    },
);

// Public wrapper. Kept separate so the provider boundary is explicit and so
// the dynamic import in the parent can target this component.
const MilkdownEditorWrapper = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownEditorWrapper(props, ref) {
    return (
      <MilkdownProvider>
        <MilkdownEditor {...props} ref={ref} />
      </MilkdownProvider>
    );
  },
);

export default MilkdownEditorWrapper;
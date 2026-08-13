"use client";

import { Crepe, CrepeFeature } from "@milkdown/crepe";
import type { CrepeConfig } from "@milkdown/crepe";
import type { AIPromptContext } from "@milkdown/crepe/feature/ai";
import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, editorViewCtx, parserCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import {
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  headingSchema,
  orderedListSchema,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import { DOMParser, DOMSerializer, type NodeType } from "@milkdown/kit/prose/model";
import { streamingPluginKey } from "@milkdown/kit/plugin/streaming";
import { $prose, replaceAll } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import { EditorState, NodeSelection, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { api } from "@/lib/api";

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

export type MilkdownEditorHandle = {
  focus: () => void;
  selectHeading: () => void;
  focusEnd: () => void;
  format: (action: FormatAction) => void;
  insertImageFile: (file: File) => void;
  askAI: () => void;
};

export type FormatAction =
  | "bold"
  | "italic"
  | "h1"
  | "h2"
  | "h3"
  | "bullet-list"
  | "ordered-list"
  | "quote"
  | "code-block"
  | "table";

export type AIConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type MilkdownEditorProps = {
  defaultValue: string;
  onChange: (markdown: string) => void;
  aiConfig: AIConfig;
  vaultId: string;
  noteId: string;
  mobile?: boolean;
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

function pinContainer(container: HTMLElement, top: number): () => void {
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
  let timer = window.setTimeout(stop, 200);
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
  function MilkdownEditor({ defaultValue, onChange, aiConfig, vaultId, noteId, mobile }, ref) {
    const crepeRef = useRef<Crepe | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

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
        [Crepe.Feature.ImageBlock]: {
          onUpload: (file: File) => uploadImageFile(file),
        },
        [Crepe.Feature.LinkTooltip]: {
          inputPlaceholder: "Paste a link…",
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

      // Block-to-block arrow navigation: when ArrowUp is pressed at the
      // start of a block, jump to the start of the previous block. When
      // ArrowDown is pressed at the end of a block, jump to the start of
      // the next block.
      crepe.editor.config((ctx) => {
        const opts = ctx.get("editorViewOptions" as never) as Record<string, unknown>;
        ctx.set("editorViewOptions" as never, {
          ...opts,
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
        // Pin through the whole click/drag so the selection that finalizes on
        // mouseup doesn't nudge. Released automatically after 200ms; for long
        // drags the pin expires mid-drag so edge auto-scroll can still extend
        // the selection. Re-pin to the original scrollTop on mouseup so the
        // drag's final selection doesn't nudge the page.
        const top = container.scrollTop;
        const stop = pinContainer(container, top);
        const onUp = () => {
          stop();
          pinContainer(container, top);
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
            const commands = ctx.get(commandsCtx);
            switch (action) {
              case "bold":
                commands.call(toggleStrongCommand.key);
                break;
              case "italic":
                commands.call(toggleEmphasisCommand.key);
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
          });
        },
        insertImageFile: (file: File) => {
          if (!file) return;
          void api.uploadImage(vaultId, noteId, file).then((meta) => {
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
        },
        askAI: () => {
          const editor = crepeRef.current?.editor;
          if (!editor) return;
          editor.action((ctx) => {
            // Same call the Crepe toolbar's AI button makes: open the AI
            // instruction tooltip for the current selection. It's only
            // registered when the AI feature is enabled (baseUrl set).
            const api = ctx.get("aiInstructionTooltipAPI" as never) as {
              show: (from: number, to: number) => void;
            };
            if (!api?.show) return;
            const view = ctx.get(editorViewCtx);
            const { from, to } = view.state.selection;
            api.show(from, to);
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
          {aiReview && (
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh] backdrop-blur-sm">
              <div className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
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
            </div>
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
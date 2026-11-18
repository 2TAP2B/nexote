// Embedded PDFs. In the file a PDF is an image link on its own line, the
// form Obsidian embeds as a PDF viewer:
//
//   ![Contract 2026.pdf](/api/vaults/<v>/images/Work/Contract-2026-x7Kq2b.pdf)
//
// Other tools show the name. In the editor it is a block with the file
// name, an "Open" link and (on desktop) the browser's inline viewer. Phone
// browsers can't show PDFs in a frame, so there the block is a card that
// opens the system viewer, with the first page drawn by pdf.js below it.

import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type * as PdfJs from "pdfjs-dist/legacy/build/pdf.mjs";
import { TextSelection } from "@milkdown/kit/prose/state";
import { $command, $nodeSchema, $remark, $view } from "@milkdown/kit/utils";

/** True for a URL whose path ends in .pdf (query and fragment ignored). */
export function isPdfUrl(url: string): boolean {
  return /\.pdf$/i.test(url.split(/[?#]/)[0] ?? "");
}

type MdNode = { type: string; url?: string; alt?: string | null; children?: MdNode[] };

// A paragraph holding only a PDF image (or Crepe's image-block made from
// one) becomes a pdfEmbed block; it is written back as the same image line.
function remarkPdf(this: { data: () => Record<string, unknown> }) {
  const data = this.data();
  const extensions = (data.toMarkdownExtensions as unknown[] | undefined) ?? [];
  extensions.push({
    handlers: {
      pdfEmbed: (node: MdNode) => {
        const alt = (node.alt ?? "").replace(/[[\]\\]/g, "\\$&");
        const url = node.url ?? "";
        return `![${alt}](${/[\s()<>]/.test(url) ? `<${url}>` : url})`;
      },
    },
  });
  data.toMarkdownExtensions = extensions;

  const toPdf = (node: MdNode): MdNode | null => {
    if (node.type === "image-block" && node.url && isPdfUrl(node.url)) {
      return { type: "pdfEmbed", url: node.url, alt: node.alt ?? "" };
    }
    const only = node.type === "paragraph" && node.children?.length === 1 ? node.children[0] : null;
    if (only?.type === "image" && only.url && isPdfUrl(only.url)) {
      return { type: "pdfEmbed", url: only.url, alt: only.alt ?? "" };
    }
    return null;
  };
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.map((child) => toPdf(child) ?? child);
    node.children.forEach(walk);
  };
  return (tree: MdNode) => walk(tree);
}

export const pdfRemark = $remark("nexote-pdf", () => remarkPdf as never);

/** File name shown for a PDF: its alt text, else the file part of the URL. */
function pdfName(src: string, title: string): string {
  return title || decodeURIComponent(src.split(/[?#]/)[0].split("/").pop() ?? "PDF");
}

export const pdfSchema = $nodeSchema("pdf_embed", () => ({
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  attrs: { src: { default: "" }, title: { default: "" } },
  parseDOM: [
    {
      tag: "div.nexote-pdf",
      getAttrs: (dom) =>
        dom instanceof HTMLElement ? { src: dom.dataset.src ?? "", title: dom.dataset.title ?? "" } : false,
    },
  ],
  // With a link inside, so copied HTML stays useful elsewhere.
  toDOM: (node) => [
    "div",
    { class: "nexote-pdf", "data-src": node.attrs.src, "data-title": node.attrs.title },
    ["a", { href: node.attrs.src }, pdfName(node.attrs.src, node.attrs.title)],
  ],
  parseMarkdown: {
    match: (node) => node.type === "pdfEmbed",
    runner: (state, node, type) => {
      state.addNode(type, { src: node.url, title: node.alt ?? "" });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "pdf_embed",
    runner: (state, node) => {
      state.addNode("pdfEmbed", undefined, undefined, { url: node.attrs.src, alt: node.attrs.title });
    },
  },
}));

/** Inserts a PDF block at the selection (an empty paragraph is replaced). */
export const insertPdfCommand = $command(
  "InsertPdf",
  (ctx) =>
    (pdf?: { src: string; title: string }) =>
    (state, dispatch) => {
      if (!pdf?.src) return false;
      const node = pdfSchema.type(ctx).create({ src: pdf.src, title: pdf.title });
      if (dispatch) {
        let tr = state.tr.replaceSelectionWith(node);
        // Caret below the block, so typing goes on there instead of
        // replacing the selected PDF; at the end of the note that needs a
        // new empty paragraph.
        const end = tr.mapping.map(state.selection.to, 1);
        const $end = tr.doc.resolve(end);
        if (!$end.parent.isTextblock && !$end.nodeAfter?.isTextblock) {
          tr = tr.insert(end, state.schema.nodes.paragraph.create());
        }
        const caret = $end.parent.isTextblock ? end : end + 1;
        dispatch(tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView());
      }
      return true;
    },
);

const FILE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13H8"/><path d="M16 17H8"/><path d="M16 13h-2"/></svg>';

// pdf.js (≈2 MB with its worker) loads only once a phone shows a PDF block.
// The legacy build: the modern one calls brand-new APIs unpolyfilled (e.g.
// Map.prototype.getOrInsertComputed) that many phones' browsers lack.
let pdfjs: Promise<{ lib: typeof PdfJs; worker: PdfJs.PDFWorker }> | null = null;
function loadPdfJs() {
  pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs").then(
    (lib) => {
      // The bundler emits the worker as a file of the build (/_next/static),
      // which the service worker caches with the rest of the app for offline.
      lib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      // One worker for every preview instead of starting one per document.
      return { lib, worker: new lib.PDFWorker() };
    },
    (err: unknown) => {
      pdfjs = null; // a chunk that failed to load (offline) is tried again later
      throw err;
    },
  );
  return pdfjs;
}

type Preview = { image: HTMLCanvasElement; pages: number };

// Rendered first pages by src, so re-created node views (switching notes,
// undo) draw a copy instead of rendering again. Bounded: each holds a canvas.
const previews = new Map<string, Promise<Preview>>();
const MAX_PREVIEWS = 12;
// iOS refuses canvases above ~16.7M pixels; tall pages stay well below.
const MAX_PIXELS = 4_000_000;
// One render at a time, so a note full of PDFs doesn't crowd the main thread.
let renderQueue: Promise<unknown> = Promise.resolve();

async function renderFirstPage(src: string, width: number): Promise<Preview> {
  // The whole file, not pdf.js's range requests: the service worker answers
  // from its cache with the full file, which also makes it work offline.
  const [data, { lib, worker }] = await Promise.all([
    fetch(src).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    }),
    loadPdfJs(),
  ]);
  const task = lib.getDocument({ data: new Uint8Array(data), worker });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(
      (width * Math.min(window.devicePixelRatio || 1, 2)) / base.width,
      Math.sqrt(MAX_PIXELS / (base.width * base.height)),
    );
    const viewport = page.getViewport({ scale });
    const image = document.createElement("canvas");
    image.width = Math.ceil(viewport.width);
    image.height = Math.ceil(viewport.height);
    await page.render({ canvas: image, viewport, background: "#fff" }).promise;
    return { image, pages: doc.numPages };
  } finally {
    void task.destroy();
  }
}

function previewOf(src: string, width: number): Promise<Preview> {
  const cached = previews.get(src);
  if (cached) {
    previews.delete(src); // most recently used last
    previews.set(src, cached);
    return cached;
  }
  const job = renderQueue.then(() => renderFirstPage(src, width));
  renderQueue = job.catch(() => {});
  previews.set(src, job);
  // A failure (offline, broken file) is not remembered: the next view retries.
  job.catch(() => {
    if (previews.get(src) === job) previews.delete(src);
  });
  for (const key of previews.keys()) {
    if (previews.size <= MAX_PREVIEWS) break;
    previews.delete(key);
  }
  return job;
}

type TouchPreview = { setSrc: (src: string) => void; destroy: () => void };

/** The first page under the card, rendered once the block nears the screen.
 *  It sits below the card's "Open" overlay, so a tap on it opens the PDF; any
 *  failure quietly leaves the plain card. */
function touchPreview(dom: HTMLElement): TouchPreview {
  const box = document.createElement("div");
  box.className = "nexote-pdf-preview";
  box.hidden = true;
  const canvas = document.createElement("canvas");
  const pages = document.createElement("span");
  pages.className = "nexote-pdf-pages";
  box.append(canvas, pages);
  dom.append(box);

  let src = "";
  let requested = "";
  let visible = false;
  let alive = true;
  const load = () => {
    if (!visible || requested === src) return;
    const want = src;
    requested = want;
    previewOf(want, dom.clientWidth || 360).then(
      ({ image, pages: count }) => {
        const ctx = canvas.getContext("2d");
        if (!alive || src !== want || !ctx) return;
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);
        pages.textContent = count === 1 ? "1 page" : `${count} pages`;
        box.hidden = false;
      },
      (err: unknown) => console.warn("[nexote-pdf] no preview:", err),
    );
  };
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries.at(-1)?.isIntersecting ?? visible;
      load();
    },
    { rootMargin: "800px 0px" },
  );
  observer.observe(dom);

  return {
    setSrc(next: string) {
      if (next === src) return;
      src = next;
      box.hidden = true;
      load();
    },
    destroy() {
      alive = false;
      observer.disconnect();
    },
  };
}

export const pdfView = $view(pdfSchema.node, () => (initial) => {
  const dom = document.createElement("div");
  dom.className = "nexote-pdf";
  dom.contentEditable = "false";
  const head = document.createElement("div");
  head.className = "nexote-pdf-head";
  const icon = document.createElement("span");
  icon.className = "nexote-pdf-icon";
  icon.innerHTML = FILE_ICON;
  const name = document.createElement("span");
  name.className = "nexote-pdf-name";
  const open = document.createElement("a");
  open.className = "nexote-pdf-open";
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "Open";
  head.append(icon, name, open);
  dom.append(head);
  let frame: HTMLIFrameElement | null = null;
  let preview: TouchPreview | null = null;
  // Phones and tablets have no inline PDF viewer in the browser.
  if (!window.matchMedia("(pointer: coarse)").matches) {
    frame = document.createElement("iframe");
    frame.className = "nexote-pdf-frame";
    frame.loading = "lazy";
    dom.append(frame);
  } else {
    dom.classList.add("nexote-pdf-card");
    preview = touchPreview(dom);
  }

  let node = initial;
  const apply = (n: ProseNode) => {
    const src = String(n.attrs.src);
    const label = pdfName(src, String(n.attrs.title));
    dom.dataset.src = src;
    name.textContent = label;
    open.href = src;
    open.setAttribute("aria-label", `Open ${label}`);
    if (frame && frame.dataset.src !== src) {
      frame.dataset.src = src;
      frame.src = `${src}#view=FitH`;
      frame.title = label;
    }
    preview?.setSrc(src);
  };
  apply(node);

  return {
    dom,
    update: (next: ProseNode) => {
      if (next.type !== node.type) return false;
      node = next;
      apply(next);
      return true;
    },
    // The viewer and the link take their own clicks; the rest selects the block.
    stopEvent: (event: Event) =>
      event.target instanceof Node && (open.contains(event.target) || (frame?.contains(event.target) ?? false)),
    ignoreMutation: () => true,
    destroy: () => preview?.destroy(),
  };
});

/** The PDFs among pasted or dropped files. The editor's own paste/drop props
 * take them: Crepe's upload plugin would swallow every file otherwise. */
export function pdfFiles(files: FileList | undefined | null): File[] {
  return [...(files ?? [])].filter((f) => f.type === "application/pdf" || isPdfUrl(f.name));
}

export const pdfPlugins = [pdfRemark, pdfSchema, pdfView, insertPdfCommand].flat();

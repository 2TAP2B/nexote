// Embedded PDFs. In the file a PDF is an image link on its own line, the
// form Obsidian embeds as a PDF viewer:
//
//   ![Contract 2026.pdf](/api/vaults/<v>/images/Work/Contract-2026-x7Kq2b.pdf)
//
// Other tools show the name. In the editor it is a block with the file
// name, an "Open" link and (on desktop) an inline viewer; phones can't show
// PDFs inline, so there the block opens the system viewer.

import type { Node as ProseNode } from "@milkdown/kit/prose/model";
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

// Phones and tablets have no inline PDF viewer in the browser.
const canPreview = () =>
  typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches;

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
  if (canPreview()) {
    frame = document.createElement("iframe");
    frame.className = "nexote-pdf-frame";
    frame.loading = "lazy";
    dom.append(frame);
  } else {
    dom.classList.add("nexote-pdf-card");
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
  };
});

/** The PDFs among pasted or dropped files. The editor's own paste/drop props
 * take them: Crepe's upload plugin would swallow every file otherwise. */
export function pdfFiles(files: FileList | undefined | null): File[] {
  return [...(files ?? [])].filter((f) => f.type === "application/pdf" || isPdfUrl(f.name));
}

export const pdfPlugins = [pdfRemark, pdfSchema, pdfView, insertPdfCommand].flat();

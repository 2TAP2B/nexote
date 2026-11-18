"use client";

import type { PhrasingContent, Root, RootContent, TableRow } from "mdast";
import { Fragment, useMemo, type ReactNode } from "react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { MemoText, type NoteRef } from "../mobile/MemoBubble";

// Thread posts as Markdown: parsed with remark (CommonMark + GFM: tables,
// task lists, strikethrough) and turned into React elements here, never via
// innerHTML: raw HTML in a post shows as text. Plain text runs keep the memo
// extras: [[links]] and #tags as chips, ==highlight== as <mark>.

const processor = unified().use(remarkParse).use(remarkGfm);

type Ctx = {
  resolve: (title: string) => NoteRef | null;
  onOpenNote: (note: NoteRef) => void;
  onOpenTag?: (tag: string) => void;
  onOpenImage: (url: string) => void;
  tone: "bubble" | "plain";
};

// Links open in a new tab; only web, mail and app-relative targets.
const safeHref = (url: string) => (/^(https?:|mailto:|\/(?!\/)|#)/i.test(url) ? url : null);

function text(value: string, ctx: Ctx, key: string): ReactNode {
  const parts = value.split(/==([^=\n]+)==/);
  return (
    <Fragment key={key}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="nexote-post-mark">
            {part}
          </mark>
        ) : (
          <MemoText
            key={i}
            text={part}
            resolve={ctx.resolve}
            onOpenNote={ctx.onOpenNote}
            onOpenTag={ctx.onOpenTag}
            tone={ctx.tone}
          />
        ),
      )}
    </Fragment>
  );
}

function inline(nodes: PhrasingContent[], ctx: Ctx, prefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${prefix}-${i}`;
    switch (node.type) {
      case "text":
        return text(node.value, ctx, key);
      case "emphasis":
        return <em key={key}>{inline(node.children, ctx, key)}</em>;
      case "strong":
        return <strong key={key}>{inline(node.children, ctx, key)}</strong>;
      case "delete":
        return <s key={key}>{inline(node.children, ctx, key)}</s>;
      case "inlineCode":
        return <code key={key}>{node.value}</code>;
      case "break":
        return <br key={key} />;
      case "link": {
        const href = safeHref(node.url);
        const kids = inline(node.children, ctx, key);
        return href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {kids}
          </a>
        ) : (
          <Fragment key={key}>{kids}</Fragment>
        );
      }
      case "image":
        return (
          <button key={key} type="button" aria-label="Show image" onClick={() => ctx.onOpenImage(node.url)} className="nexote-post-img">
            {/* eslint-disable-next-line @next/next/no-img-element -- vault image */}
            <img src={node.url} alt={node.alt ?? ""} loading="lazy" draggable={false} />
          </button>
        );
      case "html":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "linkReference":
        return <Fragment key={key}>{inline(node.children, ctx, key)}</Fragment>;
      case "imageReference":
        return <Fragment key={key}>{node.alt}</Fragment>;
      default:
        return null;
    }
  });
}

function row(r: TableRow, ctx: Ctx, key: string, head: boolean): ReactNode {
  const Cell = head ? "th" : "td";
  return (
    <tr key={key}>
      {r.children.map((c, i) => (
        <Cell key={i}>{inline(c.children, ctx, `${key}-${i}`)}</Cell>
      ))}
    </tr>
  );
}

function blocks(nodes: RootContent[], ctx: Ctx, prefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${prefix}-${i}`;
    switch (node.type) {
      case "paragraph":
        return <p key={key}>{inline(node.children, ctx, key)}</p>;
      case "heading":
        return (
          <p key={key} className={`nexote-post-h nexote-post-h${node.depth}`}>
            {inline(node.children, ctx, key)}
          </p>
        );
      case "blockquote":
        return <blockquote key={key}>{blocks(node.children, ctx, key)}</blockquote>;
      case "list": {
        const items = node.children.map((item, j) => (
          <li key={j} className={item.checked == null ? undefined : "nexote-post-task"}>
            {item.checked != null && <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} />}
            <div>{blocks(item.children, ctx, `${key}-${j}`)}</div>
          </li>
        ));
        return node.ordered ? (
          <ol key={key} start={node.start ?? undefined}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        );
      }
      case "code":
        return (
          <pre key={key}>
            <code>{node.value}</code>
          </pre>
        );
      case "thematicBreak":
        return <hr key={key} />;
      case "table":
        return (
          <div key={key} className="nexote-post-table">
            <table>
              <thead>{node.children[0] && row(node.children[0], ctx, `${key}-h`, true)}</thead>
              <tbody>{node.children.slice(1).map((r, j) => row(r, ctx, `${key}-${j}`, false))}</tbody>
            </table>
          </div>
        );
      case "html":
        return <p key={key}>{node.value}</p>;
      default:
        return null;
    }
  });
}

/** A post's text (images already split off or inline) rendered as Markdown. */
export function PostMarkdown({
  text: source,
  tone,
  resolve,
  onOpenNote,
  onOpenTag,
  onOpenImage,
}: {
  text: string;
  tone: "bubble" | "plain";
  resolve: (title: string) => NoteRef | null;
  onOpenNote: (note: NoteRef) => void;
  onOpenTag?: (tag: string) => void;
  onOpenImage: (url: string) => void;
}) {
  const tree = useMemo(() => processor.parse(source) as Root, [source]);
  return (
    <div className={`nexote-post-md nexote-post-md-${tone}`}>
      {blocks(tree.children, { resolve, onOpenNote, onOpenTag, onOpenImage, tone }, "b")}
    </div>
  );
}

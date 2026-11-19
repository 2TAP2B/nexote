"use client";

import { localDateKey } from "@/lib/note-utils";
import { splitMemo } from "@/lib/notepad";
import type { ThreadComment } from "@/lib/threads";
import type { NoteRef } from "../mobile/MemoBubble";
import { PostMarkdown } from "./PostMarkdown";
import { useLongPress } from "./useLongPress";

// The comments under a thread post: smaller, muted and indented behind a thin
// line, so they read as asides to the post rather than posts of their own. A
// long press or right-click opens a comment's menu (edit, copy, delete).

/** "Today", "Mon, Nov 17", or "Earlier" for text without a date. */
export const dayLabel = (day: string) =>
  day === localDateKey()
    ? "Today"
    : day
      ? new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
      : "Earlier";

// Comments are matched by content, like posts: an edit or a menu survives
// other comments arriving.
export const commentKey = (c: ThreadComment) => `${c.day}\n${c.time}\n${c.text}`;

type Ctx = {
  resolve: (title: string) => NoteRef | null;
  onOpenNote: (note: NoteRef) => void;
  onOpenTag?: (tag: string) => void;
  onOpenImage: (url: string) => void;
};

export function PostComments({
  comments,
  postDay,
  editingKey,
  onMenu,
  className = "",
  ...ctx
}: Ctx & {
  comments: ThreadComment[];
  /** The post's day: a comment written on another day shows its date too. */
  postDay: string;
  /** The comment open in the composer (see commentKey). */
  editingKey: string | null;
  onMenu: (comment: ThreadComment) => void;
  className?: string;
}) {
  if (comments.length === 0) return null;
  return (
    <ul
      aria-label={comments.length === 1 ? "1 comment" : `${comments.length} comments`}
      className={"flex flex-col gap-0.5 border-l-2 pl-2 " + className}
      style={{ borderColor: "color-mix(in srgb, var(--mob-muted) 30%, transparent)" }}
    >
      {comments.map((comment, i) => {
        const key = commentKey(comment);
        return (
          <CommentItem
            // Two identical comments can exist; the index tells them apart.
            key={`${i}-${key}`}
            comment={comment}
            postDay={postDay}
            editing={editingKey === key}
            onMenu={onMenu}
            {...ctx}
          />
        );
      })}
    </ul>
  );
}

function CommentItem({
  comment,
  postDay,
  editing,
  onMenu,
  resolve,
  onOpenNote,
  onOpenTag,
  onOpenImage,
}: Ctx & { comment: ThreadComment; postDay: string; editing: boolean; onMenu: (comment: ThreadComment) => void }) {
  const press = useLongPress(() => onMenu(comment));
  const { text, images } = splitMemo(comment.text);
  const stamp = comment.day && comment.day !== postDay ? `${dayLabel(comment.day)} · ${comment.time}` : comment.time;
  return (
    <li
      {...press}
      className="select-none rounded-lg px-1.5 py-1 text-[13px] leading-snug transition-colors"
      style={{
        color: "var(--mob-muted)",
        background: editing ? "var(--mob-surface)" : undefined,
        WebkitTouchCallout: "none",
      }}
    >
      {stamp && <div className="text-[11px] tabular-nums opacity-80">{stamp}</div>}
      {text && (
        <PostMarkdown
          text={text}
          tone="plain"
          resolve={resolve}
          onOpenNote={onOpenNote}
          onOpenTag={onOpenTag}
          onOpenImage={onOpenImage}
        />
      )}
      {images.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {images.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              aria-label="Show image"
              onClick={() => onOpenImage(url)}
              className="block overflow-hidden rounded-md"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- vault image */}
              <img src={url} alt="" loading="lazy" draggable={false} className="block h-20 w-20 object-cover" />
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

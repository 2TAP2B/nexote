"use client";

import { MessagesSquare } from "lucide-react";

import { replyLabel, threadPreview, threadTags, type Thread } from "@/lib/threads";

/**
 * A thread in the quick-notes stream, at its last activity: right-aligned
 * like a memo but on the surface color with an accent edge, so it reads as
 * "more inside". Tap opens the thread; tags filter the stream. While memos
 * are being selected it's dimmed and inert (threads can't be selected).
 */
export function ThreadCard({
  thread,
  dimmed,
  onOpen,
  onOpenTag,
}: {
  thread: Thread;
  dimmed: boolean;
  onOpen: () => void;
  onOpenTag: (tag: string) => void;
}) {
  const snippet = threadPreview(thread);
  const tags = threadTags(thread);

  return (
    <div
      role="button"
      tabIndex={dimmed ? -1 : 0}
      aria-label={`Open thread “${thread.title}”`}
      aria-disabled={dimmed}
      onClick={() => {
        if (!dimmed) onOpen();
      }}
      onKeyDown={(e) => {
        if (dimmed || e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onOpen();
      }}
      className="flex min-w-[55%] max-w-[85%] select-none flex-col gap-1 rounded-2xl rounded-br-md px-3 py-2 text-left transition-[opacity,transform] active:scale-[0.99]"
      style={{
        background: "var(--mob-surface)",
        color: "var(--mob-text)",
        border: "1px solid color-mix(in srgb, var(--mob-accent) 45%, transparent)",
        borderLeft: "3px solid var(--mob-accent)",
        opacity: dimmed ? 0.45 : 1,
        pointerEvents: dimmed ? "none" : undefined,
        WebkitTouchCallout: "none",
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <MessagesSquare size={15} className="shrink-0" style={{ color: "var(--mob-accent)" }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug">
          {thread.title || "Untitled thread"}
        </span>
      </span>
      {snippet && (
        <span className="line-clamp-2 break-words text-[13px] leading-snug" style={{ color: "var(--mob-muted)" }}>
          {snippet}
        </span>
      )}
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium" style={{ color: "var(--mob-accent)" }}>
          {replyLabel(thread)}
        </span>
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenTag(tag);
            }}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: "color-mix(in srgb, var(--mob-accent) 14%, transparent)",
              color: "var(--mob-accent)",
            }}
          >
            #{tag}
          </button>
        ))}
      </span>
    </div>
  );
}

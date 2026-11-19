"use client";

import { CircleCheck, MessagesSquare, Pin } from "lucide-react";
import { useState } from "react";

import { replyLabel, threadPreview, threadTags, type Thread } from "@/lib/threads";
import { MobileActionSheet } from "../mobile/MobileActionSheet";
import { isPriorityLevel, PRIORITIES, PriorityBadge } from "./priority";
import { threadMarkSections } from "./threadActions";
import { useLongPress } from "./useLongPress";

/**
 * A thread in the quick-notes stream, at its last activity: right-aligned
 * like a memo but on the surface color with an accent edge (the priority's
 * color when it has one), so it reads as "more inside". Tap opens the
 * thread; tags filter the stream; a long press or right-click opens the
 * pin / solved / priority menu. While memos are being selected it's dimmed
 * and inert (threads can't be selected).
 */
export function ThreadCard({
  thread,
  dimmed,
  onOpen,
  onOpenTag,
  onError,
}: {
  thread: Thread;
  dimmed: boolean;
  onOpen: () => void;
  onOpenTag: (tag: string) => void;
  /** A mark change failed (shown as a toast). */
  onError: (message: string) => void;
}) {
  const snippet = threadPreview(thread);
  const tags = threadTags(thread);
  const [menu, setMenu] = useState(false);
  const pressHandlers = useLongPress(() => setMenu(true));
  const edge = isPriorityLevel(thread.priority) ? PRIORITIES[thread.priority].color : "var(--mob-accent)";
  const title = thread.title || "Untitled thread";

  return (
    <>
      <div
        role="button"
        tabIndex={dimmed ? -1 : 0}
        aria-label={`Open thread “${title}”`}
        aria-disabled={dimmed}
        {...pressHandlers}
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
          borderLeft: `3px solid ${edge}`,
          opacity: dimmed ? 0.45 : 1,
          pointerEvents: dimmed ? "none" : undefined,
          WebkitTouchCallout: "none",
        }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <MessagesSquare size={15} className="shrink-0" style={{ color: "var(--mob-accent)" }} aria-hidden />
          <span
            className={"min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug" + (thread.done ? " line-through" : "")}
            style={thread.done ? { opacity: 0.6 } : undefined}
          >
            {title}
          </span>
          {thread.done && <CircleCheck size={15} className="shrink-0" style={{ color: "#22c55e" }} aria-label="Solved" />}
        </span>
        {snippet && (
          <span className="line-clamp-2 break-words text-[13px] leading-snug" style={{ color: "var(--mob-muted)" }}>
            {snippet}
          </span>
        )}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {thread.pinned && <Pin size={12} className="shrink-0" style={{ color: "var(--mob-accent)" }} aria-label="Pinned" />}
          <PriorityBadge priority={thread.priority} />
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
      {menu && (
        <MobileActionSheet
          title={title}
          sections={[
            [{ label: "Open", icon: <MessagesSquare size={19} />, onClick: onOpen }],
            ...threadMarkSections(thread, onError),
          ]}
          onClose={() => setMenu(false)}
        />
      )}
    </>
  );
}

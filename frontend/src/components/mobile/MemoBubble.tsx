"use client";

import { MessagesSquare } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { haptic } from "@/lib/haptics";
import { splitMemo } from "@/lib/notepad";
import { useSwipeAction } from "../threads/useSwipeAction";

/**
 * A note a memo can link to ([[Title]]); journal notes have no vault.
 * `thread` marks a quick-notes thread (opened in the thread view).
 */
export type NoteRef = {
  id: string;
  title: string;
  vaultId: string | null;
  where: string;
  updatedAt: string;
  thread?: boolean;
};

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 8;

/**
 * One quick-capture memo or thread post: its images, then its text with
 * linked notes and #tags as tappable chips. A long press (touch) or
 * right-click selects it; while memos are selected, a tap toggles the
 * selection instead of opening links. With `onSwipeLeft`, swiping it left
 * runs that (start a thread).
 */
export function MemoBubble({
  text: memo,
  editing,
  selected,
  selecting,
  resolve,
  onOpenNote,
  onOpenImage,
  onOpenTag,
  onToggleSelect,
  onSwipeLeft,
  swipeLabel = "Start a thread",
}: {
  /** The memo/post text (image lines included). */
  text: string;
  /** This memo is open in the composer. */
  editing: boolean;
  selected: boolean;
  /** Some memo is selected: taps select instead of opening. */
  selecting: boolean;
  resolve: (title: string) => NoteRef | null;
  onOpenNote: (note: NoteRef) => void;
  onOpenImage: (url: string) => void;
  onOpenTag?: (tag: string) => void;
  onToggleSelect: () => void;
  onSwipeLeft?: () => void;
  swipeLabel?: string;
}) {
  const { text, images } = splitMemo(memo);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  // This press selected the memo: swallow the click that ends it.
  const pressed = useRef(false);
  const swipeRef = useRef<HTMLDivElement>(null);
  const { offset, armed } = useSwipeAction(swipeRef, selecting ? undefined : onSwipeLeft);

  const cancelPress = () => {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const longPress = () => {
    cancelPress();
    pressed.current = true;
    onToggleSelect();
  };

  return (
    <div ref={swipeRef} className="relative max-w-[85%]">
      {offset < 0 && (
        <span
          aria-hidden
          className="absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
          style={{
            opacity: Math.min(1, -offset / 60),
            background: armed ? "var(--mob-accent)" : "var(--mob-surface)",
            color: armed ? "#fff" : "var(--mob-muted)",
          }}
          title={swipeLabel}
        >
          <MessagesSquare size={18} />
        </span>
      )}
    <div
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        pressed.current = false;
        cancelPress();
        const { clientX: x, clientY: y } = e;
        press.current = {
          x,
          y,
          timer: window.setTimeout(() => {
            haptic();
            longPress();
          }, LONG_PRESS_MS),
        };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      // Right-click on desktop; Android fires it for long presses too.
      onContextMenu={(e) => {
        e.preventDefault();
        if (!pressed.current) longPress();
      }}
      // Lifting the finger after a long press would otherwise turn into a
      // click on the bubble (a link chip, an image).
      onTouchEnd={(e) => {
        if (pressed.current) e.preventDefault();
      }}
      onClickCapture={(e) => {
        if (!pressed.current && !selecting) return;
        e.preventDefault();
        e.stopPropagation();
        if (pressed.current) pressed.current = false;
        else onToggleSelect();
      }}
      className={
        "relative select-none overflow-hidden rounded-2xl rounded-br-md text-[15px] leading-snug transition-shadow" +
        (editing || selected ? " ring-2 ring-primary ring-offset-2 ring-offset-background" : "")
      }
      style={{
        background: "var(--mob-accent)",
        color: "#fff",
        WebkitTouchCallout: "none",
        transform: offset ? `translateX(${offset}px)` : undefined,
        transition: offset ? "none" : "transform 180ms ease-out",
      }}
    >
      {images.length > 0 && (
        <div className={`grid gap-1 p-1 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {images.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              aria-label="Show image"
              onClick={() => onOpenImage(url)}
              className="block overflow-hidden rounded-xl"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- vault image */}
              <img src={url} alt="" loading="lazy" draggable={false} className="block max-h-64 w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {text && (
        <p className="whitespace-pre-wrap break-words px-3 py-2">
          <MemoText text={text} resolve={resolve} onOpenNote={onOpenNote} onOpenTag={onOpenTag} />
        </p>
      )}
    </div>
    </div>
  );
}

// [[Title]] / [[Title|label]], or a #tag after whitespace (the backend's rule).
const TOKEN_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]|(^|\s)\\?#([a-z0-9][\w-]*)/gi;

/** Memo text with linked notes ("@label") and #tags as chips (white-on-accent bubble styling). */
export function MemoText({
  text,
  resolve,
  onOpenNote,
  onOpenTag,
}: {
  text: string;
  resolve: (title: string) => NoteRef | null;
  onOpenNote: (note: NoteRef) => void;
  onOpenTag?: (tag: string) => void;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (m[4] !== undefined) {
      // #tag: the whitespace before it stays text.
      const tagStart = start + m[3].length;
      if (tagStart > last) parts.push(text.slice(last, tagStart));
      const tag = m[4].toLowerCase();
      parts.push(
        onOpenTag ? (
          <button
            key={tagStart}
            type="button"
            onClick={() => onOpenTag(tag)}
            className="font-semibold underline-offset-2 active:underline"
          >
            #{m[4]}
          </button>
        ) : (
          <span key={tagStart} className="font-semibold">
            #{m[4]}
          </span>
        ),
      );
      last = start + m[0].length;
      continue;
    }
    if (start > last) parts.push(text.slice(last, start));
    const title = m[1].trim();
    const label = m[2]?.trim() || title;
    const note = resolve(title);
    parts.push(
      note ? (
        <button
          key={start}
          type="button"
          onClick={() => onOpenNote(note)}
          className="mx-px rounded-md bg-white/20 px-1 font-medium active:bg-white/30"
        >
          {note.thread ? "↳ " : "@"}
          {label}
        </button>
      ) : (
        <span key={start} title="No note with this title" className="mx-px rounded-md bg-white/10 px-1 italic opacity-75">
          @{label}
        </span>
      ),
    );
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

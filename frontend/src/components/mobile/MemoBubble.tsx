"use client";

import { useRef, type ReactNode } from "react";

import { MENTION_RE, splitMemo, type NotepadEntry } from "@/lib/notepad";

/** A note a memo can link to ([[Title]]); journal notes have no vault. */
export type NoteRef = { id: string; title: string; vaultId: string | null; where: string; updatedAt: string };

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 8;

/**
 * One quick-capture memo: its images, then its text with linked notes as
 * tappable chips. A long press (touch) or right-click opens the memo menu.
 */
export function MemoBubble({
  entry,
  editing,
  resolve,
  onOpenNote,
  onOpenImage,
  onMenu,
}: {
  entry: NotepadEntry;
  /** This memo is open in the composer. */
  editing: boolean;
  resolve: (title: string) => NoteRef | null;
  onOpenNote: (note: NoteRef) => void;
  onOpenImage: (url: string) => void;
  onMenu: (entry: NotepadEntry, x: number, y: number) => void;
}) {
  const { text, images } = splitMemo(entry.text);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  // The menu opened from this press: swallow the click that ends it.
  const opened = useRef(false);

  const cancelPress = () => {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const openMenu = (x: number, y: number) => {
    cancelPress();
    opened.current = true;
    onMenu(entry, x, y);
  };

  return (
    <div
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        opened.current = false;
        cancelPress();
        const { clientX: x, clientY: y } = e;
        press.current = {
          x,
          y,
          timer: window.setTimeout(() => {
            navigator.vibrate?.(10);
            openMenu(x, y);
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
        if (!opened.current) openMenu(e.clientX, e.clientY);
      }}
      // Lifting the finger after a long press would otherwise turn into a
      // mousedown/click on the bubble, which closes the menu right away.
      onTouchEnd={(e) => {
        if (opened.current) e.preventDefault();
      }}
      onClickCapture={(e) => {
        if (!opened.current) return;
        opened.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      className={
        "max-w-[85%] select-none overflow-hidden rounded-2xl rounded-br-md text-[15px] leading-snug transition-shadow" +
        (editing ? " ring-2 ring-primary ring-offset-2 ring-offset-background" : "")
      }
      style={{ background: "var(--mob-accent)", color: "#fff", WebkitTouchCallout: "none" }}
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
          <MemoText text={text} resolve={resolve} onOpenNote={onOpenNote} />
        </p>
      )}
    </div>
  );
}

function MemoText({
  text,
  resolve,
  onOpenNote,
}: {
  text: string;
  resolve: (title: string) => NoteRef | null;
  onOpenNote: (note: NoteRef) => void;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index ?? 0;
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
          @{label}
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

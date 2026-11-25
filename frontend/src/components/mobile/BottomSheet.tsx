"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useAndroidBack } from "@/lib/android-back";
import { useVisualViewport } from "./useVirtualKeyboardInset";

const DISMISS_PX = 80;
const ANIM_MS = 220;

/** What a sheet's content gets: slide out then close, or close right away. */
export type SheetControls = { dismiss: () => void; closeNow: () => void };

/**
 * The touch shell's bottom sheet: drag handle, optional title, content. Tap
 * outside, Esc or drag the handle down to dismiss. Portaled to <body>: the
 * pager's transform would anchor a fixed overlay to the track instead of
 * the screen (a dialog stuck in the sidebar pane, half the note beside it).
 * While the on-screen keyboard is open the sheet sits on top of it.
 */
export function BottomSheet({
  title,
  subtitle,
  label,
  onClose,
  children,
}: {
  title?: string;
  subtitle?: string;
  /** Accessible name when there's no title. */
  label?: string;
  onClose: () => void;
  children: (controls: SheetControls) => ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  const closing = useRef(false);
  // Mirrors `closing` for Android Back: a sheet sliding out (tap outside,
  // drag, a button) no longer counts as open, so Back reaches what's below.
  const [leaving, setLeaving] = useState(false);
  const vv = useVisualViewport();

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Slides out, then unmounts.
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    setLeaving(true);
    setShown(false);
    setDragY(0);
    window.setTimeout(onClose, ANIM_MS);
  };
  // Content that opens something of its own closes at once.
  const closeNow = () => {
    closing.current = true;
    setLeaving(true);
    onClose();
  };
  useAndroidBack(dismiss, !leaving);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dragging = dragStart.current !== null;
  const keyboard = vv.isKeyboardOpen ? vv.inset : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end"
      style={{
        background: shown ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0)",
        transition: `background ${ANIM_MS}ms ease`,
        paddingBottom: keyboard,
      }}
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? label ?? "Menu"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] flex-col rounded-t-[20px] bg-background text-foreground shadow-2xl"
        style={{
          transform: shown ? `translateY(${dragY}px)` : "translateY(100%)",
          transition: dragging ? "none" : `transform ${ANIM_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          paddingBottom: keyboard ? 10 : "calc(env(safe-area-inset-bottom, 0px) + 10px)",
        }}
      >
        <div
          className="flex shrink-0 flex-col items-center px-4 pb-3 pt-2.5"
          style={{ touchAction: "none" }}
          onTouchStart={(e) => {
            dragStart.current = e.touches[0].clientY;
          }}
          onTouchMove={(e) => {
            if (dragStart.current === null) return;
            setDragY(Math.max(0, e.touches[0].clientY - dragStart.current));
          }}
          onTouchEnd={() => {
            dragStart.current = null;
            if (dragY > DISMISS_PX) dismiss();
            else setDragY(0);
          }}
        >
          <span aria-hidden className="h-1 w-9 rounded-full bg-muted-foreground/35" />
          {title && (
            <div className="mt-3 w-full min-w-0 text-center">
              <p className="truncate text-[15px] font-semibold">{title}</p>
              {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          )}
        </div>
        {children({ dismiss, closeNow })}
      </div>
    </div>,
    document.body,
  );
}

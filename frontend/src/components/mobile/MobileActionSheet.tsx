"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type SheetAction = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  checked?: boolean;
};

const DISMISS_PX = 80;
const ANIM_MS = 220;

/**
 * Obsidian-style mobile menu: a bottom sheet with a drag handle, an optional
 * title, and actions in rounded groups. Tap outside, Esc or drag the handle
 * down to dismiss. Portaled to <body>: the pager's transform would anchor a
 * fixed overlay to the track instead of the screen.
 */
export function MobileActionSheet({
  title,
  subtitle,
  sections,
  onClose,
}: {
  title?: string;
  subtitle?: string;
  /** Groups of actions; empty groups are skipped. */
  sections: SheetAction[][];
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  const closing = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Slides out, then unmounts.
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    setDragY(0);
    window.setTimeout(onClose, ANIM_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Actions close at once: they may open a dialog of their own.
  const run = (action: SheetAction) => {
    closing.current = true;
    onClose();
    action.onClick();
  };

  const groups = sections.filter((s) => s.length > 0);
  const dragging = dragStart.current !== null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end"
      style={{ background: shown ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0)", transition: `background ${ANIM_MS}ms ease` }}
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Menu"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] flex-col rounded-t-[20px] bg-background text-foreground shadow-2xl"
        style={{
          transform: shown ? `translateY(${dragY}px)` : "translateY(100%)",
          transition: dragging ? "none" : `transform ${ANIM_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)",
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
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3">
          {groups.map((group, i) => (
            <ul key={i} className="shrink-0 overflow-hidden rounded-xl bg-muted/60">
              {group.map((action, j) => (
                <li key={action.label}>
                  {j > 0 && <div aria-hidden className="ml-[52px] border-t border-border/70" />}
                  <button
                    type="button"
                    onClick={() => run(action)}
                    className={
                      "flex w-full items-center gap-4 px-4 py-3 text-left text-[15px] transition-colors active:bg-muted" +
                      (action.danger ? " text-red-600 dark:text-red-400" : "")
                    }
                  >
                    <span
                      className={
                        "flex w-5 shrink-0 justify-center" + (action.danger ? "" : " text-muted-foreground")
                      }
                    >
                      {action.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    {action.checked && <Check size={18} className="shrink-0 text-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

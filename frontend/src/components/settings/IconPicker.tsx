"use client";

import { Database } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getIcon, ICON_OPTIONS, type IconComponent } from "@/lib/icons";
import { cx, useIsMobileSettings } from "./ui";

const COLS = 8;
const GAP = 4;
const PAD = 8;

/**
 * Icon button that opens a grid of icons (vault icons). The grid is portaled
 * to <body> so the settings cards' overflow clipping can't cut it off; the
 * settings shells skip their Escape-to-close while it is open
 * (`data-settings-popover`).
 */
export function IconPicker({
  value,
  onChange,
  label,
  fallback = Database,
}: {
  value: string;
  onChange: (icon: string) => void;
  label: string;
  /** Shown on the button while no icon is set. */
  fallback?: IconComponent;
}) {
  const mobile = useIsMobileSettings();
  const cell = mobile ? 40 : 36;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const Current = getIcon(value, fallback);
  const open = pos !== null;

  const toggle = () => {
    if (open || !btnRef.current) {
      setPos(null);
      return;
    }
    const r = btnRef.current.getBoundingClientRect();
    const rows = Math.ceil(ICON_OPTIONS.length / COLS);
    const width = COLS * cell + (COLS - 1) * GAP + 2 * PAD;
    const height = Math.min(rows * cell + (rows - 1) * GAP + 2 * PAD, window.innerHeight * 0.7);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = r.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : below;
    setPos({ left, top });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // The grid is positioned once; scrolling the page would detach it.
    const onScroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={cx(
          "flex shrink-0 items-center justify-center border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          mobile ? "h-10 w-10 rounded-lg" : "h-8 w-8 rounded-md",
        )}
      >
        <Current size={mobile ? 18 : 16} />
      </button>
      {pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label={label}
            data-settings-popover=""
            className="fixed z-[80] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-background shadow-xl"
            style={{ left: pos.left, top: pos.top, padding: PAD }}
          >
            <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, ${cell}px)`, gap: GAP }}>
              {ICON_OPTIONS.map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  aria-label={name}
                  aria-pressed={name === value}
                  onClick={() => {
                    onChange(name);
                    setPos(null);
                  }}
                  className={cx(
                    "flex items-center justify-center rounded-md transition-colors hover:bg-muted",
                    name === value ? "bg-primary/15 text-primary" : "text-muted-foreground",
                  )}
                  style={{ width: cell, height: cell }}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

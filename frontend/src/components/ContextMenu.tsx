"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type MenuItem = {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

// A small menu rendered at fixed coordinates. Closes on outside click, Esc, or
// scroll. Used for right-click context menus on notes/folders in the tree.
// Rendered via a portal to document.body so it always sits above the editor
// and sidebar regardless of their stacking contexts.
export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  // Clamp to viewport so the menu doesn't overflow.
  const maxX = typeof window !== "undefined" ? window.innerWidth - 200 : x;
  const maxY = typeof window !== "undefined" ? window.innerHeight - items.length * 36 : y;
  const left = Math.min(x, maxX);
  const top = Math.min(y, maxY);

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left, top, zIndex: 9999 }}
      className="min-w-[160px] overflow-hidden rounded-xl border border-border bg-background py-1 shadow-lg"
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-border" />
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={[
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted",
              item.danger
                ? "text-red-600 dark:text-red-400"
                : "text-foreground",
            ].join(" ")}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
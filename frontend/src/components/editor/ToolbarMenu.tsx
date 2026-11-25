"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAndroidBack } from "@/lib/android-back";
import type { ToolbarAction, ToolbarMenuItem } from "./toolbarActions";

export type OpenMenu = { key: string; anchor: DOMRect; items: ToolbarMenuItem[] };

/** Open/close state for a toolbar button's menu; `press` runs a plain
 *  button or toggles a menu button's list above it. */
export function useToolbarMenu() {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const press = (action: ToolbarAction, button: HTMLElement) => {
    if (!action.menu) {
      setOpen(null);
      action.run?.();
      return;
    }
    const items = action.menu;
    setOpen((cur) => (cur?.key === action.key ? null : { key: action.key, anchor: button.getBoundingClientRect(), items }));
  };
  const close = useCallback(() => setOpen(null), []);
  return { open, press, close };
}

/** The choices of a toolbar button (e.g. every callout type), opening upward
 *  from the button. In a portal: the toolbars scroll horizontally, which
 *  would clip it. Never takes focus, so the editor keeps its caret. */
export function ToolbarMenu({
  menu,
  onClose,
  touch,
}: {
  menu: OpenMenu;
  onClose: () => void;
  /** Bigger rows in two columns (phone bar above the keyboard). */
  touch?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAndroidBack(onClose);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Next tick: the press that opened the menu must not close it again.
    const timer = window.setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { anchor } = menu;
  const width = touch ? 300 : 200;
  const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8));
  const bottom = window.innerHeight - anchor.top + 8;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      className={"fixed z-[70] overflow-y-auto rounded-xl p-1 shadow-xl " + (touch ? "grid grid-cols-2 gap-0.5" : "flex flex-col")}
      style={{
        left,
        bottom,
        width,
        maxHeight: Math.max(160, anchor.top - 16),
        // Portaled to <body>, outside the touch shell's --mob-* scope: use the
        // theme's opaque colors (there is no --popover in this theme).
        background: touch ? "var(--sidebar)" : "var(--background)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
      }}
    >
      {menu.items.map(({ key, label, icon: Icon, color, run }) => (
        <button
          key={key}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            run();
          }}
          className={
            "flex items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-muted " +
            (touch ? "min-h-11 px-3 text-[15px]" : "px-2.5 py-1.5 text-sm")
          }
        >
          <Icon size={touch ? 18 : 16} style={color ? { color } : undefined} />
          {label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

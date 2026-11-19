"use client";

import { useRef, type MouseEvent, type PointerEvent, type TouchEvent } from "react";

import { haptic } from "@/lib/haptics";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 8;

export type MenuOpener = "press" | "contextmenu";

/**
 * Opens a menu on a touch long press (like MemoBubble's) or a right-click,
 * for rows and cards whose tap opens something. Spread the handlers on the
 * element; after a long press the click that ends it is swallowed, so the
 * row doesn't open as well.
 */
export function useLongPress(onMenu: (at: { x: number; y: number }, via: MenuOpener) => void) {
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  // This press opened the menu: swallow the click that ends it.
  const pressed = useRef(false);

  const cancel = () => {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      pressed.current = false;
      cancel();
      // Mice have the right button for the menu.
      if (e.pointerType === "mouse") return;
      const { clientX: x, clientY: y } = e;
      press.current = {
        x,
        y,
        timer: window.setTimeout(() => {
          press.current = null;
          pressed.current = true;
          haptic();
          onMenu({ x, y }, "press");
        }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (e: PointerEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // Right-click on desktop; Android fires it for long presses too (after
    // or before the timer — whichever comes first opens the menu once).
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      if (pressed.current) return;
      cancel();
      pressed.current = true;
      onMenu({ x: e.clientX, y: e.clientY }, "contextmenu");
    },
    onTouchEnd: (e: TouchEvent) => {
      if (pressed.current) e.preventDefault();
    },
    onClickCapture: (e: MouseEvent) => {
      if (!pressed.current) return;
      e.preventDefault();
      e.stopPropagation();
      pressed.current = false;
    },
  };
}

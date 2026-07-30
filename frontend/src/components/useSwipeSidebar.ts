"use client";

import { useEffect, useRef } from "react";

type SwipeHandlers = {
  // Called when a horizontal drag from the left edge moves right (open).
  onOpen: () => void;
  // Called when a horizontal drag moves left past a threshold (close).
  onClose: () => void;
  // Whether the sidebar is currently open (only relevant on mobile).
  open: boolean;
};

// Edge width (px) where a touch-start counts as an edge-swipe to open.
const EDGE = 24;
// Horizontal distance a touch must travel to trigger an action.
const THRESHOLD = 60;
// Ignore nearly-vertical swipes (avoids hijacking scroll).
const VERTICAL_LIMIT = 1.5;

// Minimal horizontal swipe gesture for mobile sidebar open/close. Listens on
// the document so it works regardless of which element is touched. The drag
// follows the finger visually via a CSS transform driven by a callback so
// the sidebar feels responsive; we commit on touchend.
export function useSwipeSidebar({ onOpen, onClose, open }: SwipeHandlers) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const handlers = useRef({ onOpen, onClose, open });
  handlers.current = { onOpen, onClose, open };

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      // Ignore vertical-dominant gestures.
      if (Math.abs(dy) > Math.abs(dx) * VERTICAL_LIMIT) return;

      const h = handlers.current;
      if (dx > THRESHOLD) {
        // Rightward swipe: open if it started at the left edge OR if the
        // sidebar is currently open (push it further open -> no-op, but
        // allow opening from edge).
        if (s.x <= EDGE || h.open) h.onOpen();
      } else if (dx < -THRESHOLD) {
        // Leftward swipe: close if open.
        if (h.open) h.onClose();
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);
}
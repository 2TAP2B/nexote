"use client";

import { useEffect, useRef } from "react";

type SwipeHandlers = {
  // Called when a horizontal drag from near the left edge moves right (open).
  onOpen: () => void;
  // Called when a horizontal drag moves left past a threshold (close).
  onClose: () => void;
  // Whether the sidebar is currently open (only relevant on mobile).
  open: boolean;
};

// How far from the left edge a touch can start to count as an open-swipe.
const EDGE = 48;
// Horizontal distance a drag must travel to trigger an action.
const THRESHOLD = 56;
// Minimum horizontal travel before we decide it's a horizontal gesture.
const DRAG_X = 14;
// Ignore nearly-vertical gestures (avoids hijacking scroll).
const VERTICAL_LIMIT = 1.5;

// Minimal horizontal swipe gesture for mobile sidebar open/close, using
// Pointer Events (works in every modern mobile browser and doesn't get eaten
// by nested touch handlers). Relies on the shell root having
// `touch-action: pan-y` so horizontal drags are delivered to the page instead
// of the browser panning. A swipe also suppresses the synthetic click that
// would otherwise follow it (so a swipe-open in the tree doesn't open a note
// underneath the finger).
export function useSwipeSidebar({ onOpen, onClose, open }: SwipeHandlers) {
  const handlers = useRef({ onOpen, onClose, open });
  handlers.current = { onOpen, onClose, open };
  const state = useRef({ start: null as null | { x: number; y: number; id: number }, horizontal: false, lastSwipe: 0 });

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      state.current.start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      state.current.horizontal = false;
    };

    const onMove = (e: PointerEvent) => {
      const s = state.current.start;
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!state.current.horizontal && Math.abs(dx) > DRAG_X && Math.abs(dx) > Math.abs(dy)) {
        state.current.horizontal = true;
      }
    };

    const onUp = (e: PointerEvent) => {
      const s = state.current.start;
      state.current.start = null;
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      // Not a horizontal-dominant gesture (scroll, selection…) — ignore.
      if (!state.current.horizontal) return;
      if (Math.abs(dy) > Math.abs(dx) * VERTICAL_LIMIT) return;

      const h = handlers.current;
      if (dx > THRESHOLD && (s.x <= EDGE || h.open)) {
        state.current.lastSwipe = Date.now();
        h.onOpen();
      } else if (dx < -THRESHOLD && h.open) {
        state.current.lastSwipe = Date.now();
        h.onClose();
      }
    };

    // Suppress the click that the browser emits after a completed swipe, so a
    // swipe over a note row doesn't also open that note.
    const onCaptureClick = (e: Event) => {
      if (Date.now() - state.current.lastSwipe < 400) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointercancel", onUp, { passive: true });
    document.addEventListener("click", onCaptureClick, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.removeEventListener("click", onCaptureClick, true);
    };
  }, []);
}
"use client";

import { useEffect, useRef } from "react";

type SwipeHandlers = {
  onOpen: () => void;
  onClose: () => void;
  open: boolean;
};

const EDGE = 28;
const THRESHOLD = 56;
const DRAG_X = 10;
const VERTICAL_LIMIT = 1.5;

// Horizontal swipe gesture for mobile sidebar open/close.
//
// In PWA standalone mode the OS can intercept edge swipes for system
// navigation (Android back-gesture, iOS edge-swipe). To reliably receive
// horizontal drags that start near the left edge we attach an invisible
// strip with `touch-action: none` to the DOM — that tells the browser not
// to consume the gesture, so pointermove events reach our handler. For
// close-swipes (sidebar already open) we listen on the sidebar overlay
// which already captures all touches.
export function useSwipeSidebar({ onOpen, onClose, open }: SwipeHandlers) {
  const handlers = useRef({ onOpen, onClose, open });
  handlers.current = { onOpen, onClose, open };
  const state = useRef({
    start: null as null | { x: number; y: number; id: number },
    horizontal: false,
    lastSwipe: 0,
  });

  useEffect(() => {
    // Create an invisible edge strip that captures touch-starts near the
    // left edge with touch-action:none so the browser doesn't steal them.
    const edge = document.createElement("div");
    edge.style.cssText = `position:fixed;left:0;top:0;width:${EDGE}px;height:100%;z-index:5;touch-action:none;pointer-events:auto;`;
    document.body.appendChild(edge);

    const onStart = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      state.current.start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      state.current.horizontal = false;
    };

    const onMove = (e: PointerEvent) => {
      const s = state.current.start;
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (
        !state.current.horizontal &&
        Math.abs(dx) > DRAG_X &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        state.current.horizontal = true;
      }
    };

    const onUp = (e: PointerEvent) => {
      const s = state.current.start;
      state.current.start = null;
      if (!s || e.pointerId !== s.id) return;
      if (!state.current.horizontal) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
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

    const onCaptureClick = (e: Event) => {
      if (Date.now() - state.current.lastSwipe < 400) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // pointerdown on the edge strip (touch-action:none ensures we get it)
    // for open-swipes, and on document for close-swipes (sidebar open).
    const onEdgeDown = (e: PointerEvent) => onStart(e);
    const onDocDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!handlers.current.open) return;
      onStart(e);
    };
    edge.addEventListener("pointerdown", onEdgeDown, { passive: true });
    document.addEventListener("pointerdown", onDocDown, { passive: true });
    // pointermove/up on document so we track the finger even after it leaves
    // the narrow edge strip.
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointercancel", onUp, { passive: true });
    document.addEventListener("click", onCaptureClick, true);

    return () => {
      edge.removeEventListener("pointerdown", onEdgeDown);
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.removeEventListener("click", onCaptureClick, true);
      edge.remove();
    };
  }, []);
}
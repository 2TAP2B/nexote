"use client";

import { useEffect, useRef } from "react";

type SwipeHandlers = {
  onOpen: () => void;
  onClose: () => void;
  open: boolean;
};

const THRESHOLD = 60;
const DRAG_X = 8;
const VERTICAL_LIMIT = 1.5;

// Drag-to-follow swipe for the mobile "push" sidebar.
//
// Open:  drag right on the bottom navigation pill → the sidebar push
//        container's width follows the finger rightward (content gets pushed,
//        not covered). Release past THRESHOLD → open.
// Close: when the sidebar is open, drag left on the canvas/panel → the width
//        shrinks. Release past THRESHOLD → close.
//
// The push container is tracked via its CSS class so we can set its width in
// real time without React re-renders; transitions are disabled mid-drag and
// re-enabled on release for the snap animation.
export function useSwipeSidebar({ onOpen, onClose, open }: SwipeHandlers) {
  const handlers = useRef({ onOpen, onClose, open });
  handlers.current = { onOpen, onClose, open };
  const state = useRef({
    start: null as null | { x: number; y: number; id: number },
    horizontal: false,
    dragging: false,
    lastSwipe: 0,
    panelWidth: 380,
  });

  useEffect(() => {
    const isTouch =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches ||
        "ontouchstart" in window);
    if (!isTouch) return;

    const getPush = (): HTMLElement | null =>
      document.querySelector(".mob-sidebar-push");
    const getPill = (): HTMLElement | null =>
      document.querySelector(".mob-bottom-pill");

    const onStart = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // The inner panel always keeps its intrinsic width (90vw / max 520), so
      // it reliably reports the target width even while the push container is
      // collapsed to 0.
      const panelWidth =
        document.querySelector(".mob-sidebar-panel")?.getBoundingClientRect()
          .width ?? 380;
      state.current.start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      state.current.horizontal = false;
      state.current.dragging = false;
      state.current.panelWidth = panelWidth;
    };

    const onMove = (e: PointerEvent) => {
      const s = state.current.start;
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;

      if (!state.current.horizontal) {
        if (Math.abs(dx) > DRAG_X && Math.abs(dx) > Math.abs(dy)) {
          state.current.horizontal = true;
        } else {
          return;
        }
      }
      if (Math.abs(dy) > Math.abs(dx) * VERTICAL_LIMIT) return;

      // Begin dragging.
      state.current.dragging = true;
      const push = getPush();
      const h = handlers.current;
      const pw = state.current.panelWidth;

      // Disable transitions for smooth finger-following.
      if (push) push.style.transition = "none";

      if (h.open) {
        // Sidebar open — drag left to close.
        const width = Math.max(0, Math.min(pw, pw + dx));
        if (push) push.style.width = `${width}px`;
      } else {
        // Sidebar closed — drag right to open (from the bottom pill).
        const width = Math.max(0, Math.min(pw, dx));
        if (push) push.style.width = `${width}px`;
      }
    };

    const finishDrag = (e: PointerEvent) => {
      const s = state.current.start;
      state.current.start = null;
      if (!s || e.pointerId !== s.id) return;
      if (!state.current.horizontal) return;

      const dx = e.clientX - s.x;
      const h = handlers.current;
      const push = getPush();

      // Re-enable transitions for the snap animation.
      if (push) push.style.transition = "";

      if (state.current.dragging) {
        state.current.dragging = false;
        state.current.lastSwipe = Date.now();

        if (h.open) {
          // Collapse-to-default: let React's width:0 style take over so the
          // CSS transition animates from the dragged width to closed.
          if (dx < -THRESHOLD) h.onClose();
          if (push) push.style.width = "";
        } else {
          if (dx > THRESHOLD) h.onOpen();
          if (push) push.style.width = "";
        }
      } else if (push) {
        push.style.width = "";
      }
    };

    const onCaptureClick = (e: Event) => {
      if (Date.now() - state.current.lastSwipe < 400) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Open swipe: pointerdown on the bottom pill.
    const onPillDown = (e: PointerEvent) => onStart(e);
    // Close swipe: pointerdown on document when sidebar is open.
    const onDocDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!handlers.current.open) return;
      onStart(e);
    };

    const pill = getPill();
    pill?.addEventListener("pointerdown", onPillDown, { passive: true });
    document.addEventListener("pointerdown", onDocDown, { passive: true });
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", finishDrag, { passive: true });
    document.addEventListener("pointercancel", finishDrag, { passive: true });
    document.addEventListener("click", onCaptureClick, true);

    return () => {
      pill?.removeEventListener("pointerdown", onPillDown);
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", finishDrag);
      document.removeEventListener("pointercancel", finishDrag);
      document.removeEventListener("click", onCaptureClick, true);
    };
  }, []);
}
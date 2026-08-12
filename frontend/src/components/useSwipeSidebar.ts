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

// Drag-to-follow swipe for the mobile sidebar.
//
// Open:  drag right on the bottom navigation pill → the sidebar panel
//        follows the finger rightward. Release past THRESHOLD → open.
// Close: when the sidebar is open, drag left on the backdrop/panel →
//        slides it left. Release past THRESHOLD → close.
//
// The sidebar panel and backdrop are tracked via CSS classes so we can
// apply transforms in real-time without React re-renders.
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

    const getPanel = (): HTMLElement | null =>
      document.querySelector(".mob-sidebar-panel");
    const getBackdrop = (): HTMLElement | null =>
      document.querySelector(".mob-sidebar-backdrop");
    const getPill = (): HTMLElement | null =>
      document.querySelector(".mob-bottom-pill");

    const onStart = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const panel = getPanel();
      const panelWidth = panel?.getBoundingClientRect().width ?? 380;
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
      const panel = getPanel();
      const backdrop = getBackdrop();
      const h = handlers.current;
      const pw = state.current.panelWidth;

      // Disable transitions for smooth finger-following.
      if (panel) panel.style.transition = "none";
      if (backdrop) backdrop.style.transition = "none";

      if (h.open) {
        // Sidebar open — drag left to close.
        const offset = Math.min(0, dx);
        const progress = Math.max(0, 1 + offset / pw);
        if (panel) panel.style.transform = `translateX(${offset}px)`;
        if (backdrop) backdrop.style.opacity = String(progress);
      } else {
        // Sidebar closed — drag right to open (from the bottom pill).
        const offset = Math.max(0, Math.min(dx, pw));
        const progress = offset / pw;
        if (panel) {
          panel.style.transform = `translateX(${offset - pw}px)`;
          panel.style.opacity = "1";
        }
        if (backdrop) backdrop.style.opacity = String(progress);
      }
    };

    const finishDrag = (e: PointerEvent) => {
      const s = state.current.start;
      state.current.start = null;
      if (!s || e.pointerId !== s.id) return;
      if (!state.current.horizontal) return;

      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const h = handlers.current;
      const pw = state.current.panelWidth;

      const panel = getPanel();
      const backdrop = getBackdrop();

      // Re-enable transitions for the snap animation.
      if (panel) panel.style.transition = "";
      if (backdrop) backdrop.style.transition = "";

      if (state.current.dragging) {
        state.current.dragging = false;
        state.current.lastSwipe = Date.now();

        if (h.open) {
          if (dx < -THRESHOLD) {
            h.onClose();
            requestAnimationFrame(() => {
              if (panel) panel.style.transform = "";
              if (backdrop) backdrop.style.opacity = "";
            });
          } else {
            if (panel) panel.style.transform = "";
            if (backdrop) backdrop.style.opacity = "";
          }
        } else {
          if (dx > THRESHOLD) {
            h.onOpen();
            requestAnimationFrame(() => {
              if (panel) panel.style.transform = "";
              if (panel) panel.style.opacity = "";
              if (backdrop) backdrop.style.opacity = "";
            });
          } else {
            if (panel) {
              panel.style.transform = "";
              panel.style.opacity = "";
            }
            if (backdrop) backdrop.style.opacity = "";
          }
        }
      } else {
        if (panel) panel.style.transform = "";
        if (backdrop) backdrop.style.opacity = "";
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
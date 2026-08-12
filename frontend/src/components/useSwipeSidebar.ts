"use client";

import { useEffect, useRef } from "react";

type SwipeHandlers = {
  onOpen: () => void;
  onClose: () => void;
  open: boolean;
};

const EDGE = 32;
const THRESHOLD = 80;
const DRAG_X = 8;
const VERTICAL_LIMIT = 1.5;

// Drag-to-follow swipe for the mobile sidebar.
//
// Open:  touch starts within EDGE px of the left edge → the sidebar panel
//        follows the finger rightward. Release past THRESHOLD → open.
// Close: when the sidebar is open, any leftward drag on the backdrop/panel
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

    const edge = document.createElement("div");
    edge.style.cssText = `position:fixed;left:0;top:0;width:${EDGE}px;height:100%;z-index:5;touch-action:none;pointer-events:auto;`;
    document.body.appendChild(edge);

    const getPanel = (): HTMLElement | null =>
      document.querySelector(".mob-sidebar-panel");
    const getBackdrop = (): HTMLElement | null =>
      document.querySelector(".mob-sidebar-backdrop");

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

      // Begin dragging — disable transitions for smooth finger-following.
      state.current.dragging = true;
      const panel = getPanel();
      const backdrop = getBackdrop();

      // Block pointer events on the editor so ProseMirror doesn't interpret
      // the drag as a text selection (which would trigger a re-render and
      // clobber the transform).
      const editor = document.querySelector(".mob-editor-scroll");
      if (editor && !editor.getAttribute("data-swipe-active")) {
        editor.setAttribute("data-swipe-active", "1");
      }

      if (panel) panel.style.transition = "none";
      if (backdrop) backdrop.style.transition = "none";

      const h = handlers.current;
      const pw = state.current.panelWidth;

      if (h.open) {
        // Sidebar is open — drag left to close.
        const offset = Math.min(0, dx); // only allow leftward
        const progress = Math.max(0, 1 + offset / pw); // 1 → 0
        if (panel) panel.style.transform = `translateX(${offset}px)`;
        if (backdrop) backdrop.style.opacity = String(progress);
      } else {
        // Sidebar is closed — drag right to open.
        const offset = Math.max(0, Math.min(dx, pw)); // clamp 0..panelWidth
        const progress = offset / pw; // 0 → 1
        if (panel) {
          panel.style.transform = `translateX(${offset - pw}px)`;
          panel.style.opacity = "1";
        }
        if (backdrop) backdrop.style.opacity = String(progress);
      }
    };

    const onUp = (e: PointerEvent) => {
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

      // Restore editor pointer events.
      const editor = document.querySelector(".mob-editor-scroll");
      editor?.removeAttribute("data-swipe-active");

      if (state.current.dragging) {
        state.current.dragging = false;
        state.current.lastSwipe = Date.now();

        if (h.open) {
          // Sidebar open — close if dragged left past threshold.
          if (dx < -THRESHOLD) {
            h.onClose();
            // After React updates data-open to "0", the CSS transform
            // (translateX(-100%)) takes over. Clear the inline transform
            // in the next frame so there's no flicker.
            requestAnimationFrame(() => {
              if (panel) panel.style.transform = "";
              if (backdrop) backdrop.style.opacity = "";
            });
          } else {
            // not far enough — snap back open
            if (panel) panel.style.transform = "";
            if (backdrop) backdrop.style.opacity = "";
          }
        } else {
          // Sidebar closed — open if dragged right past threshold.
          if (dx > THRESHOLD) {
            h.onOpen();
            requestAnimationFrame(() => {
              if (panel) panel.style.transform = "";
              if (panel) panel.style.opacity = "";
              if (backdrop) backdrop.style.opacity = "";
            });
          } else {
            // snap back closed
            if (panel) {
              panel.style.transform = "";
              panel.style.opacity = "";
            }
            if (backdrop) backdrop.style.opacity = "";
          }
        }
      } else {
        // Horizontal but no drag happened (very small movement).
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

    const onEdgeDown = (e: PointerEvent) => onStart(e);
    const onDocDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!handlers.current.open) return;
      onStart(e);
    };

    edge.addEventListener("pointerdown", onEdgeDown, { passive: true });
    document.addEventListener("pointerdown", onDocDown, { passive: true });
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
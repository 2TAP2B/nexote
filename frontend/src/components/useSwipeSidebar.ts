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

// Drag-to-follow swipe for the mobile two-pane pager.
//
// The pager track ("double width canvas", .mob-pager) holds the sidebar pane
// (left) and the note-view pane (right), each one viewport wide. Focus is a
// translateX on the track:
//   sidebar focused → 0
//   editor focused  → -50% of the 200vw track (= -100vw)
//
// Open:  drag right on the bottom navigation pill → the track follows the
//        finger, pulling the sidebar pane into focus.
// Close: when the sidebar is focused, drag left anywhere on it → the track
//        slides back, bringing the note editor into focus.
//
// Drags write the transform straight to the DOM (transitions disabled); on
// release the inline style is cleared so the CSS rule + transition snap to
// whichever pane won. React owns the final position via data-sidebar-open.
export function useSwipeSidebar({ onOpen, onClose, open }: SwipeHandlers) {
  const handlers = useRef({ onOpen, onClose, open });
  handlers.current = { onOpen, onClose, open };
  const state = useRef({
    start: null as null | { x: number; y: number; id: number },
    horizontal: false,
    dragging: false,
    lastSwipe: 0,
  });

  useEffect(() => {
    const isTouch =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches ||
        "ontouchstart" in window);
    if (!isTouch) return;

    const getTrack = (): HTMLElement | null =>
      document.querySelector(".mob-pager");
    const getPill = (): HTMLElement | null =>
      document.querySelector(".mob-bottom-pill");

    const onStart = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      state.current.start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      state.current.horizontal = false;
      state.current.dragging = false;
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

      state.current.dragging = true;
      const track = getTrack();
      const h = handlers.current;
      // One pager pane is a full viewport wide (the track is 200vw).
      const paneW = window.innerWidth;

      // Disable transitions for smooth finger-following.
      if (track) track.style.transition = "none";

      // open: track rests at 0 (sidebar pane visible), drag left to reveal the
      // editor; closed: track rests at -100vw (editor visible), drag right to
      // pull the sidebar pane in.
      const x = Math.max(-paneW, Math.min(0, (h.open ? 0 : -paneW) + dx));
      if (track) track.style.transform = `translateX(${x}px)`;
    };

    const finishDrag = (e: PointerEvent) => {
      const s = state.current.start;
      state.current.start = null;
      if (!s || e.pointerId !== s.id) return;
      if (!state.current.horizontal) return;

      const dx = e.clientX - s.x;
      const h = handlers.current;
      const track = getTrack();

      // Re-enable transitions so the snap animation runs from the dragged
      // position to the focused pane's rest transform.
      if (track) track.style.transition = "";

      if (state.current.dragging) {
        state.current.dragging = false;
        state.current.lastSwipe = Date.now();

        if (h.open) {
          if (dx < -THRESHOLD) h.onClose();
        } else {
          if (dx > THRESHOLD) h.onOpen();
        }
      }

      // Clear the dragged transform → the CSS rule (data-sidebar-open) takes
      // back over and the transition snaps to the winning pane.
      if (track) track.style.transform = "";
    };

    // Swallows the click that would otherwise fire on the pill/tap right after
    // a swipe gesture (which would immediately re-toggle the pane).
    const onCaptureClick = (e: Event) => {
      if (Date.now() - state.current.lastSwipe < 400) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Open swipe starts on the pill; close swipe starts anywhere on the
    // sidebar (document-level, only listened to while the sidebar is focused).
    const onPillDown = (e: PointerEvent) => onStart(e);
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
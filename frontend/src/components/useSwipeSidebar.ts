"use client";

import { useEffect, useRef } from "react";

export type PagerFocus = "sidebar" | "editor" | "toc";

// Pane order in the 300vw mobile pager track: sidebar (0), editor (1), toc (2).
const PANES: readonly PagerFocus[] = ["sidebar", "editor", "toc"];
const PANE_COUNT = PANES.length;
const PANE_INDEX: Record<PagerFocus, number> = { sidebar: 0, editor: 1, toc: 2 };

type SwipeHandlers = {
  focus: PagerFocus;
  onFocus: (pane: PagerFocus) => void;
  // Also start a swipe anywhere inside the editor pane, not only on the pill.
  swipeFromContent?: boolean;
};

const THRESHOLD = 60;
const FLICK_THRESHOLD = 18;
const FLICK_VELOCITY = 0.6; // px/ms — a fast, deliberate flick wins without distance
const DRAG_X = 8;
const VERTICAL_LIMIT = 1.5;

// Drag-to-follow swipe for the mobile three-pane pager.
//
// The pager track ("triple width canvas", .mob-pager) holds the sidebar pane
// (left), the note-view pane (center) and the table-of-contents pane (right),
// each one viewport wide. Focus is a translateX on the track:
//   sidebar → 0
//   editor  → -100vw (one pane off the left)
//   toc     → -200vw (two panes off the left)
//
// Open:  drag right on the bottom navigation pill → the track follows the
//        finger, pulling the sidebar pane into focus.
// Open:  drag left on the pill (from the editor) → pulls the TOC pane in.
// Open:  with swipeFromContent, the same drags work anywhere inside the
//        pager track (editor text included), except on form fields,
//        [data-no-swipe] elements, horizontally scrollable content (code
//        blocks, tables, toolbars) and while text is selected.
// Close: when a side pane is focused, drag toward the editor anywhere on it
//        (left on the sidebar, right on the TOC) → the track slides back.
//
// Drags write the transform straight to the DOM (transitions disabled); on
// release the inline style is cleared so the CSS rule + transition snap to
// whichever pane won. React owns the final position via data-pager-focus.
export function useSwipeSidebar({ focus, onFocus, swipeFromContent = false }: SwipeHandlers) {
  const handlers = useRef({ focus, onFocus });
  handlers.current = { focus, onFocus };
  const state = useRef({
    start: null as null | { x: number; y: number; id: number; t: number },
    last: null as null | { x: number; t: number },
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
      state.current.start = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
      state.current.last = null;
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
      state.current.last = { x: e.clientX, t: performance.now() };
      const track = getTrack();
      const h = handlers.current;
      // One pager pane is a full viewport wide (the track is 300vw).
      const paneW = window.innerWidth;
      const base = -PANE_INDEX[h.focus] * paneW;

      // Disable transitions for smooth finger-following.
      if (track) track.style.transition = "none";

      // Track follows the finger, clamped to the track's own bounds.
      const x = Math.max(-(PANE_COUNT - 1) * paneW, Math.min(0, base + dx));
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

        // A quick flick snaps even a short drag home; deliberate slower drags
        // need the distance threshold. Either way the pane pans to the
        // neighbor in the dragged direction.
        const now = performance.now();
        const last = state.current.last;
        const dt = last ? now - last.t : 0;
        const vx = last && dt > 0 ? (e.clientX - last.x) / dt : 0;
        const threshold =
          Math.abs(vx) > FLICK_VELOCITY ? FLICK_THRESHOLD : THRESHOLD;

        const fi = PANE_INDEX[h.focus];
        const next =
          dx < -threshold && fi < PANE_COUNT - 1
            ? PANES[fi + 1]
            : dx > threshold && fi > 0
              ? PANES[fi - 1]
              : null;
        if (next) {
          // Leaving the editor mid-typing: drop focus so the on-screen
          // keyboard closes instead of covering the side pane.
          const active = document.activeElement;
          if (h.focus === "editor" && active instanceof HTMLElement && track?.contains(active)) {
            active.blur();
          }
          h.onFocus(next);
        }
      }

      // Clear the dragged transform → the CSS rule (data-pager-focus) takes
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

    // Whether a touch at target may begin a pager drag from the editor pane:
    // anything that needs horizontal touch input of its own keeps it. The
    // vertical note scroller computes overflow-x:auto too (overflow-y-auto
    // forces it), so only elements that overflow horizontally but not
    // vertically count as horizontal scrollers (code blocks, tables, chips).
    const canSwipeFromContent = (target: EventTarget | null): boolean => {
      const track = getTrack();
      if (!(target instanceof Element) || !track?.contains(target)) return false;
      if (target.closest("input, textarea, select, [data-no-swipe]")) return false;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return false;
      for (let el: Element | null = target; el && el !== track; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === "auto" || ox === "scroll") return false;
        }
      }
      return true;
    };

    // The pill starts an open/close swipe from the editor in either direction
    // (and, with swipeFromContent, so does the rest of the editor pane). A
    // document-level drag otherwise only initiates while a side pane is
    // focused, so it can slide back to the editor.
    const onPillDown = (e: PointerEvent) => onStart(e);
    const onDocDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (handlers.current.focus === "editor" && !(swipeFromContent && canSwipeFromContent(e.target))) return;
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
  }, [swipeFromContent]);
}
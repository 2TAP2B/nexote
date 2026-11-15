"use client";

import { useEffect, useRef } from "react";

import { haptic, isHapticClick } from "@/lib/haptics";

// "spaces" is the space switcher left of the note tree. "toc" is the
// right-hand pane: the table of contents for a note, quick capture on the
// dashboard.
export type PagerFocus = "spaces" | "sidebar" | "editor" | "toc";

// Pane order in the 400vw mobile pager track: spaces (0), sidebar (1),
// editor (2), toc (3).
const PANES: readonly PagerFocus[] = ["spaces", "sidebar", "editor", "toc"];
const PANE_COUNT = PANES.length;
const PANE_INDEX: Record<PagerFocus, number> = { spaces: 0, sidebar: 1, editor: 2, toc: 3 };

type SwipeHandlers = {
  focus: PagerFocus;
  onFocus: (pane: PagerFocus) => void;
  // Also start a swipe anywhere inside the editor pane, not only on the pill.
  swipeFromContent?: boolean;
};

const THRESHOLD_RATIO = 0.3; // drag past 30% of the pane width commits
const FLICK_VELOCITY = 0.35; // px/ms — a quick flick commits regardless of distance
const LOCK_DISTANCE = 10; // px of travel before deciding horizontal vs vertical
const EDGE_RESISTANCE = 0.25; // rubber-band factor past the first/last pane
const SNAP_MIN_MS = 160;
const SNAP_MAX_MS = 380;
const SNAP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// Drag-to-follow swipe for the mobile four-pane pager.
//
// The pager track (.mob-pager) holds the spaces pane, the sidebar pane (note
// tree), the note-view pane and the table-of-contents pane, each one viewport
// wide. Focus is a translateX on the track:
//   spaces  → 0
//   sidebar → -100vw
//   editor  → -200vw
//   toc     → -300vw
//
// From the editor: drag right → the note tree slides in, once more → the
// spaces; drag left → the TOC slides in. On the pill always; with
// swipeFromContent anywhere in the pager track (editor text included), except
// on form fields, [data-no-swipe] elements, horizontally scrollable content
// (code blocks, tables, toolbars) and while text is selected. From a side
// pane: drag either way anywhere on it.
//
// Touch events (not pointer events) drive it: the editor's vertical scroller
// would otherwise claim the gesture and fire pointercancel mid-drag. Once a
// drag locks horizontal, touchmove is preventDefault-ed so neither the page
// scroll nor the browser's back/forward swipe competes. The track follows the
// finger (rAF-batched, rubber-banded at the ends); on release it snaps with a
// duration derived from the finger's velocity, then hands the transform back
// to the CSS rule driven by data-pager-focus.
export function useSwipeSidebar({ focus, onFocus, swipeFromContent = false }: SwipeHandlers) {
  const handlers = useRef({ focus, onFocus });
  handlers.current = { focus, onFocus };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isTouch = window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;
    if (!isTouch) return;

    const getTrack = (): HTMLElement | null => document.querySelector(".mob-pager");

    type Drag = {
      id: number;
      x0: number;
      y0: number;
      mode: "pending" | "horizontal" | "ignored";
      dx: number;
      samples: { x: number; t: number }[];
      frame: number;
    };
    let drag: Drag | null = null;
    let lastSwipe = 0;

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

    const canStart = (target: EventTarget | null): boolean => {
      // Text fields keep their own gestures (caret drag, selection) in every
      // pane — e.g. the quick-capture composer.
      if (target instanceof Element && target.closest("input, textarea, select, [data-no-swipe]")) {
        return false;
      }
      if (handlers.current.focus !== "editor") return true;
      if (target instanceof Element && target.closest(".mob-bottom-pill")) return true;
      return swipeFromContent && canSwipeFromContent(target);
    };

    const paneWidth = () => window.innerWidth;

    const applyTransform = () => {
      if (!drag) return;
      drag.frame = 0;
      const track = getTrack();
      if (!track) return;
      const w = paneWidth();
      const min = -(PANE_COUNT - 1) * w;
      let x = -PANE_INDEX[handlers.current.focus] * w + drag.dx;
      if (x > 0) x *= EDGE_RESISTANCE;
      else if (x < min) x = min + (x - min) * EDGE_RESISTANCE;
      track.style.transform = `translate3d(${x}px, 0, 0)`;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        drag = null;
        return;
      }
      const t = e.touches[0];
      if (!canStart(e.target)) return;
      drag = {
        id: t.identifier,
        x0: t.clientX,
        y0: t.clientY,
        mode: "pending",
        dx: 0,
        samples: [{ x: t.clientX, t: e.timeStamp }],
        frame: 0,
      };
    };

    const onMove = (e: TouchEvent) => {
      if (!drag || drag.mode === "ignored") return;
      const t = Array.from(e.changedTouches).find((c) => c.identifier === drag!.id);
      if (!t) return;
      const dx = t.clientX - drag.x0;
      const dy = t.clientY - drag.y0;

      if (drag.mode === "pending") {
        if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) {
          // Chrome commits to a native scroll on the first uncancelled move;
          // later touchmoves then arrive non-cancelable and the pager would
          // slide while the page scrolls. Claim horizontal-leaning moves now.
          if (Math.abs(dx) > Math.abs(dy) && e.cancelable) e.preventDefault();
          return;
        }
        const sel = window.getSelection();
        if (Math.abs(dx) <= Math.abs(dy) * 1.2 || (sel && !sel.isCollapsed)) {
          drag.mode = "ignored"; // vertical scroll or text selection: hands off
          return;
        }
        drag.mode = "horizontal";
        // Start the follow from the lock point so the track doesn't jump.
        drag.x0 += Math.sign(dx) * LOCK_DISTANCE;
        const track = getTrack();
        if (track) track.style.transition = "none";
      }

      if (e.cancelable) e.preventDefault();
      drag.dx = t.clientX - drag.x0;
      drag.samples.push({ x: t.clientX, t: e.timeStamp });
      if (drag.samples.length > 6) drag.samples.shift();
      if (!drag.frame) drag.frame = requestAnimationFrame(applyTransform);
    };

    const onEnd = (e: TouchEvent) => {
      const d = drag;
      if (!d) return;
      const t = Array.from(e.changedTouches).find((c) => c.identifier === d.id);
      if (!t) return;
      drag = null;
      if (d.frame) cancelAnimationFrame(d.frame);
      if (d.mode !== "horizontal") return;
      lastSwipe = Date.now();

      // Velocity over the last ~100ms of samples (px/ms, + = rightwards).
      const now = e.timeStamp;
      const recent = d.samples.filter((s) => now - s.t < 100);
      const first = recent[0] ?? d.samples[0];
      const dt = now - first.t;
      const vx = dt > 0 ? (t.clientX - first.x) / dt : 0;

      const h = handlers.current;
      const w = paneWidth();
      const fi = PANE_INDEX[h.focus];
      const dx = t.clientX - d.x0;
      let next = fi;
      if (e.type === "touchend") {
        const flick = Math.abs(vx) > FLICK_VELOCITY && Math.sign(vx) === Math.sign(dx);
        if (flick || Math.abs(dx) > w * THRESHOLD_RATIO) next = dx < 0 ? fi + 1 : fi - 1;
        next = Math.max(0, Math.min(PANE_COUNT - 1, next));
      }

      // Snap from wherever the finger left the track: faster flicks finish
      // faster, so the motion continues the gesture instead of restarting.
      // The snap animates to an explicit target; once it lands, the inline
      // style is dropped and the data-pager-focus CSS rule (same position)
      // takes over without a visible jump.
      const track = getTrack();
      if (track) {
        const current = -fi * w + dx;
        const target = -next * w;
        const remaining = Math.abs(target - current);
        const ms = Math.round(
          Math.max(SNAP_MIN_MS, Math.min(SNAP_MAX_MS, Math.abs(vx) > 0.05 ? remaining / Math.abs(vx) : SNAP_MAX_MS)),
        );
        track.style.transition = `transform ${ms}ms ${SNAP_EASING}`;
        track.style.transform = `translate3d(${target}px, 0, 0)`;
        let done = false;
        const reset = () => {
          if (done) return;
          done = true;
          track.removeEventListener("transitionend", reset);
          // A new drag may own the track by now; leave its styles alone.
          if (drag?.mode === "horizontal") return;
          track.style.transition = "none";
          track.style.transform = "";
          void track.offsetWidth; // commit the rule-driven position before re-enabling transitions
          track.style.transition = "";
        };
        track.addEventListener("transitionend", reset);
        window.setTimeout(reset, ms + 60);
      }

      if (next !== fi) {
        // Leaving the editor mid-typing: drop focus so the on-screen keyboard
        // closes instead of covering the side pane.
        const active = document.activeElement;
        if (h.focus === "editor" && active instanceof HTMLElement && track?.contains(active)) {
          active.blur();
        }
        h.onFocus(PANES[next]);
        haptic();
      }
    };

    // Swallows the click that would otherwise fire on the pill/tap right after
    // a swipe gesture (which would immediately re-toggle the pane).
    const onCaptureClick = (e: Event) => {
      if (Date.now() - lastSwipe < 400 && !isHapticClick(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    // Non-passive: a locked horizontal drag must be able to cancel scrolling.
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    document.addEventListener("click", onCaptureClick, true);

    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      document.removeEventListener("click", onCaptureClick, true);
    };
  }, [swipeFromContent]);
}

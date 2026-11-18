"use client";

import { useEffect, useRef, type RefObject } from "react";

import { haptic } from "@/lib/haptics";

// Swipe right on a full-screen overlay (the phone's thread view) to close it,
// like iOS "back": the overlay follows the finger; letting go past 30% of the
// width or with a quick flick slides it out, else it snaps back. Leftward
// drags stay with useSwipeAction (swipe a reply), vertical ones with
// scrolling; text fields and horizontal scrollers keep their own gestures.
// The overlay root carries data-no-swipe, so the pager underneath (listening
// on the document) leaves its touches alone and the hidden panes stay put.
// Events still bubble: React (listening on the portal's container) needs them.

const THRESHOLD_RATIO = 0.3;
const FLICK_VELOCITY = 0.35; // px/ms
const LOCK_PX = 10;
const SNAP_MIN_MS = 160;
const SNAP_MAX_MS = 320;
const SNAP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// Whether a touch at `target` may start the swipe: not in a field (the
// composer), not in something scrolling sideways (tag chips, code), not while
// text is selected. The root's own data-no-swipe is meant for the pager.
function canStart(root: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !root.contains(target)) return false;
  if (target.closest("input, textarea, select, [contenteditable]")) return false;
  const opted = target.closest("[data-no-swipe]");
  if (opted && opted !== root) return false;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return false;
  // A vertical scroller computes overflow-x:auto too: only elements that
  // overflow sideways but not vertically scroll sideways.
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return false;
    }
  }
  return true;
}

export function useSwipeToClose<T extends HTMLElement>(ref: RefObject<T | null>, onClose: () => void, enabled = true) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    type Drag = {
      id: number;
      x0: number;
      y0: number;
      mode: "pending" | "swipe" | "ignored";
      dx: number;
      samples: { x: number; t: number }[];
      frame: number;
    };
    let drag: Drag | null = null;
    let closing = false;
    let lastSwipe = 0;

    const paint = () => {
      if (!drag) return;
      drag.frame = 0;
      el.style.transform = `translate3d(${drag.dx}px, 0, 0)`;
    };

    const onStart = (e: TouchEvent) => {
      if (closing || e.touches.length !== 1 || !canStart(el, e.target)) {
        drag = null;
        return;
      }
      const t = e.touches[0];
      drag = { id: t.identifier, x0: t.clientX, y0: t.clientY, mode: "pending", dx: 0, samples: [{ x: t.clientX, t: e.timeStamp }], frame: 0 };
    };

    const onMove = (e: TouchEvent) => {
      if (!drag || drag.mode === "ignored") return;
      const t = Array.from(e.changedTouches).find((c) => c.identifier === drag!.id);
      if (!t) return;
      const mx = t.clientX - drag.x0;
      const my = t.clientY - drag.y0;
      if (drag.mode === "pending") {
        if (Math.abs(mx) < LOCK_PX && Math.abs(my) < LOCK_PX) {
          // Chrome commits to a native scroll on the first uncancelled move:
          // claim rightward-leaning moves now (as the pager does).
          if (mx > 0 && Math.abs(mx) > Math.abs(my) && e.cancelable) e.preventDefault();
          return;
        }
        if (mx <= 0 || Math.abs(mx) <= Math.abs(my) * 1.2) {
          drag.mode = "ignored";
          return;
        }
        drag.mode = "swipe";
        // Follow from the lock point so the overlay doesn't jump.
        drag.x0 += LOCK_PX;
        el.style.transition = "none";
        el.style.willChange = "transform";
      }
      if (e.cancelable) e.preventDefault();
      drag.dx = Math.max(0, t.clientX - drag.x0);
      drag.samples.push({ x: t.clientX, t: e.timeStamp });
      if (drag.samples.length > 6) drag.samples.shift();
      if (!drag.frame) drag.frame = requestAnimationFrame(paint);
    };

    const onEnd = (e: TouchEvent) => {
      const d = drag;
      if (!d) return;
      const t = Array.from(e.changedTouches).find((c) => c.identifier === d.id);
      if (!t) return;
      drag = null;
      if (d.frame) cancelAnimationFrame(d.frame);
      if (d.mode !== "swipe") return;
      lastSwipe = Date.now();

      // Velocity over the last ~100ms (px/ms, + = rightwards).
      const recent = d.samples.filter((s) => e.timeStamp - s.t < 100);
      const first = recent[0] ?? d.samples[0];
      const dt = e.timeStamp - first.t;
      const vx = dt > 0 ? (t.clientX - first.x) / dt : 0;
      const w = el.clientWidth || window.innerWidth;
      const dx = Math.max(0, t.clientX - d.x0);
      const commit = e.type === "touchend" && (vx > FLICK_VELOCITY || dx > w * THRESHOLD_RATIO);

      const target = commit ? w : 0;
      const remaining = Math.abs(target - dx);
      const ms = Math.round(
        Math.max(SNAP_MIN_MS, Math.min(SNAP_MAX_MS, Math.abs(vx) > 0.05 ? remaining / Math.abs(vx) : SNAP_MAX_MS)),
      );
      el.style.transition = `transform ${ms}ms ${SNAP_EASING}`;
      el.style.transform = `translate3d(${target}px, 0, 0)`;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener("transitionend", finish);
        if (commit) {
          // The overlay unmounts; its styles go with it.
          close.current();
          return;
        }
        el.style.transition = "";
        el.style.transform = "";
        el.style.willChange = "";
      };
      el.addEventListener("transitionend", finish);
      window.setTimeout(finish, ms + 60);
      if (commit) {
        closing = true;
        haptic();
      }
    };

    // The tap a drag ended on (a post, a button) must not fire after it.
    const onClick = (e: Event) => {
      if (Date.now() - lastSwipe < 400) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("click", onClick, true);
      if (drag?.frame) cancelAnimationFrame(drag.frame);
    };
  }, [ref, enabled]);
}

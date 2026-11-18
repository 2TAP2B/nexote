"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { haptic } from "@/lib/haptics";

// Swipe left on an element (a memo, a thread post) to run an action, like
// "reply" in a messenger. Only leftward drags are claimed: a rightward one
// stays with the pager (swipe back to the dashboard). Touch only.

const LOCK_PX = 10;
/** How far to drag before letting go runs the action. */
export const SWIPE_TRIGGER_PX = 72;
const MAX_PX = 110;

export function useSwipeAction<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onSwipe: (() => void) | undefined,
): { offset: number; armed: boolean } {
  const [offset, setOffset] = useState(0);
  const action = useRef(onSwipe);
  action.current = onSwipe;
  const enabled = Boolean(onSwipe);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; id: number } | null = null;
    let mode: "pending" | "swipe" | "ignored" = "pending";
    let dx = 0;
    let armed = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        start = null;
        return;
      }
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, id: t.identifier };
      mode = "pending";
      dx = 0;
      armed = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || mode === "ignored") return;
      const t = Array.from(e.changedTouches).find((c) => c.identifier === start!.id);
      if (!t) return;
      const mx = t.clientX - start.x;
      const my = t.clientY - start.y;
      if (mode === "pending") {
        if (Math.abs(mx) < LOCK_PX && Math.abs(my) < LOCK_PX) return;
        // Leftward and mostly horizontal: ours. Anything else: hands off.
        if (mx >= 0 || Math.abs(mx) <= Math.abs(my) * 1.2) {
          mode = "ignored";
          return;
        }
        mode = "swipe";
      }
      // Keep the pager (document listener) and native scrolling out of it.
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      dx = Math.max(-MAX_PX, Math.min(0, mx + LOCK_PX));
      const nowArmed = dx <= -SWIPE_TRIGGER_PX;
      if (nowArmed && !armed) haptic();
      armed = nowArmed;
      setOffset(dx);
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const t = Array.from(e.changedTouches).find((c) => c.identifier === start!.id);
      if (!t) return;
      const ran = mode === "swipe" && armed && e.type === "touchend";
      if (mode === "swipe") e.stopPropagation();
      start = null;
      mode = "pending";
      setOffset(0);
      if (ran) action.current?.();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, enabled]);

  return { offset, armed: offset <= -SWIPE_TRIGGER_PX };
}

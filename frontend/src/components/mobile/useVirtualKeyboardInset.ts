"use client";

import { useEffect, useState } from "react";

export type VisualViewportState = {
  /** offsetTop + height — the bottom edge of the visible area in viewport px. */
  bottom: number;
  /** offsetTop — the top edge of the visible area (0 unless the page is scrolled). */
  top: number;
  /** Height of the visible area. Shrinks when the touch keyboard opens. */
  height: number;
  /** Pixels of the shell hidden behind the keyboard (innerHeight - height). */
  inset: number;
  /** Whether the on-screen keyboard is currently open. */
  isKeyboardOpen: boolean;
};

function readVisualViewport(): VisualViewportState {
  const vv = window.visualViewport;
  const innerH = window.innerHeight;
  const height = vv ? vv.height : innerH;
  const top = vv ? vv.offsetTop : 0;
  const overlay = Math.max(0, innerH - height);

  // Android Chrome resizes the layout viewport when the keyboard opens, so
  // visualViewport.height === innerHeight and the overlay is ~0. Detect that
  // case by comparing the full screen height against the (shrunk) layout
  // height. Only trust it on touch devices (desktop windows are often shorter
  // than screen.height without any keyboard).
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const shrunk = coarse && (window.screen?.height ?? 0) - innerH > 150;

  return {
    bottom: top + height,
    top,
    height,
    inset: overlay,
    isKeyboardOpen: overlay > 80 || shrunk,
  };
}

// Live readout of the visual viewport. Fixed-position elements are anchored to
// the layout viewport, not the visual one, so overlays pinned above the touch
// keyboard must compute their own offset from this each time it changes.
//
// The initial state is identical on the server and the client (keyboard
// closed) so SSR hydration matches; the real value is read in the mount effect.
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>({
    bottom: 0,
    top: 0,
    height: 0,
    inset: 0,
    isKeyboardOpen: false,
  });

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setState(readVisualViewport());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    update();

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
    };
  }, []);

  return state;
}

// Returns the number of pixels of the shell hidden behind the on-screen touch
// keyboard. The visualViewport API is used: when the keyboard opens it shows a
// smaller "visual" viewport while window.innerHeight may stay unchanged
// (iOS/Safari), so the difference is the keyboard height. On browsers that
// already resize the layout viewport (Android Chrome) the difference is ~0
// and no extra insetting is needed.
export function useVirtualKeyboardInset(): number {
  return useVisualViewport().inset;
}
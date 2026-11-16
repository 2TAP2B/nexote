"use client";

import { useEffect, useRef, useState } from "react";

const DELTA_PX = 8;
const TOP_PX = 40;

// Whether the note chrome (top bar buttons, bottom pill, format bar) should
// show: hides on scroll-down in the note editor (`.mob-editor-scroll`),
// reappears on scroll-up or near the top — the Obsidian mobile pattern.
// Listens at the document (scroll events don't bubble, but capture), so it
// follows whichever editor scroller is mounted. A new resetKey (the open
// note) shows the chrome again.
export function useScrollHideChrome(resetKey?: string): boolean {
  const [visible, setVisible] = useState(true);
  const last = useRef<{ el: EventTarget | null; y: number }>({ el: null, y: 0 });

  useEffect(() => {
    setVisible(true);
    last.current = { el: null, y: 0 };
  }, [resetKey]);

  useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains("mob-editor-scroll")) return;
      const y = el.scrollTop;
      if (last.current.el !== el) last.current = { el, y };
      const delta = y - last.current.y;
      if (delta > DELTA_PX && y > TOP_PX) setVisible(false);
      else if (delta < -DELTA_PX || y <= TOP_PX) setVisible(true);
      if (Math.abs(delta) > DELTA_PX || y <= TOP_PX) last.current.y = y;
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  return visible;
}

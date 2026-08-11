"use client";

import { useEffect, useRef, useState } from "react";

// Tracks scroll on the mobile editor container (`.mob-editor-scroll`) and
// reports whether the chrome (top bar / bottom pill) should be visible.
// Hides on scroll-down past a threshold, reappears on scroll-up or at the top.
// Standard mobile "hide on scroll" pattern.
export function useScrollHideChrome(): boolean {
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    let el: HTMLElement | null = null;
    const onScroll = () => {
      if (!el) return;
      const y = el.scrollTop;
      const delta = y - lastScrollY.current;
      if (delta > 8 && y > 40) {
        setVisible(false);
      } else if (delta < -8 || y <= 40) {
        setVisible(true);
      }
      lastScrollY.current = y;
    };

    const attach = () => {
      el = document.querySelector<HTMLElement>(".mob-editor-scroll");
      if (el) {
        el.addEventListener("scroll", onScroll, { passive: true });
        return true;
      }
      return false;
    };

    if (!attach()) {
      const obs = new MutationObserver(() => {
        if (attach()) obs.disconnect();
      });
      obs.observe(document.body, { childList: true, subtree: true });
      return () => {
        obs.disconnect();
        el?.removeEventListener("scroll", onScroll);
      };
    }
    return () => {
      el?.removeEventListener("scroll", onScroll);
    };
  }, []);

  return visible;
}
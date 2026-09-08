"use client";

import { useEffect, useState } from "react";

import type { TocHeading } from "@/components/MilkdownEditor";

// Tracks which heading is currently in view inside a scroll container.
//
// Queries only the ProseMirror editor DOM (scoped to `.ProseMirror` via
// headingSelector), so note headers / collection-item headers rendered above
// the editor never pollute the heading list. The active heading is the last
// one whose top has risen above the reading offset in the scroller. Layout
// reads are rAF-throttled — once per frame at most.
export function useTocScrollSpy({
  containerSelector,
  enabled,
  headingSelector,
  headings,
  offset = 96,
}: {
  containerSelector: string;
  enabled: boolean;
  headingSelector: string;
  headings: TocHeading[];
  offset?: number;
}): number {
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!enabled) return;
    const scroller = document.querySelector<HTMLElement>(containerSelector);
    if (!scroller) return;

    const compute = () => {
      const items = scroller.querySelectorAll<HTMLElement>(headingSelector);
      const scrollerTop = scroller.getBoundingClientRect().top;
      let index = -1;
      for (let i = 0; i < items.length; i++) {
        if (items[i].getBoundingClientRect().top - scrollerTop <= offset) index = i;
        else break;
      }
      setActiveIndex((prev) => (prev === index ? prev : index));
    };

    compute();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [containerSelector, enabled, headingSelector, headings, offset]);

  return activeIndex;
}
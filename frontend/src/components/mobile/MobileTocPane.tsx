"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import TocList, { TOC_HEADING_SELECTOR } from "@/components/TocList";
import { useTocHeadings } from "@/components/useTocHeadings";
import { useTocScrollSpy } from "@/components/useTocScrollSpy";

type Props = {
  noteId: string;
  focused: boolean;
  onClose: () => void;
};

// Full-viewport pager pane showing the active note's outline, styled like the
// sidebar pane (round X top-left + label header, --mob-* tokens). The editor
// always broadcasts its headings; this pane just mirrors them and pans back
// to the editor when a heading is tapped. A tap jumps via nexote:toc-jump
// (handled by the Milkdown editor) then returns focus to the editor pane.
export default function MobileTocPane({ noteId, focused, onClose }: Props) {
  const { headings, request } = useTocHeadings(noteId);

  // Re-ask the editor whenever the pane gains focus or the active note
  // changes, so the outline is never stale (and clears cleanly when there is
  // no editor — dashboard, raw mode).
  const prevFocused = useRef(focused);
  useEffect(() => {
    if (focused && !prevFocused.current) request();
    prevFocused.current = focused;
  }, [focused, request]);
  useEffect(() => {
    request();
  }, [request, noteId]);

  const activeIndex = useTocScrollSpy({
    containerSelector: ".mob-editor-scroll",
    headingSelector: TOC_HEADING_SELECTOR,
    headings,
    enabled: focused,
    offset: 96,
  });

  const select = (index: number) => {
    window.dispatchEvent(new CustomEvent("nexote:toc-jump", { detail: { index } }));
    onClose();
  };

  return (
    <div
      className="relative flex h-full w-1/3 shrink-0 flex-col overflow-hidden"
      style={{
        background: "var(--mob-bg)",
        borderLeft: "1px solid var(--mob-surface)",
        // Keep horizontal drags on this pane (the swipe-back to the editor)
        // in JS hands — the scrollable list must never claim them.
        touchAction: "pan-y",
      }}
    >
      {/* Header — the close X mirrors the sidebar pane's top-left button. */}
      <div
        className="flex shrink-0 items-center gap-3 px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: 8,
          borderBottom: "1px solid var(--mob-surface)",
        }}
      >
        <button
          type="button"
          aria-label="Close contents"
          onClick={onClose}
          className="flex items-center justify-center rounded-full transition-transform active:scale-95"
          style={{
            width: 40,
            height: 40,
            background: "var(--mob-surface)",
            color: "var(--mob-text)",
          }}
        >
          <X size={20} />
        </button>
        <span className="text-lg font-semibold" style={{ color: "var(--mob-text)" }}>
          Contents
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <TocList
          variant="mobile"
          headings={headings}
          activeIndex={activeIndex}
          onSelect={select}
        />
      </div>
    </div>
  );
}
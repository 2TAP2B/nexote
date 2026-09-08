"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TocHeading } from "@/components/MilkdownEditor";

// Mirrors the Milkdown editor's top-level heading list (see the
// nexote-headings-watch plugin in MilkdownEditor.tsx) into a pane/panel.
//
// The editor broadcasts { noteId, headings } so a consumer with a different
// note id ignores it (avoids showing the previous note's outline while the
// editor remounts). `request()` clears then re-asks the editor — which always
// re-broadcasts its current list when mounted, so if nothing arrives the
// consumer can safely show its empty state (raw mode, dashboard, no editor).
export function useTocHeadings(
  noteId: string,
  enabled = true,
): { headings: TocHeading[]; request: () => void; clear: () => void } {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;

  const clear = useCallback(() => setHeadings([]), []);

  const request = useCallback(() => {
    setHeadings([]);
    window.dispatchEvent(new CustomEvent("nexote:toc-request"));
  }, []);

  useEffect(() => {
    if (!enabled) {
      clear();
      return;
    }
    const onHeadings = (e: Event) => {
      const detail = (e as CustomEvent<{ noteId?: string; headings?: TocHeading[] }>).detail;
      if (!detail || detail.noteId !== noteIdRef.current) return;
      setHeadings(detail.headings ?? []);
    };
    // Raw markdown mode unmounts the editor (no broadcast arrives), so the
    // parent dispatches this to drop the stale outline.
    const onClear = () => clear();
    window.addEventListener("nexote:headings", onHeadings);
    window.addEventListener("nexote:toc-clear", onClear);
    return () => {
      window.removeEventListener("nexote:headings", onHeadings);
      window.removeEventListener("nexote:toc-clear", onClear);
    };
  }, [enabled, clear]);

  return { headings, request, clear };
}
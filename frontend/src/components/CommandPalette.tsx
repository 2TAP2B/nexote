"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

// A fuzzy-ish command palette: filters notes by title (case-insensitive
// substring, ranked by recency). Opens the chosen note as a tab. Triggered
// by Cmd/Ctrl+P (wired in Shortcuts).
export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { notes, openTab } = useNotes();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset query + focus when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      // Focus on next tick so the input is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Esc closes; handled here too in case focus is inside the input.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? notes.filter((n) => n.title.toLowerCase().includes(q))
      : notes;
    // newest first (notes is already sorted by updatedAt desc, but be safe)
    return [...base].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [notes, query]);

  // Clamp the active index when results change.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const choose = (id: string) => {
    void openTab(id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[index];
      if (r) choose(r.id);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[15vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to note…"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            Esc
          </kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              No notes found.
            </li>
          ) : (
            results.map((n, i) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => choose(n.id)}
                  onMouseEnter={() => setIndex(i)}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                    i === index
                      ? "bg-primary/15 text-foreground"
                      : "text-foreground/80 hover:bg-muted",
                  ].join(" ")}
                >
                  <span className="truncate">{n.title || "Untitled"}</span>
                  {n.path && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {n.path}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
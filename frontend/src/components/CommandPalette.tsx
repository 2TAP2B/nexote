"use client";

import { FilePlus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

type Item =
  | { kind: "note"; id: string; title: string; path?: string }
  | { kind: "daily"; label: string }
  | { kind: "create"; label: string; title: string };

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { notes, openTab, create, openDaily } = useNotes();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: Item[] = [];

    if (q && q.startsWith("daily")) {
      items.push({ kind: "daily", label: `Open daily note` });
    }

    const matched = q
      ? notes.filter((n) => n.title.toLowerCase().includes(q))
      : notes;
    const sorted = [...matched].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    for (const n of sorted) {
      items.push({ kind: "note", id: n.id, title: n.title, path: n.path });
    }

    if (q) {
      items.push({ kind: "create", label: `Create note "${query.trim()}"`, title: query.trim() });
    }

    return items;
  }, [notes, query]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const execute = (item: Item) => {
    switch (item.kind) {
      case "note":
        void openTab(item.id);
        break;
      case "daily":
        void openDaily();
        break;
      case "create":
        void create({ title: item.title });
        break;
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[index];
      if (item) execute(item);
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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
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
          {items.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              No notes found.
            </li>
          ) : (
            items.map((item, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => execute(item)}
                  onMouseEnter={() => setIndex(i)}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                    i === index
                      ? "bg-primary/15 text-foreground"
                      : "text-foreground/80 hover:bg-muted",
                  ].join(" ")}
                >
                  {item.kind === "daily" && <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  {item.kind === "create" && <FilePlus className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{item.kind === "note" ? (item.title || "Untitled") : (item as { label: string }).label}</span>
                  {item.kind === "note" && item.path && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {item.path}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {item.kind === "daily" && "Jump"}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
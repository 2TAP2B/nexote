"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { useNotes } from "@/lib/notes-context";

// Sidebar search view: a full-height search box plus a flat results list.
// Triggered from the Ribbon's search icon.
export default function SearchView() {
  const { notes, activeId, openTab } = useNotes();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(q));
  }, [notes, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-2">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Search
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full rounded-xl border border-input bg-background py-2 pl-8 pr-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {results.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {notes.length === 0 ? "No notes yet." : "No matches."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {results.map((n) => {
              const active = n.id === activeId;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void openTab(n.id)}
                    className={[
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                      active
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
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
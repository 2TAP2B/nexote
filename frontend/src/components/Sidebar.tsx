"use client";

import { useNotes } from "@/lib/notes-context";

import ThemeToggle from "./ThemeToggle";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Sidebar() {
  const { notes, selectedId, select, create, remove, creating, loading } =
    useNotes();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-muted/30">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-semibold tracking-wide text-foreground">
          Nexote
        </h1>
        <ThemeToggle />
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => create()}
          disabled={creating}
          className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "New note"}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {loading ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            No notes yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {notes.map((note) => {
              const active = note.id === selectedId;
              return (
                <li key={note.id}>
                  <div
                    className={[
                      "group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer",
                      active
                        ? "bg-primary/15 text-foreground"
                        : "text-foreground/80 hover:bg-muted",
                    ].join(" ")}
                    onClick={() => select(note.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {note.title || "Untitled"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(note.updatedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Delete note"
                      title="Delete note"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(note.id);
                      }}
                      className="invisible shrink-0 rounded px-1 text-muted-foreground hover:text-foreground group-hover:visible"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
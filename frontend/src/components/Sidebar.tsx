"use client";

import { FileText, PanelLeftClose, PanelLeftOpen, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useNotes } from "@/lib/notes-context";

import DeleteConfirm from "./DeleteConfirm";
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

type SidebarProps = {
  mobileOpen: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export default function Sidebar({
  mobileOpen,
  onClose,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const { notes, selectedId, select, create, remove, creating, loading } =
    useNotes();
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Client-side filter by title (case-insensitive). Body search would require
  // either loading all bodies or a backend endpoint; title filter is the
  // cheap, responsive v0.0.2 scope.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(q));
  }, [notes, query]);

  const handleSelect = (id: string) => {
    select(id);
    onClose();
  };

  const handleCreate = () => {
    void create();
    onClose();
  };

  return (
    <aside
      className={[
        "flex h-full shrink-0 flex-col border-r border-border bg-muted/40 backdrop-blur transition-[width] duration-200",
        // width: collapsed rail on desktop, full on mobile
        collapsed ? "md:w-16 w-64" : "w-64",
        // mobile: slide-in overlay; desktop: static column
        "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-xl max-md:transition-transform max-md:duration-200",
        mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        "md:static md:translate-x-0",
      ].join(" ")}
    >
      <div
        className={[
          "flex items-center px-3 py-3",
          collapsed ? "md:justify-center md:px-2" : "justify-between",
        ].join(" ")}
      >
        <h1
          className={[
            "text-sm font-semibold tracking-wide text-foreground",
            collapsed ? "md:hidden" : "",
          ].join(" ")}
        >
          Nexote
        </h1>
        <div
          className={[
            "flex items-center gap-1",
            collapsed ? "md:flex-col md:gap-2" : "",
          ].join(" ")}
        >
          <ThemeToggle />
          {/* Collapse toggle — desktop only */}
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className={collapsed ? "md:px-2 md:pb-3 px-3 pb-3" : "px-3 pb-3"}>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          title="New note"
          className={[
            "inline-flex items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 disabled:opacity-50",
            collapsed
              ? "md:h-10 md:w-10 md:p-0 w-full px-3 py-2"
              : "w-full px-3 py-2",
          ].join(" ")}
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="text-sm">{creating ? "Creating…" : "New note"}</span>}
        </button>
      </div>

      {/* Search + list are hidden when collapsed on desktop. */}
      <div className={collapsed ? "md:hidden px-3 pb-3" : "px-3 pb-3"}>
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

      <nav
        className={[
          "flex-1 overflow-y-auto px-2 py-1",
          collapsed ? "md:hidden" : "",
        ].join(" ")}
      >
        {loading ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {notes.length === 0 ? "No notes yet." : "No matches."}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((note) => {
              const active = note.id === selectedId;
              return (
                <li key={note.id}>
                  <div
                    className={[
                      "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 cursor-pointer transition-colors",
                      active
                        ? "bg-primary/15 text-foreground"
                        : "text-foreground/80 hover:bg-muted",
                    ].join(" ")}
                    onClick={() => handleSelect(note.id)}
                  >
                    <FileText
                      className={[
                        "h-4 w-4 shrink-0",
                        active ? "text-primary" : "text-muted-foreground",
                      ].join(" ")}
                    />
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
                        setPendingDelete(note.id);
                      }}
                      className="invisible shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 group-hover:visible"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <DeleteConfirm
        open={pendingDelete !== null}
        noteId={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async (id) => {
          setPendingDelete(null);
          await remove(id);
        }}
      />
    </aside>
  );
}
"use client";

import {
  Bookmark,
  Database,
  FilePlus,
  Keyboard,
  LayoutDashboard,
  PanelLeftClose,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
};

type Item =
  | { kind: "command"; cmd: Command }
  | { kind: "note"; id: string; title: string; path?: string }
  | { kind: "create"; label: string; title: string }
  | { kind: "vault"; id: string; name: string };

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { notes, openTab, create, openDaily, vaults, switchVault, activeVault } = useNotes();
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
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: "new-note",
        label: "Create new note",
        hint: "Ctrl+Shift+N",
        icon: <FilePlus className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () => void create(),
      },
      {
        id: "daily",
        label: "Open today's daily note",
        hint: "Ctrl+D",
        icon: <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () => void openDaily(),
      },
      {
        id: "dashboard",
        label: "Open dashboard",
        hint: "Ctrl+Shift+D",
        icon: (
          <LayoutDashboard className="h-4 w-4 shrink-0 text-muted-foreground" />
        ),
        run: () => void openTab(DASHBOARD_ID),
      },
      {
        id: "toggle-sidebar",
        label: "Toggle sidebar",
        hint: "Ctrl+B",
        icon: (
          <PanelLeftClose className="h-4 w-4 shrink-0 text-muted-foreground" />
        ),
        run: () =>
          window.dispatchEvent(new CustomEvent("nexote:toggle-sidebar")),
      },
      {
        id: "search",
        label: "Search notes",
        hint: "Ctrl+P",
        icon: <Search className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () => {},
      },
      {
        id: "bookmarks",
        label: "Bookmarks",
        icon: <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () => {},
      },
      {
        id: "theme",
        label: "Toggle theme",
        icon: <Sun className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () => {
          const isDark = document.documentElement.classList.contains("dark");
          document.documentElement.classList.toggle("dark", !isDark);
        },
      },
    ],
    [create, openDaily, openTab],
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: Item[] = [];

    // Always show commands first (filtered by query)
    const matchedCmds = q
      ? commands.filter((c) => c.label.toLowerCase().includes(q))
      : commands;
    for (const cmd of matchedCmds) {
      result.push({ kind: "command", cmd });
    }

    // Then vaults (if query matches or empty)
    const matchedVaults = q
      ? vaults.filter((v) => v.name.toLowerCase().includes(q))
      : vaults;
    for (const v of matchedVaults) {
      if (v.id !== activeVault?.id) {
        result.push({ kind: "vault", id: v.id, name: v.name });
      }
    }

    // Then notes
    const matched = q
      ? notes.filter((n) => n.title.toLowerCase().includes(q))
      : notes;
    const sorted = [...matched].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    // If empty query, limit notes to 8 so commands are visible
    const noteLimit = q ? Infinity : 8;
    for (const n of sorted.slice(0, noteLimit)) {
      result.push({ kind: "note", id: n.id, title: n.title, path: n.path });
    }

    // Create note action at the end if there's a query
    if (q) {
      result.push({
        kind: "create",
        label: `Create note "${query.trim()}"`,
        title: query.trim(),
      });
    }

    return result;
  }, [commands, notes, vaults, activeVault, query]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const execute = (item: Item) => {
    switch (item.kind) {
      case "command":
        item.cmd.run();
        break;
      case "note":
        void openTab(item.id);
        break;
      case "create":
        void create({ title: item.title });
        break;
      case "vault":
        switchVault(item.id);
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

  // Group items for rendering with section headers
  let lastKind: string | null = null;

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
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search
            className="shrink-0 text-muted-foreground"
            size={16}
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search notes…"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <ul className="max-h-96 overflow-y-auto py-1">
          {items.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              No results found.
            </li>
          ) : (
            items.map((item, i) => {
              const showHeader =
                item.kind !== lastKind;
              lastKind = item.kind;

              return (
                <li key={i}>
                  {showHeader && (
                    <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/60">
                      {item.kind === "command"
                        ? "Commands"
                        : item.kind === "vault"
                          ? "Switch vault"
                          : item.kind === "note"
                            ? "Notes"
                            : "Create"}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => execute(item)}
                    onMouseEnter={() => setIndex(i)}
                    className={[
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                      i === index
                        ? "bg-primary/15 text-foreground"
                        : "text-foreground/80 hover:bg-muted",
                    ].join(" ")}
                  >
                    {item.kind === "command" && item.cmd.icon}
                    {item.kind === "create" && (
                      <FilePlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    {item.kind === "vault" && (
                      <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    {item.kind === "note" && (
                      <span className="h-4 w-4 shrink-0 text-muted-foreground/50">
                        ●
                      </span>
                    )}
                    <span className="truncate">
                      {item.kind === "command"
                        ? item.cmd.label
                        : item.kind === "vault"
                          ? item.name
                          : item.kind === "note"
                            ? item.title || "Untitled"
                            : item.label}
                    </span>
                    {item.kind === "command" && item.cmd.hint && (
                      <kbd className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                        {item.cmd.hint}
                      </kbd>
                    )}
                    {item.kind === "note" && item.path && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {item.path}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {/* Footer with hints */}
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 py-0.5">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 py-0.5">↵</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 py-0.5">Esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
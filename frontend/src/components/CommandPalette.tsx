"use client";

import {
  Bookmark,
  CalendarDays,
  Clock,
  Database,
  FilePlus,
  FileStack,
  Hash,
  Keyboard,
  LayoutDashboard,
  ListTodo,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
  Star,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";

import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";
import { isCollectionsVault } from "@/lib/api";
import { useVisualViewport } from "@/components/mobile/useVirtualKeyboardInset";

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
  | { kind: "vault"; id: string; name: string }
  | { kind: "tag"; name: string };

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { notes, openTab, create, openDaily, vaults, switchVault, activeVault, tagsByVault } = useNotes();
  const { theme, setTheme } = useTheme();
  // Track the visual viewport: when the touch keyboard opens (iOS keeps the
  // layout viewport full-height), the backdrop must shrink to end at the
  // keyboard's top edge, or the sheet's lower half sits behind the keyboard.
  const vv = useVisualViewport();
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
        run: () => document.getElementById("nexote-new-note-btn")?.click(),
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
        id: "go-notetree",
        label: "Go to Notetree",
        icon: <FileStack className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent("nexote:select-view", { detail: "tree" }),
          ),
      },
      {
        id: "go-recent",
        label: "Go to Recent notes",
        icon: <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent("nexote:select-view", { detail: "recent" }),
          ),
      },
      {
        id: "go-shortcuts",
        label: "Go to Shortcuts",
        icon: <Star className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent("nexote:select-view", { detail: "shortcuts" }),
          ),
      },
      {
        id: "go-bookmarks",
        label: "Go to Bookmarks",
        icon: <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent("nexote:select-view", { detail: "bookmarks" }),
          ),
      },
      {
        id: "go-tags",
        label: "Go to Tags",
        icon: <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent("nexote:select-view", { detail: "tags" }),
          ),
      },
      {
        id: "go-tasks",
        label: "Go to Tasks",
        icon: <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent("nexote:select-view", { detail: "tasks" }),
          ),
      },
      {
        id: "go-daily",
        label: "Go to Daily notes",
        icon: <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent("nexote:select-view", { detail: "journal" }),
          ),
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
          const current = theme ?? "system";
          if (current === "light") setTheme("dark");
          else if (current === "dark") setTheme("system");
          else setTheme("light");
        },
      },
      {
        id: "settings",
        label: "Open settings",
        icon: <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () =>
          window.dispatchEvent(new CustomEvent("nexote:open-settings")),
      },
    ],
    [create, openDaily, openTab, theme, setTheme],
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: Item[] = [];

    // Tag search: when query starts with #, only show matching tags.
    if (q.startsWith("#")) {
      const tagQuery = q.slice(1);
      const allTags = new Map<string, number>();
      for (const v of vaults) {
        for (const t of tagsByVault[v.id] ?? []) {
          allTags.set(t.name, (allTags.get(t.name) ?? 0) + t.count);
        }
      }
      const matched = [...allTags.entries()]
        .filter(([name]) => !tagQuery || name.includes(tagQuery))
        .sort((a, b) => a[0].localeCompare(b[0]));
      for (const [name] of matched) {
        result.push({ kind: "tag", name });
      }
      return result;
    }

    // Always show commands first (filtered by query)
    const matchedCmds = q
      ? commands.filter((c) => c.label.toLowerCase().includes(q))
      : commands;
    for (const cmd of matchedCmds) {
      result.push({ kind: "command", cmd });
    }

    // Then vaults (if query matches or empty)
    const matchedVaults = q
      ? vaults.filter((v) => !isCollectionsVault(v) && v.name.toLowerCase().includes(q))
      : vaults.filter((v) => !isCollectionsVault(v));
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
  }, [commands, notes, vaults, activeVault, tagsByVault, query]);

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
      case "tag":
        window.dispatchEvent(
          new CustomEvent("nexote:select-tag", { detail: item.name }),
        );
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
      data-command-palette-backdrop
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm md:items-start md:p-4 md:pt-[15vh]"
      style={{
        paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        // Keyboard-open only, and only inside the mobile shell: anchor the
        // sheet's bottom edge to the top of the touch keyboard (the layout
        // viewport moves via visualViewport). The shell check keeps touch-
        // capable desktops (Surface etc.) on the unchanged desktop layout.
        ...(vv.isKeyboardOpen && vv.height > 0 && document.querySelector(".mob-shell-root")
          ? { height: vv.height, top: vv.top, bottom: "auto" }
          : {}),
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-command-palette
        className="flex h-full max-h-full w-full flex-1 flex-col overflow-hidden rounded-2xl border-2 bg-background shadow-xl md:h-auto md:max-w-lg md:flex-none"
        style={{ borderColor: "color-mix(in srgb, var(--primary) 55%, transparent)" }}
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

        {/* Results — full height sheet on mobile, capped box on desktop. */}
        <ul className="min-h-0 flex-1 overflow-y-auto py-1 md:max-h-96 md:flex-none">
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
                            : item.kind === "tag"
                              ? "Tags"
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
                    {item.kind === "tag" && (
                      <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">
                      {item.kind === "command"
                        ? item.cmd.label
                        : item.kind === "vault"
                          ? item.name
                          : item.kind === "note"
                            ? item.title || "Untitled"
                            : item.kind === "tag"
                              ? `#${item.name}`
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
        <div className="kbd-hints flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground/70">
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
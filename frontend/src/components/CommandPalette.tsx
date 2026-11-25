"use client";

import {
  Bookmark,
  CalendarDays,
  Clock,
  FilePlus,
  FileStack,
  FileText,
  Hash,
  Keyboard,
  Layers,
  LayoutDashboard,
  ListTodo,
  MessageSquareText,
  MessagesSquare,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
  Star,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";

import { useAndroidBack } from "@/lib/android-back";
import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";
import { api, type SearchHit } from "@/lib/api";
import { makeSnippet } from "@/lib/note-utils";
import { isThreadMeta, openThread } from "@/lib/threads";
import { useAllThreads, useSharedTags } from "@/components/threads/useAllThreads";
import { OPEN_QUICK_NOTES_EVENT } from "@/components/threads/threadEvents";
import { useVisualViewport } from "@/components/mobile/useVirtualKeyboardInset";
import { useCanEdit } from "@/components/useCanEdit";

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
  | { kind: "note"; id: string; title: string; path?: string; vaultId?: string; vaultName?: string; snippet?: string }
  | { kind: "create"; label: string; title: string }
  | { kind: "space"; id: string; name: string }
  | { kind: "thread"; vaultId: string; id: string; title: string; snippet?: string }
  | { kind: "tag"; name: string };

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { notes, openTab, create, openDaily, openJournalNote, openNoteInVault, vaults, spaces, switchSpace, activeVault, settings, activeSpaceId } = useNotes();
  const { canEditSpace } = useCanEdit();
  useAndroidBack(onClose, open);
  const { theme, setTheme } = useTheme();
  // Track the visual viewport: when the touch keyboard opens (iOS keeps the
  // layout viewport full-height), the backdrop must shrink to end at the
  // keyboard's top edge, or the sheet's lower half sits behind the keyboard.
  const vv = useVisualViewport();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Threads (from every vault and the personal store) open in the thread
  // view, never the editor.
  const { threads } = useAllThreads();
  // #tag search: notes and threads share one tag namespace.
  const sharedTags = useSharedTags(vaults);

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

  // Full-text search (title + content) across all vaults + journal, served
  // by the backend. Debounced so each keystroke doesn't fire a request; the
  // local title filter below still shows instant hits while this resolves.
  const [hits, setHits] = useState<SearchHit[]>([]);
  const hitsReqRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2 || q.startsWith("#")) {
      setHits([]);
      hitsReqRef.current++;
      return;
    }
    const req = ++hitsReqRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await api.search(q, activeSpaceId ?? undefined);
        if (req === hitsReqRef.current && open) setHits(res.results ?? []);
      } catch {
        // search is best-effort; keep the local filter usable
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [open, query, activeSpaceId]);

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
        id: "quick-notes",
        label: "Quick notes",
        icon: <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () => window.dispatchEvent(new CustomEvent(OPEN_QUICK_NOTES_EVENT)),
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
        id: "go-threads",
        label: "Go to Threads",
        icon: <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent("nexote:select-view", { detail: "threads" }),
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
    // Disabled entirely when the tags feature toggle is off.
    if (settings.showTagsOnPalette && q.startsWith("#")) {
      const tagQuery = q.slice(1);
      for (const { name } of sharedTags) {
        if (!tagQuery || name.includes(tagQuery)) result.push({ kind: "tag", name });
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

    // Then the other spaces (if the query matches or is empty).
    for (const s of spaces) {
      if (s.id !== activeSpaceId && (!q || s.name.toLowerCase().includes(q))) {
        result.push({ kind: "space", id: s.id, name: s.name });
      }
    }

    // Then threads whose title or posts contain the query.
    const threadIds = new Set(threads.map((t) => t.id));
    if (q) {
      const matched = threads
        .map((t) => ({ t, post: t.posts.find((p) => p.text.toLowerCase().includes(q)) }))
        .filter(({ t, post }) => post || t.title.toLowerCase().includes(q))
        .sort((a, b) => b.t.updatedAt.localeCompare(a.t.updatedAt));
      for (const { t, post } of matched) {
        const shown = post ?? t.posts[t.posts.length - 1];
        result.push({
          kind: "thread",
          vaultId: t.vaultId,
          id: t.id,
          title: t.title || "Untitled thread",
          snippet: shown ? makeSnippet(shown.text, 100) : undefined,
        });
      }
    }

    // Then notes — merged from the instant local title filter and the
    // backend full-text (title + content) hits, de-duplicated by vault:id.
    // Thread notes are left out: they're listed above and open elsewhere.
    const key = (vid: string | undefined, id: string) => `${vid ?? activeVault?.id ?? ""}:${id}`;
    const seen = new Set<string>();
    if (q) {
      // Sorted by updatedAt desc locally (instant).
      const localMatched = [...notes]
        .filter((n) => n.title.toLowerCase().includes(q) && !isThreadMeta(n))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      for (const n of localMatched) {
        const k = key(undefined, n.id);
        if (seen.has(k)) continue;
        seen.add(k);
        result.push({ kind: "note", id: n.id, title: n.title, path: n.path });
      }
      for (const h of hits) {
        const k = key(h.vaultId === "journal" ? "" : h.vaultId, h.id);
        if (seen.has(k) || threadIds.has(h.id)) continue;
        seen.add(k);
        result.push({
          kind: "note",
          id: h.id,
          title: h.title || "Untitled",
          path: h.vaultName,
          vaultId: h.vaultId,
          snippet: h.snippet,
        });
      }
    } else {
      const sorted = [...notes]
        .filter((n) => !isThreadMeta(n))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      // If empty query, limit notes to 8 so commands are visible
      for (const n of sorted.slice(0, 8)) {
        result.push({ kind: "note", id: n.id, title: n.title, path: n.path });
      }
    }

    // Create note action at the end if there's a query (viewers can't).
    if (q && canEditSpace) {
      result.push({
        kind: "create",
        label: `Create note "${query.trim()}"`,
        title: query.trim(),
      });
    }

    return result;
  }, [commands, notes, spaces, activeSpaceId, activeVault, sharedTags, query, settings, canEditSpace, threads]);

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
        if (item.vaultId === "journal") {
          void openJournalNote(item.id);
        } else if (item.vaultId && item.vaultId !== activeVault?.id) {
          void openNoteInVault(item.vaultId, item.id);
        } else {
          void openTab(item.id);
        }
        break;
      case "create":
        void create({ title: item.title });
        break;
      case "space":
        switchSpace(item.id);
        break;
      case "thread":
        openThread(item);
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

  // Consecutive items of one kind form a group (a rounded card).
  const groups: { kind: Item["kind"]; rows: { item: Item; i: number }[] }[] = [];
  items.forEach((item, i) => {
    const last = groups[groups.length - 1];
    if (last?.kind === item.kind) last.rows.push({ item, i });
    else groups.push({ kind: item.kind, rows: [{ item, i }] });
  });
  const GROUP_LABEL: Record<Item["kind"], string> = {
    command: "Commands",
    space: "Switch space",
    note: "Notes",
    thread: "Threads",
    tag: "Tags",
    create: "Create",
  };

  // Same look as the mobile action sheets: a bottom sheet with a grab handle
  // on mobile, a centered card on desktop; results in rounded groups.
  return (
    <div
      data-command-palette-backdrop
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 pt-10 md:items-start md:p-4 md:pt-[15vh]"
      style={{
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
        className="flex h-full max-h-full w-full flex-1 flex-col overflow-hidden rounded-t-[20px] bg-background text-foreground shadow-2xl md:h-auto md:max-w-lg md:flex-none md:rounded-2xl md:border md:border-border"
        style={{ paddingBottom: vv.isKeyboardOpen ? 0 : "env(safe-area-inset-bottom, 0px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/35 md:hidden" />
        {/* Search field */}
        <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5">
            <Search className="shrink-0 text-muted-foreground" size={16} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a command or search notes…"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
            />
            <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground md:block">
              Esc
            </kbd>
          </div>
          {/* Always-visible close affordance — touch devices have no Escape. */}
          <button
            type="button"
            aria-label="Close palette"
            title="Close"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors hover:text-foreground active:scale-95"
          >
            <X size={18} />
          </button>
        </div>

        {/* Results — full height sheet on mobile, capped box on desktop. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 md:max-h-[28rem] md:flex-none">
          {items.length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">No results found.</p>
          ) : (
            groups.map((group, g) => (
              <section key={`${group.kind}-${g}`} className="mt-3">
                <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {GROUP_LABEL[group.kind]}
                </h3>
                <ul className="overflow-hidden rounded-xl bg-muted/60">
                  {group.rows.map(({ item, i }, j) => (
                    <li key={i}>
                      {j > 0 && <div aria-hidden className="ml-[52px] border-t border-border/70" />}
                      <button
                        type="button"
                        onClick={() => execute(item)}
                        onMouseEnter={() => setIndex(i)}
                        className={
                          "flex w-full items-center gap-4 px-4 py-3 text-left text-[15px] transition-colors active:bg-muted md:py-2 md:text-sm" +
                          (i === index ? " bg-primary/10" : "")
                        }
                      >
                        <span className="flex w-5 shrink-0 justify-center text-muted-foreground [&_svg]:h-[18px] [&_svg]:w-[18px]">
                          {item.kind === "command" && item.cmd.icon}
                          {item.kind === "create" && <FilePlus />}
                          {item.kind === "space" && <Layers />}
                          {item.kind === "note" && <FileText />}
                          {item.kind === "thread" && <MessagesSquare />}
                          {item.kind === "tag" && <Hash />}
                        </span>
                        {(item.kind === "note" || item.kind === "thread") && item.snippet ? (
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{item.title || "Untitled"}</span>
                            <span className="truncate text-xs text-muted-foreground">{item.snippet}</span>
                          </span>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">
                            {item.kind === "command"
                              ? item.cmd.label
                              : item.kind === "space"
                                ? item.name
                                : item.kind === "note" || item.kind === "thread"
                                  ? item.title || "Untitled"
                                  : item.kind === "tag"
                                    ? `#${item.name}`
                                    : item.label}
                          </span>
                        )}
                        {item.kind === "command" && item.cmd.hint && (
                          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground md:block">
                            {item.cmd.hint}
                          </kbd>
                        )}
                        {item.kind === "note" && item.path && (
                          <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{item.path}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        {/* Footer with hints (desktop) */}
        <div className="kbd-hints flex shrink-0 items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground/70">
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
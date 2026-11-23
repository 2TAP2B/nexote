"use client";

import {
  Bookmark,
  CalendarDays,
  ChevronDown,
  Database,
  FilePlus,
  FileText,
  FolderPlus,
  Hash,
  History,
  Keyboard,
  LayoutGrid,
  ListTodo,
  Search,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import { isThreadMeta } from "@/lib/threads";
import { useCanEdit } from "@/components/useCanEdit";
import { useSharedTags } from "@/components/threads/useAllThreads";
import { newCollection, openCollection } from "./collections/actions";
import { CollectionBadge, ItemCover } from "./collections/CollectionArt";
import { useCollectionItems } from "./collections/items";
import { useCollections } from "./collections/useCollections";
import JournalCalendar from "./JournalCalendar";
import type { SidebarView } from "./Ribbon";

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - d);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function greeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

type RecentEntry = {
  id: string;
  title: string;
  path: string;
  updatedAt: string;
  snippet?: string;
  vaultId: string;
  source: "vault" | "journal";
};

function useSectionState(key: string, defaultOpen = true): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return defaultOpen;
    const stored = localStorage.getItem(`nexote:dashboard:${key}`);
    if (stored === null) return defaultOpen;
    return stored === "1";
  });
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(`nexote:dashboard:${key}`, next ? "1" : "0"); } catch {}
      return next;
    });
  };
  return [open, toggle];
}

const selectView = (view: SidebarView) =>
  window.dispatchEvent(new CustomEvent("nexote:select-view", { detail: view }));

export default function WelcomeDashboard({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const {
    openNoteInVault,
    create,
    openDaily,
    bookmarks,
    shortcuts,
    vaults,
    allVaultData,
    journalNotes,
    openJournalNote,
    tasks,
    refreshTags,
    toggleTaskItem,
    settings,
  } = useNotes();
  // Viewers of a shared space can't add notes or collections.
  const { canEditSpace } = useCanEdit();
  const { collections } = useCollections();
  const collectionItems = useCollectionItems();
  // Rendered client-side only so greeting/date never mismatch SSR output.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  useEffect(() => {
    if (vaults.length === 0) return;
    for (const v of vaults) void refreshTags(v.id);
  }, [vaults, refreshTags]);

  const openPalette = () => {
    if (onOpenPalette) onOpenPalette();
    else window.dispatchEvent(new CustomEvent("nexote:open-palette"));
  };

  const vaultEntries = useMemo<RecentEntry[]>(() => {
    const items: RecentEntry[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        // Collection items live in their gallery, not the note lists; threads
        // kept in a vault have their own (Threads view, quick notes).
        if (n.collection || isThreadMeta(n)) continue;
        items.push({ id: n.id, title: n.title, path: n.path, updatedAt: n.updatedAt, snippet: n.snippet, vaultId: v.id, source: "vault" });
      }
    }
    return items;
  }, [vaults, allVaultData]);

  const recents = useMemo<RecentEntry[]>(() => {
    const items = [...vaultEntries];
    for (const j of journalNotes) {
      items.push({ id: j.id, title: j.title, path: j.path, updatedAt: j.updatedAt, snippet: j.snippet, vaultId: "journal", source: "journal" });
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  }, [vaultEntries, journalNotes]);

  const bookmarkNotes = useMemo(
    () => vaultEntries.filter((n) => bookmarks.has(n.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [vaultEntries, bookmarks],
  );
  const shortcutNotes = useMemo(
    () => vaultEntries.filter((n) => shortcuts.has(n.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [vaultEntries, shortcuts],
  );

  const openItem = (entry: RecentEntry) => {
    if (entry.source === "journal") void openJournalNote(entry.id);
    else void openNoteInVault(entry.vaultId, entry.id);
  };

  const openTasks = useMemo(() => tasks.filter((t) => !t.checked), [tasks]);
  const openTaskNote = (task: (typeof tasks)[number]) => {
    if (task.vaultId === "journal") void openJournalNote(task.noteId);
    else void openNoteInVault(task.vaultId, task.noteId);
  };

  // Tags of the active space's vaults (other spaces' tags stay loaded) and of
  // every thread: one namespace, like the Tags view.
  const sharedTags = useSharedTags(vaults);
  const allTags = useMemo(() => [...sharedTags].sort((a, b) => b.count - a.count), [sharedTags]);

  const pinned = collections
    .filter((c) => c.pinned && !c.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));

  const [recentsExpanded, toggleRecentsExpanded] = useSectionState("recents-expanded", false);
  const [shortcutsOpen, toggleShortcuts] = useSectionState("shortcuts", true);
  const [bookmarksOpen, toggleBookmarks] = useSectionState("bookmarks", true);
  const [tasksOpen, toggleTasks] = useSectionState("tasks", true);
  const [tagsOpen, toggleTags] = useSectionState("tags", true);
  const [keysOpen, toggleKeys] = useSectionState("hotkeys", false);

  const visibleRecents = recents.slice(0, recentsExpanded ? 12 : 6);

  return (
    <main className="flex flex-1 justify-center overflow-y-auto bg-background">
      <div className="flex w-full max-w-6xl flex-col gap-8 px-6 py-8 md:px-10 md:py-12">
        {/* Header: greeting, stats, search */}
        <header className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
                {now ? now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "\u00a0"}
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {now ? greeting(now.getHours()) : "Welcome"}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Stat label="Notes" value={vaultEntries.length} onClick={() => selectView("tree")} />
              <Stat label="Journal" value={journalNotes.length} onClick={() => selectView("journal")} />
              <Stat label="Tags" value={allTags.length} onClick={() => selectView("tags")} />
              <Stat label="Open tasks" value={openTasks.length} onClick={() => selectView("tasks")} />
            </div>
          </div>
          <button
            type="button"
            onClick={openPalette}
            className="group flex h-12 w-full items-center gap-3 rounded-xl border border-border bg-muted/60 px-4 text-left text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-muted"
          >
            <Search className="h-4 w-4 transition-colors group-hover:text-primary" />
            <span className="flex-1">Search notes, run commands…</span>
            <Kbd>Ctrl P</Kbd>
          </button>
          {settings.dashActions && (
          <div className={canEditSpace ? "grid grid-cols-1 gap-3 sm:grid-cols-3" : "grid grid-cols-1 gap-3"}>
            {canEditSpace && (
              <QuickAction icon={<FilePlus className="h-4 w-4" />} label="New note" hint="Ctrl Shift N" onClick={() => void create()} />
            )}
            <QuickAction icon={<CalendarDays className="h-4 w-4" />} label="Today's journal" hint="Ctrl D" onClick={() => void openDaily()} />
            {canEditSpace && (
              <QuickAction icon={<LayoutGrid className="h-4 w-4" />} label="New collection" onClick={newCollection} />
            )}
          </div>
          )}
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Main column */}
          <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
            {settings.dashRecents && (
            <section className="flex flex-col gap-3">
              <SectionHeader
                icon={<History className="h-4 w-4" />}
                title="Recently edited"
                action={recents.length > 6 ? (
                  <button type="button" onClick={toggleRecentsExpanded} className="text-xs font-medium text-primary hover:underline">
                    {recentsExpanded ? "Show less" : "Show more"}
                  </button>
                ) : null}
              />
              {visibleRecents.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {visibleRecents.map((entry) => (
                    <NoteCard
                      key={`${entry.source}-${entry.id}`}
                      icon={entry.source === "journal" ? <CalendarDays className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      title={entry.title || "Untitled"}
                      snippet={entry.snippet}
                      folder={entry.source === "journal" ? "Journal" : entry.path || "Root"}
                      time={formatRelative(entry.updatedAt)}
                      onClick={() => openItem(entry)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
                  <FileText className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">No notes yet</p>
                  <p className="text-xs text-muted-foreground">Create a note or open today&apos;s journal to get started.</p>
                </div>
              )}
            </section>
            )}

            {settings.dashCollections && (
            <section className="flex flex-col gap-3">
              <SectionHeader icon={<Database className="h-4 w-4" />} title="Collections" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {pinned.map((c) => {
                  const items = collectionItems.get(c.id) ?? [];
                  const covers = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
                  return (
                    // Icon and covers on top, the name below with the full width
                    // (beside the covers it got cut off), like the phone's tiles.
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => openCollection(c.id)}
                      className="group flex flex-col gap-2.5 rounded-xl border border-border bg-muted/40 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted hover:shadow-md"
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <CollectionBadge collection={c} size={34} />
                        {covers.length > 0 && (
                          <span className="flex shrink-0 flex-row-reverse items-center">
                            {covers.map((it, i) => (
                              <span
                                key={it.id}
                                className="block rounded-md"
                                style={{
                                  marginLeft: i === covers.length - 1 ? 0 : -10,
                                  boxShadow: "0 0 0 2px var(--background)",
                                  zIndex: covers.length - i,
                                }}
                              >
                                <ItemCover cover={it.cover} collection={c} radius={6} iconSize={12} className="h-7 w-7" />
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">{c.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {items.length === 1 ? "1 item" : `${items.length} items`}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {canEditSpace && (
                  <button
                    type="button"
                    onClick={newCollection}
                    className="flex flex-col gap-2.5 rounded-xl border border-dashed border-border p-3 text-left text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border">
                      <FolderPlus className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-medium">New collection</span>
                  </button>
                )}
              </div>
            </section>
            )}
          </div>

          {/* Side column */}
          <aside className="flex min-w-0 flex-col gap-4">
            <JournalCalendar
              onOpenDay={(date) => void openDaily(date)}
              onOpenJournal={(id) => void openJournalNote(id)}
            />

            {settings.dashShortcuts && shortcutNotes.length > 0 && (
              <Panel
                icon={<Star className="h-4 w-4" />}
                title="Shortcuts"
                count={shortcutNotes.length}
                open={shortcutsOpen}
                onToggle={toggleShortcuts}
                onViewAll={() => selectView("shortcuts")}
              >
                {shortcutNotes.slice(0, 6).map((n) => (
                  <ListRow key={n.id} title={n.title || "Untitled"} meta={formatRelative(n.updatedAt)} onClick={() => openItem(n)} />
                ))}
              </Panel>
            )}

            {settings.dashBookmarks && bookmarkNotes.length > 0 && (
              <Panel
                icon={<Bookmark className="h-4 w-4" />}
                title="Bookmarks"
                count={bookmarkNotes.length}
                open={bookmarksOpen}
                onToggle={toggleBookmarks}
                onViewAll={() => selectView("bookmarks")}
              >
                {bookmarkNotes.slice(0, 6).map((n) => (
                  <ListRow key={n.id} title={n.title || "Untitled"} meta={formatRelative(n.updatedAt)} onClick={() => openItem(n)} />
                ))}
              </Panel>
            )}

            {settings.dashTasks && openTasks.length > 0 && (
              <Panel
                icon={<ListTodo className="h-4 w-4" />}
                title="Tasks"
                count={openTasks.length}
                open={tasksOpen}
                onToggle={toggleTasks}
                onViewAll={() => selectView("tasks")}
              >
                {openTasks.slice(0, 6).map((t) => (
                  <div key={`${t.vaultId}-${t.noteId}-${t.line}`} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-background/60">
                    <button
                      type="button"
                      aria-label="Complete task"
                      onClick={() => void toggleTaskItem(t.vaultId, t.noteId, t.line, !t.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-2 border-primary/70 transition-colors hover:bg-primary/20"
                    />
                    <button type="button" onClick={() => openTaskNote(t)} className="flex min-w-0 flex-1 flex-col text-left">
                      <span className="truncate text-sm text-foreground">{t.text}</span>
                      <span className="truncate text-xs text-muted-foreground">{t.noteTitle || "Untitled"}</span>
                    </button>
                  </div>
                ))}
              </Panel>
            )}

            {settings.dashTags && allTags.length > 0 && (
              <Panel
                icon={<Hash className="h-4 w-4" />}
                title="Tags"
                count={allTags.length}
                open={tagsOpen}
                onToggle={toggleTags}
                onViewAll={() => selectView("tags")}
              >
                <div className="flex flex-wrap gap-1.5 px-1 pb-1">
                  {allTags.slice(0, 24).map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent("nexote:select-tag", { detail: t.name }))}
                      className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                    >
                      #{t.name}
                      <span className="opacity-60">{t.count}</span>
                    </button>
                  ))}
                </div>
              </Panel>
            )}

            <Panel icon={<Keyboard className="h-4 w-4" />} title="Hotkeys" open={keysOpen} onToggle={toggleKeys}>
              <dl className="flex flex-col gap-1 px-2 pb-1 text-xs">
                {[
                  ["Ctrl Shift N", "New note"],
                  ["Ctrl D", "Daily note"],
                  ["Ctrl Shift D", "Dashboard"],
                  ["Ctrl P", "Command palette"],
                  ["Ctrl S", "Save note"],
                  ["Ctrl W", "Close tab"],
                  ["Ctrl Tab", "Next tab"],
                  ["Ctrl B", "Toggle sidebar"],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-2 py-0.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd><Kbd>{key}</Kbd></dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-[84px] flex-col items-start rounded-xl border border-border bg-muted/40 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-muted"
    >
      <span className="text-lg font-semibold tabular-nums leading-tight text-foreground">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </button>
  );
}

function QuickAction({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted hover:shadow-md"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</span>
      {hint && <span className="hidden xl:inline"><Kbd>{hint}</Kbd></span>}
    </button>
  );
}

function SectionHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="text-primary">{icon}</span>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <span className="ml-auto">{action}</span>
    </div>
  );
}

function NoteCard({
  icon,
  title,
  snippet,
  folder,
  time,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  snippet?: string;
  folder: string;
  time: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-[132px] flex-col gap-2 rounded-xl border border-border bg-muted/40 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted hover:shadow-md"
    >
      <span className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</span>
      </span>
      <span className={`line-clamp-2 flex-1 text-xs leading-relaxed ${snippet ? "text-muted-foreground" : "italic text-muted-foreground/50"}`}>
        {snippet || "Empty note"}
      </span>
      <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{folder}</span>
        <span className="shrink-0 tabular-nums">{time}</span>
      </span>
    </button>
  );
}

function Panel({
  icon,
  title,
  count,
  open,
  onToggle,
  onViewAll,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  onViewAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1 rounded-2xl border border-border bg-muted/30 p-2">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-background/60">
          <span className="text-primary">{icon}</span>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {count !== undefined && (
            <span className="rounded-full bg-background px-1.5 text-[11px] tabular-nums text-muted-foreground">{count}</span>
          )}
          <ChevronDown
            size={14}
            className="ml-auto text-muted-foreground transition-transform"
            style={{ transform: open ? "none" : "rotate(-90deg)" }}
          />
        </button>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-background/60"
          >
            All
          </button>
        )}
      </div>
      {open && <div className="flex flex-col">{children}</div>}
    </section>
  );
}

function ListRow({ title, meta, onClick }: { title: string; meta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-background/60"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{meta}</span>
    </button>
  );
}

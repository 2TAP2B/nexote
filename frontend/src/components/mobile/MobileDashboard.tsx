"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Library,
  FilePlus,
  FileText,
  Hash,
  History,
  ListTodo,
  Search,
  SlidersHorizontal,
  Star,
} from "lucide-react";

import { dashLayout, type DashSection } from "@/lib/dashboard";
import { useNotes } from "@/lib/notes-context";
import { isThreadMeta } from "@/lib/threads";
import { useCanEdit } from "@/components/useCanEdit";
import { useSharedTags } from "@/components/threads/useAllThreads";
import { openCollection } from "@/components/collections/actions";
import { CollectionBadge, ItemCover } from "@/components/collections/CollectionArt";
import { useCollectionItems } from "@/components/collections/items";
import { useCollections } from "@/components/collections/useCollections";
import JournalCalendar from "@/components/JournalCalendar";

type RecentEntry = {
  id: string;
  title: string;
  path: string;
  updatedAt: string;
  vaultId: string;
  source: "vault" | "journal";
};

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
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Load/save expandable section state from localStorage.
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

export default function MobileDashboard({
  onOpenSearch,
  onNewNote,
  onOpenDaily,
}: {
  onOpenSearch: () => void;
  onNewNote: () => void;
  onOpenDaily: () => void;
}) {
  const {
    bookmarks,
    shortcuts,
    vaults,
    allVaultData,
    journalNotes,
    openNoteInVault,
    openJournalNote,
    openDaily,
    tasks,
    refreshTags,
    toggleTaskItem,
    settings,
  } = useNotes();
  // Viewers of a shared space can't add notes.
  const { canEditSpace } = useCanEdit();
  const { collections } = useCollections();
  const collectionItems = useCollectionItems();
  const pinnedCollections = useMemo(
    () => collections.filter((c) => c.pinned && !c.hidden).sort((a, b) => a.name.localeCompare(b.name)),
    [collections],
  );

  useEffect(() => {
    if (vaults.length === 0) return;
    for (const v of vaults) void refreshTags(v.id);
  }, [vaults, refreshTags]);

  const recents = useMemo<RecentEntry[]>(() => {
    const items: RecentEntry[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        // Collection items live in their gallery, not the note lists; threads
        // kept in a vault have their own (Threads view, quick notes).
        if (n.collection || isThreadMeta(n)) continue;
        items.push({ id: n.id, title: n.title, path: n.path, updatedAt: n.updatedAt, vaultId: v.id, source: "vault" });
      }
    }
    for (const j of journalNotes) {
      items.push({ id: j.id, title: j.title, path: j.path, updatedAt: j.updatedAt, vaultId: "journal", source: "journal" });
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items.slice(0, 10);
  }, [vaults, allVaultData, journalNotes]);

  const bookmarkNotes = useMemo(() => {
    const items: RecentEntry[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (bookmarks.has(n.id)) {
          items.push({ id: n.id, title: n.title, path: n.path, updatedAt: n.updatedAt, vaultId: v.id, source: "vault" });
        }
      }
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  }, [vaults, allVaultData, bookmarks]);

  const shortcutNotes = useMemo(() => {
    const items: RecentEntry[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (shortcuts.has(n.id)) {
          items.push({ id: n.id, title: n.title, path: n.path, updatedAt: n.updatedAt, vaultId: v.id, source: "vault" });
        }
      }
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  }, [vaults, allVaultData, shortcuts]);

  const openItem = (entry: RecentEntry) => {
    if (entry.source === "journal") void openJournalNote(entry.id);
    else void openNoteInVault(entry.vaultId, entry.id);
  };

  const openTasks = useMemo(
    () => tasks.filter((t) => !t.checked),
    [tasks],
  );

  // Tags of the active space's vaults (other spaces' tags stay loaded) and of
  // every thread: one namespace, like the Tags view.
  const sharedTags = useSharedTags(vaults);
  const allTags = useMemo(() => [...sharedTags].sort((a, b) => b.count - a.count), [sharedTags]);

  const openTaskNote = (task: (typeof tasks)[number]) => {
    if (task.vaultId === "journal") void openJournalNote(task.noteId);
    else void openNoteInVault(task.vaultId, task.noteId);
  };

  // Expandable section states
  const [recentsOpen, toggleRecents] = useSectionState("recents", true);
  const [shortcutsOpen, toggleShortcuts] = useSectionState("shortcuts", true);
  const [bookmarksOpen, toggleBookmarks] = useSectionState("bookmarks", true);
  const [tasksOpen, toggleTasks] = useSectionState("tasks", true);
  const [tagsOpen, toggleTags] = useSectionState("tags", true);

  const layout = dashLayout(settings.dashboardTouch, "touch").filter((s) => s.shown);

  // Note lists (shortcuts, recents, bookmarks) share their rows: today's
  // two-line NoteRow, or one line per note when compact.
  const noteRows = (
    entries: RecentEntry[],
    open: boolean,
    compact: boolean,
    icon: (entry: RecentEntry, size: number) => React.ReactNode,
    subtitle: (entry: RecentEntry) => string,
  ) => (
    <div className={compact ? "flex flex-col gap-0.5" : "flex flex-col gap-1.5"}>
      {(open ? entries : entries.slice(0, 3)).map((entry) =>
        compact ? (
          <CompactRow
            key={`${entry.source}-${entry.id}`}
            icon={icon(entry, 16)}
            title={entry.title || "Untitled"}
            time={formatRelative(entry.updatedAt)}
            onClick={() => openItem(entry)}
          />
        ) : (
          <NoteRow
            key={`${entry.source}-${entry.id}`}
            icon={icon(entry, 18)}
            title={entry.title || "Untitled"}
            subtitle={subtitle(entry)}
            time={formatRelative(entry.updatedAt)}
            onClick={() => openItem(entry)}
          />
        ),
      )}
    </div>
  );

  const renderSection = ({ id, compact }: DashSection): React.ReactNode => {
    switch (id) {
      case "actions":
        return compact ? (
          <div className={canEditSpace ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
            {canEditSpace && <SlimAction icon={<FilePlus size={18} />} label="New note" onClick={onNewNote} />}
            <SlimAction icon={<CalendarDays size={18} />} label="Today" onClick={onOpenDaily} />
            <SlimAction icon={<Search size={18} />} label="Search" onClick={onOpenSearch} />
          </div>
        ) : (
          <div className={canEditSpace ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
            {canEditSpace && <QuickAction icon={<FilePlus size={22} />} label="New note" onClick={onNewNote} />}
            <QuickAction icon={<CalendarDays size={22} />} label="Today" onClick={onOpenDaily} />
            <QuickAction icon={<Search size={22} />} label="Search" onClick={onOpenSearch} />
          </div>
        );

      case "shortcuts":
        if (shortcutNotes.length === 0) return null;
        return (
          <CollapsibleSection
            icon={<Star size={16} />}
            title="Shortcuts"
            count={shortcutNotes.length}
            open={shortcutsOpen}
            onToggle={toggleShortcuts}
            onViewAll={() =>
              window.dispatchEvent(new CustomEvent("nexote:select-view", { detail: "shortcuts" }))
            }
          >
            {noteRows(shortcutNotes, shortcutsOpen, compact, (_, size) => <Star size={size} />, (n) => n.path || "No folder")}
          </CollapsibleSection>
        );

      case "recents":
        // With no notes at all the hint to create one takes the section's place.
        if (recents.length === 0) {
          return (
            <div
              className="flex flex-col items-center gap-2 rounded-2xl px-6 py-8 text-center"
              style={{ background: "var(--mob-card)" }}
            >
              <FileText size={24} style={{ color: "var(--mob-muted)" }} />
              <p className="text-sm font-medium">No notes yet</p>
              <p className="text-xs" style={{ color: "var(--mob-muted)" }}>
                Tap "New note" to create your first note, or open the journal.
              </p>
            </div>
          );
        }
        return (
          <CollapsibleSection
            icon={<History size={16} />}
            title="Continue where you left off"
            count={recents.length}
            open={recentsOpen}
            onToggle={toggleRecents}
          >
            {noteRows(
              recents,
              recentsOpen,
              compact,
              (entry, size) => (entry.source === "journal" ? <CalendarDays size={size} /> : <FileText size={size} />),
              (entry) => (entry.source === "journal" ? "Journal" : entry.path || "No folder"),
            )}
          </CollapsibleSection>
        );

      case "collections":
        if (pinnedCollections.length === 0) return null;
        if (compact) {
          return (
            <section
              className="flex flex-col gap-2 rounded-2xl p-3"
              style={{ background: "color-mix(in oklab, var(--mob-surface) 50%, transparent)" }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--mob-accent)" }}><Library size={16} /></span>
                <h2 className="text-sm font-semibold tracking-wide" style={{ color: "var(--mob-text)" }}>
                  Collections
                </h2>
                <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{pinnedCollections.length}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {pinnedCollections.map((c) => {
                  const count = collectionItems.get(c.id)?.length ?? 0;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => openCollection(c.id)}
                      className="flex min-h-[40px] items-center gap-3 rounded-xl px-2 py-1 text-left transition-[transform,background] active:scale-[0.98] active:bg-white/5"
                    >
                      <CollectionBadge collection={c} size={26} />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium" style={{ color: "var(--mob-text)" }}>
                        {c.name}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--mob-muted)" }}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        }
        return (
          <section className="flex flex-col gap-2">
            <SectionHeading icon={<Library size={16} />} title="Collections" />
            <div className="grid grid-cols-2 gap-2">
              {pinnedCollections.map((c) => {
                const items = collectionItems.get(c.id) ?? [];
                const covers = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openCollection(c.id)}
                    className="flex min-w-0 flex-col gap-2 rounded-2xl p-3 text-left transition-[transform,background] active:scale-[0.98]"
                    style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <CollectionBadge collection={c} size={32} />
                      {covers.length > 0 && (
                        <span className="flex shrink-0 flex-row-reverse items-center">
                          {covers.map((it, i) => (
                            <span
                              key={it.id}
                              className="block"
                              style={{
                                marginLeft: i === covers.length - 1 ? 0 : -8,
                                borderRadius: 6,
                                boxShadow: "0 0 0 2px var(--mob-surface)",
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
                      <span className="truncate text-sm font-medium">{c.name}</span>
                      <span className="text-xs" style={{ color: "var(--mob-muted)" }}>
                        {items.length === 1 ? "1 item" : `${items.length} items`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );

      case "calendar":
        // The calendar brings its own card and month header (as in the
        // Daily-notes view), so it needs no section heading.
        return (
          <JournalCalendar
            onOpenJournal={(journalId) => void openJournalNote(journalId)}
            onOpenDay={(date) => void openDaily(date)}
          />
        );

      case "bookmarks":
        if (bookmarkNotes.length === 0) return null;
        return (
          <CollapsibleSection
            icon={<Bookmark size={16} />}
            title="Bookmarks"
            count={bookmarkNotes.length}
            open={bookmarksOpen}
            onToggle={toggleBookmarks}
            onViewAll={() =>
              window.dispatchEvent(new CustomEvent("nexote:select-view", { detail: "bookmarks" }))
            }
          >
            {noteRows(bookmarkNotes, bookmarksOpen, compact, (_, size) => <Bookmark size={size} />, (n) => n.path || "No folder")}
          </CollapsibleSection>
        );

      case "tasks":
        if (openTasks.length === 0) return null;
        return (
          <CollapsibleSection
            icon={<ListTodo size={16} />}
            title="Todo"
            count={openTasks.length}
            open={tasksOpen}
            onToggle={toggleTasks}
            onViewAll={() =>
              window.dispatchEvent(new CustomEvent("nexote:select-view", { detail: "tasks" }))
            }
          >
            <div className={compact ? "flex flex-col gap-0.5" : "flex flex-col gap-1.5"}>
              {(tasksOpen ? openTasks : openTasks.slice(0, 3)).map((t) => (
                <div
                  key={`${t.vaultId}-${t.noteId}-${t.line}`}
                  className={`flex items-center gap-3 rounded-xl px-2 ${compact ? "min-h-[40px] py-1" : "min-h-[48px] py-1.5"}`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleTaskItem(t.vaultId, t.noteId, t.line, !t.checked);
                    }}
                    className="flex shrink-0 items-center justify-center"
                    style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid var(--mob-accent)`, background: "transparent" }}
                  />
                  <button
                    type="button"
                    onClick={() => openTaskNote(t)}
                    className="flex min-w-0 flex-1 flex-col text-left"
                  >
                    <span className="truncate text-[15px] font-medium" style={{ color: "var(--mob-text)" }}>
                      {t.text}
                    </span>
                    {!compact && (
                      <span className="truncate text-xs" style={{ color: "var(--mob-muted)" }}>
                        {t.noteTitle || "Untitled"}
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        );

      case "tags":
        if (allTags.length === 0) return null;
        return (
          <CollapsibleSection
            icon={<Hash size={16} />}
            title="Tags"
            count={allTags.length}
            open={tagsOpen}
            onToggle={toggleTags}
            onViewAll={() =>
              window.dispatchEvent(new CustomEvent("nexote:select-view", { detail: "tags" }))
            }
          >
            {/* Compact: one sideways-scrolling line. The pager leaves
                horizontally overflowing scrollers alone (useSwipeSidebar's
                overflow check), so swiping the chips scrolls them; when they
                all fit, the row swipes panes like the rest of the page. */}
            <div className={compact ? "no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1" : "flex flex-wrap gap-2 px-1"}>
              {allTags.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent("nexote:select-tag", { detail: t.name }))
                  }
                  className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-transform active:scale-95"
                  style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
                >
                  <Hash size={13} style={{ color: "var(--mob-accent)" }} />
                  {t.name}
                  {!compact && <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{t.count}</span>}
                </button>
              ))}
            </div>
          </CollapsibleSection>
        );

      // Hotkeys are desktop-only; dashLayout never yields them for touch.
      case "hotkeys":
        return null;
    }
  };

  return (
    <main
      className="flex flex-col gap-5 px-4 pb-40 pt-2"
      style={{ color: "var(--mob-text)" }}
    >
      {/* Header is the top bar row (gear + theme toggle synced by the
          dashboard variant), so no local title/greeting/actions here. */}
      {layout.map((s) => (
        <Fragment key={s.id}>{renderSection(s)}</Fragment>
      ))}

      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("nexote:open-settings", { detail: "dashboard" }))}
        className="mx-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-transform active:scale-95"
        style={{ color: "var(--mob-muted)" }}
      >
        <SlidersHorizontal size={14} />
        Customize dashboard
      </button>
    </main>
  );
}

function CollapsibleSection({
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
    <section
      className="flex flex-col gap-2 rounded-2xl p-3"
      style={{
        background: "color-mix(in oklab, var(--mob-surface) 50%, transparent)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2"
      >
        <span style={{ color: "var(--mob-accent)" }}>{icon}</span>
        <h2 className="text-sm font-semibold tracking-wide" style={{ color: "var(--mob-text)" }}>
          {title}
        </h2>
        {count !== undefined && (
          <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{count}</span>
        )}
        <ChevronDown
          size={16}
          className="ml-auto transition-transform"
          style={{
            color: "var(--mob-muted)",
            transform: open ? "none" : "rotate(-90deg)",
          }}
        />
      </button>
      {open && onViewAll && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-0.5 text-xs font-medium"
            style={{ color: "var(--mob-accent)" }}
          >
            View all
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      {open && children}
    </section>
  );
}

function SectionHeading({
  icon,
  title,
  count,
  onViewAll,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  onViewAll?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1">
      <span style={{ color: "var(--mob-accent)" }}>{icon}</span>
      <h2 className="text-sm font-semibold tracking-wide" style={{ color: "var(--mob-text)" }}>
        {title}
      </h2>
      {count !== undefined && (
        <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{count}</span>
      )}
      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="ml-auto flex items-center gap-0.5 text-xs font-medium"
          style={{ color: "var(--mob-accent)" }}
        >
          View all
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}

function NoteRow({
  icon,
  title,
  subtitle,
  time,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  time: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-[transform,background] active:scale-[0.98] active:bg-white/5"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ color: "var(--mob-accent)" }}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium" style={{ color: "var(--mob-text)" }}>
          {title}
        </span>
        <span className="truncate text-xs" style={{ color: "var(--mob-muted)" }}>
          {subtitle}
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--mob-muted)" }}>
        {time}
      </span>
    </button>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl transition-[transform,background] active:scale-[0.98]"
      style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
    >
      <span style={{ color: "var(--mob-accent)" }}>{icon}</span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

// The compact look of a note row: one line, no folder.
function CompactRow({
  icon,
  title,
  time,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  time: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[40px] items-center gap-3 rounded-xl px-2 py-1 text-left transition-[transform,background] active:scale-[0.98] active:bg-white/5"
    >
      <span className="flex w-6 shrink-0 items-center justify-center" style={{ color: "var(--mob-accent)" }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium" style={{ color: "var(--mob-text)" }}>
        {title}
      </span>
      <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--mob-muted)" }}>
        {time}
      </span>
    </button>
  );
}

// The compact look of a quick action: icon and label side by side.
function SlimAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-2 transition-[transform,background] active:scale-[0.98]"
      style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
    >
      <span className="shrink-0" style={{ color: "var(--mob-accent)" }}>{icon}</span>
      <span className="truncate text-xs font-medium">{label}</span>
    </button>
  );
}
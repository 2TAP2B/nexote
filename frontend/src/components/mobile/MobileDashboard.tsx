"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Disc3,
  FilePlus,
  FileText,
  Hash,
  History,
  ListTodo,
  Search,
  Settings,
  Star,
} from "lucide-react";

import { api } from "@/lib/api";
import type { CollectionMeta } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import CollectionFormDialog from "@/components/CollectionFormDialog";
import CollectionGallery from "@/components/CollectionGallery";

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
  onOpenSettings,
}: {
  onOpenSearch: () => void;
  onNewNote: () => void;
  onOpenDaily: () => void;
  onOpenSettings: () => void;
}) {
  const {
    bookmarks,
    shortcuts,
    vaults,
    allVaultData,
    journalNotes,
    openNoteInVault,
    openJournalNote,
    tasks,
    tagsByVault,
    refreshTags,
    toggleTaskItem,
  } = useNotes();
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [galleryCollection, setGalleryCollection] = useState<CollectionMeta | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    void api.listCollections().then((res) => setCollections(res.collections ?? []));
  }, []);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  useEffect(() => {
    if (vaults.length === 0) return;
    for (const v of vaults) void refreshTags(v.id);
  }, [vaults, refreshTags]);

  const recents = useMemo<RecentEntry[]>(() => {
    const items: RecentEntry[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        items.push({ id: n.id, title: n.title, path: n.path, updatedAt: n.updatedAt, vaultId: v.id, source: "vault" });
      }
    }
    for (const j of journalNotes) {
      items.push({ id: j.id, title: j.title, path: j.path, updatedAt: j.updatedAt, vaultId: "journal", source: "journal" });
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
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

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tags of Object.values(tagsByVault)) {
      for (const t of tags) counts.set(t.name, (counts.get(t.name) ?? 0) + t.count);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [tagsByVault]);

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

  const isEmpty = recents.length === 0;

  return (
    <main
      className="flex flex-col gap-5 px-4 pb-40 pt-2"
      style={{ color: "var(--mob-text)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-1 pt-1">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--mob-muted)" }}>
            {greeting}
          </p>
          <h1 className="text-2xl font-bold">Nexote</h1>
        </div>
        <button
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
          className="flex items-center justify-center rounded-full transition-transform active:scale-90"
          style={{ width: 44, height: 44, background: "var(--mob-surface)", color: "var(--mob-text)" }}
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Row 1: Quick actions */}
      <div className="grid grid-cols-3 gap-2">
        <QuickAction icon={<FilePlus size={22} />} label="New note" onClick={onNewNote} />
        <QuickAction icon={<CalendarDays size={22} />} label="Today" onClick={onOpenDaily} />
        <QuickAction icon={<Search size={22} />} label="Search" onClick={onOpenSearch} />
      </div>

      {/* Row 2: Shortcuts (3 preview, clickable header → all shortcuts) */}
      {shortcutNotes.length > 0 && (
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
          <div className="flex flex-col gap-1.5">
            {(shortcutsOpen ? shortcutNotes : shortcutNotes.slice(0, 3)).map((n) => (
              <NoteRow
                key={n.id}
                icon={<Star size={18} />}
                title={n.title || "Untitled"}
                subtitle={n.path || "No folder"}
                time={formatRelative(n.updatedAt)}
                onClick={() => openItem(n)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Continue where you left off */}
      {isEmpty ? (
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
      ) : (
        <CollapsibleSection
          icon={<History size={16} />}
          title="Continue where you left off"
          count={recents.length}
          open={recentsOpen}
          onToggle={toggleRecents}
        >
          <div className="flex flex-col gap-1.5">
            {(recentsOpen ? recents : recents.slice(0, 3)).map((entry) => (
              <NoteRow
                key={`${entry.source}-${entry.id}`}
                icon={entry.source === "journal" ? <CalendarDays size={18} /> : <FileText size={18} />}
                title={entry.title || "Untitled"}
                subtitle={entry.source === "journal" ? "Journal" : entry.path || "No folder"}
                time={formatRelative(entry.updatedAt)}
                onClick={() => openItem(entry)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Pinned collections */}
      {collections.filter((c) => c.pinned).length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading icon={<Disc3 size={16} />} title="Collections" />
          <div className="grid grid-cols-2 gap-2">
            {collections.filter((c) => c.pinned).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setGalleryCollection(c)}
                className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl transition-[transform,background] active:scale-[0.98]"
                style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
              >
                <span style={{ color: "var(--mob-accent)" }}><Disc3 size={20} /></span>
                <span className="text-xs font-medium">{c.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Bookmarks */}
      {bookmarkNotes.length > 0 && (
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
          <div className="flex flex-col gap-1.5">
            {(bookmarksOpen ? bookmarkNotes : bookmarkNotes.slice(0, 3)).map((n) => (
              <NoteRow
                key={n.id}
                icon={<Bookmark size={18} />}
                title={n.title || "Untitled"}
                subtitle={n.path || "No folder"}
                time={formatRelative(n.updatedAt)}
                onClick={() => openItem(n)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Todo list */}
      {openTasks.length > 0 && (
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
          <div className="flex flex-col gap-1.5">
            {(tasksOpen ? openTasks : openTasks.slice(0, 3)).map((t) => (
              <div
                key={`${t.vaultId}-${t.noteId}-${t.line}`}
                className="flex min-h-[48px] items-center gap-3 rounded-xl px-2 py-1.5"
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
                  <span className="truncate text-xs" style={{ color: "var(--mob-muted)" }}>
                    {t.noteTitle || "Untitled"}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Tags at the bottom */}
      {allTags.length > 0 && (
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
          <div className="flex flex-wrap gap-2 px-1">
            {allTags.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("nexote:select-tag", { detail: t.name }))
                }
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-transform active:scale-95"
                style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
              >
                <Hash size={13} style={{ color: "var(--mob-accent)" }} />
                {t.name}
                <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{t.count}</span>
              </button>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {galleryCollection && (
        <CollectionGallery
          open={Boolean(galleryCollection)}
          collection={galleryCollection}
          onClose={() => setGalleryCollection(null)}
          onOpenNote={(vaultId, id) => void openNoteInVault(vaultId, id)}
          onCollectionChanged={(c) => {
            setGalleryCollection(c);
            void api.listCollections().then((res) => setCollections(res.collections ?? []));
          }}
        />
      )}
      <CollectionFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          void api.listCollections().then((res) => setCollections(res.collections ?? []));
        }}
      />
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
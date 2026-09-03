"use client";

import {
  ArrowRight,
  Bookmark,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Disc3,
  FilePlus,
  FileText,
  FolderPlus,
  Hash,
  History,
  ListTodo,
  Search,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { CollectionMeta } from "@/lib/api";
import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";
import CollectionFormDialog from "./CollectionFormDialog";
import CollectionGallery from "./CollectionGallery";

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

type RecentEntry = {
  id: string;
  title: string;
  path: string;
  updatedAt: string;
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

export default function WelcomeDashboard({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const {
    notes,
    openTab,
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

  useEffect(() => {
    if (vaults.length === 0) return;
    for (const v of vaults) void refreshTags(v.id);
  }, [vaults, refreshTags]);

  const openPalette = () => {
    if (onOpenPalette) onOpenPalette();
    else window.dispatchEvent(new CustomEvent("nexote:open-palette"));
  };

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

  const openTasks = useMemo(() => tasks.filter((t) => !t.checked), [tasks]);
  const openTaskNote = (task: (typeof tasks)[number]) => {
    if (task.vaultId === "journal") void openJournalNote(task.noteId);
    else void openNoteInVault(task.vaultId, task.noteId);
  };

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tags of Object.values(tagsByVault)) {
      for (const t of tags) counts.set(t.name, (counts.get(t.name) ?? 0) + t.count);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [tagsByVault]);

  const pinned = collections.filter((c) => c.pinned);

  const [recentsOpen, toggleRecents] = useSectionState("recents", true);
  const [shortcutsOpen, toggleShortcuts] = useSectionState("shortcuts", true);
  const [bookmarksOpen, toggleBookmarks] = useSectionState("bookmarks", true);
  const [tasksOpen, toggleTasks] = useSectionState("tasks", true);
  const [tagsOpen, toggleTags] = useSectionState("tags", true);

  return (
    <main className="flex flex-1 items-start justify-center overflow-y-auto bg-background p-6 md:p-10">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        {/* Hero */}
        <div className="flex flex-col items-center gap-2 pt-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: "var(--muted)" }}>
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
            Welcome to Nexote
          </h1>
        </div>

        {/* Row 1: Quick actions */}
        <div className="grid grid-cols-3 gap-3">
          <QuickAction icon={<FilePlus className="h-5 w-5" />} label="New note" hint="Ctrl+Shift+N" onClick={() => void create()} />
          <QuickAction icon={<CalendarDays className="h-5 w-5" />} label="Today" hint="Ctrl+D" onClick={() => void openDaily()} />
          <QuickAction icon={<Search className="h-5 w-5" />} label="Search" hint="Ctrl+P" onClick={openPalette} />
        </div>

        {/* Shortcuts (3 preview, clickable header → all shortcuts) */}
        {shortcutNotes.length > 0 && (
          <CollapsibleSection
            icon={<Star className="h-4 w-4" />}
            title="Shortcuts"
            count={shortcutNotes.length}
            open={shortcutsOpen}
            onToggle={toggleShortcuts}
            onViewAll={() => window.dispatchEvent(new CustomEvent("nexote:select-view", { detail: "shortcuts" }))}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(shortcutsOpen ? shortcutNotes : shortcutNotes.slice(0, 3)).map((n) => (
                <NoteCard
                  key={n.id}
                  icon={<Star className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
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
        {recents.length > 0 ? (
          <CollapsibleSection
            icon={<History className="h-4 w-4" />}
            title="Continue where you left off"
            count={recents.length}
            open={recentsOpen}
            onToggle={toggleRecents}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(recentsOpen ? recents : recents.slice(0, 3)).map((entry) => (
                <NoteCard
                  key={`${entry.source}-${entry.id}`}
                  icon={entry.source === "journal" ? <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground/60" /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
                  title={entry.title || "Untitled"}
                  subtitle={entry.source === "journal" ? "Journal" : entry.path || "No folder"}
                  time={formatRelative(entry.updatedAt)}
                  onClick={() => openItem(entry)}
                />
              ))}
            </div>
          </CollapsibleSection>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 text-center">
            <FileText className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No notes yet</p>
            <p className="text-xs text-muted-foreground">Create a note or open today's journal to get started.</p>
          </div>
        )}

        {/* Pinned collections */}
        {pinned.length > 0 && (
          <div className="flex flex-col gap-2">
            <SectionHeading icon={<Disc3 className="h-4 w-4" />} title="Collections" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {pinned.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setGalleryCollection(c)}
                  className="group flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Disc3 className="h-5 w-5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-foreground">{c.name}</span>
                    <span className="mt-0.5 text-xs text-muted-foreground">Browse the {c.name.toLowerCase()} gallery</span>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* New collection */}
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="group flex items-center gap-3 rounded-xl border border-dashed border-border p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderPlus className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">New collection</span>
            <span className="mt-0.5 text-xs text-muted-foreground">Create a customizable collection</span>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary" />
        </button>

        {/* Bookmarks */}
        {bookmarkNotes.length > 0 && (
          <CollapsibleSection
            icon={<Bookmark className="h-4 w-4" />}
            title="Bookmarks"
            count={bookmarkNotes.length}
            open={bookmarksOpen}
            onToggle={toggleBookmarks}
            onViewAll={() => window.dispatchEvent(new CustomEvent("nexote:select-view", { detail: "bookmarks" }))}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(bookmarksOpen ? bookmarkNotes : bookmarkNotes.slice(0, 3)).map((n) => (
                <NoteCard
                  key={n.id}
                  icon={<Bookmark className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
                  title={n.title || "Untitled"}
                  subtitle={n.path || "No folder"}
                  time={formatRelative(n.updatedAt)}
                  onClick={() => openItem(n)}
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Todo */}
        {openTasks.length > 0 && (
          <CollapsibleSection
            icon={<ListTodo className="h-4 w-4" />}
            title="Todo"
            count={openTasks.length}
            open={tasksOpen}
            onToggle={toggleTasks}
            onViewAll={() => window.dispatchEvent(new CustomEvent("nexote:select-view", { detail: "tasks" }))}
          >
            <div className="flex flex-col gap-1.5">
              {(tasksOpen ? openTasks : openTasks.slice(0, 3)).map((t) => (
                <div
                  key={`${t.vaultId}-${t.noteId}-${t.line}`}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleTaskItem(t.vaultId, t.noteId, t.line, !t.checked);
                    }}
                    className="flex shrink-0 items-center justify-center rounded"
                    style={{ width: 18, height: 18, border: `2px solid var(--primary)`, background: "transparent" }}
                  />
                  <button type="button" onClick={() => openTaskNote(t)} className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="truncate text-sm font-medium text-foreground">{t.text}</span>
                    <span className="truncate text-xs text-muted-foreground">{t.noteTitle || "Untitled"}</span>
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Tags at the bottom */}
        {allTags.length > 0 && (
          <CollapsibleSection
            icon={<Hash className="h-4 w-4" />}
            title="Tags"
            count={allTags.length}
            open={tagsOpen}
            onToggle={toggleTags}
            onViewAll={() => window.dispatchEvent(new CustomEvent("nexote:select-view", { detail: "tags" }))}
          >
            <div className="flex flex-wrap gap-2">
              {allTags.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("nexote:select-tag", { detail: t.name }))}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                >
                  <Hash size={13} className="text-primary" />
                  {t.name}
                  <span className="text-xs text-muted-foreground">{t.count}</span>
                </button>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Keyboard shortcuts reference */}
        <div className="flex flex-col gap-2">
          <SectionHeading icon={<Search className="h-4 w-4" />} title="Keyboard shortcuts" />
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["Ctrl+Shift+N", "Create new note"],
                  ["Ctrl+D", "Open daily note"],
                  ["Ctrl+Shift+D", "Open dashboard"],
                  ["Ctrl+P", "Command palette / search"],
                  ["Ctrl+S", "Save current note"],
                  ["Ctrl+W", "Close tab"],
                  ["Ctrl+Tab", "Next tab"],
                  ["Ctrl+B", "Toggle sidebar"],
                  ["Esc", "Close dialog"],
                ].map(([key, label]) => (
                  <tr key={key} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-muted-foreground">{label}</td>
                    <td className="px-4 py-2 text-right">
                      <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">{key}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

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
    <section className="flex flex-col gap-2">
      <button type="button" onClick={onToggle} className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        {count !== undefined && <span className="text-xs text-muted-foreground/60">{count}</span>}
        <ChevronDown
          size={16}
          className="ml-auto text-muted-foreground transition-transform"
          style={{ transform: open ? "none" : "rotate(-90deg)" }}
        />
      </button>
      {open && onViewAll && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-0.5 text-xs font-medium text-primary"
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

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
    </div>
  );
}

function NoteCard({
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
      className="group flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground/60">{subtitle}</span>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground/60">{time}</span>
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
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 rounded-xl border border-border p-4 transition-colors hover:border-primary/40 hover:bg-muted/50"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors group-hover:text-primary">
        {icon}
      </span>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">{hint}</kbd>
    </button>
  );
}
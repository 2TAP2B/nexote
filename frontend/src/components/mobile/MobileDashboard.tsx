"use client";

import { useMemo } from "react";
import {
  Bookmark,
  CalendarDays,
  FilePlus,
  FileText,
  History,
  Search,
  Star,
} from "lucide-react";

import { useNotes } from "@/lib/notes-context";

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

// Mobile quick-start dashboard. Shown when no note is open: a "continue where
// you left off" list of the 5 most recently edited notes (across all vaults
// and the journal), plus the quick actions and the bookmarked/shortcut notes.
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
  } = useNotes();

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  // Merge every vault's notes + the journal into one recency-sorted list.
  const recents = useMemo<RecentEntry[]>(() => {
    const items: RecentEntry[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        items.push({
          id: n.id,
          title: n.title,
          path: n.path,
          updatedAt: n.updatedAt,
          vaultId: v.id,
          source: "vault",
        });
      }
    }
    for (const j of journalNotes) {
      items.push({
        id: j.id,
        title: j.title,
        path: j.path,
        updatedAt: j.updatedAt,
        vaultId: "journal",
        source: "journal",
      });
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items.slice(0, 5);
  }, [vaults, allVaultData, journalNotes]);

  // Bookmarks / shortcuts are pooled across all vaults (one shared list),
  // newest-first.
  const bookmarkNotes = useMemo(() => {
    const items: RecentEntry[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (bookmarks.has(n.id)) {
          items.push({
            id: n.id,
            title: n.title,
            path: n.path,
            updatedAt: n.updatedAt,
            vaultId: v.id,
            source: "vault",
          });
        }
      }
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items.slice(0, 6);
  }, [vaults, allVaultData, bookmarks]);
  const shortcutNotes = useMemo(() => {
    const items: RecentEntry[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (shortcuts.has(n.id)) {
          items.push({
            id: n.id,
            title: n.title,
            path: n.path,
            updatedAt: n.updatedAt,
            vaultId: v.id,
            source: "vault",
          });
        }
      }
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items.slice(0, 6);
  }, [vaults, allVaultData, shortcuts]);

  const openItem = (entry: RecentEntry) => {
    if (entry.source === "journal") void openJournalNote(entry.id);
    else void openNoteInVault(entry.vaultId, entry.id);
  };

  const isEmpty = recents.length === 0;

  return (
    <main
      className="flex flex-col gap-5 px-4 pb-40 pt-2"
      style={{ color: "var(--mob-text)" }}
    >
      {/* Header */}
      <div className="px-1 pt-1">
        <p
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--mob-muted)" }}
        >
          {greeting}
        </p>
        <h1 className="text-2xl font-bold">Nexote</h1>
      </div>

      {/* Quick actions — large touch targets */}
      <div className="grid grid-cols-3 gap-2">
        <QuickAction
          icon={<FilePlus size={22} />}
          label="New note"
          onClick={onNewNote}
        />
        <QuickAction
          icon={<CalendarDays size={22} />}
          label="Today"
          onClick={onOpenDaily}
        />
        <QuickAction
          icon={<Search size={22} />}
          label="Search"
          onClick={onOpenSearch}
        />
      </div>

      {/* Continue where you left off */}
      {isEmpty ? (
        <div
          className="flex flex-col items-center gap-2 rounded-2xl px-6 py-8 text-center"
          style={{ background: "var(--mob-card)" }}
        >
          <FileText size={24} style={{ color: "var(--mob-muted)" }} />
          <p className="text-sm font-medium">No notes yet</p>
          <p className="text-xs" style={{ color: "var(--mob-muted)" }}>
            Tap “New note” to create your first note, or open the journal.
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-2">
          <SectionHeading
            icon={<History size={16} />}
            title="Continue where you left off"
          />
          <div className="flex flex-col gap-1.5">
            {recents.map((entry) => (
              <NoteRow
                key={`${entry.source}-${entry.id}`}
                icon={
                  entry.source === "journal" ? (
                    <CalendarDays size={18} />
                  ) : (
                    <FileText size={18} />
                  )
                }
                title={entry.title || "Untitled"}
                subtitle={
                  entry.source === "journal"
                    ? "Journal"
                    : entry.path || "No folder"
                }
                time={formatRelative(entry.updatedAt)}
                onClick={() => openItem(entry)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Shortcuts */}
      {shortcutNotes.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading
            icon={<Star size={16} />}
            title="Shortcuts"
            count={shortcutNotes.length}
          />
          <div className="flex flex-col gap-1.5">
            {shortcutNotes.map((n) => (
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
        </section>
      )}

      {/* Bookmarks */}
      {bookmarkNotes.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading
            icon={<Bookmark size={16} />}
            title="Bookmarks"
            count={bookmarkNotes.length}
          />
          <div className="flex flex-col gap-1.5">
            {bookmarkNotes.map((n) => (
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
        </section>
      )}
    </main>
  );
}

function SectionHeading({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1">
      <span style={{ color: "var(--mob-accent)" }}>{icon}</span>
      <h2
        className="text-sm font-semibold tracking-wide"
        style={{ color: "var(--mob-text)" }}
      >
        {title}
      </h2>
      {count !== undefined && (
        <span className="text-xs" style={{ color: "var(--mob-muted)" }}>
          {count}
        </span>
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
      className="flex min-h-[56px] items-center gap-3 rounded-2xl px-3 py-2 text-left transition-[transform,background] active:scale-[0.98]"
      style={{ background: "var(--mob-card)" }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{
          background: "var(--mob-surface)",
          color: "var(--mob-accent)",
        }}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-[15px] font-medium"
          style={{ color: "var(--mob-text)" }}
        >
          {title}
        </span>
        <span
          className="truncate text-xs"
          style={{ color: "var(--mob-muted)" }}
        >
          {subtitle}
        </span>
      </span>
      <span
        className="shrink-0 text-xs tabular-nums"
        style={{ color: "var(--mob-muted)" }}
      >
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
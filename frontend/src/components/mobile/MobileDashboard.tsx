"use client";

import { CalendarDays, FilePlus, FileText, Search, Sparkles } from "lucide-react";

import { useNotes } from "@/lib/notes-context";

// Mobile-optimized welcome screen shown when no note is open. No keyboard
// shortcuts (touch devices don't use them), big tap targets, mobile palette.
export default function MobileDashboard({
  onOpenSearch,
  onNewNote,
  onOpenDaily,
}: {
  onOpenSearch: () => void;
  onNewNote: () => void;
  onOpenDaily: () => void;
}) {
  const { notes, openTab } = useNotes();

  const recent = [...notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  return (
    <main
      className="flex flex-col items-center gap-8 px-5 pb-32 pt-6"
      style={{ color: "var(--mob-text)" }}
    >
      {/* Hero */}
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: "var(--mob-surface)" }}
        >
          <FileText size={26} style={{ color: "var(--mob-muted)" }} />
        </div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--mob-text)" }}>
          Nexote
        </h1>
        <p className="text-sm" style={{ color: "var(--mob-muted)" }}>
          Create a note, open today's journal, or search your vault.
        </p>
      </div>

      {/* Quick actions — large tap targets */}
      <div className="flex w-full max-w-sm flex-col gap-2">
        <ActionRow icon={<FilePlus size={22} />} label="New note" onClick={onNewNote} />
        <ActionRow
          icon={<Sparkles size={22} />}
          label="Today's daily note"
          onClick={onOpenDaily}
        />
        <ActionRow icon={<Search size={22} />} label="Search notes" onClick={onOpenSearch} />
      </div>

      {/* Recent notes */}
      {recent.length > 0 && (
        <div className="flex w-full max-w-sm flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <CalendarDays size={16} style={{ color: "var(--mob-muted)" }} />
            <h2
              className="text-sm font-medium"
              style={{ color: "var(--mob-muted)" }}
            >
              Recent
            </h2>
          </div>
          <div className="flex flex-col gap-1">
            {recent.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void openTab(n.id)}
                className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors active:scale-[0.98]"
                style={{ background: "var(--mob-card)" }}
              >
                <FileText
                  size={18}
                  className="shrink-0"
                  style={{ color: "var(--mob-muted)" }}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="truncate text-[15px]"
                    style={{ color: "var(--mob-text)" }}
                  >
                    {n.title || "Untitled"}
                  </span>
                  {n.path && (
                    <span
                      className="truncate text-xs"
                      style={{ color: "var(--mob-muted)" }}
                    >
                      {n.path}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function ActionRow({
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
      className="flex min-h-[52px] items-center gap-3 rounded-xl px-4 text-left transition-transform active:scale-[0.98]"
      style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
    >
      <span className="shrink-0" style={{ color: "var(--mob-accent)" }}>
        {icon}
      </span>
      <span className="text-[15px] font-medium">{label}</span>
    </button>
  );
}
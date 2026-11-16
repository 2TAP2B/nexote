"use client";

import { Clock, History, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api, type HistoryVersion } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import { useCanEdit } from "@/components/useCanEdit";

type Props = {
  open: boolean;
  noteId: string;
  isJournal: boolean;
  onClose: () => void;
  onRestored: () => void;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Side panel listing a note's saved versions, with a Restore action per
// version. Restoring writes the version back as the current body through the
// normal save path.
export default function NoteHistoryPanel({
  open,
  noteId,
  isJournal,
  onClose,
  onRestored,
}: Props) {
  const { activeVault, isJournalNote } = useNotes();
  const canRestore = useCanEdit().canEditNote(noteId);
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const journal = isJournal || isJournalNote(noteId);
  const vaultId = journal ? "journal" : activeVault?.id;

  useEffect(() => {
    if (!open || !vaultId) return;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const res = journal
          ? await api.journalListHistory(noteId)
          : await api.listHistory(vaultId, noteId);
        setVersions(res.versions ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load history");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [open, noteId, vaultId, journal]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !vaultId) return null;

  const restore = async (ts: string) => {
    setRestoring(ts);
    setError(null);
    try {
      if (journal) {
        await api.journalRestoreHistoryVersion(noteId, ts);
      } else {
        await api.restoreHistoryVersion(vaultId, noteId, ts);
      }
      onRestored();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore version");
    } finally {
      setRestoring(null);
    }
  };

  // Same look as the mobile action sheets: a bottom sheet with a grab handle
  // on mobile (a side panel on desktop), versions in one rounded group.
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-stretch md:justify-end"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Note history"
        className="flex max-h-[85vh] w-full flex-col rounded-t-[20px] bg-background text-foreground shadow-2xl md:h-full md:max-h-none md:max-w-sm md:rounded-none md:border-l md:border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/35 md:hidden" />
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-3">
          <span className="w-9 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 text-center">
            <h2 className="text-[15px] font-semibold">Note history</h2>
            {!loading && versions.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {versions.length} saved version{versions.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close history"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading history…</span>
            </div>
          ) : error ? (
            <p className="py-6 text-center text-sm text-red-500">{error}</p>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Clock className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No saved versions yet. Versions are captured each time the note
                is saved.
              </p>
            </div>
          ) : (
            <ul className="overflow-hidden rounded-xl bg-muted/60">
              {versions.map((v, i) => (
                <li key={v.timestamp}>
                  {i > 0 && <div aria-hidden className="ml-[52px] border-t border-border/70" />}
                  <div className="flex items-center gap-4 px-4 py-3">
                    <History className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] md:text-sm">{formatTime(v.timestamp)}</p>
                      <p className={"mt-0.5 line-clamp-2 text-xs " + (v.snippet ? "text-muted-foreground" : "text-muted-foreground/50")}>
                        {v.snippet || "(empty)"}
                      </p>
                    </div>
                    {canRestore && (
                      <button
                        type="button"
                        onClick={() => void restore(v.timestamp)}
                        disabled={restoring === v.timestamp}
                        className="flex shrink-0 items-center gap-1.5 rounded-full bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        {restoring === v.timestamp ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        Restore
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

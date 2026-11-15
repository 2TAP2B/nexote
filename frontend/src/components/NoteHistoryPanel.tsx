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

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Note history"
        className="flex h-full w-full max-w-sm flex-col border-l border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="flex-1 text-sm font-semibold text-foreground">
            Note history
          </h2>
          <button
            type="button"
            aria-label="Close history"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
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
            <div className="flex flex-col gap-2">
              {versions.map((v) => (
                <div
                  key={v.timestamp}
                  className="flex items-start gap-2 rounded-xl border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">
                      {formatTime(v.timestamp)}
                    </p>
                    {v.snippet ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {v.snippet}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground/50">
                        (empty)
                      </p>
                    )}
                  </div>
                  {canRestore && (
                    <button
                      type="button"
                      onClick={() => void restore(v.timestamp)}
                      disabled={restoring === v.timestamp}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

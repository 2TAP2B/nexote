"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect } from "react";

type DeleteConfirmProps = {
  open: boolean;
  noteId: string | null;
  onCancel: () => void;
  onConfirm: (id: string) => Promise<void> | void;
};

// A minimal accessible confirmation dialog. Rendered in place (no portal) to
// keep deps small; the backdrop closes on click/Esc.
export default function DeleteConfirm({
  open,
  noteId,
  onCancel,
  onConfirm,
}: DeleteConfirmProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !noteId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Delete note"
        className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              Delete note?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This cannot be undone.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(noteId)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
"use client";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Delete note"
        className="w-full max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">Delete note?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(noteId)}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
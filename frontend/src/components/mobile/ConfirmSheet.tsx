"use client";

import { BottomSheet } from "./BottomSheet";

/** A bottom sheet confirming a destructive action, e.g. deleting a note. */
export function ConfirmSheet({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet title={title} onClose={onClose}>
      {({ dismiss, closeNow }) => (
        <div className="flex flex-col gap-3 px-4">
          {message && <p className="text-center text-sm text-muted-foreground">{message}</p>}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                closeNow();
                onConfirm();
              }}
              className="h-11 w-full rounded-xl bg-red-600 text-[15px] font-semibold text-white active:bg-red-700"
            >
              {confirmLabel}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="h-11 w-full rounded-xl bg-muted/60 text-[15px] font-medium active:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

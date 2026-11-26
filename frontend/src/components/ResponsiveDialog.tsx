"use client";

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useAndroidBack } from "@/lib/android-back";
import { BottomSheet } from "./mobile/BottomSheet";
import { ConfirmSheet } from "./mobile/ConfirmSheet";

// Dialogs that are a bottom sheet on the phone and a centered card on the
// desktop, with the same content: forms (a collection, an item) and
// confirmations. The desktop card is portaled like the sheet, so a parent's
// transform or overflow can't trap it.

// Open desktop dialogs, newest last: Escape closes only the top one (a
// confirmation over an editor closes alone).
const stack: string[] = [];

// (The touch sheet registers its own Android Back.)
function useEscapeOnTop(id: string, onClose: () => void, enabled: boolean) {
  const close = useRef(onClose);
  close.current = onClose;
  useAndroidBack(onClose, enabled);
  useEffect(() => {
    if (!enabled) return;
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack[stack.length - 1] !== id) return;
      // A popover inside (the icon grid) closes first, on its own.
      if (document.querySelector("[data-settings-popover]")) return;
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [id, enabled]);
}

/**
 * A form or panel: the touch shell's bottom sheet (`touch`) or a centered
 * desktop card. The body scrolls; the footer's buttons stay in view. Its
 * `close` slides the sheet out first (use it for Cancel).
 */
export function ResponsiveDialog({
  touch,
  title,
  subtitle,
  onClose,
  footer,
  children,
  width = 520,
}: {
  touch: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: (close: () => void) => ReactNode;
  children: ReactNode;
  /** The desktop card's max width in px. */
  width?: number;
}) {
  const id = useId();
  useEscapeOnTop(id, onClose, !touch);

  if (touch) {
    return (
      <BottomSheet title={title} subtitle={subtitle} onClose={onClose}>
        {({ dismiss }) => (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
            {footer && <div className="flex shrink-0 gap-2 border-t border-border/60 px-4 pt-3">{footer(dismiss)}</div>}
          </>
        )}
      </BottomSheet>
    );
  }

  return createPortal(
    <div
      data-overlay-dialog=""
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[min(88vh,860px)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-2xl"
        style={{ maxWidth: width }}
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1.5 -mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">{footer(onClose)}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Confirms a destructive action: ConfirmSheet on the phone, a small card on the desktop. */
export function ConfirmDialog({
  touch,
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
}: {
  touch: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const id = useId();
  useEscapeOnTop(id, onClose, !touch);

  if (touch) {
    return <ConfirmSheet title={title} message={message} confirmLabel={confirmLabel} onConfirm={onConfirm} onClose={onClose} />;
  }

  return createPortal(
    <div
      data-overlay-dialog=""
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <AlertTriangle size={19} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            {message && <p className="mt-1 text-sm text-muted-foreground">{message}</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="h-9 rounded-xl border border-border px-4 text-sm transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className="h-9 rounded-xl bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

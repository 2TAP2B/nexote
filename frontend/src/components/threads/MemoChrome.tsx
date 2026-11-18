"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Chrome shared by the chat-style memo views (quick notes, a thread): header
// buttons, selection circles, the toast, the composer's error line and the
// full-screen image viewer. Painted with the --mob-* palette.

export function HeaderButton({
  label,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-40" +
        (danger ? " text-red-600 dark:text-red-400" : "")
      }
      style={{ background: "var(--mob-surface)", color: danger ? undefined : "var(--mob-text)" }}
    >
      {children}
    </button>
  );
}

// The circle left of a memo: tap to select it (several can be selected).
export function SelectCircle({
  selected,
  onToggle,
  label = "Select memo",
}: {
  selected: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={onToggle}
      className="flex h-9 w-9 shrink-0 items-center justify-center"
    >
      <span
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full transition-colors"
        style={
          selected
            ? { background: "var(--mob-accent)", color: "#fff" }
            : { border: "2px solid color-mix(in srgb, var(--mob-muted) 55%, transparent)" }
        }
      >
        {selected && <Check size={14} strokeWidth={3} />}
      </span>
    </button>
  );
}

export type Toast = { text: string; action?: { label: string; run: () => void } };

/** A short status line; one with an action (Undo, Open) stays longer. */
export function useMemoToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const showToast = (text: string, action?: Toast["action"]) => {
    setToast({ text, action });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), action ? 5000 : 1600);
  };
  return { toast, showToast, dismissToast: () => setToast(null) };
}

export function MemoToast({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      className={
        "absolute left-1/2 top-20 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-full bg-black/80 px-3.5 py-1.5 text-xs font-medium text-white" +
        (toast.action ? "" : " pointer-events-none")
      }
    >
      <span className="truncate">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            onDismiss();
          }}
          className="shrink-0 font-semibold underline-offset-2 active:underline"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

/** The error line above the composer; a failed transcription offers Retry. */
export function DraftError({
  error,
  canRetry,
  onRetry,
  onDiscard,
}: {
  error: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-3 px-3 pb-1 text-xs" style={{ color: "#f87171" }}>
      <span className="min-w-0 flex-1">{error}</span>
      {canRetry && (
        <>
          <button type="button" onClick={onRetry} className="shrink-0 font-semibold" style={{ color: "var(--mob-accent)" }}>
            Retry
          </button>
          <button type="button" onClick={onDiscard} className="shrink-0" style={{ color: "var(--mob-muted)" }}>
            Discard
          </button>
        </>
      )}
    </div>
  );
}

// Full-screen image, portaled out of the pager (its transform would anchor a
// fixed overlay to the track instead of the screen).
export function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Marked handled, and in the capture phase so it runs first: the
      // desktop thread panel must not close along with the image.
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-label="Image"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-2"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- vault image */}
      <img src={url} alt="" className="max-h-full max-w-full object-contain" />
      <button
        type="button"
        aria-label="Close image"
        onClick={onClose}
        className="absolute right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <X size={20} />
      </button>
    </div>,
    document.body,
  );
}

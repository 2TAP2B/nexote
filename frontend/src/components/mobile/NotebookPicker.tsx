"use client";

import { Check, Folder, Notebook as NotebookIcon, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { listNotebooks, notebookKey, type Notebook } from "@/lib/notebooks";
import { useNotes } from "@/lib/notes-context";

/** A choice listed above the notebooks (e.g. "Private — only you"). */
export type SheetOption = { key: string; label: string; hint?: string; icon: ReactNode };

/**
 * Bottom sheet listing every notebook (vault root or folder) the user may
 * write to, across spaces. Used to pick where memo notes and the Notepad go
 * and as the mobile "Move to…" dialog.
 */
export function NotebookSheet({
  title,
  description,
  options = [],
  selected,
  onPick,
  onPickOption,
  onClose,
}: {
  title: string;
  description?: string;
  options?: SheetOption[];
  /** notebookKey() of the current notebook, or an option key. */
  selected?: string;
  onPick: (notebook: Notebook) => void;
  onPickOption?: (key: string) => void;
  onClose: () => void;
}) {
  const { allVaults, allVaultData, spaces } = useNotes();
  const notebooks = listNotebooks(allVaults, allVaultData, spaces);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const row = (key: string, depth: number, icon: ReactNode, label: string, hint: string | undefined, onClick: () => void) => (
    <li key={key}>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected === key ? "true" : undefined}
        className="flex w-full items-center gap-3 rounded-xl py-3 pr-3 text-left transition-colors active:bg-muted"
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px]">{label}</span>
          {hint && <span className="truncate text-[12px] text-muted-foreground">{hint}</span>}
        </span>
        {selected === key && <Check size={18} className="shrink-0 text-primary" />}
      </button>
    </li>
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[75vh] flex-col rounded-t-2xl border-t border-border bg-background text-foreground shadow-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-start gap-3 px-4 pb-2 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Cancel"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
          >
            <X size={18} />
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {options.map((o) => row(o.key, 0, o.icon, o.label, o.hint, () => onPickOption?.(o.key)))}
          {options.length > 0 && <li aria-hidden className="mx-3 my-1 border-t border-border" />}
          {notebooks.map((n) =>
            row(
              notebookKey(n),
              n.depth,
              n.depth === 0 ? (
                <NotebookIcon size={18} className="shrink-0 text-primary" />
              ) : (
                <Folder size={18} className="shrink-0 text-muted-foreground" />
              ),
              n.depth === 0 ? n.label : (n.folder.split("/").pop() ?? n.folder),
              undefined,
              () => onPick(n),
            ),
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Asks where notes made from memos go. Shown the first time "Make note" is
 * used; the choice becomes the default (Settings › Features).
 */
export function NotebookPicker({ onPick, onClose }: { onPick: (notebook: Notebook) => void; onClose: () => void }) {
  return (
    <NotebookSheet
      title="Where should memo notes go?"
      description="Notes made from memos are saved here from now on. You can change it in Settings › Features."
      onPick={onPick}
      onClose={onClose}
    />
  );
}

"use client";

import { Folder, Notebook as NotebookIcon, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { listNotebooks, notebookKey, type Notebook } from "@/lib/notebooks";
import { useNotes } from "@/lib/notes-context";

/**
 * Bottom sheet asking where notes made from memos go. Shown the first time
 * "Make note" is used; the choice becomes the default (Settings › Features).
 */
export function NotebookPicker({ onPick, onClose }: { onPick: (notebook: Notebook) => void; onClose: () => void }) {
  const { allVaults, allVaultData, spaces } = useNotes();
  const notebooks = listNotebooks(allVaults, allVaultData, spaces);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a notebook"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[75vh] flex-col rounded-t-2xl border-t border-border bg-background text-foreground shadow-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-start gap-3 px-4 pb-2 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold">Where should memo notes go?</h2>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
              Notes made from memos are saved here from now on. You can change it in Settings › Features.
            </p>
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
          {notebooks.map((n) => (
            <li key={notebookKey(n)}>
              <button
                type="button"
                onClick={() => onPick(n)}
                className="flex w-full items-center gap-3 rounded-xl py-3 pr-3 text-left transition-colors active:bg-muted"
                style={{ paddingLeft: 12 + n.depth * 18 }}
              >
                {n.depth === 0 ? (
                  <NotebookIcon size={18} className="shrink-0 text-primary" />
                ) : (
                  <Folder size={18} className="shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-[15px]">
                  {n.depth === 0 ? n.label : n.folder.split("/").pop()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

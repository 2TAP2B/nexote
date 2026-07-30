"use client";

import { FolderPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type FolderCreateDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
  parentPath?: string;
};

// A small modal dialog for naming a new folder. Replaces window.prompt with a
// nicer centered dialog. The folder is created under parentPath (root if
// empty).
export default function FolderCreateDialog({
  open,
  onClose,
  onCreate,
  parentPath,
}: FolderCreateDialogProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const full = parentPath ? `${parentPath}/${name}` : name;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(full);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New folder"
        className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FolderPlus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              New folder
            </h2>
            {parentPath && (
              <p className="text-xs text-muted-foreground">
                in {parentPath}
              </p>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Folder name"
          className="mt-4 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
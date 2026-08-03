"use client";

import { FolderPlus, Settings, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useNotes } from "@/lib/notes-context";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function SettingsPanel({ open, onClose }: Props) {
  const {
    vaults,
    activeVault,
    switchVault,
    createVault,
    renameVault,
    deleteVault,
  } = useNotes();
  const [newVaultName, setNewVaultName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!open) {
      setNewVaultName("");
      setRenamingId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleCreate = async () => {
    const name = newVaultName.trim();
    if (!name) return;
    await createVault(name);
    setNewVaultName("");
  };

  const handleRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    await renameVault(id, name);
    setRenamingId(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Settings size={16} className="text-muted-foreground" />
          <span className="flex-1 text-sm font-medium text-foreground">
            Settings
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
          >
            <X size={16} />
          </button>
        </div>

        {/* Vault management */}
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-foreground">Vaults</h2>
          </div>

          {/* Vault list */}
          <div className="flex flex-col gap-1">
            {vaults.map((vault) => (
              <div
                key={vault.id}
                className={[
                  "flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
                  vault.id === activeVault?.id
                    ? "border-primary/40 bg-primary/10"
                    : "border-border hover:bg-muted/50",
                ].join(" ")}
              >
                {renamingId === vault.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename(vault.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => void handleRename(vault.id)}
                    className="min-w-0 flex-1 rounded border border-ring bg-background px-2 py-1 text-sm text-foreground outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => switchVault(vault.id)}
                    onDoubleClick={() => {
                      setRenamingId(vault.id);
                      setRenameValue(vault.name);
                    }}
                    className="min-w-0 flex-1 text-left text-sm text-foreground"
                  >
                    {vault.name}
                    {vault.id === activeVault?.id && (
                      <span className="ml-2 text-xs text-primary">active</span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Rename vault"
                  title="Rename vault"
                  onClick={() => {
                    setRenamingId(vault.id);
                    setRenameValue(vault.name);
                  }}
                  className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  Rename
                </button>
                {vault.name !== "Default" && (
                  <button
                    type="button"
                    aria-label="Delete vault"
                    title="Delete vault"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete vault "${vault.name}" and all its notes?`,
                        )
                      )
                        void deleteVault(vault.id);
                    }}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-muted"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Create new vault */}
          <div className="flex items-center gap-2">
            <input
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
              placeholder="New vault name…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newVaultName.trim()}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground/70">
          Double-click a vault name to rename. Click to switch active vault.
        </div>
      </div>
    </div>
  );
}
"use client";

import { Disc3, Pencil, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import type { NoteMeta } from "@/lib/api";
import VinylFormDialog from "./VinylFormDialog";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenNote: (vaultId: string, id: string) => void;
};

type Vinyl = NoteMeta & {
  artist?: string;
  year?: number;
  genre?: string;
  wantlist?: boolean;
  cover?: string;
  vaultId: string;
};

// Fullscreen cover grid for the vinyl collection, opened only from the
// dashboard. Aggregates type:vinyl notes across all vaults and groups them
// into Owned / Wantlist. Clicking a card opens the note in the editor.
export default function VinylGallery({ open, onClose, onOpenNote }: Props) {
  const { vaults, allVaultData, refresh, activeVault } = useNotes();
  const [filter, setFilter] = useState<"owned" | "wantlist">("owned");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vinyl | null>(null);

  const openForm = (v: Vinyl | null = null) => {
    setEditing(v);
    setFormOpen(true);
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const vinyls = useMemo<Vinyl[]>(() => {
    const items: Vinyl[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (n.type === "vinyl") {
          items.push({ ...n, vaultId: v.id });
        }
      }
    }
    // Artist A-Z, then album.
    items.sort((a, b) => {
      const artist = (a.artist || "").toLowerCase().localeCompare((b.artist || "").toLowerCase());
      if (artist !== 0) return artist;
      return (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
    });
    return items;
  }, [vaults, allVaultData]);

  const shown = vinyls.filter((v) =>
    filter === "owned" ? !v.wantlist : v.wantlist,
  );

  if (!open) return null;

  const openNote = (v: Vinyl) => {
    onOpenNote(v.vaultId, v.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 md:px-6" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          aria-label="Close gallery"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Disc3 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Vinyl collection</h1>
          <span className="text-sm text-muted-foreground">{vinyls.length}</span>
        </div>
        <div className="flex-1" />
        {/* Owned / Wantlist toggle */}
        <div className="flex gap-1 rounded-xl bg-muted/60 p-1">
          <button
            type="button"
            onClick={() => setFilter("owned")}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
              (filter === "owned"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground")
            }
          >
            Owned
          </button>
          <button
            type="button"
            onClick={() => setFilter("wantlist")}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
              (filter === "wantlist"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground")
            }
          >
            Wantlist
          </button>
        </div>
        <button
          type="button"
          onClick={() => openForm()}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add vinyl
        </button>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Disc3 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              No {filter === "owned" ? "owned" : "wantlisted"} vinyls yet.
            </p>
            <button
              type="button"
              onClick={() => openForm()}
              className="mt-1 flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              Add your first vinyl
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {shown.map((v) => (
              <div
                key={v.id}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-border text-left transition-[transform,background] hover:bg-muted/50"
              >
                <button
                  type="button"
                  aria-label="Edit vinyl"
                  onClick={(e) => {
                    e.stopPropagation();
                    openForm(v);
                  }}
                  className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => openNote(v)}
                  className="flex flex-col text-left active:scale-[0.98]"
                >
                <div
                  className="flex aspect-square w-full items-center justify-center overflow-hidden bg-muted/40"
                >
                  {v.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.cover}
                      alt={v.title}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <Disc3 className="h-8 w-8 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 p-2.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {v.title || "Untitled"}
                  </span>
                  {v.artist && (
                    <span className="truncate text-xs text-muted-foreground">
                      {v.artist}
                    </span>
                  )}
                  {(v.year || v.genre) && (
                    <span className="truncate text-xs text-muted-foreground/70">
                      {[v.year, v.genre].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && activeVault && (
        <VinylFormDialog
          open={formOpen}
          note={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  );
}

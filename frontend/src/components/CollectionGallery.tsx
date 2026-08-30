"use client";

import { Disc3, Pencil, Pin, PinOff, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import type { CollectionMeta, NoteMeta } from "@/lib/api";
import CollectionFormDialog from "./CollectionFormDialog";
import CollectionItemForm from "./CollectionItemForm";

type Props = {
  open: boolean;
  collection: CollectionMeta;
  onClose: () => void;
  onExit?: () => void;
  onOpenNote: (vaultId: string, id: string) => void;
  onCollectionChanged?: (c: CollectionMeta) => void;
};

type Item = NoteMeta & {
  vaultId: string;
};

// Fullscreen cover grid for a collection. Aggregates notes tagged with
// collection=<id> across all vaults and renders them as a cover grid using the
// collection's custom fields. Clicking a card opens the note in the editor.
export default function CollectionGallery({
  open,
  collection,
  onClose,
  onExit,
  onOpenNote,
  onCollectionChanged,
}: Props) {
  const { vaults, allVaultData, refresh, activeVault } = useNotes();
  const [formOpen, setFormOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

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

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (n.collection === collection.id) {
          list.push({ ...n, vaultId: v.id });
        }
      }
    }
    // Sort by title A-Z.
    list.sort((a, b) =>
      (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase()),
    );
    return list;
  }, [vaults, allVaultData, collection.id]);

  if (!open) return null;

  const openForm = (item: Item | null = null) => {
    setEditing(item);
    setFormOpen(true);
  };

  const togglePin = async () => {
    try {
      const updated = await api.setCollectionPinned(collection.id, !collection.pinned);
      onCollectionChanged?.(updated);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 md:px-6"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <button
          type="button"
          aria-label="Close gallery"
          onClick={() => (onExit ? onExit() : onClose())}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Disc3 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">
            {collection.name}
          </h1>
          <span className="text-sm text-muted-foreground">{items.length}</span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          aria-label={collection.pinned ? "Unpin from dashboard" : "Pin to dashboard"}
          title={collection.pinned ? "Unpin from dashboard" : "Pin to dashboard"}
          onClick={() => void togglePin()}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {collection.pinned ? (
            <Pin className="h-4 w-4 text-primary" />
          ) : (
            <PinOff className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          aria-label="Edit collection"
          title="Edit collection"
          onClick={() => setEditOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => openForm()}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add item
        </button>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Disc3 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              No items in {collection.name} yet.
            </p>
            <button
              type="button"
              onClick={() => openForm()}
              className="mt-1 flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              Add your first item
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item) => (
              <div
                key={item.id}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-border text-left transition-[transform,background] hover:bg-muted/50"
              >
                <button
                  type="button"
                  aria-label="Edit item"
                  onClick={(e) => {
                    e.stopPropagation();
                    openForm(item);
                  }}
                  className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenNote(item.vaultId, item.id);
                    onClose();
                  }}
                  className="flex flex-col text-left active:scale-[0.98]"
                >
                  <div className="flex aspect-square w-full items-center justify-center overflow-hidden bg-muted/40">
                    {item.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.cover}
                        alt={item.title}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      <Disc3 className="h-8 w-8 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 p-2.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.title || "Untitled"}
                    </span>
                    {collection.fields.slice(0, 2).map((f) => {
                      const val = item.fields?.[f.key];
                      if (!val) return null;
                      return (
                        <span
                          key={f.key}
                          className="truncate text-xs text-muted-foreground"
                        >
                          {val}
                        </span>
                      );
                    })}
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && activeVault && (
        <CollectionItemForm
          open={formOpen}
          collection={collection}
          note={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => void refresh()}
        />
      )}

      <CollectionFormDialog
        open={editOpen}
        collection={collection}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          void api.listCollections().then((res) => {
            const updated = (res.collections ?? []).find((c) => c.id === collection.id);
            if (updated) onCollectionChanged?.(updated);
          });
        }}
      />
    </div>
  );
}

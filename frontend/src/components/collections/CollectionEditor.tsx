"use client";

import { ChevronDown, ChevronUp, Library, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "@/lib/api";
import type { CollectionField, CollectionFieldType, CollectionMeta } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import { ConfirmDialog, ResponsiveDialog } from "../ResponsiveDialog";
import { IconPicker } from "../settings/IconPicker";
import { useCollectionActions } from "./actions";
import { DialogButton, FieldLabel, TextInput } from "./formParts";
import { useCollectionItems } from "./items";
import { deleteCollectionMessage, HIDE_COLLECTION_MESSAGE } from "./menus";
import { upsertCollection } from "./useCollections";

type Props = {
  touch: boolean;
  /** Present => edit; absent => create. */
  collection?: CollectionMeta | null;
  onClose: () => void;
  onSaved?: (c: CollectionMeta) => void;
  /** The collection was deleted or hidden from the editor. */
  onRemoved?: () => void;
};

const FIELD_TYPES: { value: CollectionFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes/No" },
  { value: "date", label: "Date" },
];

const isFieldType = (v: string): v is CollectionFieldType => FIELD_TYPES.some((t) => t.value === v);

// A row in the editor. `key` is set for fields that already exist — their
// values are stored under it, so it never changes; new rows get one on save.
type Row = { rowId: number; key?: string; label: string; type: CollectionFieldType };

/** "Release date" → "releaseDate" (ASCII letters and digits only). */
function keyFromLabel(label: string): string {
  const words = label
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const key = words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
  // Keys must start with a letter to be usable as identifiers.
  return /^[A-Za-z]/.test(key) ? key : key ? `field${key}` : "field";
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** Creates or edits a collection: icon, name and the fields its items record. */
export default function CollectionEditor({ touch, collection, onClose, onSaved, onRemoved }: Props) {
  const { activeSpaceId } = useNotes();
  const { deleteCollection, hideCollection } = useCollectionActions();
  const itemsByCollection = useCollectionItems();
  const isEdit = Boolean(collection);
  const nextRowId = useRef(0);
  const newRowId = () => nextRowId.current++;

  const [name, setName] = useState(collection?.name ?? "");
  const [icon, setIcon] = useState(collection?.icon ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (collection?.fields ?? []).map((f) => ({ rowId: newRowId(), key: f.key, label: f.label, type: f.type })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "hide" | null>(null);

  const items = collection ? itemsByCollection.get(collection.id) ?? [] : [];

  const updateRow = (rowId: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const moveRow = (index: number, by: -1 | 1) =>
    setRows((prev) => {
      const next = [...prev];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Collection name is required");
      return;
    }
    // Keys of all the collection's fields, removed ones included: a removed
    // field's values stay in its items, so a new field mustn't reuse its key.
    const taken = new Set([...(collection?.fields ?? []).map((f) => f.key), ...rows.flatMap((r) => (r.key ? [r.key] : []))]);
    const fields: CollectionField[] = rows
      .filter((r) => r.label.trim())
      .map((r) => {
        let key = r.key;
        if (!key) {
          const base = keyFromLabel(r.label);
          key = base;
          for (let n = 2; taken.has(key); n++) key = `${base}${n}`;
          taken.add(key);
        }
        return { key, label: r.label.trim(), type: r.type };
      });
    setSaving(true);
    setError(null);
    try {
      if (!activeSpaceId) throw new Error("No space is open");
      const result = collection
        ? await api.updateCollection(activeSpaceId, collection.id, { name: trimmed, icon, fields })
        : await api.createCollection(activeSpaceId, { name: trimmed, icon, fields });
      upsertCollection(result);
      onSaved?.(result);
      onClose();
    } catch (e) {
      setError(message(e, "Failed to save collection"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!collection) return;
    try {
      if (collection.builtIn) await hideCollection(collection);
      else await deleteCollection(collection, items);
      onRemoved?.();
      onClose();
    } catch (e) {
      setError(message(e, collection.builtIn ? "Couldn't hide the collection" : "Couldn't delete the collection"));
    }
  };

  const removeLabel = collection?.builtIn ? "Hide collection" : "Delete collection";
  const openRemove = () => setConfirm(collection?.builtIn ? "hide" : "delete");
  const iconBtn =
    "flex shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent " +
    (touch ? "h-10 w-10" : "h-8 w-8");

  return (
    <>
      <ResponsiveDialog
        touch={touch}
        title={isEdit ? "Edit collection" : "New collection"}
        onClose={onClose}
        width={520}
        footer={(close) => (
          <>
            {isEdit && !touch && (
              <DialogButton touch={touch} tone="danger" className="mr-auto" onClick={openRemove}>
                {removeLabel}
              </DialogButton>
            )}
            <DialogButton touch={touch} onClick={close}>
              Cancel
            </DialogButton>
            <DialogButton touch={touch} tone="primary" busy={saving} onClick={() => void submit()}>
              {isEdit ? "Save" : "Create collection"}
            </DialogButton>
          </>
        )}
      >
        <FieldLabel htmlFor="collection-name">Name</FieldLabel>
        <div className="flex items-center gap-2">
          <IconPicker value={icon} onChange={setIcon} label="Collection icon" fallback={Library} />
          <TextInput
            id="collection-name"
            touch={touch}
            value={name}
            autoFocus={!touch && !isEdit}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="e.g. Vinyls, Books, Movies"
          />
        </div>

        <div className="mt-5">
          <div className="text-sm font-medium">Fields</div>
          <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
            Every item has a title, a cover and notes. Add what else you want to record.
          </p>
          {rows.length > 0 && (
            <div className="mb-2 divide-y divide-border rounded-xl border border-border">
              {rows.map((r, i) => (
                <div key={r.rowId} className="flex items-center gap-1.5 p-2">
                  <TextInput
                    touch={touch}
                    value={r.label}
                    aria-label="Field label"
                    placeholder="Field label"
                    onChange={(e) => updateRow(r.rowId, { label: e.target.value })}
                    className="flex-1"
                  />
                  <select
                    aria-label="Field type"
                    value={r.type}
                    onChange={(e) => {
                      if (isFieldType(e.target.value)) updateRow(r.rowId, { type: e.target.value });
                    }}
                    className={
                      "shrink-0 border border-border bg-muted/40 px-2 text-foreground outline-none transition-colors focus:border-primary focus:bg-background " +
                      (touch ? "h-11 rounded-xl text-base" : "h-9 rounded-lg text-sm")
                    }
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => moveRow(i, -1)} className={iconBtn}>
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === rows.length - 1}
                    onClick={() => moveRow(i, 1)}
                    className={iconBtn}
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove field"
                    onClick={() => setRows((prev) => prev.filter((x) => x.rowId !== r.rowId))}
                    className={iconBtn + " hover:text-red-500"}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { rowId: newRowId(), label: "", type: "text" }])}
            className={
              "flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground " +
              (touch ? "h-11 text-[15px]" : "h-9 text-sm")
            }
          >
            <Plus size={15} />
            Add field
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        {isEdit && touch && (
          <DialogButton touch={touch} tone="danger" className="mt-4 w-full" onClick={openRemove}>
            {removeLabel}
          </DialogButton>
        )}
      </ResponsiveDialog>

      {confirm && collection && (
        <ConfirmDialog
          touch={touch}
          title={confirm === "hide" ? `Hide “${collection.name}”?` : `Delete “${collection.name}”?`}
          message={confirm === "hide" ? HIDE_COLLECTION_MESSAGE : deleteCollectionMessage(items.length)}
          confirmLabel={confirm === "hide" ? "Hide" : "Delete"}
          onConfirm={() => void remove()}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

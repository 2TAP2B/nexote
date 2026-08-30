"use client";

import { FolderPlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { CollectionField, CollectionFieldType, CollectionMeta } from "@/lib/api";

type Props = {
  open: boolean;
  collection?: CollectionMeta | null; // present => edit; absent => create
  onClose: () => void;
  onSaved: () => void;
};

const FIELD_TYPES: { value: CollectionFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes/No" },
  { value: "date", label: "Date" },
];

// Dialog to create or edit a collection: name, icon, and the custom field
// schema. Title + cover are always required for items; these are the extra
// fields the user can add.
export default function CollectionFormDialog({
  open,
  collection,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [fields, setFields] = useState<CollectionField[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(collection);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (collection) {
      setName(collection.name);
      setIcon(collection.icon ?? "");
      setFields(collection.fields ?? []);
    } else {
      setName("");
      setIcon("");
      setFields([]);
    }
  }, [open, collection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const addField = () => {
    setFields((prev) => [
      ...prev,
      { key: `field${prev.length + 1}`, label: "", type: "text" },
    ]);
  };

  const updateField = (i: number, patch: Partial<CollectionField>) => {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const removeField = (i: number) => {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Collection name is required");
      return;
    }
    // Filter out fields without a label.
    const cleanFields = fields.filter((f) => f.label.trim());
    setSaving(true);
    setError(null);
    try {
      if (collection) {
        await api.updateCollection(collection.id, {
          name: trimmed,
          icon,
          fields: cleanFields,
        });
      } else {
        await api.createCollection({ name: trimmed, icon, fields: cleanFields });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save collection");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit collection" : "New collection"}
        className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FolderPlus className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-foreground">
              {isEdit ? "Edit collection" : "New collection"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Title and cover are always required for items; add custom fields
              below.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Vinyls, Books, Movies"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Icon
            </label>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="e.g. Music, Book, Film"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
        </div>

        {/* Custom fields */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              Custom fields
            </label>
            <button
              type="button"
              onClick={addField}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3 w-3" />
              Add field
            </button>
          </div>
          {fields.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              No custom fields yet. Add fields like Artist, Year, Genre, Rating…
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {fields.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={f.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    placeholder="Field label"
                    className="min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
                  />
                  <select
                    value={f.type}
                    onChange={(e) =>
                      updateField(i, { type: e.target.value as CollectionFieldType })
                    }
                    className="rounded-xl border border-input bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-ring"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Remove field"
                    onClick={() => removeField(i)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save" : "Create collection"}
          </button>
        </div>
      </div>
    </div>
  );
}

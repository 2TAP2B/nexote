"use client";

import { Disc3, ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { cacheImage } from "@/lib/image-cache";
import { useNotes } from "@/lib/notes-context";
import type { CollectionMeta, NoteMeta } from "@/lib/api";

type Props = {
  open: boolean;
  collection: CollectionMeta;
  note?: NoteMeta | null; // present => edit existing item; absent => create new
  onClose: () => void;
  onSaved: () => void;
};

// Structured metadata entry for a collection item. Title + cover are required;
// the remaining fields come from the collection's custom schema and are stored
// in the note's `fields` map. The review/description text lives in the body.
export default function CollectionItemForm({
  open,
  collection,
  note,
  onClose,
  onSaved,
}: Props) {
  const { activeVault, refresh } = useNotes();

  const [title, setTitle] = useState("");
  const [cover, setCover] = useState<string>("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string>("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEdit = Boolean(note);

  // Reset / prefill whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setCoverFile(null);
    if (note) {
      setTitle(note.title ?? "");
      setCover(note.cover ?? "");
      setFieldValues(note.fields ?? {});
      setCoverPreview("");
    } else {
      setTitle("");
      setCover("");
      setFieldValues({});
      setCoverPreview("");
    }
  }, [open, note, collection.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !activeVault) return null;

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setCoverFile(file);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setCoverPreview(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    const titleName = title.trim();
    if (!titleName) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const vaultId = activeVault.id;
      let noteId = note?.id ?? "";

      // Create the underlying note first (so the cover can be uploaded into
      // its folder), then populate the structured fields.
      if (!note) {
        const created = await api.create(vaultId, {
          title: titleName,
          path: collection.name,
        });
        noteId = created.id;
        await refresh();
      }

      let coverUrl = cover;
      if (coverFile) {
        const meta = await api.uploadImage(vaultId, noteId, coverFile);
        void cacheImage(meta.url, coverFile);
        coverUrl = meta.url;
      }

      await api.update(vaultId, noteId, {
        title: titleName,
        type: "collection-item",
        collection: collection.id,
        cover: coverUrl || null,
        fields: fieldValues,
      });

      await refresh();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save item");
    } finally {
      setSaving(false);
    }
  };

  const currentCover = coverPreview || cover;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit ${collection.name} item` : `New ${collection.name} item`}
        className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Disc3 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-foreground">
              {isEdit ? `Edit ${collection.name} item` : `New ${collection.name} item`}
            </h2>
            <p className="text-xs text-muted-foreground">
              Title and cover are required; other fields are optional.
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

        {/* Cover + title */}
        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            aria-label="Choose cover image"
          >
            {currentCover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentCover}
                alt="Cover"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex flex-col items-center gap-1 text-xs">
                <ImagePlus className="h-6 w-6" />
                Cover
              </span>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

        {/* Custom fields */}
        {collection.fields.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {collection.fields.map((f) => (
              <div key={f.key} className={f.type === "text" ? "col-span-2" : ""}>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {f.label}
                </label>
                {f.type === "boolean" ? (
                  <div className="flex gap-1 rounded-xl bg-muted/60 p-1">
                    <button
                      type="button"
                      onClick={() =>
                        setFieldValues((prev) => ({ ...prev, [f.key]: "false" }))
                      }
                      className={
                        "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                        (fieldValues[f.key] !== "true"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground")
                      }
                    >
                      No
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFieldValues((prev) => ({ ...prev, [f.key]: "true" }))
                      }
                      className={
                        "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                        (fieldValues[f.key] === "true"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground")
                      }
                    >
                      Yes
                    </button>
                  </div>
                ) : (
                  <input
                    value={fieldValues[f.key] ?? ""}
                    onChange={(e) =>
                      setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    placeholder={f.label}
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
                  />
                )}
              </div>
            ))}
          </div>
        )}

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
            {isEdit ? "Save" : "Add item"}
          </button>
        </div>
      </div>
    </div>
  );
}

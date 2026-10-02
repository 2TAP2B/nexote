"use client";

import { Disc3, ImagePlus, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, isCollectionsVault } from "@/lib/api";
import { cacheImage } from "@/lib/image-cache";
import { useNotes } from "@/lib/notes-context";
import type { CollectionMeta, MetadataSearchResult, NoteMeta } from "@/lib/api";
import IsbnScanner from "./IsbnScanner";

type Props = {
  open: boolean;
  collection: CollectionMeta;
  note?: (NoteMeta & { vaultId?: string }) | null; // present => edit existing item; absent => create new
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
  const { activeVault, vaults, noteVaultMap, refresh } = useNotes();

  // New items always live in the system Collections vault (one folder per
  // collection) so they never surface in a regular vault's note tree.
  // Edits target the note's owning vault — legacy items may still live
  // elsewhere.
  const collectionsVaultId = vaults.find((v) => isCollectionsVault(v))?.id ?? null;

  const [title, setTitle] = useState("");
  const [cover, setCover] = useState<string>("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string>("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Metadata lookup state ──
  // The source is determined by the collection's schema: a "discogsId" field
  // enables Discogs lookups, an "isbn" field enables book (ISBN) lookups.
  const schemaKeys = collection.fields.map((f) => f.key);
  const lookupSource = schemaKeys.includes("discogsId")
    ? "discogs"
    : schemaKeys.includes("isbn")
      ? "book"
      : null;
  const lookupKeyField = lookupSource === "discogs" ? "discogsId" : "isbn";
  const [lookupValue, setLookupValue] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  // Camera-first: a NEW book item starts with the ISBN scanner; the manual
  // form appears via the "Enter ISBN manually" link (or if the camera is
  // unavailable — the scanner's error panel includes the same link).
  const [scannerOpen, setScannerOpen] = useState(false);

  // Apply a metadata result: title, mapped fields, and a cover preview from
  // the remote URL. Everything stays manually editable afterwards.
  const applyMetadata = (res: {
    title: string;
    artists?: string[];
    year?: string;
    genres?: string[];
    label?: string;
    catno?: string;
    pages?: string;
    coverUrl?: string;
  }) => {
    setTitle((prev) => prev.trim() || res.title);
    setCoverPreview(res.coverUrl ?? "");
    setFieldValues((prev) => {
      const next = { ...prev };
      const put = (key: string, value?: string) => {
        if (!value || next[key]) return; // don't overwrite filled fields
        next[key] = value;
      };
      if (res.artists?.length) put("artist", res.artists.join(", "));
      put("author", res.artists?.join(", "));
      put("year", res.year);
      if (res.genres?.length) put("genre", res.genres[0]);
      put("label", res.label);
      put("publisher", res.label);
      put("catno", res.catno);
      put("pages", res.pages);
      return next;
    });
  };

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
      setScannerOpen(false);
    } else {
      setTitle("");
      setCover("");
      setFieldValues({});
      setCoverPreview("");
      setScannerOpen(lookupSource === "book");
    }
  }, [open, note, collection.id, lookupSource]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

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
      // Edits: the item's owning vault (gallery passes it, or resolve via the
      // cross-vault map). Creates: the system Collections vault.
      const vaultId =
        note?.vaultId ??
        (note ? noteVaultMap[note.id] ?? activeVault?.id : undefined) ??
        collectionsVaultId ??
        activeVault?.id ??
        "";
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
      } else if (!coverFile && coverUrl && /^https?:\/\//.test(coverUrl)) {
        // Remote cover from a metadata lookup — download it into the vault
        // via the backend so it stays available offline.
        try {
          const meta = await api.metadataCover({ vaultId, noteId, url: coverUrl });
          coverUrl = meta.url;
        } catch {
          // Cover download failed — keep referencing the remote URL.
        }
      }

      // Remember the lookup key in its schema field (discogsId / isbn) if the
      // user only entered it in the lookup bar.
      const storedFields = { ...fieldValues };
      if (lookupSource && lookupValue.trim() && !storedFields[lookupKeyField]) {
        storedFields[lookupKeyField] = lookupValue.trim();
      }

      await api.update(vaultId, noteId, {
        title: titleName,
        type: "collection-item",
        collection: collection.id,
        cover: coverUrl || null,
        fields: storedFields,
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

  // Fetch metadata for the entered lookup key (Discogs release id or ISBN).
  const runLookup = async (explicit?: string) => {
    const key = (explicit ?? lookupValue).trim();
    if (!key || !lookupSource) return;
    setLookupLoading(true);
    setError(null);
    try {
      const res =
        lookupSource === "discogs"
          ? await api.discogsRelease(key)
          : await api.bookLookup(key);
      applyMetadata(res);
      // After a fresh lookup the note may not exist yet — remember the cover
      // URL so submit() can download it into the vault.
      setCoverFile(null);
      setCover(res.coverUrl ?? "");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : `Lookup failed (${lookupSource})`,
      );
    } finally {
      setLookupLoading(false);
    }
  };

  // Free-text search across the collection's source.
  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q || !lookupSource) return;
    setSearching(true);
    setError(null);
    try {
      const res =
        lookupSource === "discogs"
          ? await api.discogsSearch(q)
          : await api.bookSearch(q);
      setSearchResults(res.results ?? []);
      setSearchOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  // Pick a search result: fetch its full metadata by id and fill the form.
  const pickSearchResult = async (hit: MetadataSearchResult) => {
    setSearchOpen(false);
    setLookupValue(hit.externalId);
    setLookupLoading(true);
    setError(null);
    try {
      if (lookupSource === "book") {
        // Book hits carry an ISBN (summary only) — resolve the full record
        // via the ISBN lookup so all fields fill, same as a Fetch.
        const res = await api.bookLookup(hit.externalId);
        applyMetadata(res);
        setCover(res.coverUrl ?? "");
        setCoverFile(null);
        return;
      }
      const res = await api.discogsRelease(hit.externalId);
      applyMetadata(res);
      setCover(res.coverUrl ?? "");
      setCoverFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <>
      {/* Camera-first ISBN scanner for NEW book items */}
      {open && scannerOpen && lookupSource === "book" && !note && (
        <IsbnScanner
          onScan={(isbn) => {
            setScannerOpen(false);
            setLookupValue(isbn);
            void runLookup(isbn);
          }}
          onManual={() => setScannerOpen(false)}
          onClose={onClose}
        />
      )}
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

        {/* Metadata lookup — only when the schema supports it (discogsId /
            isbn field present). Fill the form from Discogs / Google Books. */}
        {lookupSource && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-xs font-medium text-foreground">
                {lookupSource === "discogs"
                  ? "Discogs lookup — enter a release ID, or search by name"
                  : "Book lookup — enter an ISBN, or search by title"}
              </span>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={lookupValue}
                onChange={(e) => setLookupValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runLookup();
                  }
                }}
                placeholder={lookupSource === "discogs" ? "Release ID (e.g. 123456)" : "ISBN"}
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
              />
              <button
                type="button"
                onClick={() => void runLookup()}
                disabled={lookupLoading || !lookupValue.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {lookupLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Fetch
              </button>
            </div>

            {/* Free-text search */}
            <div className="mt-2 flex gap-2">
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder={lookupSource === "discogs" ? "Search artist + title…" : "Search title / author…"}
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={searching || !searchQ.trim()}
                className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
              >
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </button>
            </div>

            {/* Search results */}
            {searchOpen && searchResults.length > 0 && (
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
                {searchResults.map((hit) => (
                  <li key={`${hit.source}-${hit.externalId}`}>
                    <button
                      type="button"
                      onClick={() => void pickSearchResult(hit)}
                      className="flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50"
                    >
                      {hit.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={hit.coverUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                          <Disc3 size={14} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{hit.title}</span>
                        {hit.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searchOpen && searchResults.length === 0 && (
              <div className="mt-2 px-1 text-xs text-muted-foreground">No results.</div>
            )}
          </div>
        )}

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
    </>
  );
}

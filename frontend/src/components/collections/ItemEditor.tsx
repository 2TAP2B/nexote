"use client";

import { Disc3, ImagePlus, Loader2, ScanLine, Search, X } from "lucide-react";
import { useRef, useState } from "react";

import { api, isCollectionsVault } from "@/lib/api";
import type { CollectionMeta, MetadataSearchResult } from "@/lib/api";
import { cacheImage } from "@/lib/image-cache";
import { useNotes } from "@/lib/notes-context";
import IsbnScanner from "../IsbnScanner";
import { ConfirmDialog, ResponsiveDialog } from "../ResponsiveDialog";
import { useCollectionActions } from "./actions";
import { DialogButton, FieldLabel, Segmented, TextInput } from "./formParts";
import { LOOKUP_KEYS, type CollectionItem } from "./items";
import { DELETE_ITEM_MESSAGE } from "./menus";

type Props = {
  touch: boolean;
  collection: CollectionMeta;
  /** Present => edit this item; absent => create a new one. */
  item?: CollectionItem | null;
  onClose: () => void;
  onSaved?: (item: { id: string; vaultId: string }) => void;
  onDeleted?: () => void;
};

type LookupSource = "discogs" | "book";

type Metadata = {
  title: string;
  artists?: string[];
  year?: string;
  genres?: string[];
  label?: string;
  catno?: string;
  pages?: string;
  coverUrl?: string;
};

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

// The lookup source follows the collection's schema: a "discogsId" field
// enables Discogs lookups, an "isbn" field book (ISBN) lookups.
function lookupSourceOf(collection: CollectionMeta): { source: LookupSource; key: string } | null {
  const keys = collection.fields.map((f) => f.key).filter((k) => LOOKUP_KEYS.has(k));
  if (keys.includes("discogsId")) return { source: "discogs", key: "discogsId" };
  if (keys.includes("isbn")) return { source: "book", key: "isbn" };
  return null;
}

/**
 * Creates or edits a collection item: title, cover and the collection's
 * fields (stored in the note's `fields` map; the notes text lives in the
 * body). Collections with a Discogs id / ISBN field can fill the form from a
 * lookup; a new book starts with the camera scanner.
 */
export default function ItemEditor({ touch, collection, item, onClose, onSaved, onDeleted }: Props) {
  const { vaults, activeVault, noteVaultMap, notesById, refreshVaultTree, refreshNoteBody, renameNote } = useNotes();
  const { deleteItem } = useCollectionActions();
  const isEdit = Boolean(item);
  const lookup = lookupSourceOf(collection);

  const [title, setTitle] = useState(item?.title ?? "");
  // The stored cover, or a remote URL from a lookup (downloaded on save).
  const [cover, setCover] = useState(item?.cover ?? "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(item?.fields ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [lookupValue, setLookupValue] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  // Camera-first: a NEW book starts with the ISBN scanner; "Enter ISBN
  // manually" (also offered when the camera fails) shows the form.
  const [scannerOpen, setScannerOpen] = useState(lookup?.source === "book" && !item);

  const currentCover = coverPreview || cover;

  // Fill from a lookup without overwriting what the user already entered.
  const applyMetadata = (res: Metadata) => {
    setTitle((prev) => prev.trim() || res.title);
    setCoverPreview(res.coverUrl ?? "");
    setCover(res.coverUrl ?? "");
    setCoverFile(null);
    setFieldValues((prev) => {
      const next = { ...prev };
      const put = (key: string, value?: string) => {
        if (!value || next[key]) return;
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

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setCoverFile(file);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setCoverPreview(String(reader.result));
    reader.readAsDataURL(file);
  };

  const removeCover = () => {
    setCover("");
    setCoverFile(null);
    setCoverPreview("");
  };

  const runLookup = async (explicit?: string) => {
    const key = (explicit ?? lookupValue).trim();
    if (!key || !lookup) return;
    setLookupLoading(true);
    setError(null);
    try {
      applyMetadata(lookup.source === "discogs" ? await api.discogsRelease(key) : await api.bookLookup(key));
    } catch (e) {
      setError(message(e, `Lookup failed (${lookup.source})`));
    } finally {
      setLookupLoading(false);
    }
  };

  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q || !lookup) return;
    setSearching(true);
    setError(null);
    try {
      const res = lookup.source === "discogs" ? await api.discogsSearch(q) : await api.bookSearch(q);
      setSearchResults(res.results ?? []);
      setSearchOpen(true);
    } catch (e) {
      setError(message(e, "Search failed"));
    } finally {
      setSearching(false);
    }
  };

  const pickSearchResult = async (hit: MetadataSearchResult) => {
    setSearchOpen(false);
    setLookupLoading(true);
    setError(null);
    try {
      if (lookup?.source === "book") {
        // Book hits carry an ISBN, or a source id ("gb:…", "ol:…") when they
        // have none; the lookup resolves either, and the ISBN field gets the
        // record's ISBN (empty if it has none).
        const res = await api.bookLookup(hit.externalId);
        applyMetadata(res);
        setLookupValue(res.externalId);
        return;
      }
      setLookupValue(hit.externalId);
      applyMetadata(await api.discogsRelease(hit.externalId));
    } catch (e) {
      setError(message(e, "Lookup failed"));
    } finally {
      setLookupLoading(false);
    }
  };

  const submit = async () => {
    const titleName = title.trim();
    if (!titleName) {
      setError("Title is required");
      return;
    }
    // New items live in the system Collections vault (one folder per
    // collection) so they never show up in a regular vault's tree; edits
    // target the owning vault (older items may live elsewhere).
    const vaultId = item
      ? item.vaultId || noteVaultMap[item.id] || activeVault?.id || ""
      : vaults.find(isCollectionsVault)?.id ?? activeVault?.id ?? "";
    if (!vaultId) {
      setError("No vault to save the item in");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let noteId = item?.id ?? "";
      // Create the note first so the cover can be uploaded into its folder.
      if (!item) {
        const created = await api.create(vaultId, { title: titleName, path: collection.name });
        noteId = created.id;
      } else if (titleName !== item.title) {
        // renameNote also keeps the body's title heading in sync.
        await renameNote(item.id, titleName);
      }

      let coverUrl = cover;
      if (coverFile) {
        const meta = await api.uploadImage(vaultId, noteId, coverFile);
        void cacheImage(meta.url, coverFile);
        coverUrl = meta.url;
      } else if (coverUrl && /^https?:\/\//.test(coverUrl)) {
        // A remote cover from a lookup: download it into the vault so it
        // stays available offline.
        try {
          coverUrl = (await api.metadataCover({ vaultId, noteId, url: coverUrl })).url;
        } catch {
          // Keep referencing the remote URL.
        }
      }

      // Remember the lookup key if it was only entered in the lookup card.
      const storedFields = { ...fieldValues };
      if (lookup && lookupValue.trim() && !storedFields[lookup.key]) storedFields[lookup.key] = lookupValue.trim();

      await api.update(vaultId, noteId, {
        ...(item ? {} : { title: titleName }),
        type: "collection-item",
        collection: collection.id,
        cover: coverUrl || null,
        fields: storedFields,
      });

      await refreshVaultTree(vaultId);
      // An open item shows its header from the cached note.
      if (item && notesById[noteId]) await refreshNoteBody(noteId);
      onSaved?.({ id: noteId, vaultId });
      onClose();
    } catch (e) {
      setError(message(e, "Failed to save item"));
    } finally {
      setSaving(false);
    }
  };

  const runDelete = async () => {
    if (!item) return;
    try {
      await deleteItem(item);
      onDeleted?.();
      onClose();
    } catch (e) {
      setError(message(e, "Couldn't delete the item"));
    }
  };

  if (scannerOpen && lookup?.source === "book" && !item) {
    return (
      <IsbnScanner
        onScan={(isbn) => {
          setScannerOpen(false);
          setLookupValue(isbn);
          void runLookup(isbn);
        }}
        onManual={() => setScannerOpen(false)}
        onClose={onClose}
      />
    );
  }

  const coverSize = touch ? 96 : 112;
  const deleteLabel = "Delete item";

  return (
    <>
      <ResponsiveDialog
        touch={touch}
        title={isEdit ? "Edit item" : "New item"}
        subtitle={collection.name}
        onClose={onClose}
        width={560}
        footer={(close) => (
          <>
            {isEdit && !touch && (
              <DialogButton touch={touch} tone="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                {deleteLabel}
              </DialogButton>
            )}
            <DialogButton touch={touch} onClick={close}>
              Cancel
            </DialogButton>
            <DialogButton touch={touch} tone="primary" busy={saving} onClick={() => void submit()}>
              {isEdit ? "Save" : "Add item"}
            </DialogButton>
          </>
        )}
      >
        {/* Cover + title */}
        <div className="flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: coverSize, height: coverSize }}>
            <button
              type="button"
              aria-label={currentCover ? "Change cover" : "Add cover"}
              onClick={() => fileInputRef.current?.click()}
              className={
                "flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden text-muted-foreground transition-colors " +
                (currentCover ? "bg-muted" : "border-2 border-dashed border-border hover:border-primary hover:text-foreground")
              }
              style={{ borderRadius: 14 }}
            >
              {currentCover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentCover} alt="" className="h-full w-full object-cover" />
              ) : (
                <>
                  <ImagePlus size={touch ? 22 : 20} />
                  <span className="text-xs font-medium">Add cover</span>
                </>
              )}
            </button>
            {currentCover && (
              <button
                type="button"
                aria-label="Remove cover"
                onClick={removeCover}
                className={
                  "absolute right-1 top-1 flex items-center justify-center rounded-full bg-black/60 text-white " +
                  (touch ? "h-7 w-7" : "h-6 w-6 hover:bg-black/75")
                }
              >
                <X size={14} />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <FieldLabel htmlFor="item-title">Title</FieldLabel>
            <TextInput
              id="item-title"
              touch={touch}
              value={title}
              autoFocus={!touch && !isEdit}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Title"
            />
          </div>
        </div>

        {/* Lookup */}
        {lookup && (
          <div className="mt-4 rounded-xl bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Search size={15} className="shrink-0 text-primary" />
              <span className="flex-1 text-sm font-medium">
                {lookup.source === "discogs" ? "Find on Discogs" : "Find the book"}
              </span>
              {lookup.source === "book" && (
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className={
                    "flex items-center gap-1.5 rounded-lg px-2.5 font-medium text-primary transition-colors hover:bg-primary/10 " +
                    (touch ? "h-9 text-[15px]" : "h-7 text-sm")
                  }
                >
                  <ScanLine size={15} />
                  Scan
                </button>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <TextInput
                touch={touch}
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder={lookup.source === "discogs" ? "Artist and title…" : "Title or author…"}
              />
              <DialogButton
                touch={touch}
                className="flex-none"
                busy={searching}
                disabled={!searchQ.trim()}
                onClick={() => void runSearch()}
              >
                Search
              </DialogButton>
            </div>
            <div className="mt-2 flex gap-2">
              <TextInput
                touch={touch}
                value={lookupValue}
                inputMode={lookup.source === "book" ? "numeric" : undefined}
                onChange={(e) => setLookupValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runLookup();
                  }
                }}
                placeholder={lookup.source === "discogs" ? "Release ID (e.g. 123456)" : "ISBN"}
              />
              <DialogButton
                touch={touch}
                className="flex-none"
                busy={lookupLoading}
                disabled={!lookupValue.trim()}
                onClick={() => void runLookup()}
              >
                Fetch
              </DialogButton>
            </div>
            {searchOpen &&
              (searchResults.length > 0 ? (
                <ul className="mt-2 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-border bg-background">
                  {searchResults.map((hit) => (
                    <li key={`${hit.source}-${hit.externalId}`}>
                      <button
                        type="button"
                        onClick={() => void pickSearchResult(hit)}
                        className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50 active:bg-muted"
                      >
                        {hit.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={hit.coverUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <Disc3 size={16} />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className={"block truncate " + (touch ? "text-[15px]" : "text-sm")}>{hit.title}</span>
                          {hit.subtitle && <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 px-1 text-xs text-muted-foreground">No results.</p>
              ))}
            {lookupLoading && !searchOpen && (
              <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </p>
            )}
          </div>
        )}

        {/* Fields */}
        {collection.fields.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {collection.fields.map((f) => {
              const id = `item-field-${f.key}`;
              return (
                <div key={f.key} className={f.type === "number" || f.type === "date" ? "" : "col-span-2"}>
                  <FieldLabel htmlFor={f.type === "boolean" ? undefined : id}>{f.label}</FieldLabel>
                  {f.type === "boolean" ? (
                    <Segmented
                      touch={touch}
                      label={f.label}
                      value={fieldValues[f.key] === "true" ? "true" : "false"}
                      options={[
                        { value: "false", label: "No" },
                        { value: "true", label: "Yes" },
                      ]}
                      onChange={(v) => setFieldValues((prev) => ({ ...prev, [f.key]: v }))}
                    />
                  ) : (
                    <TextInput
                      id={id}
                      touch={touch}
                      value={fieldValues[f.key] ?? ""}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.type === "date" ? undefined : f.label}
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      inputMode={f.type === "number" ? "decimal" : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        {isEdit && touch && (
          <DialogButton touch={touch} tone="danger" className="mt-4 w-full" onClick={() => setConfirmDelete(true)}>
            {deleteLabel}
          </DialogButton>
        )}
      </ResponsiveDialog>

      {confirmDelete && item && (
        <ConfirmDialog
          touch={touch}
          title={`Delete “${item.title || "Untitled"}”?`}
          message={DELETE_ITEM_MESSAGE}
          onConfirm={() => void runDelete()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

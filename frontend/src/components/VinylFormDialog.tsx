"use client";

import { Disc3, ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { cacheImage } from "@/lib/image-cache";
import { useNotes } from "@/lib/notes-context";
import type { NoteMeta } from "@/lib/api";

type Props = {
  open: boolean;
  note?: NoteMeta | null; // present => edit existing vinyl; absent => create new
  onClose: () => void;
  onSaved: () => void;
};

const VINYL_FOLDER = "Vinyls";

// Structured metadata entry for a vinyl record. Album name becomes the note
// title; artist / year / genre / wantlist / cover are stored in frontmatter;
// the review text lives in the markdown body.
export default function VinylFormDialog({ open, note, onClose, onSaved }: Props) {
  const { activeVault, refresh } = useNotes();

  const [album, setAlbum] = useState("");
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [wantlist, setWantlist] = useState(false);
  const [cover, setCover] = useState<string>("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string>("");
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
      setAlbum(note.title ?? "");
      setArtist(note.artist ?? "");
      setYear(note.year ? String(note.year) : "");
      setGenre(note.genre ?? "");
      setWantlist(note.wantlist ?? false);
      setCover(note.cover ?? "");
      setCoverPreview("");
    } else {
      setAlbum("");
      setArtist("");
      setYear("");
      setGenre("");
      setWantlist(false);
      setCover("");
      setCoverPreview("");
    }
  }, [open, note]);

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
    const albumName = album.trim();
    if (!albumName) {
      setError("Album name is required");
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
          title: albumName,
          path: VINYL_FOLDER,
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

      const yearNum = year ? parseInt(year, 10) : undefined;
      await api.update(vaultId, noteId, {
        title: albumName,
        type: "vinyl",
        artist: artist.trim() || null,
        year: Number.isFinite(yearNum) ? yearNum : null,
        genre: genre.trim() || null,
        wantlist,
        cover: coverUrl || null,
      });

      await refresh();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save vinyl");
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
        aria-label={isEdit ? "Edit vinyl" : "New vinyl"}
        className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Disc3 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-foreground">
              {isEdit ? "Edit vinyl" : "New vinyl"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Album, artist and cover are structured; review text stays in the
              note body.
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

        {/* Cover */}
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
                alt="Vinyl cover"
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
              Album
            </label>
            <input
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              placeholder="Album name"
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

        {/* Fields */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Artist
            </label>
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artist"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Year
            </label>
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="1969"
              inputMode="numeric"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Genre
          </label>
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="Rock, Jazz, …"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          />
        </div>

        {/* Owned / Wantlist */}
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Status
          </label>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => setWantlist(false)}
              className={
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                (!wantlist
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground")
              }
            >
              Owned
            </button>
            <button
              type="button"
              onClick={() => setWantlist(true)}
              className={
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                (wantlist
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground")
              }
            >
              Wantlist
            </button>
          </div>
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
            {isEdit ? "Save" : "Add vinyl"}
          </button>
        </div>
      </div>
    </div>
  );
}

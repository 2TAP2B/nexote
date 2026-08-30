"use client";

import { Disc3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { CollectionMeta, Note } from "@/lib/api";

type Props = {
  note: Note | null;
  mobile?: boolean;
};

// Read-only header shown above a collection item's editor body. Displays a
// full-width banner of the item's cover image (covering the full available
// width without stretching), then each custom field listed below it. Only
// renders for type=collection-item notes; the cover and fields live in
// frontmatter, so the markdown body stays clean and editable.
export default function CollectionItemHeader({ note, mobile }: Props) {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);

  useEffect(() => {
    void api.listCollections().then((res) => setCollections(res.collections ?? []));
  }, []);

  const isCollectionItem = note?.type === "collection-item";
  const collection = useMemo(
    () => collections.find((c) => c.id === note?.collection) ?? null,
    [collections, note?.collection],
  );

  if (!isCollectionItem || !note) return null;

  const fields = collection?.fields ?? [];

  return (
    <div
      style={mobile ? { margin: 12 } : {}}
    >
      {/* Full-width banner cover */}
      <div
        className="flex w-full items-center justify-center overflow-hidden"
        style={{
          aspectRatio: "16/9",
          maxHeight: 360,
          borderRadius: 12,
          background: "var(--muted)",
        }}
      >
        {note.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={note.cover}
            alt={note.title}
            className="h-full w-full"
            style={{
              objectFit: "cover",
              objectPosition: "center",
            }}
          />
        ) : (
          <Disc3 className="h-12 w-12 text-muted-foreground/40" />
        )}
      </div>

      {/* Field list below the image */}
      {fields.length > 0 && (
        <div
          className="flex flex-col gap-1.5"
          style={{
            padding: "12px 4px",
            borderBottom: "1px solid var(--border)",
            marginBottom: 4,
          }}
        >
          {fields.map((f) => {
            const value = note.fields?.[f.key];
            if (value === undefined || value === null || value === "") return null;
            const display =
              f.type === "boolean"
                ? value === "true"
                  ? "Yes"
                  : "No"
                : value;
            return (
              <div key={f.key} className="flex items-baseline gap-3">
                <span
                  className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {f.label}
                </span>
                <span className="min-w-0 flex-1 text-sm" style={{ color: "var(--foreground)" }}>
                  {display}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

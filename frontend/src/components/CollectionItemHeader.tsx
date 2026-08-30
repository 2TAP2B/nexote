"use client";

import { Disc3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { CollectionMeta, Note } from "@/lib/api";

type Props = {
  note: Note | null;
  mobile?: boolean;
};

// Read-only header shown above a collection item's editor body. Displays the
// item's cover image and each custom field (with its label from the collection
// definition). Only renders for type=collection-item notes; the cover and
// fields live in frontmatter, so the markdown body stays clean and editable.
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
      className="flex gap-4 rounded-xl border border-border p-4 mb-4"
      style={{
        background: "var(--muted)",
        ...(mobile ? { margin: 16, padding: 16 } : {}),
      }}
    >
      {/* Cover */}
      <div
        className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg"
        style={{ background: "var(--background)" }}
      >
        {note.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={note.cover}
            alt={note.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <Disc3 className="h-8 w-8 text-muted-foreground/40" />
        )}
      </div>

      {/* Fields */}
      {fields.length > 0 && (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
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
              <div key={f.key} className="flex items-baseline gap-2">
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

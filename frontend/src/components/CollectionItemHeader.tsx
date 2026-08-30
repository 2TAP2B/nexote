"use client";

import { ChevronDown, Disc3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { CollectionMeta, Note } from "@/lib/api";

type Props = {
  note: Note | null;
  mobile?: boolean;
};

// Read-only header shown above a collection item's editor body. Displays a
// full-width banner of the item's cover image, then all custom fields in a
// single inline line (label: value · label: value …) collapsed behind a
// "show more" toggle by default. Only renders for type=collection-item notes;
// the cover and fields live in frontmatter, so the body stays clean/editable.
export default function CollectionItemHeader({ note, mobile }: Props) {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void api.listCollections().then((res) => setCollections(res.collections ?? []));
  }, []);

  const isCollectionItem = note?.type === "collection-item";
  const collection = useMemo(
    () => collections.find((c) => c.id === note?.collection) ?? null,
    [collections, note?.collection],
  );

  if (!isCollectionItem || !note) return null;

  const fieldPairs = (collection?.fields ?? [])
    .filter((f) => {
      const value = note.fields?.[f.key];
      return value !== undefined && value !== null && value !== "";
    })
    .map((f) => {
      const display =
        f.type === "boolean"
          ? (note.fields?.[f.key] ?? "") === "true"
            ? "Yes"
            : "No"
          : note.fields?.[f.key] ?? "";
      return `${f.label}: ${display}`;
    });

  return (
    <div style={mobile ? { margin: 12 } : {}}>
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
            style={{ objectFit: "cover", objectPosition: "center" }}
          />
        ) : (
          <Disc3 className="h-12 w-12 text-muted-foreground/40" />
        )}
      </div>

      {/* All fields on one inline line, collapsed behind the toggle */}
      {fieldPairs.length > 0 && (
        <div
          style={{
            padding: "10px 4px",
            borderBottom: "1px solid var(--border)",
            marginBottom: 4,
          }}
        >
          <p
            className="overflow-hidden text-sm leading-relaxed"
            style={{
              color: "var(--foreground)",
              ...(expanded
                ? { whiteSpace: "normal" }
                : {
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }),
            }}
          >
            {fieldPairs.join("  ·  ")}
          </p>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 flex items-center gap-1 text-xs font-medium transition-colors hover:text-primary"
            style={{ color: "var(--muted-foreground)" }}
          >
            <ChevronDown
              className="h-3.5 w-3.5 transition-transform duration-200"
              style={{ transform: expanded ? "rotate(180deg)" : undefined }}
            />
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}

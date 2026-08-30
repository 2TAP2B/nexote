"use client";

import { ChevronDown, Disc3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { CollectionMeta, Note } from "@/lib/api";

type Props = {
  note: Note | null;
  mobile?: boolean;
};

const COLLAPSED_HEIGHT = 80;

// Read-only header shown above a collection item's editor body. Displays a
// full-width banner of the item's cover image (covering the full available
// width without stretching), then each custom field listed below it. The field
// list is collapsed to a few rows by default with a "show more" toggle. Only
// renders for type=collection-item notes; the cover and fields live in
// frontmatter, so the markdown body stays clean and editable.
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

  const fields = (collection?.fields ?? []).filter((f) => {
    const value = note.fields?.[f.key];
    return value !== undefined && value !== null && value !== "";
  });

  // All fields sit behind the toggle, regardless of how many there are.
  const hasManyFields = fields.length > 0;

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
            style={{
              objectFit: "cover",
              objectPosition: "center",
            }}
          />
        ) : (
          <Disc3 className="h-12 w-12 text-muted-foreground/40" />
        )}
      </div>

      {/* Field list below the image — collapsed by default when long */}
      {fields.length > 0 && (
        <div
          style={{
            padding: "12px 4px",
            borderBottom: "1px solid var(--border)",
            marginBottom: 4,
          }}
        >
          <div
            className="flex flex-col gap-1.5 overflow-hidden transition-[height] duration-200"
            style={{
              height: hasManyFields && !expanded ? COLLAPSED_HEIGHT : "auto",
              maskImage:
                hasManyFields && !expanded
                  ? "linear-gradient(to bottom, black 60%, transparent)"
                  : undefined,
              WebkitMaskImage:
                hasManyFields && !expanded
                  ? "linear-gradient(to bottom, black 60%, transparent)"
                  : undefined,
            }}
          >
            {fields.map((f) => {
              const display =
                f.type === "boolean"
                  ? (note.fields?.[f.key] ?? "") === "true"
                    ? "Yes"
                    : "No"
                  : note.fields?.[f.key] ?? "";
              return (
                <div key={f.key} className="flex items-baseline gap-3">
                  <span
                    className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide"
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

          {hasManyFields && (
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
          )}
        </div>
      )}
    </div>
  );
}

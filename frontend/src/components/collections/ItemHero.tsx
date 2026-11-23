"use client";

import { SquarePen } from "lucide-react";

import type { CollectionMeta, Note } from "@/lib/api";
import { SHELL_PALETTE } from "../mobile/mobileTheme";
import { openCollection } from "./actions";
import { CollectionBadge, ItemCover } from "./CollectionArt";
import { itemFacts } from "./items";
import { useItemActions } from "./useItemActions";

const COVER_SHADOW = "0 14px 32px -14px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.12)";
const SUBTLE = "bg-[color-mix(in_srgb,var(--mob-text)_6%,transparent)]";
const SUBTLE_HOVER = "hover:bg-[color-mix(in_srgb,var(--mob-text)_10%,transparent)]";

/**
 * The header of an open collection item, above its editor: the cover, the
 * collection it belongs to and its filled fields. Cover and fields live in
 * frontmatter (changed with "Edit details"), so the body stays plain text.
 * The editor's title heading follows right below (globals.css,
 * `.has-collection-header`).
 */
export default function ItemHero({ note, variant }: { note: Note; variant: "mobile" | "desktop" }) {
  const touch = variant === "mobile";
  const { collection, item, pinned, canEdit, edit, element } = useItemActions(note, { touch });
  if (note.type !== "collection-item") return null;

  const shown = item ?? note;
  const facts = collection ? itemFacts(collection, shown) : [];
  const coverSize = touch ? 168 : 176;
  const cover = (
    <span className="block shrink-0" style={{ width: coverSize, height: coverSize, borderRadius: 16, boxShadow: COVER_SHADOW }}>
      <ItemCover
        cover={shown.cover}
        collection={collection}
        className="h-full w-full"
        radius={16}
        iconSize={Math.round(coverSize * 0.3)}
        pinned={pinned}
      />
    </span>
  );

  if (touch) {
    return (
      // Above the editor below it: its opaque background would cut the cover's shadow off.
      <div className="item-hero relative z-[1] flex flex-col items-center">
        {cover}
        {collection && <CollectionChip collection={collection} touch />}
        {facts.length > 0 ? (
          <dl
            className="mt-4 grid w-full grid-cols-2 gap-x-4 gap-y-3 rounded-2xl p-4"
            style={{ background: "var(--mob-surface)" }}
          >
            {facts.map(({ field, value }) => (
              <Fact key={field.key} label={field.label} value={value} touch />
            ))}
          </dl>
        ) : (
          <p className="mt-4 text-[14px]" style={{ color: "var(--mob-muted)" }}>
            No details yet
          </p>
        )}
        {canEdit && collection && (
          <button
            type="button"
            onClick={edit}
            className={`mt-3 inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium transition-transform active:scale-95 ${SUBTLE}`}
            style={{ color: "var(--mob-text)" }}
          >
            <SquarePen size={16} />
            Edit details
          </button>
        )}
        {element}
      </div>
    );
  }

  return (
    <div className="item-hero relative z-[1] flex items-start gap-7" style={SHELL_PALETTE}>
      {cover}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-4 pt-1">
        {collection && <CollectionChip collection={collection} touch={false} />}
        {facts.length > 0 ? (
          <dl className="grid w-full max-w-[560px] grid-cols-2 gap-x-8 gap-y-3">
            {facts.map(({ field, value }) => (
              <Fact key={field.key} label={field.label} value={value} touch={false} />
            ))}
          </dl>
        ) : (
          <p className="text-[13px]" style={{ color: "var(--mob-muted)" }}>
            No details yet
          </p>
        )}
        {canEdit && collection && (
          <button
            type="button"
            onClick={edit}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium transition-colors hover:bg-muted"
            style={{ color: "var(--mob-text)" }}
          >
            <SquarePen size={14} />
            Edit details
          </button>
        )}
      </div>
      {element}
    </div>
  );
}

/** The collection the item belongs to; a click shows its gallery. */
function CollectionChip({ collection, touch }: { collection: CollectionMeta; touch: boolean }) {
  return (
    <button
      type="button"
      onClick={() => openCollection(collection.id)}
      title={`Open ${collection.name}`}
      className={
        `inline-flex max-w-full items-center gap-2 rounded-full pl-1 pr-3 font-medium transition-colors ${SUBTLE} ${SUBTLE_HOVER} ` +
        (touch ? "mt-4 h-9 text-[14px]" : "h-7 text-[13px]")
      }
      style={{ color: "var(--mob-text)" }}
    >
      <span className="flex shrink-0 overflow-hidden rounded-full">
        <CollectionBadge collection={collection} size={touch ? 26 : 20} />
      </span>
      <span className="truncate">{collection.name}</span>
    </button>
  );
}

function Fact({ label, value, touch }: { label: string; value: string; touch: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--mob-muted)" }}>
        {label}
      </dt>
      <dd className={"mt-0.5 break-words " + (touch ? "text-[15px]" : "text-[14px]")} style={{ color: "var(--mob-text)" }}>
        {value}
      </dd>
    </div>
  );
}

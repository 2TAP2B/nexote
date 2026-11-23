"use client";

import { Library, Pin } from "lucide-react";

import type { CollectionMeta } from "@/lib/api";
import { getIcon, type IconComponent } from "@/lib/icons";

// The pictures of collections: a collection's icon tile and an item's cover.
// They paint with the --mob-* palette and fall back to the theme, so they fit
// the phone shell, the desktop main area and the sidebar alike.

const ACCENT = "var(--mob-accent, var(--primary))";
const SURFACE = "var(--mob-surface, var(--muted))";

/** The icon a collection chose (Library when none or an unknown one). */
export function collectionIcon(collection: Pick<CollectionMeta, "icon"> | null | undefined): IconComponent {
  return getIcon(collection?.icon, Library);
}

/** A collection's icon on an accent-tinted rounded tile. */
export function CollectionBadge({
  collection,
  size = 36,
}: {
  collection: Pick<CollectionMeta, "icon"> | null | undefined;
  size?: number;
}) {
  const Icon = collectionIcon(collection);
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: `color-mix(in srgb, ${ACCENT} 14%, transparent)`,
        color: ACCENT,
      }}
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

/**
 * An item's cover, or the collection's icon on a tinted square when it has
 * none. The frame (size, aspect, rounding) comes from `className`/`radius`;
 * the image fills it. A pinned item gets a small pin in the corner.
 */
export function ItemCover({
  cover,
  collection,
  className = "",
  radius = 12,
  iconSize = 28,
  pinned = false,
}: {
  cover?: string;
  collection: Pick<CollectionMeta, "icon"> | null | undefined;
  className?: string;
  radius?: number;
  iconSize?: number;
  pinned?: boolean;
}) {
  const Icon = collectionIcon(collection);
  return (
    <span
      className={"relative block shrink-0 overflow-hidden " + className}
      style={{
        borderRadius: radius,
        background: cover ? SURFACE : `color-mix(in srgb, ${ACCENT} 9%, ${SURFACE})`,
        // A hairline keeps light covers from melting into the background.
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--mob-text, var(--foreground)) 7%, transparent)",
      }}
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center"
          style={{ color: `color-mix(in srgb, ${ACCENT} 55%, var(--mob-muted, var(--muted-foreground)))` }}
        >
          <Icon size={iconSize} strokeWidth={1.6} />
        </span>
      )}
      {pinned && (
        <span
          aria-label="Pinned"
          className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-sm"
          style={{ background: "rgba(0, 0, 0, 0.55)" }}
        >
          <Pin size={12} strokeWidth={2.4} />
        </span>
      )}
    </span>
  );
}

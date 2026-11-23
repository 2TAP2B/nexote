"use client";

import { useMemo } from "react";

import type { CollectionField, CollectionMeta, NoteMeta } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";

/** A collection item (a note with `collection` set) and the vault it lives in. */
export type CollectionItem = NoteMeta & { vaultId: string };

// Fields that hold a lookup key (Discogs release, ISBN): they fill the item
// from the web, and are references rather than something to read in a card.
export const LOOKUP_KEYS = new Set(["discogsId", "isbn"]);

/** Every collection's items across the space's vaults, by collection id (unsorted). */
export function useCollectionItems(): Map<string, CollectionItem[]> {
  const { vaults, allVaultData } = useNotes();
  return useMemo(() => {
    const byId = new Map<string, CollectionItem[]>();
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (!n.collection) continue;
        const list = byId.get(n.collection);
        const item = { ...n, vaultId: v.id };
        if (list) list.push(item);
        else byId.set(n.collection, [item]);
      }
    }
    return byId;
  }, [vaults, allVaultData]);
}

/** A field's value as shown to people: Yes/No, a local date, else the text. */
export function fieldDisplay(field: CollectionField, raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (field.type === "boolean") return value === "true" ? "Yes" : "No";
  if (field.type === "date") {
    const d = new Date(`${value}T00:00`);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  return value;
}

/** The filled fields of an item in schema order (booleans only when set). */
export function itemFacts(collection: CollectionMeta, item: Pick<NoteMeta, "fields">) {
  return collection.fields
    .map((field) => ({ field, value: fieldDisplay(field, item.fields?.[field.key]) }))
    .filter((f) => f.value !== "");
}

/**
 * The line under an item's title in cards and rows: its first filled text,
 * number or date fields ("Miles Davis · 1959"). A bare number or date says
 * little on its own, so those carry their label ("Rating 8"); Yes/No needs
 * its label even more and is left out, like lookup keys (not for reading).
 */
export function itemSubtitle(collection: CollectionMeta, item: Pick<NoteMeta, "fields">, max = 2): string {
  return itemFacts(collection, item)
    .filter(({ field }) => field.type !== "boolean" && !LOOKUP_KEYS.has(field.key))
    .slice(0, max)
    .map(({ field, value }) => (field.type === "text" ? value : `${field.label} ${value}`))
    .join(" · ");
}

/** Search: the title or any field value contains the query (case-insensitive). */
export function itemMatches(item: CollectionItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((item.title || "").toLowerCase().includes(q)) return true;
  return Object.values(item.fields ?? {}).some((v) => v.toLowerCase().includes(q));
}

/** How a gallery orders its items: by title, by date, or by one of its fields. */
export type ItemSort = "title" | "added" | "updated" | `field:${string}`;

export function sortLabel(sort: ItemSort, collection: CollectionMeta): string {
  if (sort === "title") return "Title";
  if (sort === "added") return "Recently added";
  if (sort === "updated") return "Recently edited";
  const key = sort.slice("field:".length);
  return collection.fields.find((f) => f.key === key)?.label || "Title";
}

/** The sorts a collection offers: title, dates, then its text / number / date fields. */
export function sortOptions(collection: CollectionMeta): ItemSort[] {
  return [
    "title",
    "added",
    "updated",
    ...collection.fields
      .filter((f) => f.type !== "boolean" && !LOOKUP_KEYS.has(f.key))
      .map((f): ItemSort => `field:${f.key}`),
  ];
}

const byTitle = (a: CollectionItem, b: CollectionItem) =>
  (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base", numeric: true });

/**
 * Pinned items first, then the chosen order. Field sorts put items without
 * the field last (numbers compare as numbers, dates as dates).
 */
export function sortItems(items: CollectionItem[], sort: ItemSort, collection: CollectionMeta): CollectionItem[] {
  const field = sort.startsWith("field:") ? collection.fields.find((f) => f.key === sort.slice("field:".length)) : undefined;
  const compare = (a: CollectionItem, b: CollectionItem): number => {
    if (sort === "added") return b.createdAt.localeCompare(a.createdAt) || byTitle(a, b);
    if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt) || byTitle(a, b);
    if (!field) return byTitle(a, b);
    const av = (a.fields?.[field.key] ?? "").trim();
    const bv = (b.fields?.[field.key] ?? "").trim();
    if (!av || !bv) return (av ? -1 : bv ? 1 : 0) || byTitle(a, b);
    if (field.type === "number") {
      const diff = Number(av) - Number(bv);
      if (!Number.isNaN(diff) && diff !== 0) return diff;
    }
    return av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true }) || byTitle(a, b);
  };
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || compare(a, b));
}

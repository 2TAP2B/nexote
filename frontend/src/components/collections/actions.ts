"use client";

import { useMemo } from "react";

import { api, isCollectionsVault, type CollectionMeta } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import type { CollectionItem } from "./items";
import { dropCollection, upsertCollection } from "./useCollections";

// Opening a collection's gallery or the "new collection" editor is the
// host's job (the desktop main area, the phone overlay), so views ask for it
// with window events — the same way threads open.
export const OPEN_COLLECTION_EVENT = "nexote:open-collection";
export const NEW_COLLECTION_EVENT = "nexote:new-collection";

/** Shows the gallery of the collection with this id. */
export function openCollection(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_COLLECTION_EVENT, { detail: id }));
}

export function collectionIdFrom(e: Event): string | null {
  return e instanceof CustomEvent && typeof e.detail === "string" && e.detail ? e.detail : null;
}

/** Opens the "New collection" editor. */
export function newCollection() {
  window.dispatchEvent(new CustomEvent(NEW_COLLECTION_EVENT));
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Changes to collections and their items. Each one throws an Error with a
 * readable message when it fails (callers show it), and brings the shared
 * lists up to date right away instead of waiting for the SSE echo.
 */
export function useCollectionActions() {
  const { activeSpaceId, vaults, refreshVaultTree, closeTab } = useNotes();
  const collectionsVaultId = vaults.find(isCollectionsVault)?.id ?? null;

  return useMemo(() => {
    const space = () => {
      if (!activeSpaceId) throw new Error("No space is open");
      return activeSpaceId;
    };
    return {
      pinItem: async (item: Pick<CollectionItem, "id" | "vaultId">, pinned: boolean) => {
        try {
          await api.update(item.vaultId, item.id, { pinned });
        } catch (e) {
          throw new Error(message(e, pinned ? "Couldn't pin the item" : "Couldn't unpin the item"));
        }
        await refreshVaultTree(item.vaultId);
      },
      deleteItem: async (item: Pick<CollectionItem, "id" | "vaultId">) => {
        try {
          await api.remove(item.vaultId, item.id);
        } catch (e) {
          throw new Error(message(e, "Couldn't delete the item"));
        }
        closeTab(item.id);
        await refreshVaultTree(item.vaultId);
      },
      pinCollection: async (collection: CollectionMeta, pinned: boolean) => {
        try {
          upsertCollection(await api.setCollectionPinned(space(), collection.id, pinned));
        } catch (e) {
          throw new Error(message(e, "Couldn't change the dashboard"));
        }
      },
      hideCollection: async (collection: CollectionMeta) => {
        try {
          upsertCollection(await api.setCollectionHidden(space(), collection.id, true));
        } catch (e) {
          throw new Error(message(e, "Couldn't hide the collection"));
        }
      },
      /**
       * Deletes a collection with its items. The server removes the items in
       * the Collections vault (the collection's folder); items kept in other
       * vaults (older ones) are deleted one by one first, so none is left
       * behind invisible.
       */
      deleteCollection: async (collection: CollectionMeta, items: CollectionItem[]) => {
        try {
          for (const item of items) {
            if (item.vaultId !== collectionsVaultId) await api.remove(item.vaultId, item.id);
          }
          await api.deleteCollection(space(), collection.id);
        } catch (e) {
          throw new Error(message(e, "Couldn't delete the collection"));
        }
        dropCollection(collection.id);
        for (const item of items) closeTab(item.id);
        const touched = new Set(items.map((i) => i.vaultId));
        if (collectionsVaultId) touched.add(collectionsVaultId);
        await Promise.all([...touched].map((id) => refreshVaultTree(id)));
      },
    };
  }, [activeSpaceId, collectionsVaultId, refreshVaultTree, closeTab]);
}

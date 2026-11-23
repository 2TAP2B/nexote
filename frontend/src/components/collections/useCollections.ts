"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { api, type CollectionMeta } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";

// The active space's collection definitions, shared by every view that shows
// them (sidebar, dashboards, gallery, item header): one request per change
// instead of one per mounted view. Changes made here update it at once;
// changes elsewhere arrive as "nexote:refresh-data" (SSE spaces-change).

type State = { spaceId: string | null; list: CollectionMeta[]; loaded: boolean };

let state: State = { spaceId: null, list: [], loaded: false };
let requestedSpace: string | null = null;
// Only the newest response is applied: an older one may predate a change.
let seq = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const setState = (next: State) => {
  state = next;
  emit();
};

export function reloadCollections(spaceId: string): Promise<void> {
  requestedSpace = spaceId;
  const mine = ++seq;
  return api.listCollections(spaceId).then(
    (res) => {
      if (mine === seq) setState({ spaceId, list: res.collections ?? [], loaded: true });
    },
    () => {
      // Offline or refused: keep what this space had, but stop "loading".
      if (mine === seq) setState(state.spaceId === spaceId ? { ...state, loaded: true } : { spaceId, list: [], loaded: true });
    },
  );
}

const onRefresh = () => {
  if (requestedSpace) void reloadCollections(requestedSpace);
};

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("nexote:refresh-data", onRefresh);
    // Nobody listened for a while: changes may have been missed.
    if (requestedSpace) void reloadCollections(requestedSpace);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("nexote:refresh-data", onRefresh);
  };
}

const snapshot = () => state;

/** A collection as the server returned it after a change (create, edit, pin, hide). */
export function upsertCollection(col: CollectionMeta) {
  const i = state.list.findIndex((c) => c.id === col.id);
  const list = i < 0 ? [...state.list, col] : state.list.map((c) => (c.id === col.id ? col : c));
  setState({ ...state, list });
}

/** A deleted collection leaves the list before the next reload confirms it. */
export function dropCollection(id: string) {
  setState({ ...state, list: state.list.filter((c) => c.id !== id) });
}

/** The active space's collections, hidden ones included (views filter them). */
export function useCollections(): { collections: CollectionMeta[]; loaded: boolean; reload: () => Promise<void> } {
  const { activeSpaceId } = useNotes();
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!activeSpaceId || requestedSpace === activeSpaceId) return;
    void reloadCollections(activeSpaceId);
  }, [activeSpaceId]);

  const reload = useCallback(
    () => (activeSpaceId ? reloadCollections(activeSpaceId) : Promise.resolve()),
    [activeSpaceId],
  );
  const current = s.spaceId === activeSpaceId;
  return { collections: current ? s.list : NONE, loaded: current && s.loaded, reload };
}

const NONE: CollectionMeta[] = [];

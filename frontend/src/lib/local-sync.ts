// The Android app's sync state (`GET /api/local/sync` on its engine), shared
// by every view that shows it: the sync dots in the headers and Settings ›
// Server. One polling loop for all of them, running only while something is
// subscribed and the page is visible, one request at a time.

import { useSyncExternalStore } from "react";

import { api, type LocalSyncStatus } from "./api";

export type LocalSyncSnapshot = {
  /** null until the first answer. */
  status: LocalSyncStatus | null;
  /** The first load failed (later misses are just retried). */
  loadError: string | null;
  /** A sync finished while someone was watching; true for a moment. */
  justSynced: boolean;
};

const CONNECTED_MS = 2000;
// Not paired: only pairing (which reports its own result) changes that.
const IDLE_MS = 15000;
const JUST_SYNCED_MS = 2500;

let snapshot: LocalSyncSnapshot = { status: null, loadError: null, justSynced: false };
const listeners = new Set<() => void>();
let timer: number | undefined;
let justSyncedTimer: number | undefined;
let inFlight = false;
// Bumped by every answer that must win over a poll already under way (an
// action's own result, a forced refresh).
let generation = 0;
// lastSyncAt of the previous answer; `watching` is false right after the
// loop (re)starts, so a sync that finished while nobody looked doesn't flash.
let lastSyncAt: string | undefined;
let watching = false;

function update(patch: Partial<LocalSyncSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

function apply(status: LocalSyncStatus) {
  const last = status.connected ? status.lastSyncAt : undefined;
  const finished = watching && last !== undefined && last !== lastSyncAt;
  lastSyncAt = last;
  watching = true;
  update({ status, loadError: null, ...(finished ? { justSynced: true } : {}) });
  if (finished) {
    clearTimeout(justSyncedTimer);
    justSyncedTimer = window.setTimeout(() => update({ justSynced: false }), JUST_SYNCED_MS);
  }
}

function schedule() {
  clearTimeout(timer);
  if (listeners.size === 0 || document.visibilityState !== "visible") return;
  timer = window.setTimeout(() => void poll(), snapshot.status?.connected ? CONNECTED_MS : IDLE_MS);
}

async function poll() {
  if (inFlight) return;
  inFlight = true;
  const started = generation;
  try {
    const status = await api.localSyncStatus();
    if (started === generation) apply(status);
  } catch (e) {
    if (!snapshot.status) {
      update({ loadError: e instanceof Error && e.message ? e.message : "Couldn't read the server connection" });
    }
  } finally {
    inFlight = false;
    schedule();
  }
}

// Back on the page: read at once instead of waiting out the timer, unless a
// request is running (it schedules the next one).
function onVisibility() {
  if (document.visibilityState !== "visible" || inFlight) return;
  watching = false;
  void poll();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    watching = false;
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") void poll();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

const serverSnapshot: LocalSyncSnapshot = { status: null, loadError: null, justSynced: false };

/** The engine's sync state, kept current while the component is mounted. */
export function useLocalSync(): LocalSyncSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => serverSnapshot,
  );
}

/** An action's own answer (pair, disconnect): shown at once, and a poll that
 *  started before it can't put the old state back. */
export function setLocalSync(status: LocalSyncStatus): void {
  generation++;
  apply(status);
}

/** Reads the state now (after "Sync now"), whatever the loop is doing. */
export async function refreshLocalSync(): Promise<void> {
  const started = ++generation;
  try {
    const status = await api.localSyncStatus();
    if (started === generation) apply(status);
  } catch {
    // The loop tries again shortly.
  }
}

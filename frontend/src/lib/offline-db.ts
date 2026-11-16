"use client";

// Window-side access to the offline database the service worker
// (public/sw.js) owns: note copies, cached list responses and the outbox of
// changes waiting to sync. The worker fills and replays it; the window only
// counts the outbox (sync badge, sign-out warning) and wipes it on sign-out.
// Schema and version must match sw.js.

const DB_NAME = "nexote-offline";
const DB_VERSION = 2;
const STORES = ["notes", "lists", "outbox"];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains("meta")) db.deleteObjectStore("meta");
      for (const store of ["notes", "lists"]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

// Number of changes waiting to be synced.
export async function offlineOutboxCount(): Promise<number> {
  const db = await openDB();
  return new Promise<number>((resolve, reject) => {
    const req = db.transaction("outbox", "readonly").objectStore("outbox").count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Empties every store (note copies, lists, the outbox) so nothing of the
// signed-out account stays on the device. Clearing instead of deleting the
// database: the service worker keeps its own connection open, which would
// block deleteDatabase indefinitely.
// Executor form: Promise.withResolvers needs iOS 17.4+ and isn't polyfilled.
export async function offlineClearAll(): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES, "readwrite");
    for (const store of STORES) tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

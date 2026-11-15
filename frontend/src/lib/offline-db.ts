"use client";

// Offline persistence for Nexote. A single IndexedDB database mirrors the
// backend data so the app works fully offline: note bodies and list responses
// are cached, and edits made offline are queued in an outbox that the service
// worker replays when the connection returns.
//
// The service worker (public/sw.js) owns the actual read/write of this store
// for requests it intercepts. The window side uses these helpers to (a) push
// the full precache dataset on first online load, and (b) read the outbox
// count to show how many changes are waiting to sync.

const DB_NAME = "nexote-offline";
const DB_VERSION = 1;

export type OutboxEntry = {
  id: number;
  method: string;
  url: string;
  body: string | null;
  at: string;
  kind: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // notes / lists / meta are keyed by an "id" string the caller builds
      // (e.g. `${vaultId}/${noteId}` or a full URL path).
      for (const store of ["notes", "lists", "meta"]) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      }
      // outbox uses an auto-increment numeric "id" for FIFO ordering.
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

// --- Notes ---

export async function offlineGetNote(vaultId: string, id: string): Promise<{ id: string } | undefined> {
  const key = `${vaultId}/${id}`;
  return withStore("notes", "readonly", (s) =>
    s.get(key) as IDBRequest,
  ).then((r: unknown) => r as { id: string } | undefined);
}

export async function offlinePutNote(vaultId: string, note: { id: string }): Promise<void> {
  const key = `${vaultId}/${note.id}`;
  await withStore("notes", "readwrite", (s) => s.put({ id: key, note }));
}

export async function offlineDeleteNote(vaultId: string, id: string): Promise<void> {
  const key = `${vaultId}/${id}`;
  await withStore("notes", "readwrite", (s) => s.delete(key));
}

// --- Lists (cached GET responses) ---

export async function offlineListGet(url: string): Promise<unknown> {
  return withStore("lists", "readonly", (s) => s.get(url)).then((r) =>
    r ? (r as { value: unknown }).value : undefined,
  );
}

export async function offlineListPut(url: string, value: unknown): Promise<void> {
  await withStore("lists", "readwrite", (s) => s.put({ id: url, value }));
}

// --- Outbox ---

export async function offlineOutboxCount(): Promise<number> {
  return withStore("outbox", "readonly", (s) => s.count()).then(
    (n) => n ?? 0,
  );
}

export async function offlineOutboxList(): Promise<OutboxEntry[]> {
  return withStore("outbox", "readonly", (s) => s.getAll() as IDBRequest).then(
    (r: unknown) => (r as OutboxEntry[]) ?? [],
  );
}

export async function offlineOutboxClear(): Promise<void> {
  await withStore("outbox", "readwrite", (s) => s.clear());
}

export async function offlineOutboxRemove(id: number): Promise<void> {
  await withStore("outbox", "readwrite", (s) => s.delete(id));
}

// --- Sign-out ---

// Empties every store (mirrored notes, lists, the outbox) so nothing of the
// signed-out account stays on the device. Clearing instead of deleting the
// database: the service worker keeps its own connection open, which would
// block deleteDatabase indefinitely.
// Executor form: Promise.withResolvers needs iOS 17.4+ and isn't polyfilled.
export async function offlineClearAll(): Promise<void> {
  const db = await openDB();
  const stores = ["notes", "lists", "meta", "outbox"];
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    for (const store of stores) tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// --- Precache ---

// Store the full dataset so the service worker can serve it offline before a
// specific note/list was ever fetched individually.
export async function offlinePrecache(data: {
  lists: Record<string, unknown>;
  notes: Record<string, unknown>;
}): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["lists", "notes"], "readwrite");
    const lists = tx.objectStore("lists");
    const notes = tx.objectStore("notes");
    for (const [url, value] of Object.entries(data.lists ?? {})) {
      lists.put({ id: url, value });
    }
    for (const [key, note] of Object.entries(data.notes ?? {})) {
      notes.put({ id: key, note });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

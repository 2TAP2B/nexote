// Nexote service worker — caches the app shell for offline launch, mirrors
// backend data into IndexedDB for full offline read, and queues mutations in
// an outbox replaying them when back online.
//
// Offline is production-only (the dev server doesn't register the SW, so HMR
// chunks are never cached).

const CACHE = "nexote-v3";
const SHELL = ["/", "/m", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

const DB_NAME = "nexote-offline";
const DB_VERSION = 1;

// Matches data GETs we mirror (note bodies + list responses). Image BLOBS live
// in CacheStorage (see the image handler), but their manifest/URLs are cached.
const DATA_GET = /^\/api\//;
const IMAGE_PATH = /^\/api\/vaults\/[^/]+\/images\//;

// Mutating HTTP methods that get queued when offline.
const MUTATION = ["POST", "PUT", "PATCH", "DELETE"];

// --- IndexedDB helpers (runs in SW scope) ---
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ["notes", "lists", "meta"]) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function dbReq(store, mode, fn) {
  return openDB().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }),
  );
}

async function cacheList(url, value) {
  try {
    await dbReq("lists", "readwrite", (s) => s.put({ id: url, value }));
  } catch {}
}

async function readList(url) {
  try {
    const rec = await dbReq("lists", "readonly", (s) => s.get(url));
    return rec ? rec.value : undefined;
  } catch {
    return undefined;
  }
}

async function cacheNote(vaultId, note) {
  if (!note || !note.id) return;
  try {
    await dbReq("notes", "readwrite", (s) =>
      s.put({ id: `${vaultId}/${note.id}`, note }),
    );
  } catch {}
}

async function readNote(vaultId, noteId) {
  try {
    const rec = await dbReq("notes", "readonly", (s) =>
      s.get(`${vaultId}/${noteId}`),
    );
    return rec ? rec.note : undefined;
  } catch {
    return undefined;
  }
}

async function outboxPush(entry) {
  try {
    await dbReq("outbox", "readwrite", (s) =>
      s.add({ ...entry, at: new Date().toISOString() }),
    );
  } catch {}
}

async function outboxAll() {
  try {
    const all = await dbReq("outbox", "readonly", (s) => s.getAll());
    (all || []).sort((a, b) => a.id - b.id);
    return all || [];
  } catch {
    return [];
  }
}

async function outboxRemove(id) {
  try {
    await dbReq("outbox", "readwrite", (s) => s.delete(id));
  } catch {}
}

// --- Precache: persist the full dataset (posted by the app) ---
self.addEventListener("message", (e) => {
  const data = e.data;
  if (!data) return;
  if (data.type === "nexote:precache") {
    const { lists, notes } = data;
    openDB().then(async (db) => {
      const tx = db.transaction(["lists", "notes"], "readwrite");
      const lStore = tx.objectStore("lists");
      const nStore = tx.objectStore("notes");
      for (const [url, value] of Object.entries(lists || {})) {
        lStore.put({ id: url, value });
      }
      for (const [key, note] of Object.entries(notes || {})) {
        nStore.put({ id: key, note });
      }
    });
    return;
  }
  // Window asks the SW to replay the outbox after a reconnect. The SW scope
  // does not receive "online" events, so the window must trigger it.
  if (data.type === "nexote:flush") {
    flushOutbox();
    return;
  }
});

// --- Install / activate ---
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
  // If the app comes up online with queued changes, try to flush them.
  if (navigator.onLine) flushOutbox();
});

// --- Reconnect sync: flush the outbox in FIFO order ---
async function flushOutbox() {
  const entries = await outboxAll();
  const conflicts = [];
  for (const entry of entries) {
    try {
      const init = {
        method: entry.method,
        headers: { "Content-Type": "application/json" },
      };
      if (entry.body) init.body = entry.body;
      const res = await fetch(entry.url, init);
      if (res.status === 409) {
        // Server version is newer — keep it, drop the queued write.
        conflicts.push(entry.url);
        await outboxRemove(entry.id);
        continue;
      }
      if (res.ok || res.status === 204) {
        if (res.ok && /\/notes\/[^/]+$/.test(entry.url)) {
          // Mirror the just-saved note body for offline reads.
          try {
            const json = await res.clone().json();
            if (json?.id) cacheNote(vaultIdFrom(entry.url), json);
          } catch {}
        }
        await outboxRemove(entry.id);
      } else {
        // Leave it queued; could be a transient server error.
        continue;
      }
    } catch {
      // Network dropped mid-flush — stop and leave the rest queued.
      break;
    }
  }
  try {
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.postMessage({ type: "nexote:synced", conflicts });
    }
  } catch {}
}

// Note: the SW scope does not receive "online"/"offline" events — the window
// side (OfflineStatus) detects reconnects and sends "nexote:flush" instead.

// --- Fetch strategy ---
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only same-origin
  if (req.method === "GET" && url.pathname.startsWith("/_next/webpack-hmr")) return;
  if (url.pathname.startsWith("/api/ai/")) return; // AI proxy — never queue
  // Git push/pull/config: replaying later would be wrong and a fake 200
  // would report "Pushed." for a sync that never happened.
  if (url.pathname.startsWith("/api/git/")) return;

  // ---- Mutations ----
  if (MUTATION.includes(req.method)) {
    // Always route through respondWith so a failed fetch (offline or backend
    // unreachable) falls back to the outbox instead of erroring the UI.
    e.respondWith(
      fetch(req.clone())
        .then(async (res) => {
          if (res.ok || res.status === 204) return res;
          // 409 etc — let the app see the real status (conflict handling).
          return res;
        })
        .catch(async () => {
          const bodyText = req.method === "GET" ? null : await req.clone().text().catch(() => null);
          await outboxPush({
            method: req.method,
            url: url.pathname + url.search,
            body: bodyText || null,
            kind: mutationKind(url.pathname, req.method),
          });
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }),
    );
    return;
  }

  // ---- GETs ----

  // Image blobs: cache-first (seeded on upload).
  if (IMAGE_PATH.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Data GETs (notes + lists): network-first with offline fallback to IDB.
  if (DATA_GET.test(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            res.clone().json().then((json) => {
              const isNote = /\/notes\/[^/]+$/.test(url.pathname);
              if (isNote && json?.id) {
                cacheNote(vaultIdFrom(url.pathname), json);
              } else {
                cacheList(url.pathname + url.search, json);
              }
            }).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const isNote = /\/notes\/[^/]+$/.test(url.pathname);
          if (isNote) {
            const vid = vaultIdFrom(url.pathname);
            const nid = url.pathname.split("/").pop();
            const note = await readNote(vid, nid);
            if (note) {
              return new Response(JSON.stringify(note), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
          }
          const cached = await readList(url.pathname + url.search);
          if (cached) {
            return new Response(JSON.stringify(cached), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return caches.match(req).then((r) => r || Response.error());
        }),
    );
    return;
  }

  // Navigation: network-first -> cache fallback.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/m"))),
    );
    return;
  }

  // Static assets: cache-first.
  if (url.pathname.startsWith("/_next/static") || url.pathname.match(/\.(svg|png|ico|woff2?|css)$/)) {
    e.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          }),
      ),
    );
  }
});

// Determine which vault a /api/vaults/<id>/... path belongs to.
function vaultIdFrom(path) {
  const m = path.match(/^\/api\/vaults\/([^/]+)/);
  return m ? m[1] : "";
}

function mutationKind(pathname, method) {
  if (/\/folders/.test(pathname)) return "folder";
  if (/\/bookmarks/.test(pathname)) return "bookmark";
  if (/\/shortcuts/.test(pathname)) return "shortcut";
  if (/\/tags/.test(pathname)) return "tag";
  if (/\/images/.test(pathname)) return "image";
  if (/\/collections/.test(pathname)) return "collection";
  if (/\/journal\/notes/.test(pathname)) return "note";
  if (/\/notes/.test(pathname)) return "note";
  if (/\/vaults/.test(pathname)) return "vault";
  return "other";
}

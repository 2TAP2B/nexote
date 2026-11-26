// Nexote service worker: offline launch, offline reads and an ordered outbox
// that syncs changes made offline when the server is reachable again.
//
// - App shell (pages, /_next/static, icons, fonts): cached per release; the
//   release id comes in as ?v= on the registration URL.
// - Data GETs: network first, mirrored into IndexedDB; offline (or with the
//   server down) answered from IndexedDB. A note with changes still in the
//   outbox is always answered from the local copy, and lists get the queued
//   changes applied, so nothing "jumps back" before the sync is done.
// - Writes: only note edits/creates/deletes, bookmarks, shortcuts and folder
//   creation are queued (QUEUEABLE). They go to the network directly only
//   while the outbox is empty; otherwise they queue behind it, so the order
//   is kept. Everything else answers 503 offline ("needs a connection").
// - Replay: one at a time (flush lock), oldest first. A queued edit carries
//   the server version it was based on (expectedUpdatedAt); if the note
//   changed or vanished on the server meanwhile, the offline text is saved
//   as a separate "offline copy" note instead of being dropped or blindly
//   overwriting the newer version.
//
// Production only: the dev server doesn't register the worker.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_CACHE = `nexote-shell-${VERSION}`;
const IMAGE_CACHE = "nexote-images"; // survives releases (user content)
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

const DB_NAME = "nexote-offline";
const DB_VERSION = 2;

const IMAGE_PATH = /^\/api\/vaults\/[^/]+\/images\//;
const NOTE_PATH = /^\/api\/(?:vaults\/([^/]+)|(journal))\/notes\/([^/]+)$/;
const CREATE_PATH = /^\/api\/vaults\/([^/]+)\/notes$/;
const DAILY_PATH = /^\/api\/journal\/daily$/;
const MARK_PATH = /^\/api\/vaults\/([^/]+)\/(bookmarks|shortcuts)(?:\/([^/]+))?$/;
const FOLDER_CREATE_PATH = /^\/api\/vaults\/([^/]+)\/folders$/;
const MUTATION = ["POST", "PUT", "PATCH", "DELETE"];

// Never touched by the worker: accounts/sessions (never cached, never
// replayed), paired devices and the device sync API, the AI proxy, git sync
// and the live event stream.
const BYPASS = /^\/api\/(auth|admin|me|users|devices|sync|ai|git|events)(\/|$)/;

// The backend can't be reached even though the network works: a reverse
// proxy's 502/503/504, or the Next.js /api proxy's plain-text 500 when the
// backend is down (the backend's own errors are JSON). Treated like no
// network at all.
function serverDown(res) {
  if ([502, 503, 504].includes(res.status)) return true;
  return res.status >= 500 && !res.headers.get("Content-Type")?.includes("application/json");
}

// ---------------------------------------------------------------- IndexedDB

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1 had an unused "meta" store.
      if (db.objectStoreNames.contains("meta")) db.deleteObjectStore("meta");
      for (const store of ["notes", "lists"]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
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
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

const getList = (url) => dbReq("lists", "readonly", (s) => s.get(url)).then((r) => r?.value).catch(() => undefined);
const putList = (url, value) => dbReq("lists", "readwrite", (s) => s.put({ id: url, value })).catch(() => {});
// A note record: { id: "<scope>/<noteId>", note, base } — base is the
// updatedAt of the server version the local copy started from.
const getNoteRec = (key) => dbReq("notes", "readonly", (s) => s.get(key)).catch(() => undefined);
const putNoteRec = (rec) => dbReq("notes", "readwrite", (s) => s.put(rec)).catch(() => {});
const deleteNoteRec = (key) => dbReq("notes", "readwrite", (s) => s.delete(key)).catch(() => {});
// Entries queued by an older version of this worker ({method,url,body:text})
// are converted on read, so nothing queued before an update is lost.
const outboxAll = () =>
  dbReq("outbox", "readonly", (s) => s.getAll())
    .then(async (all) => {
      const out = [];
      for (const entry of (all || []).sort((a, b) => a.id - b.id)) {
        if (entry.op) {
          out.push(entry);
          continue;
        }
        const body = typeof entry.body === "string" ? parse(entry.body) : entry.body || {};
        const op = queueableOp(entry.method, new URL(entry.url, self.location.origin).pathname, body);
        if (!op) {
          await outboxDelete(entry.id);
          continue;
        }
        const migrated = { ...entry, op, body };
        await outboxPut(migrated);
        out.push(migrated);
      }
      return out;
    })
    .catch(() => []);
const outboxAdd = (entry) => dbReq("outbox", "readwrite", (s) => s.add(entry));
const outboxPut = (entry) => dbReq("outbox", "readwrite", (s) => s.put(entry));
const outboxDelete = (id) => dbReq("outbox", "readwrite", (s) => s.delete(id)).catch(() => {});

// ------------------------------------------------------------------ helpers

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const offlineError = (read = false) =>
  json(
    {
      error: read
        ? "You're offline and this isn't saved on this device yet."
        : "You're offline. This change needs a connection to the server.",
    },
    503,
  );
const parse = (text) => {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
};
const listUrl = (scope) => (scope === "journal" ? "/api/journal/notes" : `/api/vaults/${scope}/notes`);
const now = () => new Date().toISOString();

function noteKeyOf(pathname) {
  const m = NOTE_PATH.exec(pathname);
  return m ? { scope: m[1] || m[2], id: m[3], key: `${m[1] || m[2]}/${m[3]}` } : null;
}

// The list entry for a note (the fields the tree and dashboard read).
function entryOf(note) {
  const { body, ...meta } = note;
  const snippet = (body || "")
    .replace(/^#{1,6}\s+.*$/m, "")
    .replace(/[#*_`>\[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return { tags: [], ...meta, snippet };
}

// What a queued write is, or null when it can't be queued.
function queueableOp(method, pathname, body) {
  const note = noteKeyOf(pathname);
  if (note && (method === "PUT" || method === "DELETE")) return { kind: method === "PUT" ? "update" : "delete", ...note };
  const create = CREATE_PATH.exec(pathname);
  // Only creates with a client-chosen id: later edits must address the note.
  if (create && method === "POST" && typeof body.id === "string" && body.id) {
    return { kind: "create", scope: create[1], id: body.id, key: `${create[1]}/${body.id}` };
  }
  const mark = MARK_PATH.exec(pathname);
  if (mark && (method === "POST" || method === "DELETE")) {
    return { kind: "mark", scope: mark[1], list: mark[2], id: method === "POST" ? body.id : mark[3], add: method === "POST" };
  }
  const folder = FOLDER_CREATE_PATH.exec(pathname);
  if (folder && method === "POST") return { kind: "folder", scope: folder[1], path: body.path };
  return null;
}

// ------------------------------------------------- local copies of writes

// Applies a write to the local note copy and the cached lists, so offline
// reads (and reads before the sync finishes) show it. Returns what the
// server would have answered.
async function applyLocally(op, body) {
  if (op.kind === "update") {
    const rec = await getNoteRec(op.key);
    const { expectedUpdatedAt, ...fields } = body;
    const note = { ...(rec?.note || { id: op.id, createdAt: now() }), ...fields, id: op.id, updatedAt: now() };
    await putNoteRec({ id: op.key, note, base: rec ? (rec.base ?? rec.note.updatedAt) : undefined });
    await editList(listUrl(op.scope), (list) => {
      list.notes = (list.notes || []).map((n) => (n.id === op.id ? { ...n, ...entryOf(note) } : n));
    });
    return json(note);
  }
  if (op.kind === "create") {
    const title = (body.title || "").trim() || "Untitled";
    const note = {
      id: op.id,
      title,
      path: body.path || "",
      body: body.body || `## ${title}\n\n`,
      createdAt: now(),
      updatedAt: now(),
      tags: [],
    };
    await putNoteRec({ id: op.key, note, base: undefined });
    await editList(listUrl(op.scope), (list) => {
      list.notes = [...(list.notes || []).filter((n) => n.id !== op.id), entryOf(note)];
    });
    return json(note, 201);
  }
  if (op.kind === "delete") {
    await deleteNoteRec(op.key);
    await editList(listUrl(op.scope), (list) => {
      list.notes = (list.notes || []).filter((n) => n.id !== op.id);
    });
    return new Response(null, { status: 204 });
  }
  if (op.kind === "mark") {
    await editList(`/api/vaults/${op.scope}/${op.list}`, (list) => {
      const ids = (list[op.list] || []).filter((id) => id !== op.id);
      list[op.list] = op.add ? [...ids, op.id] : ids;
    });
    return new Response(null, { status: 204 });
  }
  if (op.kind === "folder") {
    await editList(listUrl(op.scope), (list) => {
      const folders = list.folders || [];
      if (op.path && !folders.some((f) => f.path === op.path)) {
        list.folders = [...folders, { path: op.path, name: op.path.split("/").pop() }];
      }
    });
    return json({ path: op.path }, 201);
  }
  return new Response(null, { status: 204 });
}

async function editList(url, edit) {
  const list = (await getList(url)) || {};
  const copy = structuredClone(list);
  edit(copy);
  await putList(url, copy);
}

// Lists fetched from the server while changes are still queued: apply those
// changes on top, so the tree doesn't show deleted notes or lose new ones.
async function withPending(pathname, value) {
  const pending = await outboxAll();
  if (!pending.length || !value || typeof value !== "object") return value;
  let out = structuredClone(value);
  for (const entry of pending) {
    const op = entry.op;
    const scopeList = listUrl(op.scope);
    if (pathname === scopeList && (op.kind === "update" || op.kind === "create" || op.kind === "delete")) {
      const rec = op.kind === "delete" ? null : await getNoteRec(op.key);
      out.notes = (out.notes || []).filter((n) => n.id !== op.id);
      if (rec) out.notes.push(entryOf(rec.note));
    }
    if (op.kind === "mark" && pathname === `/api/vaults/${op.scope}/${op.list}`) {
      const ids = (out[op.list] || []).filter((id) => id !== op.id);
      out[op.list] = op.add ? [...ids, op.id] : ids;
    }
  }
  return out;
}

// ------------------------------------------------------------------- outbox

// Queues a write. Repeated edits of one note merge into its queued edit
// (same place in the queue, the original base version kept) — unless that
// edit is being sent right now: merging into it would lose the new text
// when the replay removes the entry after its (older) body was saved.
async function enqueue(method, url, op, body) {
  const all = await outboxAll();
  if (op.kind === "update") {
    const lastForNote = [...all].reverse().find((e) => e.op.key === op.key);
    if (lastForNote && lastForNote.op.kind === "update" && lastForNote.id !== inFlight) {
      lastForNote.body = { ...lastForNote.body, ...body };
      await outboxPut(lastForNote);
      return;
    }
    const rec = await getNoteRec(op.key);
    const createdOffline = all.some((e) => e.op.kind === "create" && e.op.key === op.key);
    op.base = createdOffline ? undefined : rec ? (rec.base ?? rec.note.updatedAt) : undefined;
  }
  await outboxAdd({ method, url, op, body, at: now() });
}

async function pendingCount() {
  return (await outboxAll()).length;
}

async function hasPendingNote(key) {
  return (await outboxAll()).some((e) => e.op.key === key);
}

async function notify(message) {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.postMessage(message);
}

let flushing = null;
// The outbox entry whose request is on the wire (see enqueue).
let inFlight = null;
function flush() {
  if (!flushing) {
    flushing = replay().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

// Replays the outbox oldest first until it's empty or the server can't be
// reached. Returns quietly when there's nothing to do.
async function replay() {
  const report = { copies: [], failed: [], done: 0 };
  let stopped = false;
  for (;;) {
    const [entry] = await outboxAll();
    if (!entry) break;
    inFlight = entry.id;
    const body =
      entry.op.kind === "update" && entry.op.base ? { ...entry.body, expectedUpdatedAt: entry.op.base } : entry.body;
    let res;
    try {
      res = await fetch(entry.url, {
        method: entry.method,
        headers: { "Content-Type": "application/json" },
        body: entry.method === "DELETE" ? undefined : JSON.stringify(body),
      });
    } catch {
      stopped = true; // no network: keep the rest
      break;
    }
    if (res.status >= 500) {
      stopped = true;
      break;
    }
    if (res.status === 401) {
      stopped = true; // signed out: keep everything until the next sign-in
      await notify({ type: "nexote:sync-auth" });
      break;
    }
    const op = entry.op;
    if (res.ok) {
      if (op.kind === "update" || op.kind === "create") {
        const note = await res.json().catch(() => null);
        if (note?.id) {
          // Edits queued meanwhile now build on the version just saved.
          const later = (await outboxAll()).filter((e) => e.id !== entry.id && e.op.key === op.key);
          for (const e of later) {
            if (e.op.kind !== "update") continue;
            e.op.base = note.updatedAt;
            await outboxPut(e);
          }
          const rec = await getNoteRec(op.key);
          await putNoteRec({ id: op.key, note: later.length && rec ? rec.note : note, base: note.updatedAt });
        }
      }
    } else if (op.kind === "update" && (res.status === 409 || res.status === 404)) {
      // Changed (409) or deleted (404) on the server meanwhile: keep the
      // offline text as its own note next to the original.
      const copy = await saveOfflineCopy(entry);
      if (copy) report.copies.push(copy);
      else {
        stopped = true;
        break;
      }
    } else if ((op.kind === "create" && res.status === 409) || (op.kind === "delete" && res.status === 404)) {
      // Already created by an earlier replay / already gone: nothing to do.
    } else {
      report.failed.push({ method: entry.method, url: entry.url, status: res.status });
    }
    await outboxDelete(entry.id);
    inFlight = null;
    report.done++;
  }
  inFlight = null;
  const remaining = await pendingCount();
  // Always answer: the window shows "Syncing…" until it hears back.
  await notify({ type: "nexote:synced", ...report, remaining, stopped });
  return report;
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Creates "<title> (offline copy)" with the queued text. Journal notes and
// notes whose vault is gone go to the personal store.
async function saveOfflineCopy(entry) {
  const rec = await getNoteRec(entry.op.key);
  const title = `${entry.body.title || rec?.note?.title || "Untitled"} (offline copy)`;
  const text = entry.body.body ?? rec?.note?.body ?? "";
  const targets = entry.op.scope === "journal" ? ["home"] : [entry.op.scope, "home"];
  for (const vault of targets) {
    const path = vault === entry.op.scope ? entry.body.path ?? rec?.note?.path ?? "" : "";
    try {
      const res = await fetch(`/api/vaults/${vault}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newId(), title, path, body: text }),
      });
      if (res.ok) {
        const note = await res.json();
        // The local copy of the original is stale now: drop it.
        await deleteNoteRec(entry.op.key);
        await putNoteRec({ id: `${vault}/${note.id}`, note, base: note.updatedAt });
        return { original: entry.body.title || rec?.note?.title || "Untitled", copy: note.title, vault };
      }
      if (res.status !== 404 && res.status !== 403) return null;
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- lifecycle

self.addEventListener("install", (e) => {
  e.waitUntil(cacheShell().catch(() => {}));
  self.skipWaiting();
});

// Caches the shell pages and every file of this build (listed by the app's
// /sw-assets route), so the app, including lazily loaded parts like the
// editor, works offline even where this device never opened them.
async function cacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(SHELL);
  const res = await fetch("/sw-assets", { cache: "no-store" });
  const queue = res.ok ? (await res.json()).assets || [] : [];
  // A few at a time; a failed file is fetched again when the app needs it.
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let u = queue.shift(); u; u = queue.shift()) {
        await fetch(u)
          .then((r) => r.ok && cache.put(u, r))
          .catch(() => {});
      }
    }),
  );
}

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== IMAGE_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      flush();
    })(),
  );
});

self.addEventListener("message", (e) => {
  const data = e.data;
  if (!data) return;
  // The window detected the server again (or asks after a sign-in).
  if (data.type === "nexote:flush") e.waitUntil(flush());
});

// Android/Chrome: replays even after the app was closed.
self.addEventListener("sync", (e) => {
  if (e.tag === "nexote-outbox") e.waitUntil(flush());
});

function requestBackgroundSync() {
  self.registration.sync?.register("nexote-outbox").catch(() => {});
}

// -------------------------------------------------------------------- fetch

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/webpack-hmr") || BYPASS.test(url.pathname)) return;

  if (MUTATION.includes(req.method)) {
    if (url.pathname.startsWith("/api/")) e.respondWith(handleWrite(req, url));
    return;
  }
  if (req.method !== "GET") return; // HEAD probes etc. go straight to the network

  if (IMAGE_PATH.test(url.pathname)) return e.respondWith(handleImage(req));
  if (url.pathname.startsWith("/api/")) return e.respondWith(handleData(url, req));
  if (req.mode === "navigate") return e.respondWith(handleNavigation(req, url));
  if (url.pathname.startsWith("/_next/static") || /\.(svg|png|ico|woff2?|css|webmanifest)$/.test(url.pathname)) {
    return e.respondWith(handleStatic(req));
  }
});

async function handleWrite(req, url) {
  const text = req.headers.get("Content-Type")?.includes("application/json") ? await req.clone().text() : "";
  const body = parse(text);
  const path = url.pathname + url.search;
  const op = queueableOp(req.method, url.pathname, body);

  if (!op) {
    // Not queueable: the server decides; offline it fails visibly.
    try {
      const res = await fetch(req);
      return serverDown(res) ? offlineError() : res;
    } catch {
      return offlineError();
    }
  }

  // Keep the order: while anything is queued, new writes queue behind it.
  if ((await pendingCount()) === 0 && !flushing) {
    try {
      const res = await fetch(req.clone());
      if (!serverDown(res)) {
        if (res.ok && (op.kind === "update" || op.kind === "create")) {
          const note = await res.clone().json().catch(() => null);
          if (note?.id) await putNoteRec({ id: op.key, note, base: note.updatedAt });
        } else if (res.ok && op.kind === "delete") {
          await deleteNoteRec(op.key);
        }
        return res;
      }
    } catch {
      // No network: queue below.
    }
  }

  await enqueue(req.method, path, op, body);
  const answer = await applyLocally(op, body);
  requestBackgroundSync();
  notify({ type: "nexote:queued" });
  flush(); // in case only this request failed (or the queue is draining)
  return answer;
}

async function handleData(url, req) {
  const path = url.pathname + url.search;
  // The daily journal answers with a note but isn't a note URL: remember
  // which note it was, and treat it like that note.
  const daily = DAILY_PATH.test(url.pathname);
  let note = noteKeyOf(url.pathname);
  if (daily) {
    const pointer = await getList(path);
    if (pointer?.id) note = { scope: "journal", id: pointer.id, key: `journal/${pointer.id}` };
  }
  // A note with queued changes: the local copy is the newest version.
  if (note && (await hasPendingNote(note.key))) {
    const rec = await getNoteRec(note.key);
    if (rec) return json(rec.note);
  }
  try {
    const res = await fetch(req);
    if (!serverDown(res)) {
      // The server answers again: sync what's queued, even if no page asked.
      if (!flushing && res.status !== 401) pendingCount().then((n) => n && flush());
      if (res.ok && res.headers.get("Content-Type")?.includes("application/json")) {
        const value = await res.clone().json().catch(() => undefined);
        if (value !== undefined) {
          if (daily && value?.id) {
            await putList(path, { id: value.id });
            await putNoteRec({ id: `journal/${value.id}`, note: value, base: value.updatedAt });
          } else if (note && value?.id) {
            await putNoteRec({ id: note.key, note: value, base: value.updatedAt });
          } else if (!note) {
            await putList(path, value);
            const merged = await withPending(url.pathname, value);
            if (merged !== value) return json(merged);
          }
        }
      }
      return res;
    }
  } catch {
    // Offline: answer from IndexedDB below.
  }
  if (note) {
    const rec = await getNoteRec(note.key);
    if (rec) return json(rec.note);
  }
  if (!daily) {
    const list = await getList(path);
    if (list !== undefined) return json(await withPending(url.pathname, list));
  }
  return offlineError(true);
}

async function handleImage(req) {
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    return new Response(null, { status: 504 });
  }
}

// Every app address (/, /note/…, /journal/…, old /m/… links) renders the
// same shell page, cached under "/". Invite pages are their own page.
async function handleNavigation(req, url) {
  const cache = await caches.open(SHELL_CACHE);
  const isShell = !url.pathname.startsWith("/invite/");
  try {
    const res = await fetch(req);
    if (isShell && res.ok && res.headers.get("Content-Type")?.includes("text/html")) {
      cache.put("/", res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return (
      (isShell && (await cache.match("/"))) ||
      new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

async function handleStatic(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

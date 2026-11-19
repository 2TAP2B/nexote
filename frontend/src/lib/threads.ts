"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { api, type Note, type NoteMeta } from "./api";
import { localDateKey, makeSnippet } from "./note-utils";
import { memoTitle, splitMemo, type NotepadLocation } from "./notepad";

// Threads: a quick note that grew replies. Each thread is its own note
// (type "thread") in a "Threads" folder next to the Notepad, so it has its
// own tags, history and search, and reads fine in any markdown tool:
//
//   ## Garden ideas
//
//   ### 2026-11-18 09:14
//   Original text #garden
//
//   ### 2026-11-19 08:02
//   First reply
//
// Every post is a "### YYYY-MM-DD HH:MM" section (local time); the first one
// is the thread's start. Text before the first section (written in the
// editor) counts as a post without a time.

export const THREAD_TYPE = "thread";
export const THREADS_FOLDER = "Threads";

/** Fired after this device changed a thread (detail: `{ vaultId }`). */
export const THREADS_CHANGED_EVENT = "nexote:threads-changed";
/** NotesProvider re-fires every SSE note change (detail: `{ vaultId, id, updatedAt }`). */
export const NOTE_CHANGE_EVENT = "nexote:note-change";
/** Opens a thread in the thread view (detail: `{ vaultId, id }`). */
export const OPEN_THREAD_EVENT = "nexote:open-thread";

/** A post's marks, written after its time: "### 2026-11-19 09:14 📌 P2 ✅". */
export type PostFlags = {
  pinned: boolean;
  /** 1 (highest) … 5; 0 = none. */
  priority: number;
  done: boolean;
};

export const NO_FLAGS: PostFlags = { pinned: false, priority: 0, done: false };

export type ThreadPost = {
  /** "" for text before the first post heading. */
  day: string;
  time: string;
  text: string;
  flags: PostFlags;
  /** Line range in the body: [start, end), heading included. */
  start: number;
  end: number;
};

/** What identifies a post across edits elsewhere: its time and text. */
export type PostRef = Pick<ThreadPost, "day" | "time" | "text">;

export type Thread = {
  vaultId: string;
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  body: string;
  posts: ThreadPost[];
  /** Frontmatter: pinned to the top, priority 1 … 5 (0 none), solved. */
  pinned: boolean;
  priority: number;
  done: boolean;
};

// The marks after the time are free-standing tokens, readable in any
// markdown tool: 📌 pinned, P1–P5 priority, ✅ (or ✓) done.
const POST_HEADING = /^###\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})((?:\s+(?:📌|P[1-5]|✅|✓))*)\s*$/u;

function parseFlags(marks: string): PostFlags {
  const priority = marks.match(/P([1-5])/);
  return { pinned: marks.includes("📌"), priority: priority ? Number(priority[1]) : 0, done: /✅|✓/u.test(marks) };
}

function formatFlags(flags: PostFlags): string {
  return [flags.pinned ? "📌" : "", flags.priority ? `P${flags.priority}` : "", flags.done ? "✅" : ""]
    .filter(Boolean)
    .map((m) => ` ${m}`)
    .join("");
}
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" and "HH:MM" of a moment, local time. */
export function postStamp(now = new Date()): { day: string; time: string } {
  return { day: localDateKey(now), time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}` };
}

/** The Threads folder for a Notepad location. */
export function threadsFolder(loc: NotepadLocation): string {
  return loc.folder ? `${loc.folder}/${THREADS_FOLDER}` : THREADS_FOLDER;
}

export function parseThread(body: string): ThreadPost[] {
  const lines = body.split("\n");
  const posts: ThreadPost[] = [];
  const headings: number[] = [];
  lines.forEach((line, i) => {
    if (POST_HEADING.test(line)) headings.push(i);
  });
  // Text between the title heading and the first post.
  const titleLine = lines.findIndex((l) => l.trim() !== "");
  const preStart = titleLine >= 0 && /^##\s/.test(lines[titleLine]) ? titleLine + 1 : 0;
  const preEnd = headings[0] ?? lines.length;
  const pre = lines.slice(preStart, preEnd).join("\n").trim();
  if (pre) posts.push({ day: "", time: "", text: pre, flags: NO_FLAGS, start: preStart, end: preEnd });
  headings.forEach((start, k) => {
    const end = headings[k + 1] ?? lines.length;
    const m = lines[start].match(POST_HEADING);
    posts.push({
      day: m?.[1] ?? "",
      time: m?.[2] ?? "",
      text: lines.slice(start + 1, end).join("\n").trim(),
      flags: parseFlags(m?.[3] ?? ""),
      start,
      end,
    });
  });
  return posts;
}

function postLines(post: PostRef & { flags?: PostFlags }): string[] {
  const head = post.day ? [`### ${post.day} ${post.time}${formatFlags(post.flags ?? NO_FLAGS)}`] : [];
  return [...head, ...post.text.split("\n"), ""];
}

/** A whole thread file. */
export function formatThread(title: string, posts: PostRef[]): string {
  return [`## ${title}`, "", ...posts.flatMap(postLines)].join("\n");
}

/** Adds posts at the end, keeping their own times (merged memos). */
export function appendThreadPosts(body: string, posts: PostRef[]): string {
  return `${body.replace(/\s+$/, "")}\n\n${posts.flatMap(postLines).join("\n")}`;
}

export function appendThreadPost(body: string, text: string, now = new Date()): string {
  return appendThreadPosts(body, [{ ...postStamp(now), text }]);
}

function findPost(posts: ThreadPost[], target: PostRef) {
  return posts.find((p) => p.day === target.day && p.time === target.time && p.text === target.text);
}

// Posts are looked up by content in the given (latest) body, so edits made
// elsewhere meanwhile are kept; null when the post no longer exists there.
export function replaceThreadPost(body: string, target: PostRef, text: string): string | null {
  const post = findPost(parseThread(body), target);
  if (!post) return null;
  const lines = body.split("\n");
  lines.splice(post.start, post.end - post.start, ...postLines({ ...post, text }));
  return lines.join("\n");
}

/** Changes a post's marks (pin, priority, done); null when the post is gone. */
export function setPostFlags(body: string, target: PostRef, patch: Partial<PostFlags>): string | null {
  const post = findPost(parseThread(body), target);
  if (!post || !post.day) return null;
  const lines = body.split("\n");
  lines.splice(post.start, post.end - post.start, ...postLines({ ...post, flags: { ...post.flags, ...patch } }));
  return lines.join("\n");
}

export function removeThreadPost(body: string, target: PostRef): string | null {
  const post = findPost(parseThread(body), target);
  if (!post) return null;
  const lines = body.split("\n");
  lines.splice(post.start, post.end - post.start);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "")}\n`;
}

/** Replaces the "## title" heading (or adds one). */
export function retitleThread(body: string, title: string): string {
  const lines = body.split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first >= 0 && /^##\s/.test(lines[first])) {
    lines[first] = `## ${title}`;
    return lines.join("\n");
  }
  return `## ${title}\n\n${body.replace(/^\s+/, "")}`;
}

/** The title for a thread started by this post; #tags stay in the post, not the title. */
export function threadTitleFor(post: PostRef): string {
  const title = memoTitle(post.text)
    .replace(/(^|\s)\\?#[a-z0-9][\w-]*/gi, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return title || `Thread ${post.day} ${post.time}`.trim();
}

/** #tags in a post, lowercase, as the backend extracts them. */
export function postTags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)\\?#([a-z0-9][\w-]*)/gi)) tags.add(m[1].toLowerCase());
  return [...tags];
}

/** Tags of a thread: the backend's list, or parsed from the posts until it has one. */
export function threadTags(t: Thread): string[] {
  if (t.tags.length) return t.tags;
  return [...new Set(t.posts.flatMap((p) => postTags(p.text)))];
}

export function replyLabel(t: Thread): string {
  const replies = Math.max(0, t.posts.length - 1);
  if (replies === 0) return "No replies";
  return replies === 1 ? "1 reply" : `${replies} replies`;
}

/**
 * One line about the latest post for lists and cards ("Photo" for images
 * only); "" when it would only repeat the title (a thread without replies).
 */
export function threadPreview(t: Thread): string {
  const last = t.posts[t.posts.length - 1];
  if (!last) return "";
  const text = makeSnippet(last.text, 120) || (splitMemo(last.text).images.length > 0 ? "Photo" : "");
  return text.replace(/(^|\s)#[\w-]+/g, "$1").replace(/\s{2,}/g, " ").trim() === t.title ? "" : text;
}

/**
 * "YYYY-MM-DD HH:MM" of the newest post, for ordering with memos. The newest,
 * not the last: memos added to a thread keep their older times.
 */
export function lastActivity(thread: Thread): string {
  let newest = "";
  for (const p of thread.posts) {
    const stamp = p.day ? `${p.day} ${p.time.padStart(5, "0")}` : "";
    if (stamp > newest) newest = stamp;
  }
  if (newest) return newest;
  const { day, time } = postStamp(new Date(thread.updatedAt));
  return `${day} ${time}`;
}

function toThread(vaultId: string, note: Note): Thread {
  return {
    vaultId,
    id: note.id,
    title: note.title,
    tags: note.tags ?? [],
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    body: note.body,
    posts: parseThread(note.body),
    pinned: note.pinned === true,
    priority: note.priority ?? 0,
    done: note.status === "done",
  };
}

export const isThreadMeta = (n: Pick<NoteMeta, "type">) => n.type === THREAD_TYPE;

// --- Shared cache: one list per vault, loaded once for every view ---------

type Snapshot = { threads: Thread[]; loaded: boolean; error: string | null };
// stale: a change arrived while no view listened, so the next one reloads.
type Entry = { snapshot: Snapshot; listeners: Set<() => void>; loading: Promise<void> | null; stale: boolean };

const EMPTY: Snapshot = { threads: [], loaded: false, error: null };
const cache = new Map<string, Entry>();

function entryFor(vaultId: string): Entry {
  let entry = cache.get(vaultId);
  if (!entry) {
    entry = { snapshot: EMPTY, listeners: new Set(), loading: null, stale: false };
    cache.set(vaultId, entry);
  }
  return entry;
}

function publish(vaultId: string, patch: Partial<Snapshot> | ((s: Snapshot) => Partial<Snapshot>)) {
  const entry = entryFor(vaultId);
  const next = typeof patch === "function" ? patch(entry.snapshot) : patch;
  entry.snapshot = { ...entry.snapshot, ...next };
  entry.listeners.forEach((l) => l());
}

/** (Re)loads every thread of a vault: the list, then the bodies. */
export function loadThreads(vaultId: string): Promise<void> {
  const entry = entryFor(vaultId);
  entry.loading ??= (async () => {
    entry.stale = false;
    try {
      const metas = ((await api.list(vaultId)).notes ?? []).filter(isThreadMeta);
      const notes = await Promise.all(metas.map((m) => api.get(vaultId, m.id)));
      publish(vaultId, { threads: notes.map((n) => toThread(vaultId, n)), loaded: true, error: null });
    } catch (e) {
      publish(vaultId, { loaded: true, error: e instanceof Error ? e.message : "Couldn't load threads" });
    } finally {
      entry.loading = null;
    }
  })();
  return entry.loading;
}

/** Puts a saved thread note into the cache (or takes it out when it's no thread). */
export function applyThreadNote(vaultId: string, note: Note) {
  publish(vaultId, (s) => {
    const rest = s.threads.filter((t) => t.id !== note.id);
    return { threads: isThreadMeta(note) ? [...rest, toThread(vaultId, note)] : rest };
  });
}

function dropThread(vaultId: string, id: string) {
  publish(vaultId, (s) => ({ threads: s.threads.filter((t) => t.id !== id) }));
}

function notifyChanged(vaultId: string) {
  window.dispatchEvent(new CustomEvent(THREADS_CHANGED_EVENT, { detail: { vaultId } }));
}

// Changes from elsewhere (other devices, the editor): refetch just that note.
if (typeof window !== "undefined") {
  window.addEventListener(NOTE_CHANGE_EVENT, (event) => {
    const detail = (event as CustomEvent<{ vaultId?: string; id?: string; updatedAt?: string }>).detail;
    if (!detail?.vaultId || !detail.id) return;
    const entry = cache.get(detail.vaultId);
    if (!entry || !entry.snapshot.loaded) return;
    if (entry.listeners.size === 0) {
      entry.stale = true;
      return;
    }
    const known = entry.snapshot.threads.find((t) => t.id === detail.id);
    if (known && detail.updatedAt && Date.parse(known.updatedAt) >= Date.parse(detail.updatedAt)) return;
    const vaultId = detail.vaultId;
    void api
      .get(vaultId, detail.id)
      .then((note) => applyThreadNote(vaultId, note))
      .catch(() => {
        // Deleted (404) or offline: a deleted thread leaves the list.
        if (known) void loadThreads(vaultId);
      });
  });
}

/** Every thread of a vault, shared by all views; loads on first use. */
export function useThreads(vaultId: string | null): Snapshot & { reload: () => Promise<void> } {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!vaultId) return () => {};
      const entry = entryFor(vaultId);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [vaultId],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (vaultId ? entryFor(vaultId).snapshot : EMPTY),
    () => EMPTY,
  );
  useEffect(() => {
    if (!vaultId) return;
    const entry = entryFor(vaultId);
    if (!entry.snapshot.loaded || entry.stale) void loadThreads(vaultId);
  }, [vaultId]);
  const reload = useCallback(() => (vaultId ? loadThreads(vaultId) : Promise.resolve()), [vaultId]);
  return { ...snapshot, reload };
}

/**
 * Every thread of several vaults as one list (each keeps its `vaultId`),
 * from the same per-vault cache; loads the vaults not loaded yet. `loaded`
 * once all are; `error` is the first vault's that failed.
 */
export function useThreadsIn(vaultIds: readonly string[]): Snapshot {
  // The joined ids, so a new array listing the same vaults keeps the subscription.
  const key = vaultIds.join("\n");
  const ids = useMemo(() => (key ? key.split("\n") : []), [key]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const entries = ids.map(entryFor);
      for (const entry of entries) entry.listeners.add(listener);
      return () => {
        for (const entry of entries) entry.listeners.delete(listener);
      };
    },
    [ids],
  );
  // useSyncExternalStore needs the same object while no vault changed.
  const getSnapshot = useMemo(() => {
    let parts: Snapshot[] = [];
    let merged: Snapshot = EMPTY;
    return () => {
      const next = ids.map((id) => entryFor(id).snapshot);
      if (next.length === parts.length && next.every((s, i) => s === parts[i])) return merged;
      parts = next;
      merged = {
        threads: next.flatMap((s) => s.threads),
        loaded: next.every((s) => s.loaded),
        error: next.find((s) => s.error)?.error ?? null,
      };
      return merged;
    };
  }, [ids]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  useEffect(() => {
    for (const id of ids) {
      const entry = entryFor(id);
      if (!entry.snapshot.loaded || entry.stale) void loadThreads(id);
    }
  }, [ids]);
  return snapshot;
}

/**
 * Reloads a loaded vault whose note list disagrees with the cache (a thread
 * missing, gone or newer): changes no note event brought, e.g. made while
 * this device was offline.
 */
export function syncThreads(vaultId: string, metas: Pick<NoteMeta, "id" | "type" | "updatedAt">[]) {
  const entry = cache.get(vaultId);
  if (!entry?.snapshot.loaded || entry.loading) return;
  const known = new Map(entry.snapshot.threads.map((t) => [t.id, Date.parse(t.updatedAt)]));
  const listed = metas.filter(isThreadMeta);
  const differs =
    listed.length !== known.size ||
    listed.some((m) => {
      const at = known.get(m.id);
      return at === undefined || at < Date.parse(m.updatedAt);
    });
  if (differs) void loadThreads(vaultId);
}

// --- Writes ------------------------------------------------------------------

/** Starts a thread from posts (the first one names it). */
export async function createThread(loc: NotepadLocation, posts: PostRef[]): Promise<Thread> {
  const title = threadTitleFor(posts[0]);
  const note = await api.create(loc.vaultId, {
    title,
    path: threadsFolder(loc),
    type: THREAD_TYPE,
    body: formatThread(title, posts),
  });
  applyThreadNote(loc.vaultId, note);
  notifyChanged(loc.vaultId);
  return toThread(loc.vaultId, note);
}

/**
 * Changes a thread's latest body: `mutate` gets it and returns the new one
 * (null = the post it acts on is gone: an error).
 */
export async function mutateThread(
  ref: Pick<Thread, "vaultId" | "id">,
  mutate: (body: string) => string | null,
  title?: string,
): Promise<Thread> {
  const note = await api.get(ref.vaultId, ref.id);
  const next = mutate(note.body);
  if (next === null) throw new Error("This post was changed elsewhere in the meantime. Try again.");
  const saved = await api.update(ref.vaultId, ref.id, { title: title ?? note.title, body: next });
  applyThreadNote(ref.vaultId, saved);
  notifyChanged(ref.vaultId);
  return toThread(ref.vaultId, saved);
}

export async function renameThread(ref: Pick<Thread, "vaultId" | "id">, title: string): Promise<Thread> {
  return mutateThread(ref, (body) => retitleThread(body, title), title);
}

/**
 * Pins, prioritises or solves a thread (frontmatter only: an update without
 * title and body keeps both on the server).
 */
export async function setThreadMeta(
  ref: Pick<Thread, "vaultId" | "id">,
  patch: { pinned?: boolean; priority?: number; done?: boolean },
): Promise<Thread> {
  const saved = await api.update(ref.vaultId, ref.id, {
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.done !== undefined ? { status: patch.done ? "done" : "" } : {}),
  });
  applyThreadNote(ref.vaultId, saved);
  notifyChanged(ref.vaultId);
  return toThread(ref.vaultId, saved);
}

export async function deleteThread(ref: Pick<Thread, "vaultId" | "id">): Promise<void> {
  await api.remove(ref.vaultId, ref.id);
  dropThread(ref.vaultId, ref.id);
  notifyChanged(ref.vaultId);
}

/** Asks the shell to show a thread (mobile overlay / desktop panel). */
export function openThread(ref: Pick<Thread, "vaultId" | "id">) {
  window.dispatchEvent(new CustomEvent(OPEN_THREAD_EVENT, { detail: { vaultId: ref.vaultId, id: ref.id } }));
}

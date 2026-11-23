"use client";

import { ArrowDown, CircleCheck, Copy, FilePlus, MessageSquarePlus, MessagesSquare, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, isCollectionsVault } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { localDateKey, makeSnippet } from "@/lib/note-utils";
import {
  appendNotepadEntry,
  findNotepad,
  memoToNote,
  NOTEPAD_TITLE,
  notepadLocation,
  parseNotepad,
  removeNotepadEntries,
  replaceNotepadEntry,
  setNotepadEntryPinned,
  splitMemo,
  type NotepadEntry,
} from "@/lib/notepad";
import type { Notebook } from "@/lib/notebooks";
import { useNotes } from "@/lib/notes-context";
import {
  appendThreadPosts,
  createThread,
  deleteThread,
  lastActivity,
  mutateThread,
  openThread,
  postStamp,
  postTags,
  replyLabel,
  type Thread,
} from "@/lib/threads";
import { useScrolledAway } from "../threads/JumpButton";
import { DraftError, HeaderButton, ImageViewer, MemoToast, SelectCircle, useMemoToast } from "../threads/MemoChrome";
import { PinnedBar, type PinnedItem } from "../threads/PinnedBar";
import { ThreadCard } from "../threads/ThreadCard";
import { errorText, useMemoDraft } from "../threads/useMemoDraft";
import { useAllThreads } from "../threads/useAllThreads";
import { useNoteRefs } from "../threads/useNoteRefs";
import { MemoBubble, type NoteRef } from "./MemoBubble";
import { MemoComposer } from "./MemoComposer";
import { MobileActionSheet, type SheetAction } from "./MobileActionSheet";
import { SHELL_PALETTE } from "./mobileTheme";
import { NotebookPicker } from "./NotebookPicker";
import { useVisualViewport } from "./useVirtualKeyboardInset";

// Quick capture: a chat-style pad in the dashboard's right pane (swipe left on
// the dashboard) or, on the desktop (`variant="desktop"`), full size in the
// main area. Enter posts the text into the "Notepad" note — created on the
// first post or image — without leaving the dashboard. "@" links a note, the
// image button (or pasting) attaches images, the mic records a voice memo that
// the AI endpoint transcribes into the text, and the expand button writes in
// full screen. A long press (or right-click) on a memo opens its menu; the
// header's select button picks several, and the bar on top then copies,
// edits, makes a note of, adds to a thread or deletes the selection. Threads
// (lib/threads) show in the stream as cards at their last post — never their
// comments; swiping a memo left (or its menu) starts one; a #tag filters both.
// Pinned memos and threads sit in the bar under the header; memo text renders
// as Markdown.

type Target = { vaultId: string; id: string };

// Selection survives reloads and posts: entries are matched by content, not
// by their (shifting) line numbers.
const memoKey = (e: NotepadEntry) => `${e.day}\n${e.time}\n${e.text}`;

type StreamItem =
  | { kind: "memo"; key: string; entry: NotepadEntry }
  | { kind: "thread"; key: string; thread: Thread };

const dayOf = (item: StreamItem) => item.key.slice(0, 10).trim();

function dayLabel(day: string): string {
  if (day === localDateKey()) return "Today";
  if (!day) return "Earlier";
  return new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function hasTag(item: StreamItem, tag: string): boolean {
  if (item.kind === "memo") return postTags(item.entry.text).includes(tag);
  const t = item.thread;
  return t.tags.some((x) => x.toLowerCase() === tag) || t.posts.some((p) => postTags(p.text).includes(tag));
}

export default function QuickCapturePane({
  focused,
  onBack,
  variant = "mobile",
}: {
  focused: boolean;
  onBack: () => void;
  /** "desktop": fills the main area in a centered column (no pager, no touch keyboard). */
  variant?: "mobile" | "desktop";
}) {
  const { allVaults, refresh, refreshNoteBody, openNoteInVault, openTab, settings, updateSettings } = useNotes();
  const desktop = variant === "desktop";
  const vv = useVisualViewport();
  // The touch keyboard only matters in the phone's pager.
  const keyboardOpen = !desktop && vv.isKeyboardOpen;
  const [body, setBody] = useState("");
  const [fullscreen, setFullscreenState] = useState(false);
  // "Exit full screen" acts on pointerdown; the tap's click then lands on
  // the close button that sits at the same spot underneath. Ignore it.
  const fullscreenClosedAt = useRef(0);
  const setFullscreen = (next: boolean) => {
    if (!next) fullscreenClosedAt.current = Date.now();
    setFullscreenState(next);
  };
  const { toast, showToast, dismissToast } = useMemoToast();
  // The memos waiting for the first-time notebook choice.
  const [picking, setPicking] = useState<NotepadEntry[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  // Selection circles show only in selection mode (the header's select button).
  const [selectMode, setSelectMode] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  // The memo whose menu is open (long press / right-click).
  const [menuEntry, setMenuEntry] = useState<NotepadEntry | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The Notepad note once known or created here. Creation is shared, so an
  // image upload and a post can't create two notes.
  const targetRef = useRef<Target | null>(null);
  const creatingRef = useRef<Promise<Target> | null>(null);
  // Whether the pane is on screen right now (read after awaits).
  const focusedRef = useRef(focused);
  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);

  // The Notepad lives where Settings › Features says: the personal "home"
  // store (default, the same in every space) or a chosen notebook. Found and
  // (re)loaded whenever the pane is shown, so edits made elsewhere appear.
  // Creating it on the first post only sets targetRef: reloading then would
  // race the post and show the empty new note.
  const { vaultId: locVault, folder: locFolder } = notepadLocation(settings);
  // The #tag the stream is filtered by (tap a tag chip); kept until cleared.
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // The memos waiting for a thread to be added to (selection › Add to thread).
  const [threadPicking, setThreadPicking] = useState<NotepadEntry[] | null>(null);
  // A swipe is starting a thread: a second swipe meanwhile is ignored.
  const [threading, setThreading] = useState(false);
  const threadingRef = useRef(false);
  // A new location means another note: forget the old one and its memos.
  useEffect(() => {
    targetRef.current = null;
    setBody("");
    setTagFilter(null);
  }, [locVault, locFolder]);
  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    void (async () => {
      try {
        const id = await findNotepad({ vaultId: locVault, folder: locFolder });
        if (cancelled || !id) return;
        targetRef.current = { vaultId: locVault, id };
        const note = await api.get(locVault, id);
        if (!cancelled) setBody(note.body);
      } catch {
        // Offline or not created yet: the pane keeps what it shows.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focused, locVault, locFolder]);

  useEffect(() => {
    if (!focused) clearSelection();
  }, [focused]);

  // Escape leaves selection mode first. Capture phase and preventDefault: the
  // desktop host leaves quick notes on an unhandled Escape.
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      clearSelection();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectMode]);

  const entries = useMemo(() => parseNotepad(body), [body]);
  const selected = useMemo(() => entries.filter((e) => selectedKeys.has(memoKey(e))), [entries, selectedKeys]);
  // Selecting toggles a memo (and keeps selection mode on).
  const toggleSelected = (entry: NotepadEntry) => {
    setSelectMode(true);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const key = memoKey(entry);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  function clearSelection() {
    setSelectedKeys(new Set());
    setSelectMode(false);
  }

  // Memos and threads in one stream by time (a thread at its last post), oldest
  // first. The sort is stable, so memos of the same minute keep pad order.
  // Every thread, not only those next to this device's Notepad: another
  // device may keep its Notepad (and so its threads) elsewhere.
  const { threads } = useAllThreads();
  const stream = useMemo(() => {
    const items: StreamItem[] = [
      ...entries.map((entry): StreamItem => ({ kind: "memo", key: `${entry.day} ${entry.time.padStart(5, "0")}`, entry })),
      ...threads.map((thread): StreamItem => ({ kind: "thread", key: lastActivity(thread), thread })),
    ];
    return items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }, [entries, threads]);
  const visible = useMemo(
    () => (tagFilter ? stream.filter((item) => hasTag(item, tagFilter)) : stream),
    [stream, tagFilter],
  );
  const threadsByActivity = useMemo(
    () => [...threads].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a))),
    [threads],
  );
  const filterByTag = (tag: string) => setTagFilter(tag.toLowerCase());

  // Newest item at the bottom, like a chat; also when threads load or move.
  // Every time the pane comes on screen (a swipe into quick notes) it starts
  // at the latest message — never at wherever the user scrolled to last time.
  const lastKey = visible[visible.length - 1]?.key ?? "";
  const wasFocused = useRef(false);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    // The pane was swiped away and is back: it starts at the latest message,
    // so the jump bar isn't needed yet.
    if (focused && wasFocused.current) setAwayFromLatest(false);
    wasFocused.current = focused;
  }, [visible.length, lastKey, focused, keyboardOpen]);

  const { away: awayFromLatest, setAway: setAwayFromLatest } = useScrolledAway(listRef, "bottom");
  const jumpToLatest = () => {
    const list = listRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  };

  // A pinned memo picked in the bar: scrolled into view and briefly lit. The
  // tag filter goes if it hides the memo; the scroll waits for that render.
  // `n` lets picking the same memo again run it again.
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(null);
  const showMemo = (entry: NotepadEntry) => {
    if (tagFilter && !postTags(entry.text).includes(tagFilter)) setTagFilter(null);
    setFlash((prev) => ({ key: memoKey(entry), n: (prev?.n ?? 0) + 1 }));
  };
  useEffect(() => {
    if (!flash) return;
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-memo]") ?? [];
    Array.from(rows)
      .find((row) => row.dataset.memo === flash.key)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(timer);
  }, [flash]);

  // The bar shows every pin, whatever the tag filter: threads by last
  // activity, then memos newest first.
  const memoStamp = (e: NotepadEntry) => `${e.day} ${e.time.padStart(5, "0")}`;
  const pinnedItems: PinnedItem[] = [
    ...threadsByActivity
      .filter((t) => t.pinned)
      .map(
        (t): PinnedItem => ({
          key: `t-${t.vaultId}-${t.id}`,
          text: t.title || "Untitled thread",
          sub: replyLabel(t),
          icon: <MessagesSquare size={14} className="shrink-0" />,
          done: t.done,
          onSelect: () => openThread(t),
        }),
      ),
    ...entries
      .filter((e) => e.pinned)
      .sort((a, b) => memoStamp(b).localeCompare(memoStamp(a)))
      .map(
        (e): PinnedItem => ({
          key: `m-${memoKey(e)}`,
          // Plain text: the bar shows no Markdown.
          text: makeSnippet(splitMemo(e.text).text, 80) || "Image",
          sub: `${dayLabel(e.day)} ${e.time}`,
          onSelect: () => showMemo(e),
        }),
      ),
  ];

  // Threads too, so [[Thread title]] links resolve to them (the Notepad's first).
  const { resolve, suggest } = useNoteRefs(locVault);

  const ensureTarget = (): Promise<Target> => {
    if (targetRef.current) return Promise.resolve(targetRef.current);
    creatingRef.current ??= (async () => {
      const created = await api.create(locVault, { title: NOTEPAD_TITLE, path: locFolder || undefined });
      targetRef.current = { vaultId: locVault, id: created.id };
      return targetRef.current;
    })().finally(() => {
      creatingRef.current = null;
    });
    return creatingRef.current;
  };

  const {
    inputRef,
    input,
    setInput,
    attachments,
    editing,
    posting,
    error,
    setError,
    canSend,
    attach,
    removeAttachment,
    submit,
    startEdit,
    cancelEdit,
    voice,
    canRetryTranscription,
    retryTranscription,
    discardFailedClip,
  } = useMemoDraft<NotepadEntry>({
    ensureTarget,
    currentTarget: () => targetRef.current,
    targetErrorText: "Couldn't create the notepad",
    canFocus: () => focusedRef.current,
  });

  const post = () =>
    submit(
      async (text, edit) => {
        let previous = body;
        try {
          const target = await ensureTarget();
          // Write into the latest version, not this pane's copy, so edits made in
          // the editor or on another device are kept.
          previous = (await api.get(target.vaultId, target.id)).body;
          const next = edit ? replaceNotepadEntry(previous, edit, text) : appendNotepadEntry(previous, text);
          if (next === null) throw new Error("This memo was changed elsewhere in the meantime. Try again.");
          setBody(next);
          await api.update(target.vaultId, target.id, { title: NOTEPAD_TITLE, body: next });
          void refreshNoteBody(target.id);
        } catch (e) {
          setBody(previous);
          throw e;
        }
      },
      "Couldn't save to the notepad",
      () => setFullscreen(false),
    );

  const openNote = (note: NoteRef) => {
    // Threads open in the thread view: over this pane on the phone, in its
    // place on the desktop (its back returns here).
    if (note.thread && note.vaultId) {
      openThread({ vaultId: note.vaultId, id: note.id });
      return;
    }
    onBack();
    void (note.vaultId ? openNoteInVault(note.vaultId, note.id) : openTab(note.id));
  };

  // "Make note": the memos become one note in the default notebook (asked for
  // the first time), then leave the notepad — moved, not copied.
  const makeNote = (list: NotepadEntry[]) => {
    // The default notebook may be in any space; viewer-only vaults can't take notes.
    const vault = allVaults.find(
      (v) => v.id === settings.memoNoteVault && !isCollectionsVault(v) && v.role !== "viewer",
    );
    if (vault) void moveToNote(list, { vaultId: vault.id, folder: settings.memoNoteFolder });
    else setPicking(list);
  };

  const isEditing = (list: NotepadEntry[]) =>
    editing !== null && list.some((e) => e.day === editing.day && e.start === editing.start);

  const moveToNote = async (list: NotepadEntry[], notebook: Pick<Notebook, "vaultId" | "folder">) => {
    if (list.length === 0) return;
    setError(null);
    if (isEditing(list)) cancelEdit();
    // Several memos: one note, the first memo naming it, in pad order.
    const merged = list.length === 1 ? list[0] : { ...list[0], text: list.map((e) => e.text).join("\n\n") };
    const draft = memoToNote(merged, settings.headingOnNewNote);
    let created;
    try {
      created = await api.create(notebook.vaultId, {
        title: draft.title,
        path: notebook.folder || undefined,
        body: draft.body,
      });
    } catch (e) {
      setError(errorText(e, "Couldn't create the note"));
      return;
    }
    const noteId = created.id;
    const open = {
      label: "Open",
      run: () => {
        onBack();
        void openNoteInVault(notebook.vaultId, noteId);
      },
    };
    void refresh();
    // Only now take the memos out, from the notepad's latest version.
    try {
      const target = targetRef.current;
      if (!target) throw new Error("The notepad note is gone");
      const latest = (await api.get(target.vaultId, target.id)).body;
      const next = removeNotepadEntries(latest, list);
      if (next === latest) {
        showToast(`Saved as “${created.title}” — the memos changed elsewhere, so they stay`, open);
        return;
      }
      setBody(next);
      await api.update(target.vaultId, target.id, { title: NOTEPAD_TITLE, body: next });
      void refreshNoteBody(target.id);
      showToast(`Moved to “${created.title}”`, open);
    } catch (e) {
      showToast(`Saved as “${created.title}”`, open);
      setError(errorText(e, "Couldn't remove the memos from the notepad"));
    }
  };

  // Deletes memos from the notepad's latest version; Undo puts that version
  // back unless the notepad changed again since.
  const deleteMemos = async (list: NotepadEntry[]) => {
    const target = targetRef.current;
    if (!target || list.length === 0) return;
    setError(null);
    if (isEditing(list)) cancelEdit();
    try {
      const before = (await api.get(target.vaultId, target.id)).body;
      const after = removeNotepadEntries(before, list);
      if (after === before) {
        showToast("Those memos changed elsewhere");
        return;
      }
      setBody(after);
      await api.update(target.vaultId, target.id, { title: NOTEPAD_TITLE, body: after });
      void refreshNoteBody(target.id);
      showToast(list.length === 1 ? "Memo deleted" : `${list.length} memos deleted`, {
        label: "Undo",
        run: () => void restoreNotepad(target, before, after),
      });
    } catch (e) {
      setError(errorText(e, "Couldn't delete"));
    }
  };

  // Pins or unpins memos in the notepad's latest version, written once.
  const pinMemos = async (list: NotepadEntry[], pinned: boolean) => {
    const target = targetRef.current;
    if (!target || list.length === 0) return;
    let previous = body;
    try {
      previous = (await api.get(target.vaultId, target.id)).body;
      const next = list.reduce((b, entry) => setNotepadEntryPinned(b, entry, pinned) ?? b, previous);
      if (next === previous) {
        showToast("Those memos changed elsewhere");
        return;
      }
      setBody(next);
      await api.update(target.vaultId, target.id, { title: NOTEPAD_TITLE, body: next });
      void refreshNoteBody(target.id);
    } catch (e) {
      setBody(previous);
      showToast(errorText(e, pinned ? "Couldn't pin" : "Couldn't unpin"));
    }
  };

  const restoreNotepad = async (target: Target, before: string, after: string) => {
    try {
      if ((await api.get(target.vaultId, target.id)).body !== after) {
        showToast("The notepad changed since — can't undo");
        return;
      }
      setBody(before);
      await api.update(target.vaultId, target.id, { title: NOTEPAD_TITLE, body: before });
      void refreshNoteBody(target.id);
    } catch (e) {
      setError(errorText(e, "Couldn't undo"));
    }
  };

  // Takes memos out of the notepad's latest version, shown at once; null when
  // none of them is there anymore (changed elsewhere).
  const takeFromNotepad = async (list: NotepadEntry[]) => {
    const target = targetRef.current;
    if (!target) throw new Error("The notepad note is gone");
    const before = (await api.get(target.vaultId, target.id)).body;
    const after = removeNotepadEntries(before, list);
    if (after === before) return null;
    setBody(after);
    try {
      await api.update(target.vaultId, target.id, { title: NOTEPAD_TITLE, body: after });
    } catch (e) {
      setBody(before);
      throw e;
    }
    void refreshNoteBody(target.id);
    return { target, before, after };
  };

  // Swipe left: the memo becomes a thread (keeping its time) and leaves the
  // notepad. Undo deletes the thread and puts the notepad back.
  const startThread = async (entry: NotepadEntry) => {
    if (threadingRef.current || !targetRef.current) return;
    threadingRef.current = true;
    setThreading(true);
    setError(null);
    if (isEditing([entry])) cancelEdit();
    try {
      let thread: Thread;
      try {
        thread = await createThread(notepadLocation(settings), [{ day: entry.day, time: entry.time, text: entry.text }]);
      } catch (e) {
        setError(errorText(e, "Couldn't start the thread"));
        return;
      }
      const open = { label: "Open", run: () => openThread(thread) };
      try {
        const taken = await takeFromNotepad([entry]);
        if (!taken) {
          showToast("Thread started — the memo changed elsewhere, so it stays", open);
          return;
        }
        showToast("Thread started", {
          label: "Undo",
          run: () => void undoThread(thread, taken.target, taken.before, taken.after),
        });
      } catch (e) {
        showToast("Thread started", open);
        setError(errorText(e, "Couldn't remove the memo from the notepad"));
      }
    } finally {
      threadingRef.current = false;
      setThreading(false);
    }
  };

  // The notepad is checked first: if it changed since, the thread stays. The
  // memo goes back before the thread is deleted, so a failure never loses it.
  const undoThread = async (thread: Thread, target: Target, before: string, after: string) => {
    try {
      if ((await api.get(target.vaultId, target.id)).body !== after) {
        showToast("The notepad changed since — can't undo");
        return;
      }
      setBody(before);
      try {
        await api.update(target.vaultId, target.id, { title: NOTEPAD_TITLE, body: before });
      } catch (e) {
        setBody(after);
        throw e;
      }
      void refreshNoteBody(target.id);
      await deleteThread(thread);
    } catch (e) {
      setError(errorText(e, "Couldn't undo"));
    }
  };

  // "Add to thread": the memos become posts of the thread with their own
  // times (in pad order), then leave the notepad — moved, not copied.
  const addToThread = async (list: NotepadEntry[], thread: Thread) => {
    if (list.length === 0) return;
    setError(null);
    if (isEditing(list)) cancelEdit();
    // An undated memo (text above the first day) would run into the previous
    // post without a heading: it gets the current time instead.
    const now = postStamp();
    const posts = list.map(({ day, time, text }) => (day ? { day, time, text } : { ...now, text }));
    let saved: Thread;
    try {
      saved = await mutateThread(thread, (body) => appendThreadPosts(body, posts));
    } catch (e) {
      setError(errorText(e, "Couldn't add to the thread"));
      return;
    }
    const open = { label: "Open", run: () => openThread(saved) };
    try {
      const taken = await takeFromNotepad(list);
      showToast(
        taken ? `Added to “${saved.title}”` : `Added to “${saved.title}” — the memos changed elsewhere, so they stay`,
        open,
      );
    } catch (e) {
      showToast(`Added to “${saved.title}”`, open);
      setError(errorText(e, "Couldn't remove the memos from the notepad"));
    }
  };

  // Runs a selection action, leaving selection mode.
  const onSelection = (action: (list: NotepadEntry[]) => void) => () => {
    const list = selected;
    clearSelection();
    action(list);
  };

  const copyMemos = (list: NotepadEntry[]) =>
    void copyText(list.map((e) => e.text).join("\n\n")).then((ok) => showToast(ok ? "Copied" : "Couldn't copy"));

  // A memo's menu: the same actions as the selection bar, for one memo.
  const memoSections = (entry: NotepadEntry): SheetAction[][] => [
    [
      { label: "Edit", icon: <Pencil size={19} />, onClick: () => startEdit(entry) },
      { label: "Copy", icon: <Copy size={19} />, onClick: () => copyMemos([entry]) },
      entry.pinned
        ? { label: "Unpin", icon: <PinOff size={19} />, onClick: () => void pinMemos([entry], false) }
        : { label: "Pin", icon: <Pin size={19} />, onClick: () => void pinMemos([entry], true) },
    ],
    [
      ...(threading ? [] : [{ label: "Start thread", icon: <MessagesSquare size={19} />, onClick: () => void startThread(entry) }]),
      ...(threads.length > 0
        ? [{ label: "Add to thread…", icon: <MessageSquarePlus size={19} />, onClick: () => setThreadPicking([entry]) }]
        : []),
      { label: "Make note", icon: <FilePlus size={19} />, onClick: () => makeNote([entry]) },
    ],
    [{ label: "Delete", icon: <Trash2 size={19} />, danger: true, onClick: () => void deleteMemos([entry]) }],
  ];

  return (
    <section
      aria-label="Quick notes"
      className={
        desktop
          ? "relative flex h-full w-full flex-col overflow-hidden"
          : "relative flex h-full w-1/4 shrink-0 flex-col overflow-hidden"
      }
      style={
        desktop
          ? { ...SHELL_PALETTE, background: "var(--mob-bg)" }
          : {
              background: "var(--mob-bg)",
              borderLeft: "1px solid var(--mob-surface)",
              // Horizontal drags belong to the swipe back to the dashboard.
              touchAction: "pan-y",
            }
      }
    >
      {/* Exactly the visible area while the keyboard is open: iOS overlays the
          keyboard and may pan the visual viewport down (offsetTop), which would
          otherwise expose empty space below the composer. The desktop keeps a
          readable column in the middle of the main area. */}
      <div
        className={"relative flex min-h-0 flex-col" + (desktop ? " mx-auto w-full max-w-3xl" : "")}
        style={
          keyboardOpen
            ? { height: `calc(100% - ${vv.inset}px)`, transform: `translateY(${vv.top}px)` }
            : { height: "100%" }
        }
      >
        <div
          className="flex shrink-0 items-center gap-3 px-3"
          style={{
            paddingTop: desktop ? 8 : "calc(env(safe-area-inset-top, 0px) + 8px)",
            paddingBottom: 8,
            borderBottom: "1px solid var(--mob-surface)",
          }}
        >
          {selectMode ? (
            <>
              <HeaderButton label="Cancel selection" onClick={clearSelection}>
                <X size={20} />
              </HeaderButton>
              <span className="min-w-0 flex-1 truncate text-lg font-semibold" style={{ color: "var(--mob-text)" }}>
                {selected.length ? `${selected.length} selected` : "Select memos"}
              </span>
              {selected.length === 1 && (
                <HeaderButton label="Edit" onClick={onSelection((list) => startEdit(list[0]))}>
                  <Pencil size={18} />
                </HeaderButton>
              )}
              <HeaderButton
                label="Copy"
                disabled={selected.length === 0}
                onClick={onSelection(copyMemos)}
              >
                <Copy size={18} />
              </HeaderButton>
              <HeaderButton label="Make note" disabled={selected.length === 0} onClick={onSelection(makeNote)}>
                <FilePlus size={18} />
              </HeaderButton>
              <HeaderButton
                label="Add to thread"
                disabled={selected.length === 0 || threads.length === 0}
                onClick={onSelection(setThreadPicking)}
              >
                <MessageSquarePlus size={18} />
              </HeaderButton>
              {selected.length > 0 && selected.every((e) => e.pinned) ? (
                <HeaderButton label="Unpin" onClick={onSelection((list) => void pinMemos(list, false))}>
                  <PinOff size={18} />
                </HeaderButton>
              ) : (
                <HeaderButton
                  label="Pin"
                  disabled={selected.length === 0}
                  onClick={onSelection((list) => void pinMemos(list, true))}
                >
                  <Pin size={18} />
                </HeaderButton>
              )}
              <HeaderButton
                label="Delete"
                danger
                disabled={selected.length === 0}
                onClick={onSelection((list) => void deleteMemos(list))}
              >
                <Trash2 size={18} />
              </HeaderButton>
            </>
          ) : (
            <>
              <HeaderButton
                label="Close quick notes"
                onClick={() => {
                  if (Date.now() - fullscreenClosedAt.current < 600) return;
                  onBack();
                }}
              >
                <X size={20} />
              </HeaderButton>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-lg font-semibold leading-tight" style={{ color: "var(--mob-text)" }}>
                  Quick notes
                </span>
                <span className="truncate text-xs" style={{ color: "var(--mob-muted)" }}>
                  Saved to your &quot;{NOTEPAD_TITLE}&quot; note
                </span>
              </span>
              {entries.length > 0 && (
                <HeaderButton label="Select memos" onClick={() => setSelectMode(true)}>
                  <CircleCheck size={19} />
                </HeaderButton>
              )}
            </>
          )}
        </div>
        <PinnedBar items={pinnedItems} />
        {tagFilter && (
          <div
            className="flex shrink-0 items-center gap-2 px-3 py-2"
            style={{ borderBottom: "1px solid var(--mob-surface)" }}
          >
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              aria-label={`Clear filter #${tagFilter}`}
              className="flex min-w-0 items-center gap-1 rounded-full px-3 py-1 text-[13px] font-medium"
              style={{ background: "var(--mob-accent)", color: "#fff" }}
            >
              <span className="truncate">#{tagFilter}</span>
              <X size={14} className="shrink-0" />
            </button>
            <span className="truncate text-xs" style={{ color: "var(--mob-muted)" }}>
              {visible.length === 1 ? "1 item" : `${visible.length} items`}
            </span>
          </div>
        )}

        {/* The list plus the jump button floating over its bottom edge,
            just above the composer. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3" style={{ touchAction: "pan-y" }}>
            {stream.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                <p className="text-sm font-medium" style={{ color: "var(--mob-text)" }}>
                  Jot it down
                </p>
                <p className="text-xs" style={{ color: "var(--mob-muted)" }}>
                  Type below and press Enter — each memo is added to &quot;{NOTEPAD_TITLE}&quot; with the time. Type @ to
                  link a note; add photos with the image button.{" "}
                  {desktop ? "Right-click a memo to start a thread." : "Swipe a memo left to start a thread."}
                </p>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                <p className="text-sm font-medium" style={{ color: "var(--mob-text)" }}>
                  No quick notes with #{tagFilter}
                </p>
                <button
                  type="button"
                  onClick={() => setTagFilter(null)}
                  className="text-xs font-medium"
                  style={{ color: "var(--mob-accent)" }}
                >
                  Show all
                </button>
              </div>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {visible.map((item, i) => {
                  const day = dayOf(item);
                  const prev = visible[i - 1];
                  return (
                    <li
                      key={item.kind === "memo" ? `m-${item.entry.day}-${item.entry.start}` : `t-${item.thread.vaultId}-${item.thread.id}`}
                      className="flex flex-col"
                    >
                      {(!prev || day !== dayOf(prev)) && (
                        <span
                          className="my-2 self-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                          style={{ background: "var(--mob-surface)", color: "var(--mob-muted)" }}
                        >
                          {dayLabel(day)}
                        </span>
                      )}
                      {item.kind === "memo" ? (
                        <div
                          data-memo={memoKey(item.entry)}
                          className="-mx-1.5 flex items-center gap-2 rounded-xl px-1.5 transition-colors duration-500"
                          style={{
                            background:
                              flash?.key === memoKey(item.entry)
                                ? "color-mix(in srgb, var(--mob-accent) 18%, transparent)"
                                : "transparent",
                          }}
                        >
                          {selectMode && (
                            <SelectCircle
                              selected={selectedKeys.has(memoKey(item.entry))}
                              onToggle={() => toggleSelected(item.entry)}
                            />
                          )}
                          <div className="flex min-w-0 flex-1 flex-col items-end">
                            <MemoBubble
                              text={item.entry.text}
                              markdown
                              editing={editing?.start === item.entry.start && editing.day === item.entry.day}
                              selected={selectedKeys.has(memoKey(item.entry))}
                              selecting={selectMode}
                              resolve={resolve}
                              onOpenNote={openNote}
                              onOpenImage={setViewer}
                              onOpenTag={filterByTag}
                              onToggleSelect={() => toggleSelected(item.entry)}
                              onLongPress={() => setMenuEntry(item.entry)}
                              onSwipeLeft={threading ? undefined : () => void startThread(item.entry)}
                            />
                            <span
                              className="mr-1 mt-0.5 flex items-center gap-1 text-[10px] tabular-nums"
                              style={{ color: "var(--mob-muted)" }}
                            >
                              {item.entry.pinned && (
                                <Pin size={11} style={{ color: "var(--mob-accent)" }} aria-label="Pinned" />
                              )}
                              {item.entry.time}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex min-w-0 flex-col items-end">
                          <ThreadCard
                            thread={item.thread}
                            dimmed={selectMode}
                            onOpen={() => openThread(item.thread)}
                            onOpenTag={filterByTag}
                            onError={(message) => showToast(message)}
                          />
                          <span className="mr-1 mt-0.5 text-[10px] tabular-nums" style={{ color: "var(--mob-muted)" }}>
                            {item.key.slice(11)}
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          {/* A full-width bar instead of a small circle: one tap jumps back
              to the newest memo, the wording says what it does. */}
          <button
            type="button"
            aria-hidden={!awayFromLatest}
            tabIndex={awayFromLatest ? 0 : -1}
            onClick={jumpToLatest}
            className={
              "absolute inset-x-3 bottom-2 z-10 flex h-11 items-center justify-center gap-2 rounded-full border text-[13px] font-medium shadow-lg backdrop-blur transition-all duration-200 active:scale-[0.98] " +
              (awayFromLatest ? "pointer-events-auto opacity-100" : "pointer-events-none translate-y-3 opacity-0")
            }
            style={{
              background: "color-mix(in srgb, var(--mob-accent) 92%, transparent)",
              borderColor: "transparent",
              color: "#fff",
            }}
          >
            <ArrowDown size={16} />
            Jump back to recent message
          </button>
        </div>

        <MemoToast toast={toast} onDismiss={dismissToast} />

        <DraftError
          error={error}
          canRetry={canRetryTranscription}
          onRetry={retryTranscription}
          onDiscard={discardFailedClip}
        />

        <MemoComposer
          value={input}
          onChange={setInput}
          inputRef={inputRef}
          attachments={attachments}
          onAttach={(files) => void attach(files)}
          onRemoveAttachment={removeAttachment}
          fullscreen={fullscreen}
          onFullscreenChange={setFullscreen}
          editing={editing}
          onCancelEdit={cancelEdit}
          canSend={canSend}
          posting={posting}
          onSend={() => void post()}
          suggest={suggest}
          keyboardOpen={keyboardOpen}
          voice={voice}
        />
      </div>

      {viewer && <ImageViewer url={viewer} onClose={() => setViewer(null)} />}
      {menuEntry && (
        <MobileActionSheet
          title={makeSnippet(splitMemo(menuEntry.text).text, 80) || "Image"}
          subtitle={`${dayLabel(menuEntry.day)} ${menuEntry.time}`}
          sections={memoSections(menuEntry)}
          onClose={() => setMenuEntry(null)}
        />
      )}
      {picking && (
        <NotebookPicker
          onClose={() => setPicking(null)}
          onPick={(notebook) => {
            updateSettings({ memoNoteVault: notebook.vaultId, memoNoteFolder: notebook.folder });
            const list = picking;
            setPicking(null);
            void moveToNote(list, notebook);
          }}
        />
      )}
      {threadPicking && (
        <MobileActionSheet
          title="Add to thread"
          subtitle={threadPicking.length === 1 ? "1 memo" : `${threadPicking.length} memos`}
          sections={[
            threadsByActivity.map((thread) => ({
              label: `${thread.title || "Untitled thread"} · ${replyLabel(thread)}`,
              icon: <MessagesSquare size={18} />,
              onClick: () => {
                const list = threadPicking;
                setThreadPicking(null);
                void addToThread(list, thread);
              },
            })),
          ]}
          onClose={() => setThreadPicking(null)}
        />
      )}
    </section>
  );
}

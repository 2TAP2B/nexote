"use client";

import { Check, ChevronLeft, CircleCheck, Copy, MessagesSquare, MoreHorizontal, Pencil, Pin, Tags, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { copyText } from "@/lib/clipboard";
import { localDateKey, makeSnippet } from "@/lib/note-utils";
import { notepadLocation, splitMemo } from "@/lib/notepad";
import { useNotes } from "@/lib/notes-context";
import {
  appendThreadPost,
  createThread,
  deleteThread,
  mutateThread,
  openThread,
  parseThread,
  removeThreadPost,
  renameThread,
  replaceThreadPost,
  setPostFlags,
  useThreads,
  type PostFlags,
  type PostRef,
  type Thread,
  type ThreadPost,
} from "@/lib/threads";
import { MemoBubble, type NoteRef } from "../mobile/MemoBubble";
import { MemoComposer, type ComposerLabels } from "../mobile/MemoComposer";
import { MobileActionSheet } from "../mobile/MobileActionSheet";
import { useVisualViewport } from "../mobile/useVirtualKeyboardInset";
import { JumpButton, useScrolledAway } from "./JumpButton";
import { DraftError, HeaderButton, ImageViewer, MemoToast, SelectCircle, useMemoToast } from "./MemoChrome";
import { PinnedBar, type PinnedItem } from "./PinnedBar";
import { isPriorityLevel, PRIORITIES, PriorityBadge } from "./priority";
import { markSections, threadMarkSections } from "./threadActions";
import { errorText, useMemoDraft } from "./useMemoDraft";
import { useNoteRefs } from "./useNoteRefs";

// The chat view of one thread (phone overlay and desktop side panel): its
// posts like a messenger conversation, the first one being the thread's
// start, and a composer to reply. Long-press / right-click selects posts to
// edit, copy or delete them; swiping a reply left (or its hover button on
// desktop) starts a new thread from it, leaving a link in its place.

type Props = { vaultId: string; id: string; variant: "mobile" | "desktop"; onClose: () => void };

// MemoBubble and MemoComposer paint with the touch shell's palette, which
// only exists under .mob-shell-root. The same mapping here makes the view
// right in the desktop panel (light or dark theme) and wherever a host
// mounts it.
const PALETTE = {
  "--mob-bg": "var(--background)",
  "--mob-surface": "var(--muted)",
  "--mob-card": "var(--sidebar)",
  "--mob-text": "var(--foreground)",
  "--mob-muted": "var(--muted-foreground)",
  "--mob-accent": "var(--primary)",
} as React.CSSProperties;

const REPLY_LABELS: ComposerLabels = {
  send: "Reply",
  save: "Save post",
  placeholder: "Reply…",
  editPlaceholder: "Edit post…",
  newTitle: "Reply",
  editTitle: "Edit post",
  editing: (time) => (time ? `Editing the post from ${time}` : "Editing the post"),
  field: "Reply to the thread",
};

const NO_POSTS: ThreadPost[] = [];

// Posts are matched by content, not by their (shifting) line numbers, so a
// selection or an edit survives other posts arriving.
const postKey = (p: PostRef) => `${p.day}\n${p.time}\n${p.text}`;

const dayLabel = (day: string) =>
  day === localDateKey()
    ? "Today"
    : day
      ? new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
      : "Earlier";

const DONE_GREEN = "#22c55e";
const FLASH = "color-mix(in srgb, var(--mob-accent) 18%, transparent)";

// A post's first line for menus and the pinned bar (images shown as "Photo").
const postSnippet = (text: string) => makeSnippet(text, 80) || (splitMemo(text).images.length > 0 ? "Photo" : "Post");

// "Mon, Nov 17 · 09:14"
const postWhen = (p: ThreadPost) =>
  [
    p.day ? new Date(`${p.day}T00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "",
    p.time,
  ]
    .filter(Boolean)
    .join(" · ");

/** Pin / priority / done marks of a post, for its time line. */
function PostMarkIcons({ flags }: { flags: PostFlags }) {
  return (
    <>
      {flags.pinned && <Pin size={12} aria-label="Pinned" className="shrink-0" style={{ color: "var(--mob-accent)" }} />}
      <PriorityBadge priority={flags.priority} size={10} />
      {flags.done && <CircleCheck size={12} aria-label="Done" className="shrink-0" style={{ color: DONE_GREEN }} />}
    </>
  );
}

export default function ThreadView(props: Props) {
  // Another thread opened in place starts fresh: no draft, selection or
  // pending rename carries over.
  return <ThreadPane key={`${props.vaultId}/${props.id}`} {...props} />;
}

function ThreadPane({ vaultId, id, variant, onClose }: Props) {
  const { settings, openNoteInVault, openTab } = useNotes();
  const { threads, loaded, error: loadError } = useThreads(vaultId);
  const thread = threads.find((t) => t.id === id) ?? null;
  const posts = thread?.posts ?? NO_POSTS;
  const ref = { vaultId, id };
  const mobile = variant === "mobile";
  const vv = useVisualViewport();
  const keyboardOpen = mobile && vv.isKeyboardOpen;
  const { resolve, suggest } = useNoteRefs(vaultId);
  const { toast, showToast, dismissToast } = useMemoToast();
  // Images go to the thread's own note (its vault's image folder).
  const draft = useMemoDraft<ThreadPost>({
    ensureTarget: () => Promise.resolve(ref),
    currentTarget: () => ref,
    targetErrorText: "Couldn't upload to the thread",
  });
  const [fullscreen, setFullscreenState] = useState(false);
  // "Exit full screen" acts on pointerdown; the tap's click then lands on
  // the back button that sits at the same spot underneath. Ignore it.
  const fullscreenClosedAt = useRef(0);
  const setFullscreen = (next: boolean) => {
    if (!next) fullscreenClosedAt.current = Date.now();
    setFullscreenState(next);
  };
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // The title being typed while renaming (null: not renaming).
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  // Escape cancels the rename; the blur that follows must not save it.
  const renameCancelled = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const awayFromLatest = useScrolledAway(listRef, "bottom");
  // The post whose marks sheet is open (by key: it survives the save).
  const [marksKey, setMarksKey] = useState<string | null>(null);
  // The post briefly tinted after jumping to it from the pinned bar.
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const selected = posts.filter((p) => selectedKeys.has(postKey(p)));
  const editingKey = draft.editing ? postKey(draft.editing) : null;
  const isEditing = (list: ThreadPost[]) => editingKey !== null && list.some((p) => postKey(p) === editingKey);

  const toggleSelected = (post: ThreadPost) => {
    setSelectMode(true);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const key = postKey(post);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const clearSelection = () => {
    setSelectedKeys(new Set());
    setSelectMode(false);
  };
  // Runs a selection action, leaving selection mode.
  const onSelection = (action: (list: ThreadPost[]) => void) => () => {
    const list = selected;
    clearSelection();
    action(list);
  };

  // The latest post in view, like a chat: on open, on new posts and when the
  // keyboard takes half the screen.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [posts.length, keyboardOpen]);

  // Escape leaves selection mode / the menu first. Capture phase and
  // preventDefault: the desktop host closes the panel on an unhandled Escape.
  useEffect(() => {
    if (!selectMode && !menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (menuOpen) {
        setMenuOpen(false);
      } else {
        setSelectedKeys(new Set());
        setSelectMode(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectMode, menuOpen]);

  // The desktop menu closes on a click elsewhere.
  useEffect(() => {
    if (!menuOpen || mobile) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen, mobile]);

  const close = () => {
    if (Date.now() - fullscreenClosedAt.current < 600) return;
    onClose();
  };

  const send = () =>
    void draft.submit(
      async (text, edit) => {
        await mutateThread(ref, (body) => (edit ? replaceThreadPost(body, edit, text) : appendThreadPost(body, text)));
      },
      "Couldn't save to the thread",
      () => setFullscreen(false),
    );

  const openNote = (note: NoteRef) => {
    // Threads only open in the thread view; the editor can't show them.
    if (note.thread && note.vaultId) {
      openThread({ vaultId: note.vaultId, id: note.id });
      return;
    }
    // On the phone the overlay would hide the note.
    if (mobile) onClose();
    void (note.vaultId ? openNoteInVault(note.vaultId, note.id) : openTab(note.id));
  };

  // The Tags view, like a #tag in the editor: notes and threads share tags.
  const openTag = (tag: string) => {
    window.dispatchEvent(new CustomEvent("nexote:select-tag", { detail: tag }));
    onClose();
  };

  const removeThread = async () => {
    if (!thread) return;
    if (!window.confirm(`Delete the thread “${thread.title}” and all its posts?`)) return;
    try {
      await deleteThread(ref);
      onClose();
    } catch (e) {
      draft.setError(errorText(e, "Couldn't delete the thread"));
    }
  };

  const startRename = () => {
    if (!thread) return;
    renameCancelled.current = false;
    setMenuOpen(false);
    setTitleDraft(thread.title);
  };

  const commitRename = async () => {
    const title = titleDraft?.trim() ?? "";
    setTitleDraft(null);
    if (renameCancelled.current || !thread || !title || title === thread.title) return;
    try {
      await renameThread(ref, title);
    } catch (e) {
      draft.setError(errorText(e, "Couldn't rename the thread"));
    }
  };

  // Deletes posts from the thread's latest version; Undo puts that version
  // back unless the thread changed again since.
  const deletePosts = async (list: ThreadPost[]) => {
    if (list.length === 0) return;
    // A thread is its posts: taking all of them means deleting the thread.
    if (list.length >= posts.length) {
      showToast(list.length === 1 ? "It's the only post" : "Those are all the posts", {
        label: "Delete thread",
        run: () => void removeThread(),
      });
      return;
    }
    draft.setError(null);
    if (isEditing(list)) draft.cancelEdit();
    let before = "";
    try {
      const saved = await mutateThread(ref, (body) => {
        before = body;
        const next = list.reduce<string | null>((b, p) => (b === null ? null : removeThreadPost(b, p)), body);
        return next !== null && parseThread(next).length > 0 ? next : null;
      });
      showToast(list.length === 1 ? "Post deleted" : `${list.length} posts deleted`, {
        label: "Undo",
        run: () => void restore(before, saved.body),
      });
    } catch (e) {
      draft.setError(errorText(e, "Couldn't delete"));
    }
  };

  const restore = async (before: string, after: string) => {
    let stale = false;
    try {
      await mutateThread(ref, (body) => {
        stale = body !== after;
        return stale ? null : before;
      });
    } catch (e) {
      if (stale) showToast("The thread changed since — can't undo");
      else draft.setError(errorText(e, "Couldn't undo"));
    }
  };

  // "Swipe a reply": the post becomes a thread of its own and a link to it
  // takes its place here.
  const startThreadFrom = async (post: ThreadPost) => {
    draft.setError(null);
    if (isEditing([post])) draft.cancelEdit();
    const home = notepadLocation(settings);
    // [[links]] to threads resolve within one vault: a thread kept outside the
    // Notepad's vault spawns its threads next to itself.
    const loc = home.vaultId === vaultId ? home : { vaultId, folder: "" };
    let created: Thread;
    try {
      created = await createThread(loc, [post]);
    } catch (e) {
      draft.setError(errorText(e, "Couldn't start the thread"));
      return;
    }
    const open = { label: "Open", run: () => openThread(created) };
    try {
      await mutateThread(ref, (body) => replaceThreadPost(body, post, `[[${created.title}]]`));
      showToast("Thread started", open);
    } catch (e) {
      // The new thread exists either way; the post just stays here as well.
      showToast("Thread started — the post stays here too", open);
      draft.setError(errorText(e, "Couldn't replace the post with a link"));
    }
  };

  const copyPosts = (list: ThreadPost[]) => {
    void copyText(list.map((p) => p.text).join("\n\n")).then((ok) => showToast(ok ? "Copied" : "Couldn't copy"));
  };

  const single = selected.length === 1 ? selected[0] : null;
  // The first post is the thread itself: starting a thread from it is moot.
  const canSpinOff = single !== null && posts.indexOf(single) > 0;
  // Marks live in a post's heading; text before the first heading has none.
  const marksable = single !== null && single.day !== "";
  const marksPost = marksKey === null ? null : (posts.find((p) => postKey(p) === marksKey) ?? null);
  const threadMarks = thread ? threadMarkSections(thread, draft.setError) : [];

  const jumpToLatest = () => {
    const list = listRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  };

  // Scrolls a pinned post into view and tints it briefly so the eye finds it.
  const revealPost = (key: string) => {
    const el = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-post-key]") ?? []).find(
      (node) => node.dataset.postKey === key,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.clearTimeout(flashTimer.current);
    setFlashKey(key);
    flashTimer.current = window.setTimeout(() => setFlashKey(null), 1200);
  };
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const pinnedItems: PinnedItem[] = posts
    .filter((p) => p.flags.pinned)
    .map((p) => {
      const key = postKey(p);
      return {
        key,
        text: postSnippet(p.text),
        sub: postWhen(p),
        icon: <PriorityBadge priority={p.flags.priority} />,
        done: p.flags.done,
        onSelect: () => revealPost(key),
      };
    });

  const header = selectMode ? (
    <>
      <HeaderButton label="Cancel selection" onClick={clearSelection}>
        <X size={20} />
      </HeaderButton>
      <span className="min-w-0 flex-1 truncate text-lg font-semibold" style={{ color: "var(--mob-text)" }}>
        {selected.length ? `${selected.length} selected` : "Select posts"}
      </span>
      {marksable && (
        <HeaderButton label="Marks" onClick={onSelection((list) => setMarksKey(postKey(list[0])))}>
          <Tags size={18} />
        </HeaderButton>
      )}
      {single && (
        <HeaderButton label="Edit" onClick={onSelection((list) => draft.startEdit(list[0]))}>
          <Pencil size={18} />
        </HeaderButton>
      )}
      {canSpinOff && (
        <HeaderButton label="Start a thread from this" onClick={onSelection((list) => void startThreadFrom(list[0]))}>
          <MessagesSquare size={18} />
        </HeaderButton>
      )}
      <HeaderButton label="Copy" disabled={selected.length === 0} onClick={onSelection(copyPosts)}>
        <Copy size={18} />
      </HeaderButton>
      <HeaderButton
        label="Delete"
        danger
        disabled={selected.length === 0}
        onClick={onSelection((list) => void deletePosts(list))}
      >
        <Trash2 size={18} />
      </HeaderButton>
    </>
  ) : (
    <>
      <HeaderButton label={mobile ? "Back" : "Close thread"} onClick={close}>
        {mobile ? <ChevronLeft size={22} /> : <X size={20} />}
      </HeaderButton>
      <div className="flex min-w-0 flex-1 flex-col">
        {titleDraft !== null ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                // Handled here: the desktop host would close the panel.
                e.preventDefault();
                renameCancelled.current = true;
                e.currentTarget.blur();
              }
            }}
            aria-label="Thread title"
            enterKeyHint="done"
            className="w-full rounded-md bg-transparent px-1 text-lg font-semibold leading-tight outline-none ring-2 ring-primary"
            style={{ color: "var(--mob-text)" }}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={startRename}
              disabled={!thread}
              title={thread ? "Rename thread" : undefined}
              className={"truncate text-left text-lg font-semibold leading-tight" + (thread?.done ? " line-through opacity-60" : "")}
              style={{ color: "var(--mob-text)" }}
            >
              {thread?.title || "Thread"}
            </button>
            {thread?.done && <CircleCheck size={16} aria-label="Solved" className="shrink-0" style={{ color: DONE_GREEN }} />}
          </div>
        )}
        {thread && (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto pt-0.5 text-xs" style={{ scrollbarWidth: "none" }}>
            {thread.pinned && (
              <Pin size={12} aria-label="Pinned" className="shrink-0" style={{ color: "var(--mob-accent)" }} />
            )}
            <PriorityBadge priority={thread.priority} />
            {thread.tags.length > 0 ? (
              thread.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => openTag(tag)}
                  title={`Notes and threads tagged #${tag}`}
                  className="shrink-0 rounded-full px-2 py-px font-medium"
                  style={{
                    background: "color-mix(in oklab, var(--mob-accent) 15%, transparent)",
                    color: "var(--mob-accent)",
                  }}
                >
                  #{tag}
                </button>
              ))
            ) : (
              <span className="truncate" style={{ color: "var(--mob-muted)" }}>
                {posts.length === 1 ? "1 post" : `${posts.length} posts`}
              </span>
            )}
          </div>
        )}
      </div>
      {thread && posts.length > 0 && (
        <HeaderButton label="Select posts" onClick={() => setSelectMode(true)}>
          <CircleCheck size={19} />
        </HeaderButton>
      )}
      {thread && (
        <div ref={menuRef} className="relative">
          <HeaderButton label="More" onClick={() => setMenuOpen((open) => !open)}>
            <MoreHorizontal size={20} />
          </HeaderButton>
          {menuOpen && !mobile && (
            <div
              role="menu"
              className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-lg border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={startRename}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted"
              >
                <Pencil size={15} className="text-muted-foreground" />
                Rename
              </button>
              {threadMarks.map((group, g) => (
                <div key={g} role="group">
                  <div aria-hidden className="my-1 border-t border-border" />
                  {group.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={action.checked ?? false}
                      onClick={() => {
                        setMenuOpen(false);
                        action.onClick();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted [&_svg]:h-[15px] [&_svg]:w-[15px]"
                    >
                      <span className="flex shrink-0 text-muted-foreground">{action.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{action.label}</span>
                      {action.checked && <Check size={15} className="shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
              ))}
              <div aria-hidden className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void removeThread();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-red-600 hover:bg-muted dark:text-red-400"
              >
                <Trash2 size={15} />
                Delete thread
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );

  let content: React.ReactNode;
  if (!thread) {
    content = (
      <Notice
        title={!loaded ? "Loading…" : loadError ? "Couldn't load the thread" : "Thread not found"}
        text={!loaded ? "" : (loadError ?? "It may have been deleted or moved.")}
      />
    );
  } else if (posts.length === 0) {
    content = <Notice title="No posts yet" text="Write the first one below." />;
  } else if (mobile) {
    // Phone: a timeline instead of chat bubbles (unlike quick notes). Each
    // post has its time on top and a dot on the rail; the line runs on to the
    // next post's dot, so a thread reads as one thought over time.
    content = (
      <ol className="flex flex-col">
        {posts.map((post, i) => {
          const key = postKey(post);
          const first = i === 0;
          const last = i === posts.length - 1;
          const newDay = first || post.day !== posts[i - 1].day;
          const stamp = post.time ? (newDay ? `${dayLabel(post.day)} · ${post.time}` : post.time) : newDay ? dayLabel(post.day) : "";
          return (
            <li
              key={`${post.day}-${post.start}`}
              data-post-key={key}
              className="-mx-1 flex gap-1 rounded-xl px-1 transition-colors duration-500"
              style={flashKey === key ? { background: FLASH } : undefined}
            >
              {selectMode && (
                <SelectCircle label="Select post" selected={selectedKeys.has(key)} onToggle={() => toggleSelected(post)} />
              )}
              <div aria-hidden className="relative flex w-5 shrink-0 justify-center">
                <span
                  className="relative z-[1] mt-[5px] h-2.5 w-2.5 rounded-full"
                  style={
                    isPriorityLevel(post.flags.priority)
                      ? { background: PRIORITIES[post.flags.priority].color }
                      : first
                        ? { background: "var(--mob-accent)" }
                        : { background: "var(--mob-bg)", border: "2px solid var(--mob-accent)" }
                  }
                />
                {!last && (
                  <span
                    className="absolute bottom-[-5px] top-[15px] w-[2px] rounded-full"
                    style={{ background: "color-mix(in srgb, var(--mob-accent) 30%, transparent)" }}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 pb-5">
                <div className="flex items-center gap-1.5 px-2 text-[12px] tabular-nums" style={{ color: "var(--mob-muted)" }}>
                  {stamp && <span>{stamp}</span>}
                  {first && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--mob-accent)" }}>
                      Started
                    </span>
                  )}
                  <PostMarkIcons flags={post.flags} />
                </div>
                <div className={post.flags.done ? "opacity-[0.55] [&_.nexote-post-md]:line-through" : undefined}>
                  <MemoBubble
                    text={post.text}
                    variant="timeline"
                    markdown
                    editing={editingKey === key}
                    selected={selectedKeys.has(key)}
                    selecting={selectMode}
                    resolve={resolve}
                    onOpenNote={openNote}
                    onOpenImage={setViewer}
                    onOpenTag={openTag}
                    onToggleSelect={() => toggleSelected(post)}
                    onSwipeLeft={first ? undefined : () => void startThreadFrom(post)}
                    swipeLabel="Start a thread from this"
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    );
  } else {
    content = (
      <ol className="flex flex-col gap-1.5">
        {posts.map((post, i) => {
          const key = postKey(post);
          const first = i === 0;
          const flags = post.flags;
          return (
            <li
              key={`${post.day}-${post.start}`}
              data-post-key={key}
              className="flex flex-col rounded-xl transition-colors duration-500"
              style={flashKey === key ? { background: FLASH } : undefined}
            >
              {(first || post.day !== posts[i - 1].day) && (
                <span
                  className="my-2 self-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                  style={{ background: "var(--mob-surface)", color: "var(--mob-muted)" }}
                >
                  {dayLabel(post.day)}
                </span>
              )}
              <div className="flex items-center gap-2">
                {selectMode && (
                  <SelectCircle label="Select post" selected={selectedKeys.has(key)} onToggle={() => toggleSelected(post)} />
                )}
                <div className="group flex min-w-0 flex-1 flex-col items-end">
                  {first && (
                    <span
                      className="mb-0.5 mr-1 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--mob-accent)" }}
                    >
                      Started
                    </span>
                  )}
                  <div className="flex w-full items-center justify-end gap-1.5">
                    {/* No swipe with a mouse: desktop offers the same on hover. */}
                    {!mobile && !first && !selectMode && (
                      <button
                        type="button"
                        aria-label="Start a thread from this"
                        title="Start a thread from this"
                        onClick={() => void startThreadFrom(post)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                        style={{ background: "var(--mob-surface)", color: "var(--mob-muted)" }}
                      >
                        <MessagesSquare size={16} />
                      </button>
                    )}
                    <div
                      className={
                        "flex min-w-0 flex-1 justify-end" + (flags.done ? " opacity-[0.55] [&_.nexote-post-md]:line-through" : "")
                      }
                    >
                      <MemoBubble
                        text={post.text}
                        markdown
                        editing={editingKey === key}
                        selected={selectedKeys.has(key)}
                        selecting={selectMode}
                        resolve={resolve}
                        onOpenNote={openNote}
                        onOpenImage={setViewer}
                        onOpenTag={openTag}
                        onToggleSelect={() => toggleSelected(post)}
                        onSwipeLeft={first ? undefined : () => void startThreadFrom(post)}
                        swipeLabel="Start a thread from this"
                      />
                    </div>
                  </div>
                  {(post.time || flags.pinned || flags.priority > 0 || flags.done) && (
                    <span className="mr-1 mt-0.5 flex items-center gap-1 text-[10px] tabular-nums" style={{ color: "var(--mob-muted)" }}>
                      <PostMarkIcons flags={flags} />
                      {post.time}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section
      aria-label={thread ? `Thread: ${thread.title}` : "Thread"}
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{ ...PALETTE, background: "var(--mob-bg)", color: "var(--mob-text)" }}
    >
      {/* Exactly the visible area while the phone keyboard is open: iOS
          overlays the keyboard and may pan the visual viewport down
          (offsetTop), which would otherwise expose empty space below the
          composer. */}
      <div
        className="relative flex min-h-0 flex-col"
        style={
          keyboardOpen
            ? { height: `calc(100% - ${vv.inset}px)`, transform: `translateY(${vv.top}px)` }
            : { height: "100%" }
        }
      >
        <div
          className="flex shrink-0 items-center gap-3 px-3"
          style={{
            paddingTop: mobile ? "calc(env(safe-area-inset-top, 0px) + 8px)" : 8,
            paddingBottom: 8,
            borderBottom: "1px solid var(--mob-surface)",
          }}
        >
          {header}
        </div>

        <PinnedBar items={pinnedItems} title="Pinned posts" />

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
            style={{ touchAction: "pan-y" }}
          >
            {content}
          </div>
          <JumpButton
            show={awayFromLatest}
            direction="down"
            label="Jump to the latest post"
            onClick={jumpToLatest}
            className="absolute bottom-3 right-3 z-10"
          />
        </div>

        <MemoToast toast={toast} onDismiss={dismissToast} />

        <DraftError
          error={draft.error}
          canRetry={draft.canRetryTranscription}
          onRetry={draft.retryTranscription}
          onDiscard={draft.discardFailedClip}
        />

        {thread && (
          <MemoComposer
            value={draft.input}
            onChange={draft.setInput}
            inputRef={draft.inputRef}
            attachments={draft.attachments}
            onAttach={(files) => void draft.attach(files)}
            onRemoveAttachment={draft.removeAttachment}
            fullscreen={fullscreen}
            onFullscreenChange={setFullscreen}
            editing={draft.editing}
            onCancelEdit={draft.cancelEdit}
            canSend={draft.canSend}
            posting={draft.posting}
            onSend={send}
            suggest={suggest}
            keyboardOpen={keyboardOpen}
            voice={draft.voice}
            labels={REPLY_LABELS}
            allowFullscreen={mobile}
          />
        )}
      </div>

      {viewer && <ImageViewer url={viewer} onClose={() => setViewer(null)} />}
      {menuOpen && mobile && thread && (
        <MobileActionSheet
          title={thread.title}
          onClose={() => setMenuOpen(false)}
          sections={[
            [{ label: "Rename", icon: <Pencil size={18} />, onClick: startRename }],
            ...threadMarks,
            [{ label: "Delete thread", icon: <Trash2 size={18} />, danger: true, onClick: () => void removeThread() }],
          ]}
        />
      )}
      {marksPost && (
        <MobileActionSheet
          title={postSnippet(marksPost.text)}
          subtitle={postWhen(marksPost)}
          onClose={() => setMarksKey(null)}
          sections={markSections(
            marksPost.flags,
            (patch) =>
              void mutateThread(ref, (b) => setPostFlags(b, marksPost, patch)).catch((e: unknown) =>
                draft.setError(errorText(e, "Couldn't change the post")),
              ),
            "post",
          )}
        />
      )}
    </section>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-sm font-medium" style={{ color: "var(--mob-text)" }}>
        {title}
      </p>
      {text && (
        <p className="text-xs" style={{ color: "var(--mob-muted)" }}>
          {text}
        </p>
      )}
    </div>
  );
}

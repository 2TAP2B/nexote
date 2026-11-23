"use client";

import { Check, ChevronLeft, CircleCheck, Copy, MessageSquareReply, MoreHorizontal, Pencil, Pin, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { copyText } from "@/lib/clipboard";
import { makeSnippet } from "@/lib/note-utils";
import { splitMemo } from "@/lib/notepad";
import { useNotes } from "@/lib/notes-context";
import {
  addThreadComment,
  appendThreadPost,
  deleteThread,
  mutateThread,
  openThread,
  parseThread,
  removeThreadComment,
  removeThreadPost,
  renameThread,
  replaceThreadComment,
  replaceThreadPost,
  setPostFlags,
  useThreads,
  type PostFlags,
  type PostRef,
  type ThreadComment,
  type ThreadPost,
} from "@/lib/threads";
import { MemoBubble, type NoteRef } from "../mobile/MemoBubble";
import { MemoComposer, type ComposerLabels } from "../mobile/MemoComposer";
import { MobileActionSheet, type SheetAction } from "../mobile/MobileActionSheet";
import { SHELL_PALETTE } from "../mobile/mobileTheme";
import { useVisualViewport } from "../mobile/useVirtualKeyboardInset";
import { JumpButton, useScrolledAway } from "./JumpButton";
import { DraftError, HeaderButton, ImageViewer, MemoToast, SelectCircle, useMemoToast } from "./MemoChrome";
import { PinnedBar, type PinnedItem } from "./PinnedBar";
import { commentKey, dayLabel, PostComments } from "./PostComments";
import { isPriorityLevel, PRIORITIES, PriorityBadge } from "./priority";
import { markSections, threadMarkSections } from "./threadActions";
import { errorText, useMemoDraft } from "./useMemoDraft";
import { useNoteRefs } from "./useNoteRefs";

// The chat view of one thread (phone overlay, desktop main area): its posts
// like a messenger conversation, the first one being the thread's start, each
// with its comments underneath, and a composer to reply. Long-press /
// right-click opens a post's or comment's menu (comment, edit, copy, marks,
// delete); swiping a post left (or its hover button on desktop) comments on
// it. The header's select button picks several posts to copy or delete.

type Props = { vaultId: string; id: string; variant: "mobile" | "desktop"; onClose: () => void };

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

// Commenting reuses the composer's edit banner: it names the post the
// comment goes under, and its Cancel leaves comment mode.
const commentLabels = (post: string): ComposerLabels => ({
  send: "Comment",
  save: "Comment",
  placeholder: "Write a comment…",
  editPlaceholder: "Write a comment…",
  newTitle: "Comment",
  editTitle: "Comment",
  editing: () => `Commenting on: ${post}`,
  field: "Comment on the post",
});

const COMMENT_EDIT_LABELS: ComposerLabels = {
  send: "Comment",
  save: "Save comment",
  placeholder: "Write a comment…",
  editPlaceholder: "Edit comment…",
  newTitle: "Comment",
  editTitle: "Edit comment",
  editing: () => "Editing comment",
  field: "Edit the comment",
};

// On the comment page the header shows the topic, so the composer needs no
// banner; the placeholder says that a send adds a comment there.
const DETAIL_LABELS: ComposerLabels = {
  ...REPLY_LABELS,
  send: "Comment",
  save: "Comment",
  placeholder: "Write a comment…",
  editPlaceholder: "Write a comment…",
};

// What the composer edits: a post or a comment, as it was when opened (the
// save looks it up by that content in the latest body).
type Edit =
  | { kind: "post"; post: ThreadPost; text: string; time: string }
  | { kind: "comment"; post: ThreadPost; comment: ThreadComment; text: string; time: string };

// The long-press menu: a post's or one of its comments' (by content: it
// survives other changes arriving while it's open).
type Sheet = { kind: "post"; key: string } | { kind: "comment"; postKey: string; comment: ThreadComment };

const NO_POSTS: ThreadPost[] = [];

// Posts are matched by content, not by their (shifting) line numbers, so a
// selection or an edit survives other posts arriving.
const postKey = (p: PostRef) => `${p.day}\n${p.time}\n${p.text}`;

const DONE_GREEN = "#22c55e";
const FLASH = "color-mix(in srgb, var(--mob-accent) 18%, transparent)";

// A post's or comment's first line for menus and the pinned bar (images
// shown as "Photo").
const postSnippet = (text: string, empty = "Post") =>
  makeSnippet(text, 80) || (splitMemo(text).images.length > 0 ? "Photo" : empty);

// "Mon, Nov 17 · 09:14"
const postWhen = (p: { day: string; time: string }) =>
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
  const { openNoteInVault, openTab } = useNotes();
  const { threads, loaded, error: loadError } = useThreads(vaultId);
  const thread = threads.find((t) => t.id === id) ?? null;
  const posts = thread?.posts ?? NO_POSTS;
  const ref = { vaultId, id };
  const mobile = variant === "mobile";
  // Desktop shows the thread in the wide editor area: header, stream and
  // composer share one centered, readable column.
  const column = mobile ? "" : "mx-auto w-full max-w-3xl";
  const vv = useVisualViewport();
  const keyboardOpen = mobile && vv.isKeyboardOpen;
  const { resolve, suggest } = useNoteRefs(vaultId);
  const { toast, showToast, dismissToast } = useMemoToast();
  // Images go to the thread's own note (its vault's image folder).
  const draft = useMemoDraft<Edit>({
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
  const { away: awayFromLatest, setAway: setAwayFromLatest } = useScrolledAway(listRef, "bottom");
  // The post a new comment goes under (null: the composer replies). Its
  // content as it was when picked: the save finds it in the latest body.
  const [commentOn, setCommentOn] = useState<ThreadPost | null>(null);
  // The post whose comments are open (null: the thread's timeline).
  const [detailPostKey, setDetailPostKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // The post briefly tinted after jumping to it from the pinned bar.
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const selected = posts.filter((p) => selectedKeys.has(postKey(p)));
  const editingKey = draft.editing?.kind === "post" ? postKey(draft.editing.post) : null;
  const commentOnKey = commentOn ? postKey(commentOn) : null;
  // The post whose comment page is open, from the latest posts (deleted: back).
  const detailPost = detailPostKey === null ? null : (posts.find((p) => postKey(p) === detailPostKey) ?? null);
  // The comment page's header leaves comment mode; the send then has no post
  // target anymore, so the draft must not fire a comment.
  useEffect(() => {
    if (detailPostKey !== null && commentOn !== null && postKey(commentOn) !== detailPostKey) setCommentOn(null);
  }, [detailPostKey, commentOn]);
  // The comment of this post open in the composer, if any.
  const editingCommentOf = (post: ThreadPost) =>
    draft.editing?.kind === "comment" && postKey(draft.editing.post) === postKey(post) ? commentKey(draft.editing.comment) : null;
  // The composer works on one of these posts (an edit of it or of one of its
  // comments, or a comment for it).
  const composerOn = (list: ThreadPost[]) => {
    const keys = new Set(list.map(postKey));
    return {
      editing: draft.editing !== null && keys.has(postKey(draft.editing.post)),
      commenting: commentOnKey !== null && keys.has(commentOnKey),
    };
  };

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
  // keyboard takes half the screen. Every time the view comes on screen it
  // starts at the latest post (a swipe into it, or reopening it).
  const wasShown = useRef(false);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    if (!mobile) wasShown.current = true;
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

  const send = () => {
    const target = commentOn ?? (detailPost?.day ? detailPost : null);
    void draft.submit(
      async (text, edit) => {
        await mutateThread(ref, (body) => {
          if (edit?.kind === "comment") return replaceThreadComment(body, edit.post, edit.comment, text);
          if (edit) return replaceThreadPost(body, edit.post, text);
          return target ? addThreadComment(body, target, text) : appendThreadPost(body, text);
        });
      },
      target ? "Couldn't save the comment" : "Couldn't save to the thread",
      () => {
        if (target) setCommentOn(null);
        setFullscreen(false);
      },
    );
  };

  const startEditPost = (post: ThreadPost) => {
    setCommentOn(null);
    draft.startEdit({ kind: "post", post, text: post.text, time: post.time });
  };

  const startEditComment = (post: ThreadPost, comment: ThreadComment) => {
    setCommentOn(null);
    draft.startEdit({ kind: "comment", post, comment, text: comment.text, time: comment.time });
  };

  // Comment mode: the next send goes under this post. Text typed so far stays.
  const startComment = (post: ThreadPost) => {
    if (draft.editing) draft.cancelEdit();
    draft.setError(null);
    setCommentOn(post);
    requestAnimationFrame(() => draft.inputRef.current?.focus({ preventScroll: true }));
  };

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
    const on = composerOn(list);
    if (on.editing) draft.cancelEdit();
    if (on.commenting) setCommentOn(null);
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

  const deleteComment = async (post: ThreadPost, comment: ThreadComment) => {
    draft.setError(null);
    if (editingCommentOf(post) === commentKey(comment)) draft.cancelEdit();
    let before = "";
    try {
      const saved = await mutateThread(ref, (body) => {
        before = body;
        return removeThreadComment(body, post, comment);
      });
      showToast("Comment deleted", { label: "Undo", run: () => void restore(before, saved.body) });
    } catch (e) {
      draft.setError(errorText(e, "Couldn't delete the comment"));
    }
  };

  const copy = (text: string) => {
    void copyText(text).then((ok) => showToast(ok ? "Copied" : "Couldn't copy"));
  };
  const copyPosts = (list: ThreadPost[]) => copy(list.map((p) => p.text).join("\n\n"));

  // The post / comment whose menu is open, from the latest posts (gone: no menu).
  const sheetPost =
    sheet === null ? null : (posts.find((p) => postKey(p) === (sheet.kind === "post" ? sheet.key : sheet.postKey)) ?? null);
  const sheetComment =
    sheet?.kind === "comment" && sheetPost
      ? (sheetPost.comments.find((c) => commentKey(c) === commentKey(sheet.comment)) ?? null)
      : null;

  // Comments and marks live under a post's heading; text before the first
  // heading (day "") has neither.
  const postSheetSections = (post: ThreadPost): SheetAction[][] => [
    [
      ...(post.day
        ? [{ label: "Comment", icon: <MessageSquareReply size={19} />, onClick: () => startComment(post) }]
        : []),
      { label: "Edit", icon: <Pencil size={19} />, onClick: () => startEditPost(post) },
      { label: "Copy", icon: <Copy size={19} />, onClick: () => copyPosts([post]) },
    ],
    ...(post.day
      ? markSections(
          post.flags,
          (patch) =>
            void mutateThread(ref, (b) => setPostFlags(b, post, patch)).catch((e: unknown) =>
              draft.setError(errorText(e, "Couldn't change the post")),
            ),
          "post",
        )
      : []),
    [{ label: "Delete", icon: <Trash2 size={19} />, danger: true, onClick: () => void deletePosts([post]) }],
  ];

  const commentSheetSections = (post: ThreadPost, comment: ThreadComment): SheetAction[][] => [
    [
      { label: "Edit", icon: <Pencil size={19} />, onClick: () => startEditComment(post, comment) },
      { label: "Copy", icon: <Copy size={19} />, onClick: () => copy(comment.text) },
    ],
    [{ label: "Delete", icon: <Trash2 size={19} />, danger: true, onClick: () => void deleteComment(post, comment) }],
  ];

  // What the composer is doing: editing a post or comment, commenting, replying.
  const composerEditing = draft.editing ?? (commentOn ? { time: commentOn.time } : null);
  const composerLabels =
    draft.editing?.kind === "comment"
      ? COMMENT_EDIT_LABELS
      : !draft.editing && commentOn
        ? commentLabels(postSnippet(commentOn.text))
        : REPLY_LABELS;
  const cancelComposerMode = () => {
    if (draft.editing) draft.cancelEdit();
    else setCommentOn(null);
  };

  const single = selected.length === 1 ? selected[0] : null;
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
      {single && (
        <HeaderButton label="Edit" onClick={onSelection((list) => startEditPost(list[0]))}>
          <Pencil size={18} />
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
      <HeaderButton
        label={detailPost ? "Back to the thread" : mobile ? "Back" : "Close thread"}
        onClick={detailPost ? () => setDetailPostKey(null) : close}
      >
        {detailPost || mobile ? <ChevronLeft size={22} /> : <X size={20} />}
      </HeaderButton>
      <div className="flex min-w-0 flex-1 flex-col">
        {detailPost ? (
          <>
            <span className="truncate text-xs" style={{ color: "var(--mob-muted)" }}>
              {thread?.title}
            </span>
            <span
              className={"truncate text-lg font-semibold leading-tight" + (detailPost.flags.done ? " line-through opacity-60" : "")}
              style={{ color: "var(--mob-text)" }}
            >
              {postSnippet(detailPost.text)}
            </span>
          </>
        ) : (
          <>
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
        {thread && !detailPost && (
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
          </>
        )}
      </div>
      {!detailPost && thread && posts.length > 0 && (
        <HeaderButton label="Select posts" onClick={() => setSelectMode(true)}>
          <CircleCheck size={19} />
        </HeaderButton>
      )}
      {!detailPost && thread && (
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

  // Phone timeline: the stream's dot-and-line block for one post. Reused by
  // the comment page, which shows one post without the thread's other posts.
  const timelinePost = (post: ThreadPost, i: number, list: ThreadPost[]) => {
    const key = postKey(post);
    const first = i === 0;
    const last = i === list.length - 1;
    const newDay = first || post.day !== list[i - 1]?.day;
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
              editing={editingKey === key || commentOnKey === key}
              selected={selectedKeys.has(key)}
              selecting={selectMode}
              resolve={resolve}
              onOpenNote={openNote}
              onOpenImage={setViewer}
              onOpenTag={openTag}
              onToggleSelect={() => toggleSelected(post)}
              onLongPress={() => setSheet({ kind: "post", key })}
              onSwipeLeft={post.day ? () => startComment(post) : undefined}
              swipeLabel="Comment"
              swipeIcon={<MessageSquareReply size={18} />}
            />
          </div>
        </div>
      </li>
    );
  };

  // The comments of one post (used by the comment page in both layouts).
  const CommentsBlock = ({ post, indent }: { post: ThreadPost; indent: string }) => (
    <PostComments
      comments={post.comments}
      postDay={post.day}
      editingKey={editingCommentOf(post)}
      onMenu={(comment) => setSheet({ kind: "comment", postKey: postKey(post), comment })}
      resolve={resolve}
      onOpenNote={openNote}
      onOpenImage={setViewer}
      onOpenTag={openTag}
      className={indent}
    />
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
  } else if (detailPost) {
    // One topic with its comments. Phone: the timeline block; desktop: the
    // post's bubble, then the comments under it.
    content = mobile ? (
      <ol className="flex flex-col">
        {timelinePost(detailPost, posts.indexOf(detailPost) === 0 ? 0 : -1, [detailPost])}
        <CommentsBlock post={detailPost} indent="ml-8" />
      </ol>
    ) : (
      <ol className="flex flex-col gap-1.5">
        <li className="flex flex-col items-end">
          <div className="group flex min-w-0 flex-1 flex-col items-end">
            <div className={"flex w-full items-center justify-end gap-1.5"}>
              <div
                className={
                  "flex min-w-0 flex-1 justify-end" +
                  (detailPost.flags.done ? " opacity-[0.55] [&_.nexote-post-md]:line-through" : "")
                }
              >
                <MemoBubble
                  text={detailPost.text}
                  markdown
                  editing={editingKey === postKey(detailPost) || commentOnKey === postKey(detailPost)}
                  selected={selectedKeys.has(postKey(detailPost))}
                  selecting={selectMode}
                  resolve={resolve}
                  onOpenNote={openNote}
                  onOpenImage={setViewer}
                  onOpenTag={openTag}
                  onToggleSelect={() => toggleSelected(detailPost)}
                  onLongPress={() => setSheet({ kind: "post", key: postKey(detailPost) })}
                />
              </div>
            </div>
            <span className="mr-1 mt-0.5 flex items-center gap-1 text-[10px] tabular-nums" style={{ color: "var(--mob-muted)" }}>
              <PostMarkIcons flags={detailPost.flags} />
              {detailPost.time}
            </span>
            <CommentsBlock post={detailPost} indent="mr-1 mt-1 w-fit max-w-[75%]" />
          </div>
        </li>
      </ol>
    );
  } else if (mobile) {
    // Phone: a timeline instead of chat bubbles (unlike quick notes). Each
    // post has its time on top and a dot on the rail; the line runs on to the
    // next post's dot, so a thread reads as one thought over time. Comments
    // hide behind a count: tapping it opens the post with them.
    content = (
      <ol className="flex flex-col">
        {posts.map((post, i) => (
          <Fragment key={`${post.day}-${post.start}`}>
            {timelinePost(post, i, posts)}
            {post.comments.length > 0 && (
              <li className="-mt-3 flex gap-1">
                <span aria-hidden className="w-5 shrink-0" />
                <button
                  type="button"
                  onClick={() => {
                    setDetailPostKey(postKey(post));
                    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 }));
                  }}
                  className="ml-2 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
                  style={{
                    background: "var(--mob-surface)",
                    color: "var(--mob-accent)",
                  }}
                >
                  <MessageSquareReply size={13} />
                  {post.comments.length === 1 ? "1 comment" : `${post.comments.length} comments`}
                </button>
              </li>
            )}
          </Fragment>
        ))}
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
                    {!mobile && post.day && !selectMode && (
                      <button
                        type="button"
                        aria-label="Comment"
                        title="Comment"
                        onClick={() => startComment(post)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                        style={{ background: "var(--mob-surface)", color: "var(--mob-muted)" }}
                      >
                        <MessageSquareReply size={16} />
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
                        editing={editingKey === key || commentOnKey === key}
                        selected={selectedKeys.has(key)}
                        selecting={selectMode}
                        resolve={resolve}
                        onOpenNote={openNote}
                        onOpenImage={setViewer}
                        onOpenTag={openTag}
                        onToggleSelect={() => toggleSelected(post)}
                        onLongPress={() => setSheet({ kind: "post", key })}
                        onSwipeLeft={post.day ? () => startComment(post) : undefined}
                        swipeLabel="Comment"
                        swipeIcon={<MessageSquareReply size={18} />}
                      />
                    </div>
                  </div>
                  {(post.time || flags.pinned || flags.priority > 0 || flags.done) && (
                    <span className="mr-1 mt-0.5 flex items-center gap-1 text-[10px] tabular-nums" style={{ color: "var(--mob-muted)" }}>
                      <PostMarkIcons flags={flags} />
                      {post.time}
                    </span>
                  )}
                  {/* On the phone the comments hide behind a count; on
                      desktop they show inline, so there is no page to open. */}
                  {/* Under the bubble, narrower, text reading left to right
                      from a thin rule: asides to the post. */}
                  <PostComments
                    comments={post.comments}
                    postDay={post.day}
                    editingKey={editingCommentOf(post)}
                    onMenu={(comment) => setSheet({ kind: "comment", postKey: key, comment })}
                    resolve={resolve}
                    onOpenNote={openNote}
                    onOpenImage={setViewer}
                    onOpenTag={openTag}
                    // Shrinks to its text, right under the bubble it belongs to.
                    className="mr-1 mt-1 w-fit max-w-[75%]"
                  />
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
      style={{ ...SHELL_PALETTE, background: "var(--mob-bg)", color: "var(--mob-text)" }}
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
          className="shrink-0 px-3"
          style={{
            paddingTop: mobile ? "calc(env(safe-area-inset-top, 0px) + 8px)" : 8,
            paddingBottom: 8,
            borderBottom: "1px solid var(--mob-surface)",
          }}
        >
          <div className={"flex items-center gap-3 " + column}>{header}</div>
        </div>

        <div className={"shrink-0 " + column}>
          <PinnedBar items={pinnedItems} title="Pinned posts" />
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
            style={{ touchAction: "pan-y" }}
          >
            {mobile ? content : <div className={"flex min-h-full flex-col " + column}>{content}</div>}
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

        <div className={"shrink-0 " + column}>
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
              // On the comment page the header names the topic; the plain
              // placeholder says what a send does. No banner.
              editing={detailPost ? null : composerEditing}
              onCancelEdit={cancelComposerMode}
              canSend={draft.canSend}
              posting={draft.posting}
              onSend={send}
              suggest={suggest}
              keyboardOpen={keyboardOpen}
              voice={draft.voice}
              labels={detailPost && !draft.editing ? DETAIL_LABELS : composerLabels}
              allowFullscreen={mobile}
              composing={false}
            />
          )}
        </div>
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
      {sheetPost && sheetComment ? (
        <MobileActionSheet
          title={postSnippet(sheetComment.text, "Comment")}
          subtitle={postWhen(sheetComment)}
          onClose={() => setSheet(null)}
          sections={commentSheetSections(sheetPost, sheetComment)}
        />
      ) : (
        sheetPost &&
        sheet?.kind === "post" && (
          <MobileActionSheet
            title={postSnippet(sheetPost.text)}
            subtitle={postWhen(sheetPost)}
            onClose={() => setSheet(null)}
            sections={postSheetSections(sheetPost)}
          />
        )
      )}
    </section>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    // flex-1: fills the desktop column, whose height is only a minimum.
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
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

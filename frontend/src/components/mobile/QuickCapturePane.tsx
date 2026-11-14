"use client";

import { Copy, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import ContextMenu from "@/components/ContextMenu";
import { api, isCollectionsVault } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cacheImage } from "@/lib/image-cache";
import { localDateKey } from "@/lib/note-utils";
import {
  appendNotepadEntry,
  joinMemo,
  NOTEPAD_TITLE,
  parseNotepad,
  replaceNotepadEntry,
  splitMemo,
  type NotepadEntry,
} from "@/lib/notepad";
import { useNotes } from "@/lib/notes-context";
import { MemoBubble, type NoteRef } from "./MemoBubble";
import { MemoComposer, type Attachment } from "./MemoComposer";
import { useVisualViewport } from "./useVirtualKeyboardInset";

// Quick capture: a chat-style pad in the dashboard's right pane (swipe left on
// the dashboard). Enter posts the text into the "Notepad" note — created on the
// first post or image — without leaving the dashboard. "@" links a note, the
// image button (or pasting) attaches images, and the expand button writes in
// full screen. Long-press a memo to copy or edit it.

type Target = { vaultId: string; id: string };

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// "/api/vaults/<vault>/images/<rel>" → "<rel>" (what the delete route takes).
const imageRel = (url: string) => url.slice(url.indexOf("/images/") + "/images/".length);

export default function QuickCapturePane({ focused, onBack }: { focused: boolean; onBack: () => void }) {
  const { vaults, activeVault, allVaultData, journalNotes, refresh, refreshNoteBody, openNoteInVault, openTab } =
    useNotes();
  const vv = useVisualViewport();
  const [body, setBody] = useState("");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [editing, setEditing] = useState<NotepadEntry | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ entry: NotepadEntry; x: number; y: number } | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef(0);
  const nextKey = useRef(0);
  // Attachments removed while still uploading: delete the file once it lands.
  const removedWhileUploading = useRef(new Set<number>());
  // The Notepad note once known or created here. Creation is shared, so an
  // image upload and a post can't create two notes.
  const targetRef = useRef<Target | null>(null);
  const creatingRef = useRef<Promise<Target> | null>(null);
  // Whether the pane is on screen right now (read after awaits).
  const focusedRef = useRef(focused);
  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);

  const notepad = useMemo(() => {
    for (const v of vaults) {
      if (isCollectionsVault(v)) continue;
      const hit = allVaultData[v.id]?.notes.find((n) => n.title === NOTEPAD_TITLE && !n.collection);
      if (hit) return { vaultId: v.id, id: hit.id };
    }
    return null;
  }, [vaults, allVaultData]);
  const notepadVault = notepad?.vaultId;
  const notepadId = notepad?.id;

  useEffect(() => {
    if (notepadVault && notepadId) targetRef.current = { vaultId: notepadVault, id: notepadId };
  }, [notepadVault, notepadId]);

  // (Re)load whenever the pane is shown, so edits made elsewhere appear.
  useEffect(() => {
    if (!focused || !notepadVault || !notepadId) return;
    let cancelled = false;
    api
      .get(notepadVault, notepadId)
      .then((note) => {
        if (!cancelled) setBody(note.body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [focused, notepadVault, notepadId]);

  useEffect(() => {
    if (!focused) setMenu(null);
  }, [focused]);

  const entries = useMemo(() => parseNotepad(body), [body]);

  // Newest entry at the bottom, like a chat.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries.length, focused, vv.isKeyboardOpen]);

  // Notes a memo can link to: every regular vault note and the journal.
  const noteRefs = useMemo(() => {
    const refs: NoteRef[] = [];
    for (const v of vaults) {
      if (isCollectionsVault(v)) continue;
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (n.id === notepadId || !n.title) continue;
        refs.push({
          id: n.id,
          title: n.title,
          vaultId: v.id,
          where: n.path ? `${v.name} › ${n.path}` : v.name,
          updatedAt: n.updatedAt,
        });
      }
    }
    for (const n of journalNotes) {
      if (n.title) refs.push({ id: n.id, title: n.title, vaultId: null, where: "Journal", updatedAt: n.updatedAt });
    }
    return refs;
  }, [vaults, allVaultData, journalNotes, notepadId]);

  // [[Title]] → note: same title (any case), the notepad's vault first.
  const resolve = useCallback(
    (title: string) => {
      const wanted = title.toLowerCase();
      let fallback: NoteRef | null = null;
      for (const ref of noteRefs) {
        if (ref.title.toLowerCase() !== wanted) continue;
        if (ref.vaultId === notepadVault) return ref;
        fallback ??= ref;
      }
      return fallback;
    },
    [noteRefs, notepadVault],
  );

  // "@query" suggestions: titles containing the query, prefix matches first,
  // then the most recently edited.
  const suggest = useCallback(
    (query: string) => {
      const q = query.toLowerCase();
      return noteRefs
        .filter((r) => r.title.toLowerCase().includes(q))
        .sort(
          (a, b) =>
            Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) ||
            b.updatedAt.localeCompare(a.updatedAt),
        )
        .slice(0, 6);
    },
    [noteRefs],
  );

  const ensureTarget = (): Promise<Target> => {
    if (targetRef.current) return Promise.resolve(targetRef.current);
    creatingRef.current ??= (async () => {
      const vault =
        activeVault && !isCollectionsVault(activeVault) ? activeVault : vaults.find((v) => !isCollectionsVault(v));
      if (!vault) throw new Error("No vault to keep the notepad in");
      const created = await api.create(vault.id, { title: NOTEPAD_TITLE });
      targetRef.current = { vaultId: vault.id, id: created.id };
      void refresh();
      return targetRef.current;
    })().finally(() => {
      creatingRef.current = null;
    });
    return creatingRef.current;
  };

  const showToast = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  };

  // Drops an attachment's preview; a fresh upload that is never posted is
  // deleted from the vault again.
  const discard = (a: Attachment) => {
    if (a.preview.startsWith("blob:")) URL.revokeObjectURL(a.preview);
    const target = targetRef.current;
    if (a.fresh && a.url && target) void api.removeImage(target.vaultId, imageRel(a.url)).catch(() => {});
  };

  const attach = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setError(null);
    const items = images.map((file): Attachment => ({
      key: ++nextKey.current,
      preview: URL.createObjectURL(file),
      status: "uploading",
      fresh: true,
    }));
    setAttachments((list) => [...list, ...items]);
    const update = (key: number, patch: Partial<Attachment>) =>
      setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));
    let target: Target;
    try {
      target = await ensureTarget();
    } catch (e) {
      items.forEach((item) => update(item.key, { status: "error" }));
      setError(errorText(e, "Couldn't create the notepad"));
      return;
    }
    await Promise.all(
      images.map(async (file, i) => {
        const key = items[i].key;
        try {
          const meta = await api.uploadImage(target.vaultId, target.id, file);
          if (removedWhileUploading.current.delete(key)) {
            void api.removeImage(target.vaultId, imageRel(meta.url)).catch(() => {});
            return;
          }
          // Keep the bytes locally so the image survives a reload offline.
          void cacheImage(meta.url, file);
          window.dispatchEvent(new CustomEvent("nexote:image-uploaded", { detail: meta.url }));
          update(key, { status: "ready", url: meta.url });
        } catch (e) {
          update(key, { status: "error" });
          setError(errorText(e, "Image upload failed"));
        }
      }),
    );
  };

  const removeAttachment = (key: number) => {
    const a = attachments.find((x) => x.key === key);
    if (!a) return;
    if (a.status === "uploading") removedWhileUploading.current.add(key);
    else discard(a);
    setAttachments((list) => list.filter((x) => x.key !== key));
  };

  const uploading = attachments.some((a) => a.status === "uploading");
  const memoText = joinMemo(
    input,
    attachments.flatMap((a) => (a.status === "ready" && a.url ? [a.url] : [])),
  );
  const canSend = Boolean(memoText) && !uploading;

  const resetComposer = () => {
    setInput("");
    setAttachments([]);
    setEditing(null);
  };

  const post = async () => {
    if (!canSend || posting) return;
    const text = memoText;
    const edit = editing;
    if (edit && text === edit.text) {
      resetComposer();
      return;
    }
    setPosting(true);
    setError(null);
    const draft = { input, attachments };
    setInput("");
    setAttachments([]);
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
      draft.attachments.forEach((a) => {
        if (a.preview.startsWith("blob:")) URL.revokeObjectURL(a.preview);
      });
      setEditing(null);
      setFullscreen(false);
      void refreshNoteBody(target.id);
    } catch (e) {
      setBody(previous);
      setInput((current) => current || draft.input);
      setAttachments((current) => (current.length > 0 ? current : draft.attachments));
      setError(errorText(e, "Couldn't save to the notepad"));
    } finally {
      setPosting(false);
      // Keep typing the next memo — but never focus a pane swiped away in the
      // meantime: focusing makes the browser scroll the pager to the field.
      if (focusedRef.current) inputRef.current?.focus({ preventScroll: true });
    }
  };

  const startEdit = (entry: NotepadEntry) => {
    const memo = splitMemo(entry.text);
    attachments.forEach(discard);
    setError(null);
    setEditing(entry);
    setInput(memo.text);
    setAttachments(
      memo.images.map((url): Attachment => ({ key: ++nextKey.current, preview: url, url, status: "ready", fresh: false })),
    );
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const cancelEdit = () => {
    attachments.forEach(discard);
    resetComposer();
  };

  const openNote = (note: NoteRef) => {
    onBack();
    void (note.vaultId ? openNoteInVault(note.vaultId, note.id) : openTab(note.id));
  };

  return (
    <section
      aria-label="Quick notes"
      className="relative flex h-full w-1/3 shrink-0 flex-col overflow-hidden"
      style={{
        background: "var(--mob-bg)",
        borderLeft: "1px solid var(--mob-surface)",
        // Horizontal drags belong to the swipe back to the dashboard.
        touchAction: "pan-y",
      }}
    >
      {/* Shrinks by the keyboard height (iOS overlays it) so the composer
          always sits right above the keyboard. */}
      <div
        className="relative flex min-h-0 flex-col"
        style={{ height: vv.isKeyboardOpen ? `calc(100% - ${vv.inset}px)` : "100%" }}
      >
        <div
          className="flex shrink-0 items-center gap-3 px-3"
          style={{
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
            paddingBottom: 8,
            borderBottom: "1px solid var(--mob-surface)",
          }}
        >
          <button
            type="button"
            aria-label="Close quick notes"
            onClick={onBack}
            className="flex items-center justify-center rounded-full transition-transform active:scale-95"
            style={{ width: 40, height: 40, background: "var(--mob-surface)", color: "var(--mob-text)" }}
          >
            <X size={20} />
          </button>
          <span className="flex min-w-0 flex-col">
            <span className="text-lg font-semibold leading-tight" style={{ color: "var(--mob-text)" }}>
              Quick notes
            </span>
            <span className="truncate text-xs" style={{ color: "var(--mob-muted)" }}>
              Saved to your &quot;{NOTEPAD_TITLE}&quot; note
            </span>
          </span>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" style={{ touchAction: "pan-y" }}>
          {entries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="text-sm font-medium" style={{ color: "var(--mob-text)" }}>
                Jot it down
              </p>
              <p className="text-xs" style={{ color: "var(--mob-muted)" }}>
                Type below and press Enter — each memo is added to &quot;{NOTEPAD_TITLE}&quot; with the time. Type @ to
                link a note; add photos with the image button.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {entries.map((entry, i) => (
                <li key={`${entry.day}-${entry.start}`} className="flex flex-col items-end">
                  {entry.day !== entries[i - 1]?.day && (
                    <span
                      className="my-2 self-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                      style={{ background: "var(--mob-surface)", color: "var(--mob-muted)" }}
                    >
                      {entry.day === localDateKey()
                        ? "Today"
                        : entry.day
                          ? new Date(`${entry.day}T00:00`).toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })
                          : "Earlier"}
                    </span>
                  )}
                  <MemoBubble
                    entry={entry}
                    editing={editing?.start === entry.start && editing.day === entry.day}
                    resolve={resolve}
                    onOpenNote={openNote}
                    onOpenImage={setViewer}
                    onMenu={(e, x, y) => setMenu({ entry: e, x, y })}
                  />
                  <span className="mr-1 mt-0.5 text-[10px] tabular-nums" style={{ color: "var(--mob-muted)" }}>
                    {entry.time}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {toast && (
          <div
            role="status"
            className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white"
          >
            {toast}
          </div>
        )}

        {error && (
          <div className="px-3 pb-1 text-xs" style={{ color: "#f87171" }}>
            {error}
          </div>
        )}

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
          keyboardOpen={vv.isKeyboardOpen}
        />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Copy",
              icon: <Copy size={15} />,
              onClick: () => {
                void copyText(menu.entry.text).then((ok) => showToast(ok ? "Copied" : "Couldn't copy"));
              },
            },
            { label: "Edit", icon: <Pencil size={15} />, onClick: () => startEdit(menu.entry) },
          ]}
        />
      )}
      {viewer && <ImageViewer url={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}

// Full-screen image, portaled out of the pager (its transform would anchor a
// fixed overlay to the track instead of the screen).
function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-label="Image"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-2"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- vault image */}
      <img src={url} alt="" className="max-h-full max-w-full object-contain" />
      <button
        type="button"
        aria-label="Close image"
        onClick={onClose}
        className="absolute right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <X size={20} />
      </button>
    </div>,
    document.body,
  );
}

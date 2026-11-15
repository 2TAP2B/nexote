"use client";

import { Copy, FilePlus, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import ContextMenu from "@/components/ContextMenu";
import { api, isCollectionsVault } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cacheImage } from "@/lib/image-cache";
import { localDateKey } from "@/lib/note-utils";
import {
  appendNotepadEntry,
  findNotepad,
  joinMemo,
  memoToNote,
  NOTEPAD_TITLE,
  notepadLocation,
  parseNotepad,
  removeNotepadEntry,
  replaceNotepadEntry,
  splitMemo,
  type NotepadEntry,
} from "@/lib/notepad";
import type { Notebook } from "@/lib/notebooks";
import { useNotes } from "@/lib/notes-context";
import { MemoBubble, type NoteRef } from "./MemoBubble";
import { MemoComposer, type Attachment } from "./MemoComposer";
import { NotebookPicker } from "./NotebookPicker";
import { useVisualViewport } from "./useVirtualKeyboardInset";
import { useVoiceRecorder, VoiceError, type VoiceClip } from "./useVoiceRecorder";

// Quick capture: a chat-style pad in the dashboard's right pane (swipe left on
// the dashboard). Enter posts the text into the "Notepad" note — created on the
// first post or image — without leaving the dashboard. "@" links a note, the
// image button (or pasting) attaches images, the mic records a voice memo that
// the AI endpoint transcribes into the text, and the expand button writes in
// full screen. Long-press a memo to copy or edit it, or to make it a note of
// its own.

type Target = { vaultId: string; id: string };
type Toast = { text: string; action?: { label: string; run: () => void } };

const MAX_RECORDING_MS = 10 * 60_000;

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// "/api/vaults/<vault>/images/<rel>" → "<rel>" (what the delete route takes).
const imageRel = (url: string) => url.slice(url.indexOf("/images/") + "/images/".length);

export default function QuickCapturePane({ focused, onBack }: { focused: boolean; onBack: () => void }) {
  const {
    vaults,
    allVaults,
    allVaultData,
    journalNotes,
    refresh,
    refreshNoteBody,
    openNoteInVault,
    openTab,
    settings,
    updateSettings,
  } = useNotes();
  const vv = useVisualViewport();
  const [body, setBody] = useState("");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fullscreen, setFullscreenState] = useState(false);
  // "Exit full screen" acts on pointerdown; the tap's click then lands on
  // the close button that sits at the same spot underneath. Ignore it.
  const fullscreenClosedAt = useRef(0);
  const setFullscreen = (next: boolean) => {
    if (!next) fullscreenClosedAt.current = Date.now();
    setFullscreenState(next);
  };
  const [editing, setEditing] = useState<NotepadEntry | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // The memo waiting for the first-time notebook choice.
  const [picking, setPicking] = useState<NotepadEntry | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  // A recording whose transcription failed, kept for "Retry".
  const [failedClip, setFailedClip] = useState<VoiceClip | null>(null);
  const transcribeAbort = useRef<AbortController | null>(null);
  const recorder = useVoiceRecorder({ maxMs: MAX_RECORDING_MS, onLimit: () => void stopVoice() });
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
  useEffect(() => () => transcribeAbort.current?.abort(), []);

  // The Notepad lives where Settings › Features says: the personal "home"
  // store (default, the same in every space) or a chosen notebook. Found and
  // (re)loaded whenever the pane is shown, so edits made elsewhere appear.
  // Creating it on the first post only sets targetRef: reloading then would
  // race the post and show the empty new note.
  const { vaultId: locVault, folder: locFolder } = notepadLocation(settings);
  // A new location means another note: forget the old one and its memos.
  useEffect(() => {
    targetRef.current = null;
    setBody("");
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
        if (!n.title) continue;
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
  }, [vaults, allVaultData, journalNotes]);

  // [[Title]] → note: same title (any case); the first match wins (the
  // active space's vaults, then the journal).
  const resolve = useCallback(
    (title: string) => {
      const wanted = title.toLowerCase();
      return noteRefs.find((ref) => ref.title.toLowerCase() === wanted) ?? null;
    },
    [noteRefs],
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
      const created = await api.create(locVault, { title: NOTEPAD_TITLE, path: locFolder || undefined });
      targetRef.current = { vaultId: locVault, id: created.id };
      return targetRef.current;
    })().finally(() => {
      creatingRef.current = null;
    });
    return creatingRef.current;
  };

  const showToast = (text: string, action?: Toast["action"]) => {
    setToast({ text, action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 5000 : 1600);
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

  // Voice memos: record, then the AI endpoint transcribes the clip and the
  // text lands in the composer to check before posting.
  const transcribe = async (clip: VoiceClip) => {
    setTranscribing(true);
    setError(null);
    setFailedClip(null);
    const abort = new AbortController();
    transcribeAbort.current = abort;
    try {
      const text = (
        await api.transcribeAudio(
          {
            baseUrl: settings.aiBaseUrl,
            apiKey: settings.aiApiKey,
            model: settings.aiTranscribeModel.trim() || "whisper-1",
          },
          clip.blob,
          clip.fileName,
          abort.signal,
        )
      ).trim();
      if (!text) {
        setError("No speech was recognized.");
        return;
      }
      setInput((current) => (current.trim() ? `${current.replace(/\s+$/, "")} ${text}` : text));
      if (focusedRef.current) inputRef.current?.focus({ preventScroll: true });
    } catch (e) {
      if (abort.signal.aborted) return;
      setFailedClip(clip);
      setError(errorText(e, "Transcription failed"));
    } finally {
      if (transcribeAbort.current === abort) transcribeAbort.current = null;
      setTranscribing(false);
    }
  };

  const startVoice = async () => {
    setError(null);
    setFailedClip(null);
    if (!settings.aiBaseUrl.trim()) {
      setError("Voice memos are transcribed by your AI endpoint: set it up in Settings › AI on this device.");
      return;
    }
    try {
      await recorder.start();
    } catch (e) {
      setError(e instanceof VoiceError ? e.message : "Couldn't start recording.");
    }
  };

  const stopVoice = async () => {
    const clip = await recorder.stop();
    if (clip) await transcribe(clip);
    else setError("Nothing was recorded.");
  };

  const cancelVoice = () => {
    recorder.cancel();
    transcribeAbort.current?.abort();
    setTranscribing(false);
  };

  const voiceState = recorder.recording ? "recording" : transcribing ? "transcribing" : "idle";

  // "Make note": the memo becomes a note in the default notebook (asked for
  // the first time), then leaves the notepad — moved, not copied.
  const makeNote = (entry: NotepadEntry) => {
    // The default notebook may be in any space; viewer-only vaults can't take notes.
    const vault = allVaults.find(
      (v) => v.id === settings.memoNoteVault && !isCollectionsVault(v) && v.role !== "viewer",
    );
    if (vault) void moveToNote(entry, { vaultId: vault.id, folder: settings.memoNoteFolder });
    else setPicking(entry);
  };

  const moveToNote = async (entry: NotepadEntry, notebook: Pick<Notebook, "vaultId" | "folder">) => {
    setError(null);
    if (editing?.day === entry.day && editing.start === entry.start) cancelEdit();
    const draft = memoToNote(entry, settings.headingOnNewNote);
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
    // Only now take the memo out, from the notepad's latest version.
    try {
      const target = targetRef.current;
      if (!target) throw new Error("The notepad note is gone");
      const next = removeNotepadEntry((await api.get(target.vaultId, target.id)).body, entry);
      if (next === null) {
        showToast(`Saved as “${created.title}” — the memo changed elsewhere, so it stays`, open);
        return;
      }
      setBody(next);
      await api.update(target.vaultId, target.id, { title: NOTEPAD_TITLE, body: next });
      void refreshNoteBody(target.id);
      showToast(`Moved to “${created.title}”`, open);
    } catch (e) {
      showToast(`Saved as “${created.title}”`, open);
      setError(errorText(e, "Couldn't remove the memo from the notepad"));
    }
  };

  return (
    <section
      aria-label="Quick notes"
      className="relative flex h-full w-1/4 shrink-0 flex-col overflow-hidden"
      style={{
        background: "var(--mob-bg)",
        borderLeft: "1px solid var(--mob-surface)",
        // Horizontal drags belong to the swipe back to the dashboard.
        touchAction: "pan-y",
      }}
    >
      {/* Exactly the visible area while the keyboard is open: iOS overlays the
          keyboard and may pan the visual viewport down (offsetTop), which would
          otherwise expose empty space below the composer. */}
      <div
        className="relative flex min-h-0 flex-col"
        style={
          vv.isKeyboardOpen
            ? { height: `calc(100% - ${vv.inset}px)`, transform: `translateY(${vv.top}px)` }
            : { height: "100%" }
        }
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
            onClick={() => {
              if (Date.now() - fullscreenClosedAt.current < 600) return;
              onBack();
            }}
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

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3" style={{ touchAction: "pan-y" }}>
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
            className={
              "absolute left-1/2 top-20 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-full bg-black/80 px-3.5 py-1.5 text-xs font-medium text-white" +
              (toast.action ? "" : " pointer-events-none")
            }
          >
            <span className="truncate">{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  setToast(null);
                }}
                className="shrink-0 font-semibold underline-offset-2 active:underline"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 px-3 pb-1 text-xs" style={{ color: "#f87171" }}>
            <span className="min-w-0 flex-1">{error}</span>
            {failedClip && (
              <>
                <button
                  type="button"
                  onClick={() => void transcribe(failedClip)}
                  className="shrink-0 font-semibold"
                  style={{ color: "var(--mob-accent)" }}
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFailedClip(null);
                    setError(null);
                  }}
                  className="shrink-0"
                  style={{ color: "var(--mob-muted)" }}
                >
                  Discard
                </button>
              </>
            )}
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
          voice={{
            state: voiceState,
            elapsedMs: recorder.elapsedMs,
            onStart: () => void startVoice(),
            onStop: () => void stopVoice(),
            onCancel: cancelVoice,
          }}
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
            { label: "Make note", icon: <FilePlus size={15} />, onClick: () => makeNote(menu.entry) },
          ]}
        />
      )}
      {viewer && <ImageViewer url={viewer} onClose={() => setViewer(null)} />}
      {picking && (
        <NotebookPicker
          onClose={() => setPicking(null)}
          onPick={(notebook) => {
            updateSettings({ memoNoteVault: notebook.vaultId, memoNoteFolder: notebook.folder });
            const entry = picking;
            setPicking(null);
            void moveToNote(entry, notebook);
          }}
        />
      )}
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

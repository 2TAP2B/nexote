"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { cacheImage } from "@/lib/image-cache";
import { joinMemo, splitMemo } from "@/lib/notepad";
import { useNotes } from "@/lib/notes-context";
import type { Attachment, VoiceState } from "../mobile/MemoComposer";
import { useVoiceRecorder, VoiceError, type VoiceClip } from "../mobile/useVoiceRecorder";

// The draft behind a MemoComposer, shared by quick notes and thread replies:
// the text, images uploaded as soon as they're attached, voice memos the AI
// endpoint transcribes into the text, and the memo being edited. The host
// decides where images are uploaded (`ensureTarget`) and how a memo is saved
// (`submit`'s callback).

/** The note images are uploaded to. */
export type MemoTarget = { vaultId: string; id: string };

const MAX_RECORDING_MS = 10 * 60_000;

export const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

// "/api/vaults/<vault>/images/<rel>" → "<rel>" (what the delete route takes).
const imageRel = (url: string) => url.slice(url.indexOf("/images/") + "/images/".length);

export function useMemoDraft<E extends { text: string }>({
  ensureTarget,
  currentTarget,
  targetErrorText,
  canFocus = () => true,
}: {
  /** The note images go to, created on demand by the host if needed. */
  ensureTarget: () => Promise<MemoTarget>;
  /** That note if known yet: a fresh upload that's dropped is deleted there again. */
  currentTarget: () => MemoTarget | null;
  /** Shown when `ensureTarget` fails without a message. */
  targetErrorText: string;
  /** Whether the input may take focus now (read after awaits). */
  canFocus?: () => boolean;
}) {
  const { settings } = useNotes();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editing, setEditing] = useState<E | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  // A recording whose transcription failed, kept for "Retry".
  const [failedClip, setFailedClip] = useState<VoiceClip | null>(null);
  const transcribeAbort = useRef<AbortController | null>(null);
  const recorder = useVoiceRecorder({ maxMs: MAX_RECORDING_MS, onLimit: () => void stopVoice() });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextKey = useRef(0);
  // Attachments removed while still uploading: delete the file once it lands.
  const removedWhileUploading = useRef(new Set<number>());
  useEffect(() => () => transcribeAbort.current?.abort(), []);

  // Drops an attachment's preview; a fresh upload that is never posted is
  // deleted from the vault again.
  const discard = (a: Attachment) => {
    if (a.preview.startsWith("blob:")) URL.revokeObjectURL(a.preview);
    const target = currentTarget();
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
    let target: MemoTarget;
    try {
      target = await ensureTarget();
    } catch (e) {
      items.forEach((item) => update(item.key, { status: "error" }));
      setError(errorText(e, targetErrorText));
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

  const reset = () => {
    setInput("");
    setAttachments([]);
    setEditing(null);
  };

  /**
   * Saves the draft: `save` writes the text (a new memo, or the edited one's
   * new text). The composer clears at once and gets the draft back if saving
   * fails; an edit that changed nothing just closes.
   */
  const submit = async (
    save: (text: string, editing: E | null) => Promise<void>,
    failText: string,
    onSaved?: () => void,
  ) => {
    if (!canSend || posting) return;
    const text = memoText;
    const edit = editing;
    if (edit && text === edit.text) {
      reset();
      return;
    }
    setPosting(true);
    setError(null);
    const draft = { input, attachments };
    setInput("");
    setAttachments([]);
    try {
      await save(text, edit);
      draft.attachments.forEach((a) => {
        if (a.preview.startsWith("blob:")) URL.revokeObjectURL(a.preview);
      });
      setEditing(null);
      onSaved?.();
    } catch (e) {
      setInput((current) => current || draft.input);
      setAttachments((current) => (current.length > 0 ? current : draft.attachments));
      setError(errorText(e, failText));
    } finally {
      setPosting(false);
      // Keep typing the next memo — but never focus a pane swiped away in the
      // meantime: focusing makes the browser scroll the pager to the field.
      if (canFocus()) inputRef.current?.focus({ preventScroll: true });
    }
  };

  /** Loads a memo into the composer to edit it. */
  const startEdit = (item: E) => {
    const memo = splitMemo(item.text);
    attachments.forEach(discard);
    setError(null);
    setEditing(item);
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
    reset();
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
      if (canFocus()) inputRef.current?.focus({ preventScroll: true });
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

  const voiceState: VoiceState = recorder.recording ? "recording" : transcribing ? "transcribing" : "idle";

  return {
    inputRef,
    input,
    setInput,
    attachments,
    editing,
    posting,
    error,
    setError,
    memoText,
    canSend,
    attach,
    removeAttachment,
    submit,
    startEdit,
    cancelEdit,
    /** MemoComposer's `voice` prop. */
    voice: {
      state: voiceState,
      elapsedMs: recorder.elapsedMs,
      onStart: () => void startVoice(),
      onStop: () => void stopVoice(),
      onCancel: cancelVoice,
    },
    /** A failed transcription can be retried (or its clip discarded). */
    canRetryTranscription: failedClip !== null,
    retryTranscription: () => {
      if (failedClip) void transcribe(failedClip);
    },
    discardFailedClip: () => {
      setFailedClip(null);
      setError(null);
    },
  };
}

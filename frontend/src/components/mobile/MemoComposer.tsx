"use client";

import { ArrowUp, Check, FileText, ImagePlus, Loader2, Maximize2, Mic, Minimize2, Pencil, Trash2, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { NoteRef } from "./MemoBubble";

export type Attachment = {
  key: number;
  /** What the thumbnail shows: the picked file (blob: URL) or the image URL. */
  preview: string;
  /** Server URL once uploaded. */
  url?: string;
  status: "uploading" | "ready" | "error";
  /** Uploaded in this composer session, so removing it deletes the file again. */
  fresh: boolean;
};

// "@query" right before the caret, at the start or after whitespace.
const MENTION_QUERY = /(?:^|\s)@([^\s@[\]]*)$/;
const COMPACT_MAX_HEIGHT = 160;

export type VoiceState = "idle" | "recording" | "transcribing";

/** The composer's wording: what is written, and where it goes. */
export type ComposerLabels = {
  send: string;
  save: string;
  placeholder: string;
  editPlaceholder: string;
  newTitle: string;
  editTitle: string;
  /** The banner while editing: the edited memo's time ("" when it has none). */
  editing: (time: string) => string;
  field: string;
};

const MEMO_LABELS: ComposerLabels = {
  send: "Post to notepad",
  save: "Save memo",
  placeholder: "Write a memo…",
  editPlaceholder: "Edit memo…",
  newTitle: "New memo",
  editTitle: "Edit memo",
  editing: (time) => `Editing the memo from ${time}`,
  field: "Quick note",
};

const formatElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The quick-capture composer: a chat-style bar (Enter posts) that can expand
 * to full screen for longer memos (Enter adds a line; Ctrl/⌘+Enter posts).
 * "@" suggests notes to link ([[Title]]); the image button or pasting attaches
 * images; the mic records a voice memo that is transcribed into the text. The
 * textarea keeps its place in the tree in both layouts, so switching doesn't
 * drop focus (the phone keyboard stays up).
 */
export function MemoComposer({
  value,
  onChange,
  inputRef,
  attachments,
  onAttach,
  onRemoveAttachment,
  fullscreen,
  onFullscreenChange,
  editing,
  onCancelEdit,
  canSend,
  posting,
  onSend,
  suggest,
  keyboardOpen,
  voice,
  labels = MEMO_LABELS,
  allowFullscreen = true,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  attachments: Attachment[];
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (key: number) => void;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
  /** The memo or post being edited (only its time is shown). */
  editing: { time: string } | null;
  onCancelEdit: () => void;
  canSend: boolean;
  posting: boolean;
  onSend: () => void;
  suggest: (query: string) => NoteRef[];
  keyboardOpen: boolean;
  voice: {
    state: VoiceState;
    elapsedMs: number;
    onStart: () => void;
    onStop: () => void;
    onCancel: () => void;
  };
  labels?: ComposerLabels;
  /** False hides the expand button (desktop: the panel is the writing room). */
  allowFullscreen?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const suggestions = mention ? suggest(mention.query) : [];

  // The compact bar grows with the text up to ~6 lines; full screen fills the pane.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (fullscreen) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPACT_MAX_HEIGHT)}px`;
  }, [value, fullscreen, inputRef]);

  const updateMention = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const m = el.value.slice(0, caret).match(MENTION_QUERY);
    setMention(m ? { start: caret - m[1].length - 1, query: m[1] } : null);
    setActive(0);
  };

  const pick = (note: NoteRef) => {
    const el = inputRef.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? value.length;
    const link = `[[${note.title}]] `;
    const pos = mention.start + link.length;
    onChange(value.slice(0, mention.start) + link + value.slice(caret));
    setMention(null);
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(pos, pos);
    });
  };

  // Buttons that must not take focus from the textarea (the phone keyboard
  // stays up) act on pointerdown and prevent it: some mobile browsers drop the
  // click after a prevented pointerdown. Keyboard activation (a click with
  // detail 0) still works.
  const tap = (action: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      action();
    },
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) action();
    },
  });
  const setFullscreen = (next: boolean) => {
    onFullscreenChange(next);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  const sendLabel = editing ? labels.save : labels.send;
  const sendDisabled = !canSend || posting;
  const send = () => {
    if (!sendDisabled) onSend();
  };
  const sendIcon = posting ? (
    <Loader2 size={20} className="animate-spin" />
  ) : editing ? (
    <Check size={20} />
  ) : (
    <ArrowUp size={20} />
  );
  const imageButton = (
    <button
      type="button"
      aria-label="Add images"
      onClick={() => fileRef.current?.click()}
      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
      style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
    >
      <ImagePlus size={20} />
    </button>
  );
  // Recording needs a real tap (onClick): browsers only grant the microphone
  // from a user gesture.
  const micButton = (
    <button
      type="button"
      aria-label="Record a voice memo"
      onClick={voice.onStart}
      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
      style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
    >
      <Mic size={20} />
    </button>
  );
  const recordingVoice = voice.state === "recording";
  const voiceControls = (
    <>
      <button
        type="button"
        aria-label={recordingVoice ? "Discard recording" : "Cancel transcription"}
        {...tap(voice.onCancel)}
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
      >
        {recordingVoice ? <Trash2 size={18} /> : <X size={18} />}
      </button>
      <div
        role="status"
        className="flex h-[42px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl border px-3.5"
        style={{ background: "var(--mob-card)", borderColor: "var(--mob-surface)" }}
      >
        {recordingVoice ? (
          <>
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="text-[15px] tabular-nums" style={{ color: "var(--mob-text)" }}>
              {formatElapsed(voice.elapsedMs)}
            </span>
            <span className="truncate text-sm" style={{ color: "var(--mob-muted)" }}>
              Recording…
            </span>
          </>
        ) : (
          <>
            <Loader2 size={16} className="shrink-0 animate-spin" style={{ color: "var(--mob-muted)" }} />
            <span className="truncate text-sm" style={{ color: "var(--mob-muted)" }}>
              Transcribing…
            </span>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="Stop and transcribe"
        {...tap(voice.onStop)}
        disabled={!recordingVoice}
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-40"
        style={{ background: "var(--mob-accent)", color: "#fff" }}
      >
        <Check size={20} />
      </button>
    </>
  );
  // The compact bar offers the mic where the send button goes while there is
  // nothing to send, like voice messages in chat apps.
  const showMic = !editing && !value.trim() && attachments.length === 0;
  const attachmentStrip = attachments.length > 0 && (
    <div className={`flex gap-2 overflow-x-auto pb-1 ${fullscreen ? "px-4 pt-2" : "mb-2"}`}>
      {attachments.map((a) => (
        <div
          key={a.key}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl"
          style={{ background: "var(--mob-surface)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview / vault image */}
          <img
            src={a.preview}
            alt=""
            className={`h-full w-full object-cover ${a.status === "uploading" ? "opacity-60" : ""}`}
          />
          {a.status === "uploading" && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Loader2 size={18} className="animate-spin text-white" />
            </span>
          )}
          {a.status === "error" && (
            <span className="absolute inset-0 flex items-center justify-center bg-red-500/60 text-[10px] font-semibold text-white">
              Failed
            </span>
          )}
          <button
            type="button"
            aria-label="Remove image"
            {...tap(() => onRemoveAttachment(a.key))}
            className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div
      className={fullscreen ? "absolute inset-0 z-20 flex flex-col" : "shrink-0 px-2 pt-1.5"}
      style={
        fullscreen
          ? { background: "var(--mob-bg)" }
          : {
              background: "var(--mob-bg)",
              paddingBottom: keyboardOpen ? 6 : "calc(env(safe-area-inset-bottom, 0px) + 8px)",
            }
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onAttach(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {fullscreen && (
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
            aria-label="Exit full screen"
            {...tap(() => setFullscreen(false))}
            className="flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-95"
            style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
          >
            <Minimize2 size={18} />
          </button>
          <span className="flex-1 text-lg font-semibold" style={{ color: "var(--mob-text)" }}>
            {editing ? labels.editTitle : labels.newTitle}
          </span>
          <button
            type="button"
            aria-label={sendLabel}
            {...tap(send)}
            disabled={sendDisabled}
            className="flex h-10 items-center gap-1.5 rounded-full px-4 text-[15px] font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--mob-accent)", color: "#fff" }}
          >
            {posting ? <Loader2 size={18} className="animate-spin" /> : null}
            {editing ? "Save" : "Post"}
          </button>
        </div>
      )}

      {editing && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs ${fullscreen ? "mx-3 mt-2" : "mb-2"}`}
          style={{ background: "var(--mob-surface)", color: "var(--mob-muted)" }}
        >
          <Pencil size={13} className="shrink-0" />
          <span className="flex-1">{labels.editing(editing.time)}</span>
          <button
            type="button"
            {...tap(onCancelEdit)}
            className="font-medium"
            style={{ color: "var(--mob-accent)" }}
          >
            Cancel
          </button>
        </div>
      )}

      {mention && (
        <ul
          role="listbox"
          aria-label="Link a note"
          className={`overflow-hidden rounded-xl border shadow-sm ${fullscreen ? "mx-3 mt-2" : "mb-2"}`}
          style={{ background: "var(--mob-card)", borderColor: "var(--mob-surface)" }}
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-2 text-xs" style={{ color: "var(--mob-muted)" }}>
              No note matches “{mention.query}”
            </li>
          ) : (
            suggestions.map((note, i) => (
              <li key={`${note.vaultId ?? "journal"}-${note.id}`}>
                {/* Acts on pointerdown: a tap must not blur the textarea first. */}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pick(note);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
                  style={{
                    background: i === active ? "color-mix(in oklab, var(--mob-accent) 12%, transparent)" : undefined,
                  }}
                >
                  <FileText size={16} className="shrink-0" style={{ color: "var(--mob-muted)" }} />
                  <span className="min-w-0 flex-1 truncate text-[15px]" style={{ color: "var(--mob-text)" }}>
                    {note.title}
                  </span>
                  <span className="max-w-[45%] shrink-0 truncate text-xs" style={{ color: "var(--mob-muted)" }}>
                    {note.where}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {!fullscreen && attachmentStrip}

      {/* Messenger layout (Signal-like): one rounded pill holds the image
          button, the text, full screen and (while empty) the mic; the round
          send button sits next to it. */}
      <div className={fullscreen ? "flex min-h-0 flex-1 flex-col" : "relative flex items-end gap-1.5"}>
        <div
          className={fullscreen ? "relative min-h-0 flex-1" : "relative flex min-w-0 flex-1 items-end rounded-[22px] px-1"}
          style={fullscreen ? undefined : { background: "var(--mob-surface)", minHeight: 44 }}
        >
          {!fullscreen && (
            <PillIcon label="Add images" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={21} />
            </PillIcon>
          )}
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              updateMention(e.target);
            }}
            onSelect={(e) => updateMention(e.currentTarget)}
            onBlur={() => setMention(null)}
            onKeyDown={(e) => {
              if (mention && suggestions.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  setActive((i) => (i + step + suggestions.length) % suggestions.length);
                  return;
                }
                if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  pick(suggestions[active] ?? suggestions[0]);
                  return;
                }
              }
              if (mention && e.key === "Escape") {
                e.preventDefault();
                setMention(null);
                return;
              }
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
              if (fullscreen && !(e.metaKey || e.ctrlKey)) return; // a new line
              e.preventDefault();
              onSend();
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (files.length === 0) return;
              e.preventDefault();
              onAttach(files);
            }}
            rows={1}
            enterKeyHint={fullscreen ? "enter" : "send"}
            placeholder={editing ? labels.editPlaceholder : labels.placeholder}
            aria-label={labels.field}
            className={
              fullscreen
                ? "block h-full w-full resize-none bg-transparent px-4 py-3 text-[16px] leading-relaxed outline-none"
                : "block min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-1 py-[11px] text-[16px] leading-[22px] outline-none"
            }
            style={{ color: "var(--mob-text)" }}
          />
          {!fullscreen && allowFullscreen && (
            <PillIcon label="Write in full screen" tapHandlers={tap(() => setFullscreen(true))}>
              <Maximize2 size={18} />
            </PillIcon>
          )}
          {!fullscreen && showMic && (
            <PillIcon label="Record a voice memo" onClick={voice.onStart}>
              <Mic size={21} />
            </PillIcon>
          )}
        </div>
        {!fullscreen && (
          <button
            type="button"
            aria-label={sendLabel}
            {...tap(send)}
            disabled={sendDisabled}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-40"
            style={{ background: "var(--mob-accent)", color: "#fff" }}
          >
            {sendIcon}
          </button>
        )}
        {!fullscreen && voice.state !== "idle" && (
          <div className="absolute inset-0 z-10 flex items-end gap-2" style={{ background: "var(--mob-bg)" }}>
            {voiceControls}
          </div>
        )}
      </div>

      {fullscreen && attachmentStrip}
      {fullscreen && (
        <div
          className="flex shrink-0 items-center gap-3 px-3 pt-2"
          style={{
            borderTop: "1px solid var(--mob-surface)",
            paddingBottom: keyboardOpen ? 8 : "calc(env(safe-area-inset-bottom, 0px) + 10px)",
          }}
        >
          {voice.state === "idle" ? (
            <>
              {imageButton}
              {micButton}
              <span className="text-xs" style={{ color: "var(--mob-muted)" }}>
                @ links a note
              </span>
            </>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2">{voiceControls}</div>
          )}
        </div>
      )}
    </div>
  );
}

// An icon button inside the composer pill (no background of its own).
function PillIcon({
  label,
  onClick,
  tapHandlers,
  children,
}: {
  label: string;
  onClick?: () => void;
  tapHandlers?: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      {...tapHandlers}
      className="mb-[4px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90"
      style={{ color: "var(--mob-muted)" }}
    >
      {children}
    </button>
  );
}

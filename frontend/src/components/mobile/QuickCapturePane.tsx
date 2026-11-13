"use client";

import { ArrowUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, isCollectionsVault } from "@/lib/api";
import { localDateKey } from "@/lib/note-utils";
import { appendNotepadEntry, NOTEPAD_TITLE, parseNotepad } from "@/lib/notepad";
import { useNotes } from "@/lib/notes-context";
import { useVisualViewport } from "./useVirtualKeyboardInset";

// Quick capture: a chat-style pad in the dashboard's right pane (swipe left
// on the dashboard). Enter posts the text into the "Notepad" note — created
// on the first post — without leaving the dashboard; Shift+Enter (hardware
// keyboards) adds a line break.
export default function QuickCapturePane({ focused, onBack }: { focused: boolean; onBack: () => void }) {
  const { vaults, activeVault, allVaultData, refresh, refreshNoteBody } = useNotes();
  const vv = useVisualViewport();
  const [body, setBody] = useState("");
  const [input, setInput] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const entries = useMemo(() => parseNotepad(body), [body]);

  // Newest entry at the bottom, like a chat.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries.length, focused, vv.isKeyboardOpen]);

  const post = async () => {
    const text = input.trim();
    if (!text || posting) return;
    setPosting(true);
    setError(null);
    setInput("");
    let previous = body;
    try {
      let target = notepad;
      if (target) {
        // Append to the latest version, not this pane's copy, so edits made
        // in the editor or on another device are kept.
        previous = (await api.get(target.vaultId, target.id)).body;
      } else {
        const vault =
          activeVault && !isCollectionsVault(activeVault)
            ? activeVault
            : vaults.find((v) => !isCollectionsVault(v));
        if (!vault) throw new Error("No vault to keep the notepad in");
        const created = await api.create(vault.id, { title: NOTEPAD_TITLE });
        target = { vaultId: vault.id, id: created.id };
        previous = created.body;
      }
      const next = appendNotepadEntry(previous, text);
      setBody(next);
      await api.update(target.vaultId, target.id, { title: NOTEPAD_TITLE, body: next });
      void refreshNoteBody(target.id);
      if (!notepad) void refresh();
    } catch (e) {
      setBody(previous);
      setInput((current) => current || text);
      setError(e instanceof Error ? e.message : "Couldn't save to the notepad");
    } finally {
      setPosting(false);
      inputRef.current?.focus();
    }
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
        className="flex min-h-0 flex-col"
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
                Type below and press Enter — each entry is added to &quot;{NOTEPAD_TITLE}&quot; with the time.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {entries.map((entry, i) => (
                <li key={`${entry.day}-${entry.time}-${i}`} className="flex flex-col items-end">
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
                  <span
                    className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3 py-2 text-[15px] leading-snug"
                    style={{ background: "var(--mob-accent)", color: "#fff" }}
                  >
                    {entry.text}
                  </span>
                  <span className="mr-1 mt-0.5 text-[10px] tabular-nums" style={{ color: "var(--mob-muted)" }}>
                    {entry.time}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {error && (
          <div className="px-3 pb-1 text-xs" style={{ color: "#f87171" }}>
            {error}
          </div>
        )}

        <div
          className="flex shrink-0 items-end gap-2 px-3 pt-2"
          style={{
            borderTop: "1px solid var(--mob-surface)",
            paddingBottom: vv.isKeyboardOpen ? 8 : "calc(env(safe-area-inset-bottom, 0px) + 10px)",
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void post();
              }
            }}
            rows={1}
            enterKeyHint="send"
            placeholder="Write something…"
            aria-label="Quick note"
            className="max-h-32 min-h-[42px] flex-1 resize-none rounded-2xl border px-3.5 py-2.5 text-[15px] outline-none"
            style={{ background: "var(--mob-card)", color: "var(--mob-text)", borderColor: "var(--mob-surface)" }}
          />
          <button
            type="button"
            aria-label="Post to notepad"
            onClick={() => void post()}
            disabled={!input.trim() || posting}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-40"
            style={{ background: "var(--mob-accent)", color: "#fff" }}
          >
            <ArrowUp size={20} />
          </button>
        </div>
      </div>
    </section>
  );
}

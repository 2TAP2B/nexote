"use client";

import { Check, FileText, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

// Milkdown/ProseMirror need the DOM, so load the editor client-side only.
const MilkdownEditorWrapper = dynamic(
  () => import("@/components/MilkdownEditor"),
  { ssr: false },
);

export default function EditorPane() {
  const { activeNote, activeId, save, saving, setDraft } = useNotes();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Track the latest note content so we can tell editor-emitted changes apart
  // from a freshly loaded note (avoid clobbering on swap).
  const skipNextChange = useRef(false);

  // When the active note changes, reset local state from the cached payload.
  useEffect(() => {
    if (!activeNote) {
      setTitle("");
      setBody("");
      setLoadedKey(null);
      return;
    }
    setTitle(activeNote.title);
    setBody(activeNote.body);
    setLoadedKey(activeNote.id);
    skipNextChange.current = true;
  }, [activeNote]);

  const handleEditorChange = useCallback((markdown: string) => {
    if (skipNextChange.current) {
      skipNextChange.current = false;
      return;
    }
    setBody(markdown);
  }, []);

  // Keep the provider's draft ref in sync so the Cmd/Ctrl+S shortcut saves
  // the latest values without waiting for the debounce.
  useEffect(() => {
    setDraft({ title, body });
  }, [title, body, setDraft]);

  // Debounced autosave. Any change to title or body schedules a save 800ms
  // later; a subsequent change resets the timer.
  useEffect(() => {
    if (!activeId || loadedKey !== activeId) return;
    // Don't save before the editor has been hydrated with the loaded note.
    if (skipNextChange.current) return;

    const t = setTimeout(() => {
      void save(activeId, { title, body });
    }, 800);
    return () => clearTimeout(t);
  }, [activeId, loadedKey, title, body, save]);

  if (!activeNote) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background p-6">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <FileText className="h-6 w-6" />
          </div>
          <p className="text-sm">Select a note or create a new one.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-center gap-3 border-b border-border px-4 py-3 md:px-8">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          className="w-full max-w-md bg-transparent text-center text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
        />
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 text-primary" />
              Saved
            </>
          )}
        </span>
      </div>

      {/* Editor container: responsive padding/margin so the editor never
          overlaps the sidebar or screen edges. The inner .ProseMirror has its
          own measure cap (see globals.css); this wrapper adds breathing room
          and scrolls vertically. */}
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-10 md:py-10">
        <div className="mx-auto w-full max-w-3xl">
          <MilkdownEditorWrapper
            key={activeNote.id}
            defaultValue={activeNote.body}
            onChange={handleEditorChange}
          />
        </div>
      </div>
    </main>
  );
}
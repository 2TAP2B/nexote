"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

// Milkdown/ProseMirror need the DOM, so load the editor client-side only.
const MilkdownEditorWrapper = dynamic(
  () => import("@/components/MilkdownEditor"),
  { ssr: false },
);

export default function EditorPane() {
  const { selected, selectedId, save, saving, setDraft } = useNotes();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Track the latest note content so we can tell editor-emitted changes apart
  // from a freshly loaded note (avoid clobbering on swap).
  const skipNextChange = useRef(false);

  // When the selected note changes, reset local state from the server payload.
  useEffect(() => {
    if (!selected) {
      setTitle("");
      setBody("");
      setLoadedKey(null);
      return;
    }
    setTitle(selected.title);
    setBody(selected.body);
    setLoadedKey(selected.id);
    skipNextChange.current = true;
  }, [selected]);

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
    if (!selectedId || loadedKey !== selectedId) return;
    // Don't save before the editor has been hydrated with the loaded note.
    if (skipNextChange.current) return;

    const t = setTimeout(() => {
      void save(selectedId, { title, body });
    }, 800);
    return () => clearTimeout(t);
  }, [selectedId, loadedKey, title, body, save]);

  if (!selected) {
    return (
      <main className="flex flex-1 items-center justify-center text-muted-foreground">
        <p className="text-sm">Select a note or create a new one.</p>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:px-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          className="min-w-0 flex-1 bg-transparent text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground md:text-lg"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {saving ? "Saving…" : "Saved"}
        </span>
      </div>

      {/* Editor fills the available width; the inner max-width cap is removed
          so long lines and wide tables use the full pane. */}
      <div className="flex-1 overflow-y-auto">
        <MilkdownEditorWrapper
          key={selected.id}
          defaultValue={selected.body}
          onChange={handleEditorChange}
        />
      </div>
    </main>
  );
}
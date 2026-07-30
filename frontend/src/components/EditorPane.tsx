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
  const { selected, selectedId, save, saving } = useNotes();

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
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          className="flex-1 bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground"
        />
        <span className="text-xs text-muted-foreground">
          {saving ? "Saving…" : "Saved"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <MilkdownEditorWrapper
            key={selected.id}
            defaultValue={selected.body}
            onChange={handleEditorChange}
          />
        </div>
      </div>
    </main>
  );
}
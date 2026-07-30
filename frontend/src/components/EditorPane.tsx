"use client";

import { FileText, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

const MilkdownEditorWrapper = dynamic(
  () => import("@/components/MilkdownEditor"),
  { ssr: false },
);

export default function EditorPane() {
  const { activeNote, activeId, save, saving, setDraft } = useNotes();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const skipNextChange = useRef(false);

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

  useEffect(() => {
    setDraft({ title, body });
  }, [title, body, setDraft]);

  useEffect(() => {
    if (!activeId || loadedKey !== activeId) return;
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
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: "var(--muted)" }}>
            <FileText className="h-6 w-6" />
          </div>
          <p className="text-sm">Select a note or create a new one.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-center border-b border-border relative">
        <div className="flex items-center justify-center flex-1 px-4" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
            className="max-w-[400px] bg-transparent text-center text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
          />
        </div>
        <span className="absolute right-4 top-1/2 -translate-y-1/2 shrink-0 text-xs text-muted-foreground/50">
          {saving ? (
            <>
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              Saving…
            </>
          ) : (
            "Saved"
          )}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div>
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
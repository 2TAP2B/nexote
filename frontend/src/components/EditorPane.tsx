"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Ellipsis,
  FileText,
  Loader2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

const MilkdownEditorWrapper = dynamic(
  () => import("@/components/MilkdownEditor"),
  { ssr: false },
);

function extractH1(body: string): string | null {
  const m = body.match(/^# (.+)$/m);
  return m ? m[1].trim() : null;
}

function replaceOrAddH1(body: string, title: string): string {
  const h1 = `# ${title}`;
  if (/^# .+$/m.test(body)) {
    return body.replace(/^# .+$/m, h1);
  }
  return body ? `${h1}\n\n${body}` : h1;
}

export default function EditorPane() {
  const { activeNote, activeId, save, saving, setDraft } = useNotes();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyKey, setBodyKey] = useState(0);

  const skipNextChange = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const prevBodyRef = useRef("");

  useEffect(() => {
    if (!activeNote) {
      setTitle("");
      setBody("");
      setLoadedKey(null);
      return;
    }

    const sameNote = activeNote.id === loadedKey;
    const bodyChanged = activeNote.body !== prevBodyRef.current;
    prevBodyRef.current = activeNote.body;

    setTitle(activeNote.title);
    setBody(activeNote.body);
    setLoadedKey(activeNote.id);
    skipNextChange.current = true;

    if (sameNote && bodyChanged) {
      setBodyKey((k) => k + 1);
    }
  }, [activeNote]);

  const handleEditorChange = useCallback((markdown: string) => {
    if (skipNextChange.current) {
      skipNextChange.current = false;
      return;
    }
    setBody(markdown);
    const h1 = extractH1(markdown);
    if (h1) {
      setTitle(h1);
    }
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

  const startEditingTitle = () => {
    setTitleDraft(title);
    setEditingTitle(true);
    requestAnimationFrame(() => titleInputRef.current?.focus());
  };

  const commitTitle = async () => {
    if (!editingTitle) return;
    const t = titleDraft.trim() || "Untitled";
    if (t !== title && activeId) {
      const newBody = replaceOrAddH1(body, t);
      setTitle(t);
      setBody(newBody);
      prevBodyRef.current = newBody;
      setBodyKey((k) => k + 1);
      await save(activeId, { title: t, body: newBody }).catch(() => {});
    }
    setEditingTitle(false);
  };

  if (!activeNote) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background p-6">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--muted)" }}
          >
            <FileText className="h-6 w-6" />
          </div>
          <p className="text-sm">Select a note or create a new one.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col min-h-0 bg-background">
      {/* Title bar: nav arrows, breadcrumb, actions */}
      <div
        className="flex shrink-0 items-center px-4"
        style={{ height: 36, borderBottom: "1px solid var(--border)" }}
      >
        {/* Left: nav arrows */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Go back"
            title="Go back"
            className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            aria-label="Go forward"
            title="Go forward"
            className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
          >
            <ArrowRight size={15} />
          </button>
        </div>

        {/* Center: breadcrumb / inline title edit */}
        <div className="flex flex-1 items-center justify-center min-w-0">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              onBlur={commitTitle}
              className="min-w-0 rounded border border-ring bg-background px-1 text-xs text-foreground outline-none"
              style={{ maxWidth: 400 }}
            />
          ) : (
            <span
              className="truncate text-xs text-muted-foreground/60 cursor-text"
              style={{ maxWidth: 400 }}
              onClick={startEditingTitle}
              title="Click to rename"
            >
              {activeNote.path ? `${activeNote.path} / ` : ""}{title}
            </span>
          )}
        </div>

        {/* Right: reading view + 3-dot menu */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground/40">
            {saving ? (
              <Loader2 className="inline h-3 w-3 animate-spin" />
            ) : (
              "Saved"
            )}
          </span>
          <button
            type="button"
            aria-label="Reading view"
            title="Reading view"
            className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
          >
            <BookOpen size={15} />
          </button>
          <button
            type="button"
            aria-label="More actions"
            title="More actions"
            className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
          >
            <Ellipsis size={15} />
          </button>
        </div>
      </div>

      {/* Editor — .milkdown handles its own scrolling */}
      <div className="min-h-0 flex-1 flex flex-col">
        <MilkdownEditorWrapper
          key={`${activeNote.id}-${bodyKey}`}
          defaultValue={activeNote.body}
          onChange={handleEditorChange}
        />
      </div>
    </main>
  );
}

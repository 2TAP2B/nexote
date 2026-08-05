"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Ellipsis,
  FileText,
  Loader2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";
import WelcomeDashboard from "@/components/WelcomeDashboard";
import type { MilkdownEditorHandle } from "@/components/MilkdownEditor";

const MilkdownEditorWrapper = dynamic<
  React.ComponentPropsWithoutRef<typeof import("@/components/MilkdownEditor").default> & {
    ref?: React.Ref<MilkdownEditorHandle>;
  }
>(() => import("@/components/MilkdownEditor"), { ssr: false });

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
  const { activeNote, activeId, openTabs, openTab, save, saving, setDraft, isDashboardActive, bookmarks, toggleBookmark, settings } =
    useNotes();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyKey, setBodyKey] = useState(0);

  const skipNextChange = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<MilkdownEditorHandle>(null);
  const prevBodyRef = useRef("");
  const ownSaveCountRef = useRef(0);

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

    // If this update came from our own save, don't remount the editor or
    // overwrite local body state — the user may have continued typing while
    // the async save was in flight.
    if (ownSaveCountRef.current > 0) {
      ownSaveCountRef.current--;
      setTitle(activeNote.title);
      setLoadedKey(activeNote.id);
      return;
    }

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
    if (!settings.autosave) return;

    const t = setTimeout(() => {
      ownSaveCountRef.current++;
      prevBodyRef.current = body;
      void save(activeId, { title, body });
    }, 800);
    return () => clearTimeout(t);
  }, [activeId, loadedKey, title, body, save, settings.autosave]);

  const startEditingTitle = () => {
    setTitleDraft(title);
    setEditingTitle(true);
    requestAnimationFrame(() => titleInputRef.current?.focus());
  };

  // When a new note is created, focus the editor and select the H1 text so
  // the user can immediately rename it by typing, or press Enter to move
  // past it and start writing the body.
  useEffect(() => {
    const onRenameNew = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          editorRef.current?.selectHeading();
        });
      });
    };
    const onFocusEnd = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          editorRef.current?.focusEnd();
        });
      });
    };
    window.addEventListener("nexote:rename-new-note", onRenameNew);
    window.addEventListener("nexote:focus-note-end", onFocusEnd);
    return () => {
      window.removeEventListener("nexote:rename-new-note", onRenameNew);
      window.removeEventListener("nexote:focus-note-end", onFocusEnd);
    };
  }, []);

  // Escape in the editor returns focus to the notetree.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only act when the editor (or something inside it) is focused.
      const el = document.activeElement as HTMLElement | null;
      if (!el) return;
      const inEditor =
        el.isContentEditable ||
        el.closest(".milkdown") ||
        el.closest(".ProseMirror") ||
        el.closest("[data-milkdown-root]") ||
        el.closest("[contenteditable]");
      if (inEditor) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("nexote:focus-tree"));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [activeNote]);

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

  if (isDashboardActive || !activeNote) {
    return <WelcomeDashboard />;
  }

  // Cycle to the previous / next open tab.
  const goPrevTab = () => {
    if (!activeId || openTabs.length < 2) return;
    const idx = openTabs.indexOf(activeId);
    if (idx < 0) return;
    const prev = idx <= 0 ? openTabs.length - 1 : idx - 1;
    void openTab(openTabs[prev]);
  };
  const goNextTab = () => {
    if (!activeId || openTabs.length < 2) return;
    const idx = openTabs.indexOf(activeId);
    if (idx < 0) return;
    const next = idx >= openTabs.length - 1 ? 0 : idx + 1;
    void openTab(openTabs[next]);
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col min-h-0 bg-background">
      {/* Title bar: nav arrows, breadcrumb, actions */}
      <div
        className="flex shrink-0 items-center px-4"
        style={{ height: 36, borderBottom: "1px solid var(--border)" }}
      >
        {/* Left: nav arrows — cycle through open tabs */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous tab"
            title="Previous tab"
            onClick={goPrevTab}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            aria-label="Next tab"
            title="Next tab"
            onClick={goNextTab}
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

        {/* Right: save status, bookmark, reading view + 3-dot menu */}
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
            aria-label={bookmarks.has(activeNote.id) ? "Remove bookmark" : "Add bookmark"}
            title={bookmarks.has(activeNote.id) ? "Remove bookmark" : "Add bookmark"}
            onClick={() => void toggleBookmark(activeNote.id)}
            className="flex h-7 w-7 items-center justify-center transition-colors rounded hover:bg-white/5"
            style={{
              color: bookmarks.has(activeNote.id)
                ? "var(--primary)"
                : "var(--muted-foreground)",
              opacity: bookmarks.has(activeNote.id) ? 1 : 0.5,
            }}
          >
            {bookmarks.has(activeNote.id) ? (
              <BookmarkCheck size={15} fill="currentColor" />
            ) : (
              <Bookmark size={15} />
            )}
          </button>
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

      {/* Editor — the wrapper scrolls (native page-style scrollbar) */}
      <div
        className="nexote-editor-scroll min-h-0 flex-1 flex flex-col overflow-y-auto"
        style={{ "--editor-font-size": `${settings.editorFontSize}px` } as React.CSSProperties}
      >
        <MilkdownEditorWrapper
          ref={editorRef}
          key={`${activeNote.id}-${bodyKey}`}
          defaultValue={activeNote.body}
          onChange={handleEditorChange}
        />
      </div>
    </main>
  );
}

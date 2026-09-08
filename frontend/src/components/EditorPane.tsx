"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Braces,
  Copy,
  Edit3,
  Ellipsis,
  FileText,
  History,
  ListTree,
  Loader2,
  Sparkles,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";
import { generateNoteTitle } from "@/lib/ai";
import { extractTitleHeading, replaceOrAddTitleHeading } from "@/lib/note-utils";
import ContextMenu from "@/components/ContextMenu";
import AICommandPanel from "@/components/AICommandPanel";
import CollectionItemHeader from "@/components/CollectionItemHeader";
import NoteHistoryPanel from "@/components/NoteHistoryPanel";
import RawMarkdownTextarea from "@/components/RawMarkdownTextarea";
import TocList, { TOC_HEADING_SELECTOR } from "@/components/TocList";
import WelcomeDashboard from "@/components/WelcomeDashboard";
import type { MilkdownEditorHandle } from "@/components/MilkdownEditor";
import { useTocHeadings } from "@/components/useTocHeadings";
import { useTocScrollSpy } from "@/components/useTocScrollSpy";

const MilkdownEditorWrapper = dynamic<
  React.ComponentPropsWithoutRef<typeof import("@/components/MilkdownEditor").default> & {
    ref?: React.Ref<MilkdownEditorHandle>;
  }
>(() => import("@/components/MilkdownEditor"), { ssr: false });

export default function EditorPane({
  tocOpen,
  onToggleToc,
  onCloseCollectionItem,
}: {
  tocOpen: boolean;
  onToggleToc: () => void;
  onCloseCollectionItem?: () => void;
}) {
  const { activeNote, activeId, activeVault, openTabs, openTab, save, saving, setDraft, isDashboardActive, bookmarks, toggleBookmark, settings, isJournalNote, copyNote, refreshNoteBody } =
    useNotes();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyKey, setBodyKey] = useState(0);
  const [overflowMenu, setOverflowMenu] = useState<{ x: number; y: number } | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const skipNextChange = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<MilkdownEditorHandle>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const prevBodyRef = useRef("");
  const ownSaveCountRef = useRef(0);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Stable identity for the editor's AI config so the Milkdown editor only
  // rebuilds when the AI settings actually change, not on every render.
  const aiConfig = useMemo(
    () => ({
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
    }),
    [settings.aiBaseUrl, settings.aiApiKey, settings.aiModel],
  );

  useEffect(() => {
    if (!activeNote) {
      setTitle("");
      setBody("");
      setLoadedKey(null);
      setRawMode(false);
      return;
    }

    const sameNote = activeNote.id === loadedKey;
    const bodyChanged = activeNote.body !== prevBodyRef.current;
    prevBodyRef.current = activeNote.body;

    // Each note opens in the rendered view; the raw-mode toggle is per-note.
    if (!sameNote) setRawMode(false);

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

    // Crepe does not always emit a post-mount markdown update (e.g. an empty
    // or unchanged doc), so skipNextChange could stay set forever and swallow
    // the user's first real edit. Release it right after mount: the redundant
    // initial save is avoided while later emissions save normally.
    const releaseSkip = window.setTimeout(() => {
      skipNextChange.current = false;
    }, 300);

    if (sameNote && bodyChanged) {
      setBodyKey((k) => k + 1);
    }
    return () => window.clearTimeout(releaseSkip);
  }, [activeNote]);

  const handleEditorChange = useCallback((markdown: string) => {
    if (skipNextChange.current) {
      skipNextChange.current = false;
      return;
    }
    setBody(markdown);
    const heading = extractTitleHeading(markdown);
    if (heading) {
      setTitle(heading);
    }
  }, []);

  useEffect(() => {
    setDraft({ title, body });
  }, [title, body, setDraft]);

  // Table of contents: mirror the editor's headings into the docked panel and
  // highlight the section currently in view while scrolling.
  const tocNoteId = activeNote?.id ?? "";
  const tocEnabled = Boolean(tocOpen && !rawMode && activeNote);
  const { headings: tocHeadings, request: requestToc } = useTocHeadings(tocNoteId, tocEnabled);
  const activeTocIndex = useTocScrollSpy({
    containerSelector: ".nexote-editor-scroll",
    headingSelector: TOC_HEADING_SELECTOR,
    headings: tocHeadings,
    enabled: tocEnabled,
    offset: 72,
  });

  // Re-ask whenever the panel opens, the active note changes, or the editor
  // re-mounts (raw-mode round-trip); the editor always re-broadcasts.
  useEffect(() => {
    if (tocEnabled) requestToc();
  }, [tocEnabled, requestToc, tocNoteId]);

  const selectTocHeading = (index: number) => {
    window.dispatchEvent(new CustomEvent("nexote:toc-jump", { detail: { index } }));
  };

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
      const newBody = replaceOrAddTitleHeading(body, t);
      setTitle(t);
      setBody(newBody);
      prevBodyRef.current = newBody;
      setBodyKey((k) => k + 1);
      await save(activeId, { title: t, body: newBody }).catch(() => {});
    }
    setEditingTitle(false);
  };

  const handleGenerateTitle = async () => {
    if (!activeId) return;
    try {
      const aiTitle = await generateNoteTitle(aiConfig, body);
      if (!aiTitle || aiTitle === title) return;
      const newBody = replaceOrAddTitleHeading(body, aiTitle);
      setTitle(aiTitle);
      setBody(newBody);
      prevBodyRef.current = newBody;
      setBodyKey((k) => k + 1);
      await save(activeId, { title: aiTitle, body: newBody }).catch(() => {});
    } catch (e) {
      console.error("[nexote-ai]", e instanceof Error ? e.message : String(e));
    }
  };

  if (isDashboardActive || !activeNote) {
    return <WelcomeDashboard />;
  }

  // Switch to the raw markdown textarea, caret at the end.
  const toggleToRaw = () => {
    setRawMode(true);
    // The TOC mirrors the editor's headings; with the editor unmounted it has
    // no live source, so drop the stale outline.
    window.dispatchEvent(new CustomEvent("nexote:toc-clear"));
    requestAnimationFrame(() => {
      const el = rawTextareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  };

  // Flush the raw edits to the server, then remount the rendered editor so it
  // shows exactly what was typed (the remount reads activeNote.body, which is
  // updated by the save). skipNextChange swallows the remount's markdown
  // emission, like an initial mount.
  const toggleToRendered = async () => {
    if (!activeId) return;
    ownSaveCountRef.current++;
    prevBodyRef.current = body;
    skipNextChange.current = true;
    await save(activeId, { title, body }).catch(() => {});
    setBodyKey((k) => k + 1);
    setRawMode(false);
    window.setTimeout(() => {
      skipNextChange.current = false;
    }, 300);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => editorRef.current?.focusEnd());
    });
  };

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

  const isCollectionItem = activeNote?.type === "collection-item";

  return (
    <main className="flex min-w-0 flex-1 flex-col min-h-0 bg-background">
      {/* Title bar: nav arrows, breadcrumb, actions */}
      <div
        className="flex shrink-0 items-center px-4"
        style={{ height: 36, borderBottom: "1px solid var(--border)" }}
      >
        {/* Collection items: minimal bar with a close X to return to gallery */}
        {isCollectionItem ? (
          <>
            <button
              type="button"
              aria-label="Close collection item"
              title="Back to collection"
              onClick={onCloseCollectionItem}
              className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
            >
              <X size={15} />
            </button>
            <span
              className="ml-2 truncate text-xs text-muted-foreground/60"
              style={{ maxWidth: 400 }}
            >
              {activeNote.path ? `${activeNote.path} / ` : ""}{title}
            </span>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground/40">
              {saving ? (
                <Loader2 className="inline h-3 w-3 animate-spin" />
              ) : (
                "Saved"
              )}
            </span>
          </>
        ) : (
        <>
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
            aria-label={rawMode ? "Rendered view" : "Raw markdown"}
            title={rawMode ? "Rendered view" : "Raw markdown"}
            onClick={() => (rawMode ? void toggleToRendered() : toggleToRaw())}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
          >
            {rawMode ? <BookOpen size={15} /> : <Braces size={15} />}
          </button>
          <button
            type="button"
            aria-label="Note history"
            title="Note history"
            onClick={() => setHistoryOpen(true)}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
          >
            <History size={15} />
          </button>
          <button
            type="button"
            aria-label={tocOpen ? "Hide table of contents" : "Show table of contents"}
            title={tocOpen ? "Hide table of contents" : "Show table of contents"}
            onClick={onToggleToc}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
            style={tocOpen ? { color: "var(--primary)" } : undefined}
          >
            <ListTree size={15} />
          </button>
          <button
            type="button"
            aria-label="More actions"
            title="More actions"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setOverflowMenu({ x: r.right, y: r.bottom + 4 });
            }}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground rounded hover:bg-white/5"
          >
            <Ellipsis size={15} />
          </button>
        </div>
        </>
        )}
      </div>

      {overflowMenu && activeNote && (
        <ContextMenu
          x={overflowMenu.x}
          y={overflowMenu.y}
          onClose={() => setOverflowMenu(null)}
          items={[
            {
              label: "Open in new tab",
              icon: <SquareArrowOutUpRight className="h-4 w-4" />,
              onClick: () => void openTab(activeNote.id),
            },
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Make a copy",
              icon: <Copy className="h-4 w-4" />,
              onClick: () => void copyNote(activeNote.id),
            },
            {
              label: bookmarks.has(activeNote.id) ? "Remove bookmark" : "Add bookmark",
              icon: bookmarks.has(activeNote.id)
                ? <BookmarkCheck className="h-4 w-4" />
                : <Bookmark className="h-4 w-4" />,
              onClick: () => void toggleBookmark(activeNote.id),
            },
            ...(settings.aiBaseUrl.trim()
              ? [{
                  label: "Ask AI…",
                  icon: <Sparkles className="h-4 w-4" />,
                  onClick: () => setAiPanelOpen(true),
                },
                {
                  label: "Generate AI title",
                  icon: <Sparkles className="h-4 w-4" />,
                  onClick: () => void handleGenerateTitle(),
                }]
              : []),
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Rename",
              icon: <Edit3 className="h-4 w-4" />,
              onClick: startEditingTitle,
            },
          ]}
        />
      )}

      {/* Editor — the wrapper scrolls (native page-style scrollbar); the
          table-of-contents panel docks to its right when enabled. */}
      <div className="flex min-h-0 flex-1">
        <div
          className={
            "nexote-editor-scroll min-h-0 flex-1 overflow-y-auto" +
            (activeNote?.type === "collection-item" ? " has-collection-header" : "")
          }
          style={{ "--editor-font-size": `${settings.editorFontSize}px` } as React.CSSProperties}
        >
          {!rawMode && <CollectionItemHeader note={activeNote} />}
          {rawMode ? (
            <RawMarkdownTextarea
              ref={rawTextareaRef}
              value={body}
              onChange={handleEditorChange}
              fontSize={settings.editorFontSize}
            />
          ) : (
            <MilkdownEditorWrapper
              ref={editorRef}
              key={`${activeNote.id}-${bodyKey}`}
              defaultValue={activeNote.body}
              onChange={handleEditorChange}
              aiConfig={aiConfig}
              vaultId={isJournalNote(activeNote.id) ? "journal" : activeVault?.id ?? ""}
              noteId={activeNote.id}
              onAskAI={() => setAiPanelOpen(true)}
            />
          )}
        </div>

        {tocOpen && !rawMode && activeNote && (
          <aside
            className="flex w-60 shrink-0 flex-col overflow-hidden"
            style={{ borderLeft: "1px solid var(--border)", background: "var(--background)" }}
          >
            <div
              className="flex shrink-0 items-center px-3 py-1.5"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <span className="truncate text-sm font-medium" style={{ color: "var(--foreground)" }}>
                Contents
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              <TocList
                variant="desktop"
                headings={tocHeadings}
                activeIndex={activeTocIndex}
                onSelect={selectTocHeading}
              />
            </div>
          </aside>
        )}
      </div>

      {aiPanelOpen && (
        <AICommandPanel
          editorRef={editorRef}
          onClose={() => setAiPanelOpen(false)}
        />
      )}

      <NoteHistoryPanel
        open={historyOpen}
        noteId={activeNote.id}
        isJournal={isJournalNote(activeNote.id)}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => {
          // Reload the note body so the editor reflects the restored version.
          void refreshNoteBody(activeNote.id);
        }}
      />
    </main>
  );
}

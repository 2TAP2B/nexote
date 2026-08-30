"use client";

import { BookOpen, Braces, Ellipsis, Moon, PanelLeft, Sun } from "lucide-react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MilkdownEditorHandle, AIConfig } from "@/components/MilkdownEditor";
import AICommandPanel from "@/components/AICommandPanel";
import CollectionItemHeader from "@/components/CollectionItemHeader";
import RawMarkdownTextarea from "@/components/RawMarkdownTextarea";
import { useNotes, DASHBOARD_ID } from "@/lib/notes-context";
import type { Note } from "@/lib/api";
import MobileDashboard from "./MobileDashboard";
import MobileEditorToolbar from "./MobileEditorToolbar";
import { useScrollHideChrome } from "./useScrollHideChrome";
import { useVirtualKeyboardInset, useVisualViewport } from "./useVirtualKeyboardInset";

const MilkdownEditorWrapper = dynamic<
  React.ComponentPropsWithoutRef<typeof import("@/components/MilkdownEditor").default> & {
    ref?: React.Ref<MilkdownEditorHandle>;
  }
>(() => import("@/components/MilkdownEditor"), { ssr: false });

// The note title is an H2 (##) heading at the start of the body. Read it back
// from the editor's markdown so the title bar stays in sync while typing.
function extractTitleHeading(body: string): string | null {
  const m = body.match(/^##? (.+)$/m);
  return m ? m[1].trim() : null;
}

type Props = {
  activeNote: Note | null;
  isDashboard: boolean;
  onOpenSidebar: () => void;
  onOverflow: (x: number, y: number) => void;
  onSearch: () => void;
  onNewNote: () => void;
  onOpenSettings: () => void;
  openDaily: () => Promise<void>;
};

export default function MobileNoteView({
  activeNote,
  isDashboard,
  onOpenSidebar,
  onOverflow,
  onSearch,
  onNewNote,
  onOpenSettings,
  openDaily,
}: Props) {
  const { settings, isJournalNote, activeVault, save, setDraft, activeId } =
    useNotes();

  const editorRef = useRef<MilkdownEditorHandle>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  // Height of the on-screen keyboard (0 when hidden). The editor scroll area
  // shrinks by this amount while typing so the caret never scrolls underneath
  // the keyboard — ProseMirror keeps the cursor in view within the smaller
  // viewport.
  const kbdInset = useVirtualKeyboardInset();
  const vv = useVisualViewport();

  const aiConfig = useMemo<AIConfig>(
    () => ({
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
    }),
    [settings.aiBaseUrl, settings.aiApiKey, settings.aiModel],
  );

  // --- Editor body/title sync + autosave (mirrors the desktop EditorPane) ---
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [bodyKey, setBodyKey] = useState(0);
  const [rawMode, setRawMode] = useState(false);
  const loadedKeyRef = useRef<string | null>(null);
  const skipNextChange = useRef(false);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Guards against the autosave response clobbering in-flight typing — same
  // pattern as the desktop EditorPane. When our own save completes and
  // activeNote changes, we DON'T remount the editor or overwrite local body
  // state; the user may have kept typing while the save was in flight.
  const ownSaveCountRef = useRef(0);
  const prevBodyRef = useRef("");

  useEffect(() => {
    if (!activeNote) {
      setTitle("");
      setBody("");
      loadedKeyRef.current = null;
      setRawMode(false);
      return;
    }

    const sameNote = activeNote.id === loadedKeyRef.current;
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
      loadedKeyRef.current = activeNote.id;
      return;
    }

    setTitle(activeNote.title);
    setBody(activeNote.body);
    loadedKeyRef.current = activeNote.id;
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
    if (heading) setTitle(heading);
  }, []);

  // When the keyboard opens the editor viewport shrinks; bring the caret into
  // view once the new height has had a chance to apply (ProseMirror only
  // re-scrolls on the next selection change).
  useEffect(() => {
    if (kbdInset <= 0) return;
    const t = setTimeout(() => {
      const sel = window.getSelection();
      const cont = document.querySelector<HTMLElement>(".mob-editor-scroll");
      if (!sel || !cont || sel.rangeCount === 0) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const bottomLimit = (window.visualViewport?.height ?? window.innerHeight) - 24;
      if (rect.bottom > bottomLimit) {
        cont.scrollTop += rect.bottom - bottomLimit;
      }
    }, 160);
    return () => clearTimeout(t);
  }, [kbdInset]);

  useEffect(() => {
    setDraft({ title, body });
  }, [title, body, setDraft]);

  useEffect(() => {
    if (!activeId || loadedKeyRef.current !== activeId) return;
    if (skipNextChange.current) return;
    if (!settings.autosave) return;

    const t = setTimeout(() => {
      ownSaveCountRef.current++;
      prevBodyRef.current = body;
      void save(activeId, { title, body });
    }, 800);
    return () => clearTimeout(t);
  }, [activeId, title, body, save, settings.autosave]);

  // Switch to the raw markdown textarea, caret at the end.
  const toggleToRaw = () => {
    setRawMode(true);
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

  // Dashboard: render the mobile welcome screen only when the dashboard tab is
  // the active tab. While a note tab is active but its body hasn't loaded yet
  // (e.g. right after a reload), show a lightweight skeleton instead of flashing
  // the dashboard.
  if (isDashboard || !activeNote) {
    if (!isDashboard) {
      return (
        <div className="relative min-h-0 flex-1" style={{ background: "var(--mob-bg)" }}>
          <MobileTopBar onOpenSidebar={onOpenSidebar} onOverflow={onOverflow} />
          <div
            className="flex flex-col gap-2 px-5"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 84px)" }}
          >
            <Skeleton width="40%" height={28} />
            <Skeleton width="90%" height={16} />
            <Skeleton width="95%" height={16} />
            <Skeleton width="80%" height={16} />
          </div>
          {aiPanelOpen && (
            <AICommandPanel
              editorRef={editorRef}
              onClose={() => setAiPanelOpen(false)}
              mobile
            />
          )}
        </div>
      );
    }
    return (
      <div className="relative min-h-0 flex-1" style={{ background: "var(--mob-bg)" }}>
        <MobileTopBar onOpenSidebar={onOpenSidebar} onOverflow={onOverflow} showThemeToggle />
        <div
          className="h-full overflow-y-auto"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 60px)" }}
        >
          <MobileDashboard
            onOpenSearch={onSearch}
            onNewNote={onNewNote}
            onOpenDaily={() => void openDaily()}
            onOpenSettings={onOpenSettings}
          />
      </div>

      {aiPanelOpen && (
        <AICommandPanel
          editorRef={editorRef}
          onClose={() => setAiPanelOpen(false)}
          mobile
        />
      )}
    </div>
  );
}

  return (
    <div
      className="relative min-h-0 flex-1"
      style={{ background: "var(--mob-bg)" }}
    >
      {/* Top bar — fixed overlay that auto-hides on scroll-down, reappears
       * on scroll-up or at top. Transparent so the editor shows through.
       * In raw mode it stays pinned so the toggle-back button is always
       * reachable. */}
      <MobileTopBar onOpenSidebar={onOpenSidebar} onOverflow={onOverflow} rawMode={rawMode} />

      {/* Editor — fullscreen, fills the entire area behind the top bar. The
       * H2 note name is the first line inside the editor (editable). While the
       * touch keyboard is open the scrollport shrinks so the caret stays
       * visible above it. */}
      <div
        className="mob-editor-scroll h-full overflow-y-auto"
        style={
          {
            "--editor-font-size": `${settings.editorFontSize}px`,
            height: kbdInset > 0 ? `calc(100% - ${kbdInset + 24}px)` : undefined,
          } as React.CSSProperties
        }
      >
        {!rawMode && <CollectionItemHeader note={activeNote} mobile />}
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
            mobile
            onAskAI={() => setAiPanelOpen(true)}
          />
        )}
      </div>

      {/* Bottom toolbar — appears after the user taps the editor to set a
       * cursor (or selects text), pinned right above the on-screen keyboard.
       * Replaces the floating Milkdown selection toolbar. Hides on scroll. */}
      <MobileEditorToolbar
        editorRef={editorRef}
        aiAvailable={Boolean(aiConfig.baseUrl)}
      />

      {/* Raw/rendered toggle — floating button at the bottom right, above the
       * keyboard (or above the bottom nav pill when the keyboard is closed).
       * The top bar hides on scroll, so the toggle lives down here where it
       * is always reachable while editing. */}
      <div
        className="pointer-events-auto fixed z-40"
        style={{
          right: 16,
          top: `calc(${vv.bottom}px - env(safe-area-inset-bottom, 0px) - 132px)`,
        }}
      >
        <CircleButton
          ariaLabel={rawMode ? "Rendered view" : "Raw markdown"}
          onClick={() => (rawMode ? void toggleToRendered() : toggleToRaw())}
        >
          {rawMode ? <BookOpen size={20} /> : <Braces size={20} />}
        </CircleButton>
      </div>

      {aiPanelOpen && (
        <AICommandPanel
          editorRef={editorRef}
          onClose={() => setAiPanelOpen(false)}
          mobile
        />
      )}
    </div>
  );
}

function MobileTopBar({
  onOpenSidebar,
  onOverflow,
  rawMode = false,
  showThemeToggle = false,
}: {
  onOpenSidebar: () => void;
  onOverflow: (x: number, y: number) => void;
  rawMode?: boolean;
  showThemeToggle?: boolean;
}) {
  const hideChrome = useScrollHideChrome();
  const visible = rawMode || hideChrome;
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && theme === "dark";
  return (
    <div
      className="pointer-events-none fixed left-0 right-0 z-40 flex items-center justify-between px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
        paddingBottom: 8,
        transform: visible ? "translateY(0)" : "translateY(-150%)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.25s ease, opacity 0.2s ease",
      }}
    >
      <div className="pointer-events-auto">
        <CircleButton onClick={onOpenSidebar} ariaLabel="Open notes list">
          <PanelLeft size={20} />
        </CircleButton>
      </div>
      <div className="pointer-events-auto">
        {showThemeToggle ? (
          <CircleButton
            ariaLabel="Toggle theme"
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </CircleButton>
        ) : (
          <CircleButton
            ariaLabel="More actions"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onOverflow(r.right, r.bottom + 8);
            }}
          >
            <Ellipsis size={20} />
          </CircleButton>
        )}
      </div>
    </div>
  );
}

function CircleButton({
  children,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex items-center justify-center rounded-full transition-transform active:scale-95"
      style={{
        width: 40,
        height: 40,
        background: "var(--mob-surface)",
        color: "var(--mob-text)",
      }}
    >
      {children}
    </button>
  );
}

// A pulsing placeholder line used while a note body loads after a reload, so
// the UI never flashes back to the dashboard.
function Skeleton({ width, height }: { width: string; height: number }) {
  return (
    <div
      className="rounded-xl"
      style={{
        width,
        height,
        background: "var(--mob-surface)",
        animation: "mob-skeleton 1.2s ease-in-out infinite",
      }}
    />
  );
}
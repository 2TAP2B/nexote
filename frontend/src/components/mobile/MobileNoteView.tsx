"use client";

import { Ellipsis, PanelLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MilkdownEditorHandle, AIConfig } from "@/components/MilkdownEditor";
import WelcomeDashboard from "@/components/WelcomeDashboard";
import { useNotes, DASHBOARD_ID } from "@/lib/notes-context";
import type { Note } from "@/lib/api";
import MobileFormatBar from "./MobileFormatBar";
import { useScrollHideChrome } from "./useScrollHideChrome";
import { useVirtualKeyboardInset } from "./useVirtualKeyboardInset";

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
  openWithHistory: (id: string) => Promise<void>;
  openDaily: () => Promise<void>;
};

export default function MobileNoteView({
  activeNote,
  isDashboard,
  onOpenSidebar,
  onOverflow,
}: Props) {
  const { settings, isJournalNote, activeVault, save, setDraft, activeId } =
    useNotes();

  const editorRef = useRef<MilkdownEditorHandle>(null);

  // Height of the on-screen keyboard (0 when hidden). The editor scroll area
  // shrinks by this amount while typing so the caret never scrolls underneath
  // the keyboard — ProseMirror keeps the cursor in view within the smaller
  // viewport.
  const kbdInset = useVirtualKeyboardInset();

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
  const loadedKeyRef = useRef<string | null>(null);
  const skipNextChange = useRef(false);
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
      return;
    }

    const sameNote = activeNote.id === loadedKeyRef.current;
    const bodyChanged = activeNote.body !== prevBodyRef.current;
    prevBodyRef.current = activeNote.body;

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

  // Dashboard: render the welcome screen (no editor).
  if (isDashboard || !activeNote) {
    return (
      <div className="relative min-h-0 flex-1" style={{ background: "var(--mob-bg)" }}>
        <MobileTopBar onOpenSidebar={onOpenSidebar} onOverflow={onOverflow} />
        <div
          className="h-full overflow-y-auto"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 60px)" }}
        >
          <WelcomeDashboard />
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-0 flex-1"
      style={{ background: "var(--mob-bg)" }}
    >
      {/* Top bar — fixed overlay that auto-hides on scroll-down, reappears
       * on scroll-up or at top. Transparent so the editor shows through. */}
      <MobileTopBar onOpenSidebar={onOpenSidebar} onOverflow={onOverflow} />

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
        <MilkdownEditorWrapper
          ref={editorRef}
          key={`${activeNote.id}-${bodyKey}`}
          defaultValue={activeNote.body}
          onChange={handleEditorChange}
          aiConfig={aiConfig}
          vaultId={isJournalNote(activeNote.id) ? "journal" : activeVault?.id ?? ""}
          noteId={activeNote.id}
          mobile
        />
      </div>

      {/* Pinned formatting bar — always visible, replaces the floating
       * Milkdown selection toolbar. Sits above the keyboard and above the
       * bottom pill. */}
      <MobileFormatBar
        editorRef={editorRef}
        aiAvailable={Boolean(aiConfig.baseUrl)}
        kbdInset={kbdInset}
      />
    </div>
  );
}

function MobileTopBar({
  onOpenSidebar,
  onOverflow,
}: {
  onOpenSidebar: () => void;
  onOverflow: (x: number, y: number) => void;
}) {
  const visible = useScrollHideChrome();
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
        <CircleButton
          ariaLabel="More actions"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onOverflow(r.right, r.bottom + 8);
          }}
        >
          <Ellipsis size={20} />
        </CircleButton>
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
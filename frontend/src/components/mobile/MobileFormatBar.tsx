"use client";

import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Sparkles,
  TextQuote,
} from "lucide-react";
import { useEffect, useState, type RefObject } from "react";

import type { FormatAction, MilkdownEditorHandle } from "@/components/MilkdownEditor";
import { useScrollHideChrome } from "./useScrollHideChrome";

// Fixed formatting bar for the mobile note view. Replaces the floating
// Milkdown selection toolbar (which overlapped the selection and the native
// copy/paste popup) with an always-visible touch-friendly bar pinned above the
// virtual keyboard inset and above the floating bottom pill.
export default function MobileFormatBar({
  editorRef,
  aiAvailable,
  kbdInset,
}: {
  editorRef: RefObject<MilkdownEditorHandle | null>;
  aiAvailable: boolean;
  kbdInset: number;
}) {
  const run = (action: FormatAction) => () => {
    editorRef.current?.format(action);
  };

  // Same auto-hide-on-scroll behavior as the bottom pill / top bar, so the
  // editing chrome shares one "intelligence": hide on scroll-down, reappear
  // on scroll-up or at the top, while the text keeps its reading space.
  const visible = useScrollHideChrome();

  // While text is selected, keep the bar on screen even if the scroll-chrome
  // logic would have hidden it (the user just tapped to select, so the bar
  // must be reachable to format the selection).
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    const onChange = (e: Event) => {
      setHasSelection(Boolean((e as CustomEvent).detail));
    };
    window.addEventListener("nexote:selection-change", onChange as EventListener);
    return () => window.removeEventListener("nexote:selection-change", onChange as EventListener);
  }, []);

  const show = visible || hasSelection;

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 z-40 flex justify-center"
      style={{
        bottom: `calc(${kbdInset}px + env(safe-area-inset-bottom, 0px) + 78px)`,
        transform: show ? "translateY(0)" : "translateY(150%)",
        opacity: show ? 1 : 0,
        transition: "transform 0.25s ease, opacity 0.2s ease",
      }}
    >
      <div
        onPointerDown={(e) => e.preventDefault()}
        className="pointer-events-auto flex items-center gap-1 overflow-x-auto rounded-full px-2"
        style={{
          height: 48,
          background: "var(--mob-surface)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          maxWidth: "calc(100% - 24px)",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <BarButton label="Bold" onClick={run("bold")}>
          <Bold size={20} />
        </BarButton>
        <BarButton label="Italic" onClick={run("italic")}>
          <Italic size={20} />
        </BarButton>
        <BarDivider />
        <BarButton label="Heading 1" onClick={run("h1")}>
          <Heading1 size={20} />
        </BarButton>
        <BarButton label="Heading 2" onClick={run("h2")}>
          <Heading2 size={20} />
        </BarButton>
        <BarButton label="Heading 3" onClick={run("h3")}>
          <Heading3 size={20} />
        </BarButton>
        <BarDivider />
        <BarButton label="Bullet list" onClick={run("bullet-list")}>
          <List size={20} />
        </BarButton>
        <BarButton label="Ordered list" onClick={run("ordered-list")}>
          <ListOrdered size={20} />
        </BarButton>
        <BarButton label="Quote" onClick={run("quote")}>
          <TextQuote size={20} />
        </BarButton>
        <BarButton label="Code block" onClick={run("code-block")}>
          <Code2 size={20} />
        </BarButton>
        {aiAvailable && (
          <>
            <BarDivider />
            <BarButton
              label="Ask AI"
              onClick={() => editorRef.current?.askAI()}
              accent
            >
              <Sparkles size={20} />
            </BarButton>
          </>
        )}
      </div>
    </div>
  );
}

function BarButton({
  children,
  label,
  onClick,
  accent,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex shrink-0 items-center justify-center rounded-full transition-transform active:scale-90"
      style={{
        width: 44,
        height: 44,
        color: accent ? "var(--mob-accent, #7c6ff0)" : "var(--mob-text)",
      }}
    >
      {children}
    </button>
  );
}

function BarDivider() {
  return (
    <span
      aria-hidden
      className="shrink-0"
      style={{ width: 1, height: 22, background: "var(--mob-muted)" }}
    />
  );
}
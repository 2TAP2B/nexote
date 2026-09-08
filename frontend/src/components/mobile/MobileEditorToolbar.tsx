"use client";

import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Plus,
  Sparkles,
  Strikethrough,
  Table,
  TextQuote,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { FormatAction, MilkdownEditorHandle } from "@/components/MilkdownEditor";
import { useScrollHideChrome } from "./useScrollHideChrome";
import { useVisualViewport } from "./useVirtualKeyboardInset";

// Bottom toolbar for the mobile note view. Replaces the floating Milkdown
// selection toolbar (which overlapped the selection and the native copy/paste
// popup). Appears only after the user taps the editor to set a cursor (or
// selects text) and sits pinned to the top of the on-screen keyboard, right
// where the caret is. Every markdown tool is exposed directly as a button in
// a horizontally scrollable bar (scrollbar hidden). It hides on scroll-down
// (reading) and reappears on scroll-up.
export default function MobileEditorToolbar({
  editorRef,
  aiAvailable,
}: {
  editorRef: RefObject<MilkdownEditorHandle | null>;
  aiAvailable: boolean;
}) {
  const run = (action: FormatAction) => () => {
    editorRef.current?.format(action);
  };

  // First toolbar button: open the slash command menu. The editor listens for
  // this event, drops a "/" in the document at the caret (or a fresh body
  // paragraph below the current block) and focuses, which surfaces the sheet.
  const openSlash = () => {
    window.dispatchEvent(new CustomEvent("nexote:slash-open"));
  };

  // Visible whenever the on-screen keyboard is open (the user is editing).
  const [hasSelection, setHasSelection] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [forceShow, setForceShow] = useState(false);
  const chromeVisible = useScrollHideChrome();
  const vv = useVisualViewport();
  // Keyboard-open is checked FIRST and alone: dismissing the keyboard on iOS
  // doesn't always blur the editor, so hasFocus can stay stale when the user
  // taps back in (no new focus event) — tying visibility to the keyboard
  // itself avoids that dead state where the bar never reappears. While the
  // keyboard is closed, show only when the caret is in the editor or text is
  // selected AND the chrome hasn't been hidden by scrolling.
  const show = vv.isKeyboardOpen || ((hasSelection || hasFocus) && (chromeVisible || forceShow));

  // Gap between the bar and what's beneath it: 12px when the keyboard is open
  // (hugging its top edge), or above the floating bottom pill otherwise.
  const gap = vv.isKeyboardOpen ? 12 : 80;
  const barTop = `calc(${vv.bottom}px - env(safe-area-inset-bottom, 0px) - ${gap + 52}px)`;

  useEffect(() => {
    const onChange = (e: Event) => {
      const active = Boolean((e as CustomEvent).detail);
      setHasSelection(active);
      if (active) setForceShow(true);
    };
    const onFocus = () => {
      setHasFocus(true);
      setForceShow(true);
    };
    const onBlur = () => setHasFocus(false);
    window.addEventListener("nexote:selection-change", onChange as EventListener);
    window.addEventListener("nexote:editor-focus", onFocus);
    window.addEventListener("nexote:editor-blur", onBlur);
    return () => {
      window.removeEventListener("nexote:selection-change", onChange as EventListener);
      window.removeEventListener("nexote:editor-focus", onFocus);
      window.removeEventListener("nexote:editor-blur", onBlur);
    };
  }, []);

  // Clear the focus override whenever a scroll-hide transition happens, so
  // scrolling away still dismisses the bar.
  useEffect(() => {
    if (!chromeVisible) setForceShow(false);
  }, [chromeVisible]);

  // When the on-screen keyboard closes the user is done editing — dismiss the
  // bar and drop the focus/selection overrides so it doesn't linger floating
  // above the content.
  const prevKeyboardOpen = useRef(vv.isKeyboardOpen);
  useEffect(() => {
    if (prevKeyboardOpen.current && !vv.isKeyboardOpen) {
      setHasFocus(false);
      setHasSelection(false);
      setForceShow(false);
    }
    prevKeyboardOpen.current = vv.isKeyboardOpen;
  }, [vv.isKeyboardOpen]);

  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-40 flex justify-center px-3"
      style={{
        top: barTop,
        transform: show ? "translateY(0)" : "translateY(150%)",
        opacity: show ? 1 : 0,
        transition: "transform 0.25s ease, opacity 0.2s ease, top 0.2s ease",
      }}
    >
      <div className="pointer-events-auto w-full max-w-2xl">
        <div
          onPointerDown={(e) => e.preventDefault()}
          className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-2xl px-2"
          style={{
            height: 48,
            background: "var(--mob-surface)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          }}
        >
          <BarButton label="Insert / slash commands" onClick={openSlash} accent>
            <Plus size={20} />
          </BarButton>
          <BarDivider />
          <BarButton label="Bold" onClick={run("bold")}>
            <Bold size={20} />
          </BarButton>
          <BarButton label="Italic" onClick={run("italic")}>
            <Italic size={20} />
          </BarButton>
          <BarButton label="Strikethrough" onClick={run("strike")}>
            <Strikethrough size={20} />
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
          <BarButton label="Task list" onClick={run("task-list")}>
            <ListTodo size={20} />
          </BarButton>
          <BarButton label="Quote" onClick={run("quote")}>
            <TextQuote size={20} />
          </BarButton>
          <BarButton label="Code block" onClick={run("code-block")}>
            <Code2 size={20} />
          </BarButton>
          <BarButton label="Table" onClick={run("table")}>
            <Table size={20} />
          </BarButton>
          <BarButton label="Image" onClick={() => fileRef.current?.click()}>
            <ImageIcon size={20} />
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

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) editorRef.current?.insertImageFile(file);
          e.target.value = "";
        }}
      />
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
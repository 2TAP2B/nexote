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
  Plus,
  Sparkles,
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
// where the caret is. It hides on scroll-down (reading) and reappears on
// scroll-up.
export default function MobileEditorToolbar({
  editorRef,
  aiAvailable,
}: {
  editorRef: RefObject<MilkdownEditorHandle | null>;
  aiAvailable: boolean;
}) {
  const run = (action: FormatAction) => () => {
    editorRef.current?.format(action);
    setMenuOpen(false);
  };

  // Visible while the caret is in the editor or text is selected, and only
  // when the chrome hasn't been hidden by scrolling. Re-tapping the editor
  // while scrolled (focus/selection) force-reveals it; the next scroll-hide
  // transition clears that override.
  const [hasSelection, setHasSelection] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [forceShow, setForceShow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const chromeVisible = useScrollHideChrome();
  const vv = useVisualViewport();
  // While the on-screen keyboard is open the user is editing, so never let
  // scroll-hide dismiss the bar mid-typing.
  const show = (hasSelection || hasFocus) && (chromeVisible || forceShow || vv.isKeyboardOpen);

  // Gap between the bar and what's beneath it: 12px when the keyboard is open
  // (hugging its top edge), or above the floating bottom pill otherwise.
  const gap = vv.isKeyboardOpen ? 12 : 80;
  const barTop = `calc(${vv.bottom}px - env(safe-area-inset-bottom, 0px) - ${gap + 48}px)`;

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
      setMenuOpen(false);
    }
    prevKeyboardOpen.current = vv.isKeyboardOpen;
  }, [vv.isKeyboardOpen]);

  // Close the insert menu whenever the toolbar hides (scroll / blur).
  useEffect(() => {
    if (!show) setMenuOpen(false);
  }, [show]);

  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 z-40 flex justify-center"
      style={{
        top: barTop,
        transform: show ? "translateY(0)" : "translateY(150%)",
        opacity: show ? 1 : 0,
        transition: "transform 0.25s ease, opacity 0.2s ease, top 0.2s ease",
      }}
    >
      {menuOpen && (
        <div
          className="pointer-events-auto fixed inset-0 z-50 bg-black/40"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="pointer-events-auto relative">
        <div
          onPointerDown={(e) => e.preventDefault()}
          className="flex items-center gap-1 overflow-x-auto rounded-full px-2 no-scrollbar"
          style={{
            height: 48,
            background: "var(--mob-surface)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
            maxWidth: "calc(100vw - 24px)",
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
          <BarButton
            label={menuOpen ? "Close insert menu" : "Insert block"}
            onClick={() => setMenuOpen((open) => !open)}
            accent
          >
            <Plus size={22} />
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

        {menuOpen && (
          <div
            onPointerDown={(e) => e.preventDefault()}
            className="absolute z-50"
            style={{
              bottom: "calc(100% + 10px)",
              left: "50%",
              transform: "translateX(-50%)",
              width: "max(272px, calc(100vw - 48px))",
            }}
          >
            <div
              className="no-scrollbar rounded-2xl p-2"
              style={{
                background: "var(--mob-surface)",
                boxShadow:
                  "0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.45)",
                maxHeight: `calc(${Math.max(vv.height, 200)}px - env(safe-area-inset-bottom, 0px) - ${gap + 48 + 20}px)`,
                overflowY: "auto",
              }}
            >
              <div
                className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--mob-muted)" }}
              >
                Insert
              </div>
              <div className="grid grid-cols-2 gap-1">
                <MenuTile label="Heading 1" icon={<Heading1 size={22} />} onClick={run("h1")} />
                <MenuTile label="Heading 2" icon={<Heading2 size={22} />} onClick={run("h2")} />
                <MenuTile label="Heading 3" icon={<Heading3 size={22} />} onClick={run("h3")} />
                <MenuTile label="Bullet list" icon={<List size={22} />} onClick={run("bullet-list")} />
                <MenuTile label="Ordered list" icon={<ListOrdered size={22} />} onClick={run("ordered-list")} />
                <MenuTile label="Quote" icon={<TextQuote size={22} />} onClick={run("quote")} />
                <MenuTile label="Code block" icon={<Code2 size={22} />} onClick={run("code-block")} />
                <MenuTile label="Table" icon={<Table size={22} />} onClick={run("table")} />
                <MenuTile
                  label="Image"
                  icon={<ImageIcon size={22} />}
                  onClick={() => {
                    setMenuOpen(false);
                    fileRef.current?.click();
                  }}
                />
              </div>
            </div>
          </div>
        )}
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

function MenuTile({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 transition-transform active:scale-95"
      style={{ color: "var(--mob-text)" }}
    >
      <span style={{ color: "var(--mob-accent, #7c6ff0)" }}>{icon}</span>
      <span className="text-xs leading-tight">{label}</span>
    </button>
  );
}
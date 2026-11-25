"use client";

import {
  ArrowLeft,
  Languages,
  Edit3,
  ListChecks,
  Maximize2,
  Minimize2,
  PenLine,
  Send,
  SpellCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

import type { MilkdownEditorHandle } from "@/components/MilkdownEditor";
import { useAndroidBack } from "@/lib/android-back";

type PresetItem = {
  id: string;
  label: string;
  prompt: string;
  icon: ComponentType<{ size?: number }>;
};

type Submenu = {
  id: string;
  label: string;
  items: { id: string; label: string; prompt: string }[];
};

const PRESETS: PresetItem[] = [
  {
    id: "improve",
    label: "Improve writing",
    prompt: "Improve the writing while preserving the original meaning.",
    icon: PenLine,
  },
  {
    id: "grammar",
    label: "Fix grammar & spelling",
    prompt: "Fix any grammar and spelling errors without changing the meaning.",
    icon: SpellCheck,
  },
  {
    id: "shorter",
    label: "Make shorter",
    prompt: "Make this shorter while preserving the key information.",
    icon: Minimize2,
  },
  {
    id: "longer",
    label: "Make longer",
    prompt: "Expand this with more detail and examples.",
    icon: Maximize2,
  },
];

const SUBMENUS: Submenu[] = [
  {
    id: "tone",
    label: "Change tone",
    items: [
      { id: "professional", label: "Professional", prompt: "Rewrite this in a professional tone." },
      { id: "casual", label: "Casual", prompt: "Rewrite this in a casual tone." },
      { id: "confident", label: "Confident", prompt: "Rewrite this in a confident tone." },
      { id: "friendly", label: "Friendly", prompt: "Rewrite this in a friendly tone." },
      { id: "direct", label: "Direct", prompt: "Rewrite this in a direct tone." },
      { id: "formal", label: "Formal", prompt: "Rewrite this in a formal tone." },
    ],
  },
  {
    id: "translate",
    label: "Translate",
    items: [
      { id: "english", label: "English", prompt: "Translate this to English." },
      { id: "german", label: "German", prompt: "Translate this to German." },
      { id: "french", label: "French", prompt: "Translate this to French." },
      { id: "spanish", label: "Spanish", prompt: "Translate this to Spanish." },
      { id: "chinese", label: "Chinese", prompt: "Translate this to Chinese (Simplified)." },
      { id: "japanese", label: "Japanese", prompt: "Translate this to Japanese." },
    ],
  },
];

type Props = {
  editorRef: React.RefObject<MilkdownEditorHandle | null>;
  onClose: () => void;
  mobile?: boolean;
};

// A reliable, always-on-screen AI command panel that replaces Crepe's floating
// instruction tooltip. Shows preset actions (Improve writing, Fix grammar, Make
// shorter, Make longer, Change tone, Translate) plus a custom-prompt input.
// Submitting any action calls editorRef.runAI(instruction) which dispatches
// runAICmd on the current selection.
export default function AICommandPanel({ editorRef, onClose, mobile }: Props) {
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Back leaves a submenu first, then closes the panel.
  useAndroidBack(onClose);
  useAndroidBack(() => setSubmenu(null), submenu !== null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (instruction: string) => {
    editorRef.current?.runAI(instruction);
    onClose();
  };

  const submitCustom = () => {
    const v = custom.trim();
    if (!v) return;
    run(v);
  };

  const activeSubmenu = SUBMENUS.find((s) => s.id === submenu);

  // Portaled to document.body: the panel is position:fixed, and its mount
  // point on mobile sits inside the pager's transformed track — a fixed
  // element there would be anchored to the track, not the viewport.
  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="pointer-events-auto flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border bg-background shadow-2xl sm:max-w-md sm:rounded-2xl"
        style={{
          borderColor: "var(--border)",
          maxHeight: mobile ? "70vh" : "85vh",
        }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          {activeSubmenu ? (
            <button
              type="button"
              onClick={() => setSubmenu(null)}
              className="flex items-center gap-1.5 text-sm font-medium"
              style={{ color: "var(--foreground)" }}
            >
              <ArrowLeft size={16} />
              Back
            </button>
          ) : (
            <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              <PenLine size={16} style={{ color: "var(--primary)" }} />
              Ask AI
            </span>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ color: "var(--muted-foreground)" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeSubmenu ? (
            <div className="flex flex-col gap-1">
              <p className="px-2 pb-1 text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                {activeSubmenu.label}
              </p>
              {activeSubmenu.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => run(item.prompt)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                  style={{ color: "var(--foreground)" }}
                >
                  <span className="flex-1">{item.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {PRESETS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => run(item.prompt)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                    style={{ color: "var(--foreground)" }}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: "color-mix(in srgb, var(--primary) 12%, transparent)",
                        color: "var(--primary)",
                      }}
                    >
                      <Icon size={16} />
                    </span>
                    {item.label}
                  </button>
                );
              })}
              {SUBMENUS.map((sub) => {
                const Icon = sub.id === "tone" ? Edit3 : Languages;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setSubmenu(sub.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                    style={{ color: "var(--foreground)" }}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: "color-mix(in srgb, var(--primary) 12%, transparent)",
                        color: "var(--primary)",
                      }}
                    >
                      <Icon size={16} />
                    </span>
                    {sub.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom prompt input */}
        {!activeSubmenu && (
          <div className="shrink-0 border-t p-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--background)" }}>
              <input
                ref={inputRef}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitCustom();
                  }
                }}
                placeholder="Write a custom prompt…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--foreground)" }}
              />
              <button
                type="button"
                aria-label="Send"
                onClick={submitCustom}
                disabled={!custom.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
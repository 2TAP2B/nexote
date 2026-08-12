"use client";

import { ChevronLeft, ChevronRight, Plus, Search, SquareStack } from "lucide-react";

import { useScrollHideChrome } from "./useScrollHideChrome";

type Props = {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onSearch: () => void;
  onNewNote: () => void;
  onOpenTabs: () => void;
  tabCount: number;
};

// Floating capsule toolbar at the bottom of the note view. Auto-hides on
// scroll-down and reappears on scroll-up (standard mobile pattern). Icons:
// back, forward (disabled when no history), search, new note, open tabs.
export default function MobileBottomPill({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onSearch,
  onNewNote,
  onOpenTabs,
  tabCount,
}: Props) {
  const visible = useScrollHideChrome();

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 z-40 flex justify-center"
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        transform: visible ? "translateY(0)" : "translateY(150%)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.25s ease, opacity 0.2s ease",
      }}
    >
      <div
        className="mob-bottom-pill pointer-events-auto flex items-center gap-5 rounded-full px-5"
        style={{
          height: 56,
          background: "var(--mob-surface)",
          // semi-opaque feel
          boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          touchAction: "none",
        }}
      >
        <PillIcon
          active={canGoBack}
          onClick={canGoBack ? onBack : undefined}
          ariaLabel="Back"
        >
          <ChevronLeft size={24} />
        </PillIcon>
        <PillIcon
          active={canGoForward}
          onClick={canGoForward ? onForward : undefined}
          ariaLabel="Forward"
        >
          <ChevronRight size={24} />
        </PillIcon>
        <PillIcon active onClick={onSearch} ariaLabel="Search">
          <Search size={22} />
        </PillIcon>
        <PillIcon active onClick={onNewNote} ariaLabel="New note">
          <Plus size={24} />
        </PillIcon>
        <button
          type="button"
          aria-label="Open tabs"
          onClick={onOpenTabs}
          className="flex items-center justify-center transition-transform active:scale-90"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1.5px solid var(--mob-muted)",
            color: "var(--mob-text)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {tabCount || 0}
        </button>
      </div>
    </div>
  );
}

function PillIcon({
  children,
  active,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick?: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={!active || !onClick}
      className="flex items-center justify-center transition-transform active:scale-90 disabled:opacity-40"
      style={{ color: active ? "var(--mob-text)" : "var(--mob-muted)" }}
    >
      {children}
    </button>
  );
}
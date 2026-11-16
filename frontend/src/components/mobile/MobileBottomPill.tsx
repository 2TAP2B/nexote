"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListTree,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  SquareStack,
} from "lucide-react";
import { useState } from "react";

import { MobileActionSheet } from "./MobileActionSheet";
import { useScrollHideChrome } from "./useScrollHideChrome";
import { useVisualViewport } from "./useVirtualKeyboardInset";

type Props = {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onDashboard: () => void;
  onSearch: () => void;
  onNewNote: () => void;
  onOpenTabs: () => void;
  tabCount: number;
  onOpenSidebar: () => void;
  onOpenToc: () => void;
  onOpenDaily: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onCommandPalette: () => void;
  /** The open note; scrolling it down hides the pill. Unset on the dashboard. */
  autoHideKey?: string;
};

// Floating capsule toolbar at the bottom of the note view. Hides while the
// touch keyboard is open and on scroll-down in a note. Icons: back, forward,
// search, dashboard (center), new note, open tabs, and a hamburger menu with
// quick actions.
export default function MobileBottomPill({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onDashboard,
  onSearch,
  onNewNote,
  onOpenTabs,
  tabCount,
  onOpenSidebar,
  onOpenToc,
  onOpenDaily,
  onOpenSettings,
  onToggleTheme,
  onCommandPalette,
  autoHideKey,
}: Props) {
  const scrollVisible = useScrollHideChrome(autoHideKey);
  const vv = useVisualViewport();
  const shown = (scrollVisible || autoHideKey === undefined) && !vv.isKeyboardOpen;
  const [menuOpen, setMenuOpen] = useState(false);

  const menuSections = [
    [
      { label: "Notes list", icon: <SquareStack size={19} />, onClick: onOpenSidebar },
      { label: "Table of contents", icon: <ListTree size={19} />, onClick: onOpenToc },
      { label: "Today's note", icon: <CalendarDays size={19} />, onClick: onOpenDaily },
    ],
    [
      { label: "Command palette", icon: <SlidersHorizontal size={19} />, onClick: onCommandPalette },
      { label: "Toggle theme", icon: <Moon size={19} />, onClick: onToggleTheme },
    ],
    [{ label: "Settings", icon: <Settings size={19} />, onClick: onOpenSettings }],
  ];

  return (
    <>
      <div
        className="pointer-events-none absolute left-0 right-0 z-40 flex justify-center"
        style={{
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          transform: shown ? "translateY(0)" : "translateY(150%)",
          opacity: shown ? 1 : 0,
          transition: "transform 0.25s ease, opacity 0.2s ease",
        }}
      >
        <div
          className="mob-bottom-pill pointer-events-auto flex items-center rounded-full px-5"
          style={{
            height: 60,
            background: "var(--mob-surface)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
            touchAction: "none",
          }}
        >
          {/* Left group */}
          <div className="flex flex-1 items-center justify-end gap-3">
            <PillIcon
              active={canGoBack}
              onClick={canGoBack ? onBack : undefined}
              ariaLabel="Back"
            >
              <ChevronLeft size={22} />
            </PillIcon>
            <PillIcon
              active={canGoForward}
              onClick={canGoForward ? onForward : undefined}
              ariaLabel="Forward"
            >
              <ChevronRight size={22} />
            </PillIcon>
            <PillIcon active onClick={onSearch} ariaLabel="Search">
              <Search size={22} />
            </PillIcon>
          </div>

          {/* Center: dashboard */}
          <div className="flex flex-1 items-center justify-center">
            <button
              type="button"
              aria-label="Dashboard"
              onClick={onDashboard}
              className="mx-4 flex items-center justify-center rounded-full transition-transform active:scale-90"
              style={{
                width: 44,
                height: 44,
                background: "color-mix(in srgb, var(--mob-accent) 18%, transparent)",
                color: "var(--mob-accent)",
              }}
            >
              <LayoutDashboard size={24} />
            </button>
          </div>

          {/* Right group */}
          <div className="flex flex-1 items-center justify-start gap-3">
            <PillIcon active onClick={onNewNote} ariaLabel="New note">
              <Plus size={24} />
            </PillIcon>
            <button
              type="button"
              aria-label="Open tabs"
              onClick={onOpenTabs}
              className="flex items-center justify-center transition-transform active:scale-90"
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "color-mix(in srgb, var(--mob-text) 12%, transparent)",
                boxShadow: "0 0 0 1.5px var(--mob-text)",
                color: "var(--mob-text)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {tabCount || 0}
            </button>
            <button
              type="button"
              aria-label="Menu"
              onClick={() => setMenuOpen(true)}
              className="flex items-center justify-center transition-transform active:scale-90"
              style={{ color: "var(--mob-text)" }}
            >
              <Menu size={24} />
            </button>
          </div>
        </div>
      </div>

      {menuOpen && <MobileActionSheet sections={menuSections} onClose={() => setMenuOpen(false)} />}
    </>
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
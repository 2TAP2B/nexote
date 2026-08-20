"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  SquareStack,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import ContextMenu, { type MenuItem } from "@/components/ContextMenu";
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
  onOpenDaily: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onCommandPalette: () => void;
};

// Floating capsule toolbar at the bottom of the note view. Always visible
// (except while the touch keyboard is open). Icons: back, forward, dashboard
// (center, always shown), search, new note, open tabs, and a hamburger menu
// with quick actions.
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
  onOpenDaily,
  onOpenSettings,
  onToggleTheme,
  onCommandPalette,
}: Props) {
  const visible = true;
  // Hide while the touch keyboard is open so the nav capsule never sits
  // between the editor and the keyboard.
  const vv = useVisualViewport();
  const shown = visible && !vv.isKeyboardOpen;

  // Hamburger menu state — positioned above the pill.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const r = menuBtnRef.current?.getBoundingClientRect();
    if (r) {
      setMenuPos({ x: r.right, y: r.top - 8 });
      setMenuOpen(true);
    }
  };

  const menuItems: MenuItem[] = [
    {
      label: "Notes list",
      icon: <SquareStack className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onOpenSidebar();
      },
    },
    {
      label: "Today's note",
      icon: <CalendarDays className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onOpenDaily();
      },
    },
    {
      label: "Command palette",
      icon: <SlidersHorizontal className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onCommandPalette();
      },
    },
    {
      label: "Toggle theme",
      icon: <Moon className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onToggleTheme();
      },
    },
    { label: "", onClick: () => {}, separator: true },
    {
      label: "Settings",
      icon: <Settings className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onOpenSettings();
      },
    },
  ];

  return (
    <>
      <div
        className="pointer-events-none fixed left-0 right-0 z-40 flex justify-center"
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
                borderRadius: 8,
                background: "color-mix(in srgb, var(--mob-text) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--mob-muted) 40%, transparent)",
                color: "var(--mob-text)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {tabCount || 0}
            </button>
            <button
              ref={menuBtnRef}
              type="button"
              aria-label="Menu"
              onClick={openMenu}
              className="flex items-center justify-center transition-transform active:scale-90"
              style={{ color: "var(--mob-text)" }}
            >
              <Menu size={24} />
            </button>
          </div>
        </div>
      </div>

      {menuOpen && menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuOpen(false)}
        />
      )}
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
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
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

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
  onOpenToc,
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

  // Hamburger menu — rendered as a CommandPalette-style bottom sheet.
  // Portalled into the mobile shell root: the pill lives inside the
  // transform-panned .mob-pager track, which would break position:fixed.
  const [menuOpen, setMenuOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPortalTarget(document.querySelector<HTMLElement>(".mob-shell-root"));
  }, []);

  const openMenu = () => setMenuOpen(true);

  type SheetEntry = { label: string; icon: React.ReactNode; onClick: () => void; section?: "main" | "settings" };
  const menuItems: SheetEntry[] = [
    {
      section: "main",
      label: "Notes list",
      icon: <SquareStack className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onOpenSidebar();
      },
    },
    {
      section: "main",
      label: "Today's note",
      icon: <CalendarDays className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onOpenDaily();
      },
    },
    {
      section: "main",
      label: "Command palette",
      icon: <SlidersHorizontal className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onCommandPalette();
      },
    },
    {
      section: "main",
      label: "Table of contents",
      icon: <ListTree className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onOpenToc();
      },
    },
    {
      section: "main",
      label: "Toggle theme",
      icon: <Moon className="h-4 w-4" />,
      onClick: () => {
        setMenuOpen(false);
        onToggleTheme();
      },
    },
    {
      section: "settings",
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

      {menuOpen &&
        portalTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm"
            style={{
              paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            }}
            onClick={() => setMenuOpen(false)}
          >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="flex w-full flex-col overflow-hidden rounded-2xl border-2 bg-background shadow-xl"
            style={{ borderColor: "color-mix(in srgb, var(--primary) 55%, transparent)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — mirrors the palette search-input row */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Menu className="shrink-0 text-muted-foreground" size={16} />
              <span className="flex-1 text-sm text-foreground">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                title="Close"
                onClick={() => setMenuOpen(false)}
                className="flex shrink-0 touch-manipulation items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                style={{ width: 36, height: 36, marginRight: -8 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Items — palette row styling, grouped like palette kind headers */}
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {menuItems.map((item, i) => {
                const prev = menuItems[i - 1];
                const showHeader = !prev || prev.section !== item.section;
                return (
                  <li key={item.label}>
                    {showHeader && (
                      <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/60">
                        {item.section === "settings" ? "Settings" : "Actions"}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={item.onClick}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground/80 transition-colors hover:bg-muted active:bg-primary/15 active:text-foreground"
                    >
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Footer with hints — same as the palette footer */}
            <div className="kbd-hints flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground/70">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border px-1 py-0.5">↵</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border px-1 py-0.5">Esc</kbd>
                close
              </span>
            </div>
          </div>
        </div>,
        portalTarget
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
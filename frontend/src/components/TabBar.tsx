"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

type TabBarProps = {
  onOpenPalette: () => void;
};

// A horizontal tab bar of open notes, Obsidian-style. Tabs are rounded
// pills without strokes; the active tab uses the background color, inactive
// tabs are muted. A trailing "+" button opens a small menu with actions.
export default function TabBar({ onOpenPalette }: TabBarProps) {
  const { openTabs, activeId, notesById, openTab, closeTab, create, creating } =
    useNotes();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the "+" menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/40 px-2 py-2">
      {/* Scrollable tabs. Kept in their own overflow container so the "+"
          menu (which lives outside this container) is never clipped. */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        {openTabs.map((id) => {
          const note = notesById[id];
          const title = note?.title || "Untitled";
          const active = id === activeId;
          return (
            <div
              key={id}
              role="tab"
              tabIndex={0}
              aria-selected={active}
              onClick={() => void openTab(id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(id);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void openTab(id);
                }
              }}
              className={[
                "group flex max-w-[200px] min-w-[110px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              ].join(" ")}
            >
              <span className="truncate">{title}</span>
              <button
                type="button"
                aria-label="Close tab"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* "+" button with dropdown menu. Lives outside the scroll container so
          the menu isn't clipped by overflow-x-auto. */}
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          aria-label="New tab actions"
          title="New tab actions"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-background py-1 shadow-lg">
            <MenuItem
              label="Create new note"
              shortcut="Ctrl+N"
              disabled={creating}
              onClick={() => {
                setMenuOpen(false);
                void create();
              }}
            />
            <MenuItem
              label="Go to note…"
              shortcut="Ctrl+P"
              onClick={() => {
                setMenuOpen(false);
                onOpenPalette();
              }}
            />
            <div className="my-1 border-t border-border" />
            <MenuItem
              label="Close tab"
              disabled={activeId === null}
              onClick={() => {
                setMenuOpen(false);
                if (activeId) closeTab(activeId);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span>{label}</span>
      {shortcut && (
        <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
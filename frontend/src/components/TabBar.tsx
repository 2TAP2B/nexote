"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

type TabBarProps = {
  onOpenPalette: () => void;
};

// Obsidian-style tab bar: tabs look like labels, not buttons. Active tab has
// a subtle brighter background; inactive tabs are muted. Height 38px, no
// thick borders. A trailing "+" opens a small menu.
export default function TabBar({ onOpenPalette }: TabBarProps) {
  const { openTabs, activeId, notesById, openTab, closeTab, create, creating } =
    useNotes();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);

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

  const openMenu = () => {
    const r = plusRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 4, left: r.left });
    setMenuOpen((v) => !v);
  };

  return (
    <div
      className="flex shrink-0 items-center gap-0 overflow-x-auto bg-muted px-0"
      style={{ height: 38, borderBottom: "1px solid var(--border)" }}
    >
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
              "group flex max-w-[220px] min-w-[80px] shrink-0 cursor-pointer items-center gap-1.5 px-3 text-[14px] font-medium transition-colors",
              active
                ? "bg-background text-foreground"
                : "text-muted-foreground opacity-70 hover:opacity-100 hover:bg-background/40",
            ].join(" ")}
            style={{ height: 38 }}
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
              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-60"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <div ref={menuRef} className="relative shrink-0">
        <button
          ref={plusRef}
          type="button"
          aria-label="New tab actions"
          title="New tab actions"
          onClick={openMenu}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-background/40 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
        {menuOpen && menuPos && (
          <div
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
            className="z-50 w-56 overflow-hidden rounded-lg bg-background py-1 shadow-lg"
          >
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
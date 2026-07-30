"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

type TopBarProps = {
  onOpenPalette: () => void;
};

export default function TopBar({ onOpenPalette }: TopBarProps) {
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
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
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
      className="flex shrink-0 items-stretch"
      style={{
        height: 40,
        background: "var(--background)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Tabs */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto pl-2">
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
              className="group flex shrink-0 cursor-pointer items-center px-4"
              style={{
                minWidth: 100,
                maxWidth: 220,
                height: 36,
                marginTop: 2,
                marginBottom: 2,
                background: active ? "var(--background)" : "transparent",
                borderRadius: 8,
                marginLeft: 2,
              }}
            >
              <span
                className="truncate"
                style={{
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  opacity: active ? 1 : 0.7,
                  color: "var(--foreground)",
                }}
              >
                {title}
              </span>
              <button
                type="button"
                aria-label="Close tab"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
                className="ml-2 flex shrink-0 items-center justify-center transition-colors hover:opacity-100"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  opacity: active ? 0.5 : 0,
                  color: "var(--foreground)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background =
                    "rgba(255,255,255,0.06)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {/* + button */}
        <div ref={menuRef} className="relative flex items-stretch">
          <button
            ref={plusRef}
            type="button"
            aria-label="New tab actions"
            title="New tab actions"
            onClick={openMenu}
            className="flex items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground"
            style={{
              width: 36,
              height: 36,
              marginTop: 2,
              marginBottom: 2,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              e.currentTarget.style.borderRadius = "6px";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Plus size={16} />
          </button>
          {menuOpen && menuPos && (
            <div
              style={{
                position: "fixed",
                top: menuPos.top,
                left: menuPos.left,
                zIndex: 50,
                background: "var(--topbar)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
              className="min-w-[180px] overflow-hidden py-1 shadow-lg"
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
              <div
                className="my-1"
                style={{ borderTop: "1px solid var(--border)" }}
              />
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
      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:opacity-80 disabled:opacity-50"
      style={{ background: "transparent" }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "rgba(255,255,255,0.05)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      <span>{label}</span>
      {shortcut && (
        <kbd
          className="rounded px-1.5 py-0.5 text-xs"
          style={{
            border: "1px solid var(--border)",
            color: "var(--muted-foreground)",
          }}
        >
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

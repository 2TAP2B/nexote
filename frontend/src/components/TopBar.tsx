"use client";

import { ChevronDown, LayoutDashboard, MessageSquareText, Plus, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { useAndroidBack } from "@/lib/android-back";
import { useNotes, DASHBOARD_ID } from "@/lib/notes-context";
import { useCanEdit } from "@/components/useCanEdit";
import { SyncDot } from "@/components/SyncDot";

type TopBarProps = {
  onOpenPalette: () => void;
  onOpenDashboard: () => void;
  /** Quick notes fill the main area (the pinned tab after the dashboard shows active). */
  quickNotesActive: boolean;
  /** Quick notes or a thread cover the editor: no note tab shows active. */
  mainViewOpen: boolean;
  onOpenQuickNotes: () => void;
  /** Any tab click, also on the already active tab: it leaves quick notes / a thread. */
  onTabClick: () => void;
};

export default function TopBar({
  onOpenPalette,
  onOpenDashboard,
  quickNotesActive,
  mainViewOpen,
  onOpenQuickNotes,
  onTabClick,
}: TopBarProps) {
  const { openTabs, activeId, notesById, openTab, closeTab, create, creating, renameNote } =
    useNotes();
  const { canEditSpace, canEditNote } = useCanEdit();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  useAndroidBack(() => setMenuOpen(false), menuOpen);
  const plusRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

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

  const startRename = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setTitleDraft(currentTitle);
    requestAnimationFrame(() => renameRef.current?.focus());
  };

  const commitRename = () => {
    if (!renamingId) return;
    const t = titleDraft.trim() || "Untitled";
    if (t !== notesById[renamingId]?.title) void renameNote(renamingId, t);
    setRenamingId(null);
  };

  return (
    <div className="flex shrink-0 items-stretch h-full">
      {/* Tabs */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {openTabs.map((id) => {
          const isDashboard = id === DASHBOARD_ID;
          const note = notesById[id];
          const title = isDashboard ? "Dashboard" : note?.title || "Untitled";
          const active = id === activeId && !mainViewOpen;
          const isRenaming = renamingId === id;
          return (
            <Fragment key={id}>
            <div
              role="tab"
              tabIndex={0}
              aria-selected={active}
              onClick={() => {
                if (isRenaming) return;
                onTabClick();
                void openTab(id);
              }}
              onMouseDown={(e) => {
                if (e.button === 1 && !isDashboard) {
                  e.preventDefault();
                  closeTab(id);
                }
              }}
              onDoubleClick={() => !isDashboard && canEditNote(id) && startRename(id, title)}
              className="group flex shrink-0 cursor-pointer items-center"
              style={{
                width: isDashboard ? 44 : 168,
                height: 34,
                marginTop: 3,
                marginBottom: 3,
                background: active ? "var(--background)" : "transparent",
                borderRadius: 8,
                marginLeft: 3,
                paddingLeft: isDashboard ? 10 : 12,
                paddingRight: isDashboard ? 10 : 8,
              }}
            >
              {isRenaming ? (
                <input
                  ref={renameRef}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 rounded border border-ring bg-background px-1 text-sm text-foreground outline-none"
                />
              ) : isDashboard ? (
                <LayoutDashboard
                  size={15}
                  className="shrink-0"
                  style={{ opacity: active ? 1 : 0.55 }}
                />
              ) : (
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{
                    fontSize: 13,
                    fontWeight: active ? 500 : 400,
                    opacity: active ? 1 : 0.55,
                    color: "var(--foreground)",
                  }}
                >
                  {title}
                </span>
              )}
              {!isRenaming && !isDashboard && (
                <button
                  type="button"
                  aria-label="Close tab"
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(id);
                  }}
                  className="ml-2 flex shrink-0 items-center justify-center"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    opacity: active ? 0.5 : 0.3,
                    color: "var(--foreground)",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.opacity = "1";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.opacity = active ? "0.5" : "0.3";
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {isDashboard && (
              <button
                type="button"
                role="tab"
                aria-selected={quickNotesActive}
                aria-label="Quick notes"
                title="Quick notes"
                onClick={onOpenQuickNotes}
                className="flex shrink-0 cursor-pointer items-center"
                style={{
                  width: 44,
                  height: 34,
                  marginTop: 3,
                  marginBottom: 3,
                  background: quickNotesActive ? "var(--background)" : "transparent",
                  borderRadius: 8,
                  marginLeft: 3,
                  paddingLeft: 10,
                  paddingRight: 10,
                }}
              >
                <MessageSquareText size={15} className="shrink-0" style={{ opacity: quickNotesActive ? 1 : 0.55 }} />
              </button>
            )}
            </Fragment>
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
            className="flex items-center justify-center text-muted-foreground/45 transition-colors hover:text-foreground"
            style={{ width: 34, height: 34, marginTop: 3, marginBottom: 3, borderRadius: 6 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Plus size={15} />
          </button>
          {menuOpen && menuPos && (
            <div
              style={{
                position: "fixed",
                top: menuPos.top,
                left: menuPos.left,
                zIndex: 50,
                background: "var(--tab-active)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
              className="min-w-[180px] overflow-hidden py-1 shadow-lg"
            >
              {canEditSpace && (
                <MenuItem
                  label="Create new note"
                  shortcut="Ctrl+Shift+N"
                  disabled={creating}
                  onClick={() => {
                    setMenuOpen(false);
                    void create();
                  }}
                />
              )}
              <MenuItem
                label="Go to note…"
                shortcut="Ctrl+P"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenPalette();
                }}
              />
              <MenuItem
                label="Open dashboard"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenDashboard();
                }}
              />
              <div
                className="my-1"
                style={{ borderTop: "1px solid var(--border)" }}
              />
              <MenuItem
                label="Close tab"
                shortcut="Ctrl+W"
                disabled={activeId === null}
                onClick={() => {
                  setMenuOpen(false);
                  if (activeId) closeTab(activeId);
                }}
              />
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* The Android app's sync (tablets in the desktop shell). */}
        <SyncDot />

        {/* Tab list overflow menu */}
        <div className="flex items-stretch">
          <button
            type="button"
            aria-label="Tab list"
            title="Tab list"
            className="flex items-center justify-center text-muted-foreground/45 transition-colors hover:text-foreground"
            style={{ width: 34, height: 34, marginTop: 3, marginBottom: 3, borderRadius: 6 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <ChevronDown size={15} />
          </button>
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

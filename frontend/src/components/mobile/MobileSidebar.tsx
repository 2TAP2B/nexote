"use client";

import {
  Bookmark,
  CalendarDays,
  ChevronsDownUp,
  Clock,
  Expand,
  FilePlus,
  FileStack,
  FolderPlus,
  Hash,
  Library,
  ListTodo,
  Star,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";

import FileTree, { type TreeControls } from "@/components/FileTree";
import type { SidebarView } from "@/components/Ribbon";
import { useNotes } from "@/lib/notes-context";

type Props = {
  open: boolean;
  onClose: () => void;
  onControlsReady?: (c: TreeControls) => void;
  treeControls?: TreeControls | null;
  view: SidebarView;
  selectedTag: string | null;
  onSelectView: (view: SidebarView) => void;
  onSelectTagConsumed: () => void;
};

const RIBBON_ITEMS: { icon: typeof FileStack; label: string; view: SidebarView }[] = [
  { icon: FileStack, label: "Notes", view: "tree" },
  { icon: Clock, label: "Recent", view: "recent" },
  { icon: Star, label: "Shortcuts", view: "shortcuts" },
  { icon: Bookmark, label: "Bookmarks", view: "bookmarks" },
  { icon: Hash, label: "Tags", view: "tags" },
  { icon: ListTodo, label: "Tasks", view: "tasks" },
  { icon: Library, label: "Collections", view: "collections" },
  { icon: CalendarDays, label: "Daily", view: "journal" },
];

export default function MobileSidebar({
  open,
  onClose,
  onControlsReady,
  treeControls,
  view,
  selectedTag,
  onSelectView,
  onSelectTagConsumed,
}: Props) {
  const fileTreeBox = useRef<HTMLDivElement>(null);

  const { openDaily } = useNotes();

  useEffect(() => {
    const el = fileTreeBox.current;
    if (!el) return;
    const onTapNote = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-note-id]")) return;
      setTimeout(onClose, 0);
    };
    el.addEventListener("click", onTapNote, true);
    return () => el.removeEventListener("click", onTapNote, true);
  }, [onClose]);

  const activeLabel = RIBBON_ITEMS.find((r) => r.view === view)?.label ?? "Notes";

  const newNote = () => document.getElementById("nexote-new-note-btn")?.click();
  const newFolder = () => document.getElementById("nexote-new-folder-btn")?.click();

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ pointerEvents: open ? "auto" : "none" }}
    >
      {/* Backdrop */}
      <div
        className="mob-sidebar-backdrop absolute inset-0"
        data-open={open ? "1" : "0"}
        onClick={onClose}
        style={{
          background: "rgba(0,0,0,0.5)",
          pointerEvents: open ? "auto" : "none",
          touchAction: "none",
        }}
      />

      {/* Sidebar panel — slides in/out via transform.
          The transform is driven by a data attribute (not React inline
          style) so the swipe hook can set style.transform directly on the
          DOM without React clobbering it on re-render. */}
      <div
        className="mob-sidebar-panel nexote-sidebar absolute flex h-full flex-col"
        data-open={open ? "1" : "0"}
        style={{
          width: "85vw",
          maxWidth: 380,
          background: "var(--mob-bg)",
          borderRight: "1px solid var(--mob-surface)",
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        {/* Header — current view name + close */}
        <div
          className="flex shrink-0 items-center justify-between px-4"
          style={{
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
            paddingBottom: 8,
            borderBottom: "1px solid var(--mob-surface)",
          }}
        >
          <span
            className="text-lg font-semibold"
            style={{ color: "var(--mob-text)" }}
          >
            {activeLabel}
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ color: "var(--mob-muted)" }}
          >
            <X size={22} />
          </button>
        </div>

        {/* Horizontal ribbon — view switcher icons */}
        <div
          className="shrink-0 flex items-center gap-1 overflow-x-auto no-scrollbar px-2"
          style={{
            paddingTop: 8,
            paddingBottom: 8,
            borderBottom: "1px solid var(--mob-surface)",
          }}
        >
          {RIBBON_ITEMS.map((item) => {
            const active = view === item.view;
            return (
              <button
                key={item.view}
                type="button"
                aria-label={item.label}
                title={item.label}
                onClick={() => {
                  if (item.view === "journal") {
                    onSelectView(item.view);
                    void openDaily();
                    onClose();
                    return;
                  }
                  onSelectView(item.view);
                }}
                className="flex shrink-0 items-center justify-center rounded-lg transition-colors"
                style={{
                  width: 38,
                  height: 38,
                  color: active ? "var(--mob-accent)" : "var(--mob-muted)",
                  background: active
                    ? "color-mix(in oklab, var(--mob-accent) 12%, transparent)"
                    : "transparent",
                }}
              >
                <item.icon size={20} />
              </button>
            );
          })}
        </div>

        {/* FileTree */}
        <div
          ref={fileTreeBox}
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ color: "var(--mob-text)" }}
        >
          <FileTree
            collapsed={false}
            view={view}
            selectedTag={selectedTag}
            onSelectTagConsumed={onSelectTagConsumed}
            onControlsReady={onControlsReady}
            onSelectView={onSelectView}
          />
        </div>

        {/* Bottom toolbar — new note, new folder, expand/collapse folders,
         * expand/collapse all vaults, settings. Matches the top ribbon's
         * design: same button size, colors, and active states. */}
        {view === "tree" && (
          <div
            className="shrink-0 flex items-center gap-1 overflow-x-auto no-scrollbar px-2"
            style={{
              paddingTop: 8,
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
              borderTop: "1px solid var(--mob-surface)",
            }}
          >
            <RibbonBtn label="New note" onClick={newNote}>
              <FilePlus size={20} />
            </RibbonBtn>
            <RibbonBtn label="New folder" onClick={newFolder}>
              <FolderPlus size={20} />
            </RibbonBtn>
            <div className="flex-1" />
            <RibbonBtn
              label={
                treeControls?.allExpanded
                  ? "Collapse all folders"
                  : "Expand all folders"
              }
              onClick={() => treeControls?.toggleExpandCollapse()}
            >
              <ChevronsDownUp
                size={20}
                style={{
                  transform: treeControls?.allExpanded ? "none" : "rotate(180deg)",
                }}
              />
            </RibbonBtn>
            <RibbonBtn
              label={
                treeControls?.allSectionsExpanded
                  ? "Collapse all vaults"
                  : "Expand all vaults"
              }
              onClick={() => treeControls?.toggleSectionsCollapse()}
            >
              <Expand size={20} />
            </RibbonBtn>
          </div>
        )}
      </div>
    </div>
  );
}

function RibbonBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex shrink-0 items-center justify-center rounded-lg transition-colors active:scale-95"
      style={{
        width: 38,
        height: 38,
        color: "var(--mob-muted)",
      }}
    >
      {children}
    </button>
  );
}
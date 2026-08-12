"use client";

import {
  Bookmark,
  CalendarDays,
  ChevronsDownUp,
  Clock,
  FilePlus,
  FileStack,
  FolderPlus,
  Hash,
  Images,
  ListTodo,
  Star,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";

import FileTree, { type TreeControls } from "@/components/FileTree";
import type { SidebarView } from "@/components/Ribbon";

type Props = {
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
  { icon: Images, label: "Images", view: "images" },
  { icon: CalendarDays, label: "Daily", view: "journal" },
];

export default function MobileSidebar({
  onClose,
  onControlsReady,
  treeControls,
  view,
  selectedTag,
  onSelectView,
  onSelectTagConsumed,
}: Props) {
  const fileTreeBox = useRef<HTMLDivElement>(null);

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
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close sidebar"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.5)", touchAction: "none" }}
      />

      <div
        className="nexote-sidebar relative flex h-full flex-col"
        style={{
          width: "85vw",
          maxWidth: 380,
          background: "var(--mob-bg)",
          borderRight: "1px solid var(--mob-surface)",
          animation: "mobSlideInLeft 0.22s ease",
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
                onClick={() => onSelectView(item.view)}
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

        {/* Bottom toolbar — new note, new folder, expand/collapse */}
        {view === "tree" && (
          <div
            className="flex shrink-0 items-center gap-1 px-3 py-2"
            style={{
              borderTop: "1px solid var(--mob-surface)",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
            }}
          >
            <ToolButton label="New note" onClick={newNote}>
              <FilePlus size={20} />
            </ToolButton>
            <ToolButton label="New folder" onClick={newFolder}>
              <FolderPlus size={20} />
            </ToolButton>
            <div className="flex-1" />
            <ToolButton
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
            </ToolButton>
          </div>
        )}
      </div>

      <style>{`@keyframes mobSlideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
    </div>
  );
}

function ToolButton({
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
      className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors active:scale-95"
      style={{ color: "var(--mob-text)", background: "var(--mob-surface)" }}
    >
      {children}
    </button>
  );
}
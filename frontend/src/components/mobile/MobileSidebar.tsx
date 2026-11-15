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
  Settings,
  Star,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";

import FileTree, { type TreeControls } from "@/components/FileTree";
import type { SidebarView } from "@/components/Ribbon";
import { useNotes } from "@/lib/notes-context";
import { useCanEdit } from "@/components/useCanEdit";

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
  { icon: Library, label: "Collections", view: "collections" },
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

  const { openDaily, settings } = useNotes();
  // Viewers of a shared space can't add notes or folders.
  const { canEditSpace } = useCanEdit();

  // Honor the Features toggles: hidden views disappear from the switcher.
  const visibleItems = RIBBON_ITEMS.filter(
    (item) =>
      (item.view !== "tags" || settings.showTagsSection) &&
      (item.view !== "tasks" || settings.showTasksSection),
  );

  // If the persisted view is now hidden, fall back to the note tree.
  useEffect(() => {
    if (view === "tags" && !settings.showTagsSection) onSelectView("tree");
    else if (view === "tasks" && !settings.showTasksSection) onSelectView("tree");
  }, [view, settings.showTagsSection, settings.showTasksSection, onSelectView]);

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

  const activeLabel = visibleItems.find((r) => r.view === view)?.label ?? "Notes";

  const newNote = () => document.getElementById("nexote-new-note-btn")?.click();
  const newFolder = () => document.getElementById("nexote-new-folder-btn")?.click();

  return (
    <div
      className="relative flex h-full w-1/4 shrink-0 flex-col overflow-hidden"
      style={{
        background: "var(--mob-bg)",
        borderRight: "1px solid var(--mob-surface)",
      }}
    >
      {/* Header — the close X sits at the same top-left spot the sidebar
          (hamburger) button occupies on the note view, so tapping there
          always returns to the note editor. */}
      <div
        className="flex shrink-0 items-center gap-3 px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: 8,
          borderBottom: "1px solid var(--mob-surface)",
        }}
      >
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onClose}
          className="flex items-center justify-center rounded-full transition-transform active:scale-95"
          style={{
            width: 40,
            height: 40,
            background: "var(--mob-surface)",
            color: "var(--mob-text)",
          }}
        >
          <X size={20} />
        </button>
        <span className="text-lg font-semibold" style={{ color: "var(--mob-text)" }}>
          {activeLabel}
        </span>
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
          {visibleItems.map((item) => {
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
            {canEditSpace && (
              <>
                <RibbonBtn label="New note" onClick={newNote}>
                  <FilePlus size={20} />
                </RibbonBtn>
                <RibbonBtn label="New folder" onClick={newFolder}>
                  <FolderPlus size={20} />
                </RibbonBtn>
              </>
            )}
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
            <RibbonBtn
              label="Settings"
              onClick={() => window.dispatchEvent(new CustomEvent("nexote:open-settings"))}
            >
              <Settings size={20} />
            </RibbonBtn>
          </div>
        )}
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
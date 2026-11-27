"use client";

import {
  Bookmark,
  CalendarDays,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  FilePlus,
  FileStack,
  FolderPlus,
  Hash,
  LayoutList,
  Library,
  List,
  ListTodo,
  MessagesSquare,
  Settings,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import FileTree, { TREE_SORT_LABELS, type TreeControls } from "@/components/FileTree";
import type { SidebarView } from "@/components/Ribbon";
import { useNotes, type TreeSort } from "@/lib/notes-context";
import { useCanEdit } from "@/components/useCanEdit";
import { MobileActionSheet } from "./MobileActionSheet";

type Props = {
  onClose: () => void;
  onControlsReady?: (c: TreeControls) => void;
  treeControls?: TreeControls | null;
  view: SidebarView;
  selectedTag: string | null;
  onSelectView: (view: SidebarView) => void;
  onSelectTagConsumed: () => void;
  openThreadId: string | null;
  openCollectionId: string | null;
};

const RIBBON_ITEMS: { icon: typeof FileStack; label: string; view: SidebarView }[] = [
  { icon: FileStack, label: "Notes", view: "tree" },
  { icon: Clock, label: "Recent", view: "recent" },
  { icon: Star, label: "Shortcuts", view: "shortcuts" },
  { icon: Bookmark, label: "Bookmarks", view: "bookmarks" },
  { icon: Hash, label: "Tags", view: "tags" },
  { icon: ListTodo, label: "Tasks", view: "tasks" },
  { icon: MessagesSquare, label: "Threads", view: "threads" },
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
  openThreadId,
  openCollectionId,
}: Props) {
  const fileTreeBox = useRef<HTMLDivElement>(null);

  const { settings, updateSettings } = useNotes();
  // The "View" sheet: note order and compact/card rows.
  const [viewSheet, setViewSheet] = useState(false);
  // Viewers of a shared space can't add notes or folders.
  const { canEditSpace } = useCanEdit();

  // Honor the Features toggles: hidden views disappear from the switcher.
  const visibleItems = RIBBON_ITEMS.filter(
    (item) =>
      (item.view !== "tags" || settings.showTagsSection) &&
      (item.view !== "tasks" || settings.showTasksSection) &&
      (item.view !== "threads" || settings.showThreadsSection),
  );

  // If the persisted view is now hidden, fall back to the note tree.
  useEffect(() => {
    if (view === "tags" && !settings.showTagsSection) onSelectView("tree");
    else if (view === "tasks" && !settings.showTasksSection) onSelectView("tree");
    else if (view === "threads" && !settings.showThreadsSection) onSelectView("tree");
  }, [view, settings.showTagsSection, settings.showTasksSection, settings.showThreadsSection, onSelectView]);

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
            openThreadId={openThreadId}
            openCollectionId={openCollectionId}
            onControlsReady={onControlsReady}
            onSelectView={onSelectView}
            touch
          />
        </div>

        {/* Bottom bar of the note tree: labeled actions (an icon alone said
         * too little), each a full-width touch target. */}
        {view === "tree" && (
          <div
            className="shrink-0 flex items-stretch px-1"
            style={{
              paddingTop: 4,
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4px)",
              borderTop: "1px solid var(--mob-surface)",
            }}
          >
            {canEditSpace && (
              <>
                <BarAction label="Note" onClick={newNote}>
                  <FilePlus size={20} />
                </BarAction>
                <BarAction label="Folder" onClick={newFolder}>
                  <FolderPlus size={20} />
                </BarAction>
              </>
            )}
            <BarAction label="View" onClick={() => setViewSheet(true)}>
              <SlidersHorizontal size={20} />
            </BarAction>
            <BarAction
              label={treeControls?.allExpanded ? "Collapse" : "Expand"}
              onClick={() => treeControls?.toggleExpandCollapse()}
            >
              {treeControls?.allExpanded ? <ChevronsDownUp size={20} /> : <ChevronsUpDown size={20} />}
            </BarAction>
            <BarAction label="Settings" onClick={() => window.dispatchEvent(new CustomEvent("nexote:open-settings"))}>
              <Settings size={20} />
            </BarAction>
          </div>
        )}
        {viewSheet && (
          <MobileActionSheet
            title="View"
            onClose={() => setViewSheet(false)}
            sections={[
              (Object.keys(TREE_SORT_LABELS) as TreeSort[]).map((sort) => ({
                label: `Sort: ${TREE_SORT_LABELS[sort]}`,
                icon: <ChevronsUpDown size={18} />,
                checked: settings.treeSort === sort,
                onClick: () => updateSettings({ treeSort: sort }),
              })),
              [
                {
                  label: "Compact rows",
                  icon: <List size={18} />,
                  checked: !settings.treeCards,
                  onClick: () => updateSettings({ treeCards: false }),
                },
                {
                  label: "Cards with preview",
                  icon: <LayoutList size={18} />,
                  checked: settings.treeCards,
                  onClick: () => updateSettings({ treeCards: true }),
                },
              ],
            ]}
          />
        )}
    </div>
  );
}

function BarAction({
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
      onClick={onClick}
      className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors active:bg-[var(--mob-surface)]"
      style={{ color: "var(--mob-muted)" }}
    >
      {children}
      <span className="text-[11px] leading-none">{label}</span>
    </button>
  );
}
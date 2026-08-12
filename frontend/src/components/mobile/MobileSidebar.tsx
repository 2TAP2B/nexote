"use client";

import {
  Bookmark,
  CalendarDays,
  Clock,
  FileStack,
  Hash,
  Images,
  ListTodo,
  Settings,
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

// The mobile sidebar's horizontal icon strip — same views as the desktop
// Ribbon but laid out horizontally for the narrow panel. Tapping an icon
// switches the FileTree's view.
const RIBBON_ITEMS: { icon: typeof FileStack; label: string; view: SidebarView }[] = [
  { icon: FileStack, label: "Notetree", view: "tree" },
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
  view,
  selectedTag,
  onSelectView,
  onSelectTagConsumed,
}: Props) {
  const fileTreeBox = useRef<HTMLDivElement>(null);

  // Selecting a note in the tree should open it AND dismiss the sidebar. The
  // parent already closes on activeId change, but tapping the already-active
  // note keeps the sidebar open — so close on any tap that lands on a note row.
  // The close is deferred to the next tick so the row's React onClick (which
  // opens the note) fires first — calling onClose synchronously in the capture
  // phase would unmount the tree before React processes the click at the target.
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

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close sidebar"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.5)" }}
      />

      {/* Sidebar panel — slides in from the left. */}
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
        {/* Header — title + settings + close */}
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
            Notes
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Settings"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("nexote:open-settings"))
              }
              style={{ color: "var(--mob-muted)" }}
            >
              <Settings size={22} />
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{ color: "var(--mob-muted)" }}
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Horizontal ribbon — view switcher icons. */}
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

        {/* FileTree — renders the selected view. */}
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
      </div>

      <style>{`@keyframes mobSlideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
    </div>
  );
}
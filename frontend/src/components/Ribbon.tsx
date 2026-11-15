"use client";

import {
  Bookmark,
  CalendarDays,
  Clock,
  FileStack,
  Hash,
  Library,
  ListTodo,
  Settings,
  Star,
  Terminal,
} from "lucide-react";

import ThemeToggle from "./ThemeToggle";
import { AccountButton, SpaceSwitcher } from "./spaces/RibbonSpaces";
import { useNotes } from "@/lib/notes-context";

export type SidebarView =
  | "tree"
  | "recent"
  | "shortcuts"
  | "bookmarks"
  | "journal"
  | "tags"
  | "tasks"
  | "collections";

type RibbonProps = {
  activeView: SidebarView;
  onSelectView: (view: SidebarView) => void;
  onOpenDaily: () => void;
  onCommandPalette: () => void;
  onOpenSettings: () => void;
};

export default function Ribbon({
  activeView,
  onSelectView,
  onOpenDaily,
  onCommandPalette,
  onOpenSettings,
}: RibbonProps) {
  const { settings } = useNotes();
  const icons: {
    icon: typeof FileStack;
    label: string;
    view: SidebarView;
    daily?: boolean;
  }[] = [
    { icon: FileStack, label: "Notetree", view: "tree" },
    { icon: Clock, label: "Recent", view: "recent" },
    { icon: Star, label: "Shortcuts", view: "shortcuts" },
    { icon: Bookmark, label: "Bookmarks", view: "bookmarks" },
    ...(settings.showTagsSection ? [{ icon: Hash, label: "Tags", view: "tags" as const }] : []),
    ...(settings.showTasksSection ? [{ icon: ListTodo, label: "Tasks", view: "tasks" as const }] : []),
    { icon: Library, label: "Collections", view: "collections" },
    { icon: CalendarDays, label: "Daily notes", view: "journal", daily: true },
  ];

  return (
    <div
      className="flex h-full w-10 shrink-0 flex-col items-center pt-1"
      style={{ background: "var(--icon-rail)", borderRight: "1px solid var(--border)" }}
    >
      {icons.map((it) => {
        const active = activeView === it.view;
        return (
          <button
            key={it.view}
            type="button"
            aria-label={it.label}
            title={it.label}
            onClick={() => {
              if (it.daily) {
                onSelectView(it.view);
                onOpenDaily();
                return;
              }
              onSelectView(it.view);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-white/5"
            style={
              active
                ? { color: "var(--primary)", background: "color-mix(in oklab, var(--primary) 12%, transparent)" }
                : { color: "var(--muted-foreground)", opacity: 0.7 }
            }
          >
            <it.icon size={18} />
          </button>
        );
      })}

      <button
        type="button"
        aria-label="Command palette"
        title="Command palette"
        onClick={onCommandPalette}
        className="flex h-9 w-9 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground rounded-md hover:bg-white/5"
      >
        <Terminal size={18} />
      </button>

      <div className="flex-1" />

      <div className="flex flex-col items-center pb-2 gap-0.5">
        <SpaceSwitcher />
        <AccountButton />
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
          className="flex h-9 w-9 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground rounded-md hover:bg-white/5"
        >
          <Settings size={18} />
        </button>
        <ThemeToggle />
      </div>
    </div>
  );
}

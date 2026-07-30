"use client";

import {
  Bookmark,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Search,
  Settings,
  Terminal,
} from "lucide-react";

type RibbonProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCommandPalette: () => void;
  onDaily: () => void;
};

// Far-left vertical icon strip, Obsidian-style. The top icon collapses the
// sidebar; below it are the sidebar action icons. Search opens the command
// palette popup rather than switching a sidebar view.
export default function Ribbon({
  collapsed,
  onToggleCollapse,
  onCommandPalette,
  onDaily,
}: RibbonProps) {
  const items: {
    icon: typeof FileText;
    label: string;
    onClick: () => void;
  }[] = [
    { icon: FileText, label: "Files", onClick: () => {} },
    { icon: Bookmark, label: "Bookmarks", onClick: () => {} },
    { icon: Search, label: "Search (Ctrl+P)", onClick: onCommandPalette },
    { icon: CalendarDays, label: "Daily journal", onClick: onDaily },
    { icon: Terminal, label: "Command palette (Ctrl+P)", onClick: onCommandPalette },
  ];

  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/50 py-2">
      {/* Collapse toggle at the very top */}
      <button
        type="button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={onToggleCollapse}
        className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="h-5 w-5" />
        ) : (
          <ChevronLeft className="h-5 w-5" />
        )}
      </button>

      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          aria-label={it.label}
          title={it.label}
          onClick={it.onClick}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <it.icon className="h-5 w-5" />
        </button>
      ))}

      <div className="flex-1" />

      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Settings className="h-5 w-5" />
      </button>
    </div>
  );
}
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

import ThemeToggle from "./ThemeToggle";

type RibbonProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCommandPalette: () => void;
  onDaily: () => void;
};

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
    <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-border py-2" style={{ background: "var(--muted)" }}>
      <button
        type="button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={onToggleCollapse}
        className="mb-1 flex h-8 w-8 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>

      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          aria-label={it.label}
          title={it.label}
          onClick={it.onClick}
          className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <it.icon className="h-4 w-4" />
        </button>
      ))}

      <div className="flex-1" />

      <ThemeToggle />
      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        <Settings className="h-4 w-4" />
      </button>
    </div>
  );
}
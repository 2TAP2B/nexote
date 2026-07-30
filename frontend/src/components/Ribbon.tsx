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
    {
      icon: Terminal,
      label: "Command palette (Ctrl+P)",
      onClick: onCommandPalette,
    },
  ];

  return (
    <div
      className="flex h-full w-10 shrink-0 flex-col items-center pt-1"
      style={{ background: "var(--sidebar)", borderRight: "1px solid var(--border)" }}
    >
      <button
        type="button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={onToggleCollapse}
        className="flex h-9 w-9 items-center justify-center text-muted-foreground/85 transition-colors hover:text-foreground rounded-md hover:bg-white/5"
      >
        {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>

      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          aria-label={it.label}
          title={it.label}
          onClick={it.onClick}
          className="flex h-9 w-9 items-center justify-center text-muted-foreground/85 transition-colors hover:text-foreground rounded-md hover:bg-white/5"
        >
          <it.icon size={18} />
        </button>
      ))}

      <div className="flex-1" />

      <div className="flex flex-col items-center pb-2">
        <ThemeToggle />
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className="flex h-9 w-9 items-center justify-center text-muted-foreground/85 transition-colors hover:text-foreground rounded-md hover:bg-white/5"
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}

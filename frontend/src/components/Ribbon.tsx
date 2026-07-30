"use client";

import {
  CalendarDays,
  FileText,
  Search,
  Settings,
  Terminal,
} from "lucide-react";

export type RibbonView = "files" | "search";

type RibbonProps = {
  view: RibbonView;
  onViewChange: (v: RibbonView) => void;
  onCommandPalette: () => void;
  onDaily: () => void;
};

// Far-left vertical icon strip, Obsidian-style. Each icon switches the sidebar
// view or triggers an action (command palette, daily journal, settings).
export default function Ribbon({
  view,
  onViewChange,
  onCommandPalette,
  onDaily,
}: RibbonProps) {
  const items: {
    icon: typeof FileText;
    label: string;
    active: boolean;
    onClick: () => void;
  }[] = [
    {
      icon: FileText,
      label: "Files",
      active: view === "files",
      onClick: () => onViewChange("files"),
    },
    {
      icon: Search,
      label: "Search",
      active: view === "search",
      onClick: () => onViewChange("search"),
    },
    {
      icon: CalendarDays,
      label: "Daily journal",
      active: false,
      onClick: onDaily,
    },
    {
      icon: Terminal,
      label: "Command palette (Ctrl+P)",
      active: false,
      onClick: onCommandPalette,
    },
  ];

  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/50 py-2">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          aria-label={it.label}
          title={it.label}
          onClick={it.onClick}
          className={[
            "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
            it.active
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          ].join(" ")}
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
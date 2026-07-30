"use client";

import { X } from "lucide-react";

import { useNotes } from "@/lib/notes-context";

// A horizontal tab bar of open notes, Obsidian-style. Click to focus, middle-
// click or the X button to close. The active tab is highlighted.
export default function TabBar() {
  const { openTabs, activeId, notesById, openTab, closeTab } = useNotes();

  if (openTabs.length === 0) return null;

  return (
    <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-border bg-muted/30">
      {openTabs.map((id) => {
        const note = notesById[id];
        const title = note?.title || "Untitled";
        const active = id === activeId;
        return (
          <div
            key={id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            onClick={() => void openTab(id)}
            onMouseDown={(e) => {
              // Middle-click closes the tab.
              if (e.button === 1) {
                e.preventDefault();
                closeTab(id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void openTab(id);
              }
            }}
            className={[
              "group flex max-w-[200px] min-w-[120px] cursor-pointer items-center gap-2 border-r border-border px-3 py-2 text-sm transition-colors",
              active
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            ].join(" ")}
          >
            <span className="truncate">{title}</span>
            <button
              type="button"
              aria-label="Close tab"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(id);
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
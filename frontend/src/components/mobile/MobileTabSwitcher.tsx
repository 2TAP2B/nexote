"use client";

import { FileText, Plus, X } from "lucide-react";

import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";

type Props = {
  onClose: () => void;
  onNewTab: () => void;
};

// Full-screen grid of open tabs (browser-style tab switcher). Each card shows
// a document icon + title; the active tab has an indigo border. Close × on
// each card; "+" and "Done" in the bottom bar.
export default function MobileTabSwitcher({ onClose, onNewTab }: Props) {
  const { openTabs, activeId, notesById, openTab, closeTab } = useNotes();

  const handleClose = (id: string) => {
    closeTab(id);
    // If we closed the last tab, exit the switcher.
    if (openTabs.length <= 1) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--mob-bg)" }}
    >
      <div
        className="shrink-0"
        style={{ height: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
      />
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="grid grid-cols-2 gap-5">
          {openTabs.map((id) => {
            const isDashboard = id === DASHBOARD_ID;
            const note = notesById[id];
            const title = isDashboard ? "Dashboard" : note?.title || "Untitled";
            const isActive = id === activeId;
            return (
              <div key={id} className="relative">
                {/* Close button — top-right, overlapping the card edge. */}
                <button
                  type="button"
                  aria-label="Close tab"
                  onClick={() => handleClose(id)}
                  className="absolute flex items-center justify-center rounded-full"
                  style={{
                    top: -12,
                    right: -8,
                    width: 32,
                    height: 32,
                    background: "var(--mob-surface)",
                    color: "var(--mob-text)",
                    zIndex: 2,
                  }}
                >
                  <X size={16} />
                </button>
                {/* Card */}
                <button
                  type="button"
                  onClick={() => {
                    void openTab(id);
                    onClose();
                  }}
                  className="flex w-full flex-col items-center justify-center"
                  style={{
                    aspectRatio: "3 / 4",
                    borderRadius: 20,
                    background: "var(--mob-card)",
                    border: isActive
                      ? "4px solid var(--mob-accent)"
                      : "4px solid transparent",
                  }}
                >
                  <FileText
                    size={48}
                    style={{ color: "var(--mob-muted)" }}
                  />
                </button>
                {/* Title label under the card. */}
                <div
                  className="mt-2 truncate text-center text-sm"
                  style={{ color: "var(--mob-text)" }}
                >
                  {title}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom control bar. */}
      <div
        className="flex shrink-0 items-center justify-between px-6"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
          paddingTop: 16,
        }}
      >
        <button
          type="button"
          aria-label="New tab"
          onClick={onNewTab}
          style={{ color: "var(--mob-text)" }}
        >
          <Plus size={26} />
        </button>
        <div
          className="flex items-center gap-1 text-base"
          style={{ color: "var(--mob-text)" }}
        >
          {openTabs.length} {openTabs.length === 1 ? "tab" : "tabs"}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-base font-semibold"
          style={{ color: "var(--mob-done)" }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
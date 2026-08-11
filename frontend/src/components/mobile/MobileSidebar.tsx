"use client";

import { Settings, X } from "lucide-react";
import { useState } from "react";

import FileTree, { type TreeControls } from "@/components/FileTree";
import SettingsPanel from "@/components/SettingsPanel";

type Props = {
  onClose: () => void;
  onControlsReady?: (c: TreeControls) => void;
  treeControls?: TreeControls | null;
};

// Slide-in sidebar for mobile. Renders the existing FileTree (compact, active
// vault) at ~82% width with a backdrop. Tapping the backdrop or the close
// button dismisses it. Opening a note closes the sidebar (handled by the
// parent via the tree's openTab). A settings button in the header opens the
// shared SettingsPanel.
export default function MobileSidebar({ onClose, onControlsReady }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [colorScheme, setColorScheme] = useState("default");

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
        className="relative flex h-full flex-col"
        style={{
          width: "82vw",
          maxWidth: 340,
          background: "var(--mob-bg)",
          borderRight: "1px solid var(--mob-surface)",
          animation: "mobSlideInLeft 0.22s ease",
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between px-4"
          style={{
            height: "calc(env(safe-area-inset-top, 0px) + 52px)",
            paddingTop: "env(safe-area-inset-top, 0px)",
            borderBottom: "1px solid var(--mob-surface)",
          }}
        >
          <span
            className="text-base font-semibold"
            style={{ color: "var(--mob-text)" }}
          >
            Notes
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
              style={{ color: "var(--mob-muted)" }}
            >
              <Settings size={20} />
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{ color: "var(--mob-muted)" }}
            >
              <X size={22} />
            </button>
          </div>
        </div>

        <div
          className="nexote-sidebar min-h-0 flex-1 overflow-y-auto"
          style={{ color: "var(--mob-text)" }}
        >
          <FileTree
            collapsed={false}
            view="tree"
            onControlsReady={onControlsReady}
            onSelectView={() => {
              /* view switching deferred on mobile */
            }}
          />
        </div>
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        colorScheme={colorScheme}
        onColorSchemeChange={setColorScheme}
      />

      <style>{`@keyframes mobSlideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
    </div>
  );
}
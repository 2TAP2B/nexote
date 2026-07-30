"use client";

import { useState } from "react";

import EditorPane from "@/components/EditorPane";
import Shortcuts from "@/components/Shortcuts";
import Sidebar from "@/components/Sidebar";
import { NotesProvider } from "@/lib/notes-context";

export default function Page() {
  // On mobile the sidebar is an overlay toggled by a top-bar menu button; on
  // md+ it is a static column. This state only affects small screens.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <NotesProvider>
      <Shortcuts />
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden md:flex-row">
        {/* Mobile top bar */}
        <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 md:hidden">
          <button
            type="button"
            aria-label="Toggle notes list"
            onClick={() => setSidebarOpen((v) => !v)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground"
          >
            ☰
          </button>
          <span className="text-sm font-semibold">Nexote</span>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {/* Sidebar: static on md+, slide-in overlay on mobile */}
          <Sidebar
            mobileOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
          {sidebarOpen && (
            <button
              type="button"
              aria-label="Close notes list"
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 z-10 bg-black/30 md:hidden"
            />
          )}
          <EditorPane />
        </div>
      </div>
    </NotesProvider>
  );
}
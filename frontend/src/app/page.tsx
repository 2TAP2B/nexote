"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import EditorPane from "@/components/EditorPane";
import Shortcuts from "@/components/Shortcuts";
import Sidebar from "@/components/Sidebar";
import { NotesProvider } from "@/lib/notes-context";
import { useSwipeSidebar } from "@/components/useSwipeSidebar";

export default function Page() {
  // On mobile the sidebar is an overlay toggled by a top-bar menu button and
  // by horizontal swipe gestures; on md+ it is a static column that can also
  // be folded to a narrow rail.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useSwipeSidebar({
    open: mobileOpen,
    onOpen: () => setMobileOpen(true),
    onClose: () => setMobileOpen(false),
  });

  return (
    <NotesProvider>
      <Shortcuts />
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background md:flex-row">
        {/* Mobile top bar */}
        <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 backdrop-blur md:hidden">
          <button
            type="button"
            aria-label="Toggle notes list"
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-foreground transition-colors hover:bg-muted"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">Nexote</span>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <Sidebar
            mobileOpen={mobileOpen}
            onClose={() => setMobileOpen(false)}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((v) => !v)}
          />
          {mobileOpen && (
            <button
              type="button"
              aria-label="Close notes list"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 z-20 bg-black/40 backdrop-blur-sm md:hidden"
            />
          )}
          <EditorPane />
        </div>
      </div>
    </NotesProvider>
  );
}
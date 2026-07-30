"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";

import CommandPalette from "@/components/CommandPalette";
import EditorPane from "@/components/EditorPane";
import FileTree from "@/components/FileTree";
import Ribbon, { type RibbonView } from "@/components/Ribbon";
import SearchView from "@/components/SearchView";
import Shortcuts from "@/components/Shortcuts";
import TabBar from "@/components/TabBar";
import ThemeToggle from "@/components/ThemeToggle";
import { useSwipeSidebar } from "@/components/useSwipeSidebar";
import { NotesProvider, useNotes } from "@/lib/notes-context";

export default function Page() {
  return (
    <NotesProvider>
      <AppShell />
    </NotesProvider>
  );
}

// AppShell lives inside NotesProvider so it can read openDaily from context
// and pass it to the Ribbon without DOM hacks.
function AppShell() {
  const { openDaily } = useNotes();
  const [view, setView] = useState<RibbonView>("files");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useSwipeSidebar({
    open: mobileOpen,
    onOpen: () => setMobileOpen(true),
    onClose: () => setMobileOpen(false),
  });

  return (
    <>
      <Shortcuts onOpenPalette={() => setPaletteOpen(true)} />
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
          {/* Ribbon (desktop only; on mobile the menu button suffices) */}
          <div className="hidden md:flex">
            <Ribbon
              view={view}
              onViewChange={setView}
              onCommandPalette={() => setPaletteOpen(true)}
              onDaily={() => void openDaily()}
            />
          </div>

          {/* Sidebar: FileTree or SearchView. Collapsible on desktop, overlay
              on mobile. */}
          <aside
            className={[
              "flex h-full shrink-0 flex-col border-r border-border bg-muted/30 backdrop-blur transition-[width] duration-200",
              collapsed ? "md:w-14 w-64" : "w-64",
              "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-xl max-md:transition-transform max-md:duration-200",
              mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
              "md:static md:translate-x-0",
            ].join(" ")}
          >
            <SidebarHeader
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((v) => !v)}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              {collapsed ? (
                <FileTree collapsed />
              ) : view === "files" ? (
                <FileTree collapsed={false} />
              ) : (
                <SearchView />
              )}
            </div>
          </aside>
          {mobileOpen && (
            <button
              type="button"
              aria-label="Close notes list"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 z-20 bg-black/40 backdrop-blur-sm md:hidden"
            />
          )}

          {/* Main: tab bar + editor */}
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <TabBar />
            <EditorPane />
          </main>
        </div>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
        />
      </div>
    </>
  );
}

// Sidebar header with the collapse toggle and theme toggle.
function SidebarHeader({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <div
      className={[
        "flex items-center px-3 py-2",
        collapsed ? "md:justify-center md:px-2" : "justify-between",
      ].join(" ")}
    >
      <ThemeToggle />
      <button
        type="button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={onToggleCollapse}
        className="hidden h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
      >
        {collapsed ? (
          <PanelLeftOpen className="h-4 w-4" />
        ) : (
          <PanelLeftClose className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
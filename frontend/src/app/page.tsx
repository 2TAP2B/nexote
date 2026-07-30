"use client";

import {
  ArrowDownAZ,
  ChevronsDownUp,
  FolderPlus,
  Menu,
  PanelLeftClose,
  Pen,
} from "lucide-react";
import { useState } from "react";

import CommandPalette from "@/components/CommandPalette";
import EditorPane from "@/components/EditorPane";
import FileTree, { type TreeControls } from "@/components/FileTree";
import Ribbon from "@/components/Ribbon";
import Shortcuts from "@/components/Shortcuts";
import TabBar from "@/components/TabBar";
import { useSwipeSidebar } from "@/components/useSwipeSidebar";
import { NotesProvider, useNotes } from "@/lib/notes-context";

export default function Page() {
  return (
    <NotesProvider>
      <AppShell />
    </NotesProvider>
  );
}

function AppShell() {
  const { openDaily } = useNotes();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Shared tree controls so the sidebar header buttons can drive the tree.
  const [treeControls, setTreeControls] = useState<TreeControls>({
    expandAll: () => {},
    collapseAll: () => {},
    toggleSort: () => {},
    sorted: false,
  });

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
          {/* Ribbon (desktop only) */}
          <div className="hidden md:flex">
            <Ribbon
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((v) => !v)}
              onCommandPalette={() => setPaletteOpen(true)}
              onDaily={() => void openDaily()}
            />
          </div>

          {/* Sidebar: FileTree + a header with action buttons. */}
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
              onCollapseSidebar={() => setCollapsed(true)}
              treeControls={treeControls}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <FileTree
                collapsed={collapsed}
                onControlsReady={setTreeControls}
              />
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
            <TabBar onOpenPalette={() => setPaletteOpen(true)} />
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

// Sidebar header with the action button row: new note, new folder, sort A-Z,
// expand all, collapse all, collapse sidebar. Hidden when collapsed (the
// ribbon's collapse toggle expands it back).
function SidebarHeader({
  collapsed,
  onCollapseSidebar,
  treeControls,
}: {
  collapsed: boolean;
  onCollapseSidebar: () => void;
  treeControls: TreeControls;
}) {
  if (collapsed) return null;

  return (
    <div className="flex items-center gap-0.5 border-b border-border px-2 py-1.5">
      <ActionButton
        label="New note"
        icon={<Pen className="h-4 w-4" />}
        onClick={() => {
          // new note — delegate to the tree's create via a synthetic event
          document
            .getElementById("nexote-new-note-btn")
            ?.click();
        }}
      />
      <ActionButton
        label="New folder"
        icon={<FolderPlus className="h-4 w-4" />}
        onClick={() => {
          document
            .getElementById("nexote-new-folder-btn")
            ?.click();
        }}
      />
      <ActionButton
        label={treeControls.sorted ? "Sort: A-Z (on)" : "Sort A-Z"}
        icon={<ArrowDownAZ className="h-4 w-4" />}
        onClick={treeControls.toggleSort}
        active={treeControls.sorted}
      />
      <ActionButton
        label="Expand all"
        icon={<ChevronsDownUp className="h-4 w-4 rotate-180" />}
        onClick={treeControls.expandAll}
      />
      <ActionButton
        label="Collapse all"
        icon={<ChevronsDownUp className="h-4 w-4" />}
        onClick={treeControls.collapseAll}
      />
      <div className="flex-1" />
      <ActionButton
        label="Collapse sidebar"
        icon={<PanelLeftClose className="h-4 w-4" />}
        onClick={onCollapseSidebar}
      />
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  active,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      ].join(" ")}
    >
      {icon}
    </button>
  );
}
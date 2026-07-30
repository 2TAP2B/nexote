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
  const [treeControls, setTreeControls] = useState<TreeControls>({
    expandAll: () => {},
    collapseAll: () => {},
    toggleSort: () => {},
    sorted: false,
    allExpanded: true,
    toggleExpandCollapse: () => {},
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
        <header className="flex items-center gap-2 px-3 py-2 md:hidden" style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
          <button
            type="button"
            aria-label="Toggle notes list"
            onClick={() => setMobileOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center text-foreground transition-colors hover:opacity-70"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-medium">Nexote</span>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {/* Ribbon */}
          <div className="hidden md:flex">
            <Ribbon
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((v) => !v)}
              onCommandPalette={() => setPaletteOpen(true)}
              onDaily={() => void openDaily()}
            />
          </div>

          {/* Sidebar: 300px, subtle surface, no visible border (color diff). */}
          <aside
            className={[
              "flex h-full shrink-0 flex-col transition-[width] duration-200",
              collapsed ? "md:w-12 w-[300px]" : "w-[300px]",
              "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-xl max-md:transition-transform max-md:duration-200",
              mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
              "md:static md:translate-x-0",
            ].join(" ")}
            style={{ background: "var(--muted)" }}
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
              className="absolute inset-0 z-20 md:hidden"
              style={{ background: "rgba(0,0,0,0.4)" }}
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

// Sidebar header: compact action buttons. Hidden when collapsed.
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
    <div
      className="flex items-center gap-0.5 px-2 py-1.5"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <ActionButton
        label="New note"
        icon={<Pen className="h-3.5 w-3.5" />}
        onClick={() => document.getElementById("nexote-new-note-btn")?.click()}
      />
      <ActionButton
        label="New folder"
        icon={<FolderPlus className="h-3.5 w-3.5" />}
        onClick={() => document.getElementById("nexote-new-folder-btn")?.click()}
      />
      <ActionButton
        label={treeControls.sorted ? "Sort: A-Z (on)" : "Sort A-Z"}
        icon={<ArrowDownAZ className="h-3.5 w-3.5" />}
        onClick={treeControls.toggleSort}
        active={treeControls.sorted}
      />
      <ActionButton
        label={treeControls.allExpanded ? "Collapse all folders" : "Expand all folders"}
        icon={
          treeControls.allExpanded ? (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronsDownUp className="h-3.5 w-3.5 rotate-180" />
          )
        }
        onClick={treeControls.toggleExpandCollapse}
      />
      <div className="flex-1" />
      <ActionButton
        label="Collapse sidebar"
        icon={<PanelLeftClose className="h-3.5 w-3.5" />}
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
        "flex h-7 w-7 items-center justify-center transition-colors",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
      style={active ? { background: "color-mix(in oklab, var(--primary) 12%, transparent)" } : undefined}
    >
      {icon}
    </button>
  );
}
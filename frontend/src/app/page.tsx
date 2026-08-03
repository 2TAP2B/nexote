"use client";

import {
  ArrowDownAZ,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  Database,
  FilePlus,
  Folder,
  FolderPlus,
  LayoutList,
  Menu,
  PanelLeftClose,
  Search,
  Settings,
  SquareStack,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import CommandPalette from "@/components/CommandPalette";
import EditorPane from "@/components/EditorPane";
import FileTree, { type TreeControls } from "@/components/FileTree";
import MobileBottomBar from "@/components/MobileBottomBar";
import Ribbon from "@/components/Ribbon";
import SettingsPanel from "@/components/SettingsPanel";
import Shortcuts from "@/components/Shortcuts";
import TopBar from "@/components/TopBar";
import { useSwipeSidebar } from "@/components/useSwipeSidebar";
import { DASHBOARD_ID, NotesProvider, useNotes } from "@/lib/notes-context";

export default function Page() {
  return (
    <NotesProvider>
      <AppShell />
    </NotesProvider>
  );
}

function AppShell() {
  const { openDaily, create, openTab } = useNotes();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [treeControls, setTreeControls] = useState<TreeControls>({
    expandAll: () => {},
    collapseAll: () => {},
    toggleSort: () => {},
    sorted: false,
    allExpanded: true,
    toggleExpandCollapse: () => {},
    allSectionsExpanded: true,
    toggleSectionsCollapse: () => {},
  });

  useSwipeSidebar({
    open: mobileOpen,
    onOpen: () => setMobileOpen(true),
    onClose: () => setMobileOpen(false),
  });

  // Listen for the "toggle sidebar" event dispatched by keyboard shortcuts
  // (Ctrl/Cmd+B or Ctrl/Cmd+\). On desktop it collapses/expands; on mobile it
  // opens/closes the drawer.
  useEffect(() => {
    const onToggle = () => {
      if (window.matchMedia("(max-width: 767px)").matches) {
        setMobileOpen((v) => !v);
      } else {
        setCollapsed((v) => !v);
      }
    };
    const onOpenPalette = () => setPaletteOpen(true);
    const onOpenSettings = () => setSettingsOpen(true);
    window.addEventListener("nexote:toggle-sidebar", onToggle);
    window.addEventListener("nexote:open-palette", onOpenPalette);
    window.addEventListener("nexote:open-settings", onOpenSettings);
    return () => {
      window.removeEventListener("nexote:toggle-sidebar", onToggle);
      window.removeEventListener("nexote:open-palette", onOpenPalette);
      window.removeEventListener("nexote:open-settings", onOpenSettings);
    };
  }, []);

  // Persist + hydrate sidebar width (drag-to-resize). SSR-safe via effect.
  useEffect(() => {
    const saved = localStorage.getItem("nexote:sidebar-width");
    if (saved) {
      const w = parseInt(saved, 10);
      if (!Number.isNaN(w)) setSidebarWidth(Math.min(Math.max(w, 220), 560));
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("nexote:sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(Math.max(startW + (ev.clientX - startX), 220), 560);
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  return (
    <>
      <Shortcuts onOpenPalette={() => setPaletteOpen(true)} />
      <div className="flex w-full flex-col bg-background viewport-full">
        {/* Full-width top bar (desktop) — includes collapse toggle at far left */}
        <div
          className="hidden md:flex shrink-0"
          style={{ height: 40, background: "var(--tab-active)", borderBottom: "1px solid var(--border)" }}
        >
          {/* Left section: collapse toggle + folder/search/bookmark above sidebar */}
          <div
            className={
              "flex items-center gap-0.5 shrink-0 transition-[width] duration-200 " +
              (collapsed ? "w-12 pl-0 justify-center" : "pl-3")
            }
            style={collapsed ? undefined : { width: sidebarWidth }}
          >
            <button
              type="button"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed((v) => !v)}
              className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 hover:text-foreground rounded-md hover:bg-white/5"
            >
              {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
            {!collapsed && (
              <>
                <button
                  type="button"
                  aria-label="File tree"
                  title="File tree"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("nexote:show-filetree"),
                    )
                  }
                  className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 hover:text-foreground rounded-md hover:bg-white/5"
                >
                  <Folder size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Search"
                  title="Search"
                  onClick={() => setPaletteOpen(true)}
                  className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 hover:text-foreground rounded-md hover:bg-white/5"
                >
                  <Search size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Bookmarks"
                  title="Bookmarks"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("nexote:toggle-bookmarks"),
                    )
                  }
                  className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 hover:text-foreground rounded-md hover:bg-white/5"
                >
                  <Bookmark size={18} />
                </button>
              </>
            )}
          </div>
          <div className="flex-1 min-w-0 h-full">
            <TopBar
              onOpenPalette={() => setPaletteOpen(true)}
              onOpenDashboard={() => void openTab(DASHBOARD_ID)}
            />
          </div>
        </div>

        {/* Below: Ribbon + sidebar + editor */}
        <div className="relative flex flex-1 min-h-0 flex-col md:flex-row">
          {/* Mobile header — in flex flow on mobile, pushes content down */}
          <header
            className="flex items-center gap-2 px-3 md:hidden shrink-0 z-10"
            style={{ height: 40, background: "var(--tab-active)", borderBottom: "1px solid var(--border)" }}
          >
            <button
              type="button"
              aria-label="Toggle notes list"
              onClick={() => setMobileOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center text-muted-foreground/70"
            >
              <Menu size={18} />
            </button>
            <span className="text-sm font-medium" style={{ opacity: 0.7 }}>Nexote</span>
          </header>

          {/* Ribbon: vertical icon strip (desktop only, below top bar) */}
          <div className="hidden md:flex shrink-0">
            <Ribbon
              onCommandPalette={() => setPaletteOpen(true)}
              onDaily={() => void openDaily()}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>

          {/* Sidebar */}
          <aside
            className={[
              "flex h-full shrink-0 flex-col transition-[width] duration-200",
              collapsed ? "md:w-0 overflow-hidden" : "",
              "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-xl max-md:transition-transform max-md:duration-200 max-md:pt-10",
              mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
              "md:static md:translate-x-0 md:pt-0",
            ].join(" ")}
            style={{
              background: "var(--sidebar)",
              ...(collapsed ? {} : { width: sidebarWidth }),
            }}
          >
            <SidebarHeader
              collapsed={collapsed}
              onCollapseSidebar={() => setCollapsed(true)}
              onNewNote={() => void create()}
              treeControls={treeControls}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <FileTree
                collapsed={collapsed}
                onControlsReady={setTreeControls}
              />
            </div>
          </aside>
          {!collapsed && (
            <div
              onMouseDown={startResize}
              className="hidden md:flex shrink-0 cursor-col-resize items-center justify-center"
              style={{ width: 5, background: "transparent", zIndex: 5 }}
              title="Drag to resize"
            >
              <div
                className="h-full w-px"
                style={{ background: "var(--border)" }}
              />
            </div>
          )}
          {mobileOpen && (
            <button
              type="button"
              aria-label="Close notes list"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 z-20 md:hidden"
              style={{ background: "rgba(0,0,0,0.4)" }}
            />
          )}

          <main className="flex min-w-0 flex-1 flex-col min-h-0 overflow-hidden">
            <EditorPane />
          </main>
        </div>

        <MobileBottomBar onOpenPalette={() => setPaletteOpen(true)} />

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
        />

        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
    </>
  );
}

function SidebarHeader({
  collapsed,
  onCollapseSidebar,
  onNewNote,
  treeControls,
}: {
  collapsed: boolean;
  onCollapseSidebar: () => void;
  onNewNote: () => void;
  treeControls: TreeControls;
}) {
  if (collapsed) return null;

  return (
    <div className="flex flex-col" style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Action buttons */}
      <div className="flex items-center gap-0.5 px-2 py-1.5">
        <ActionButton
          label="New note"
          icon={<FilePlus className="h-3.5 w-3.5" />}
          onClick={onNewNote}
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
          label="Card view"
          icon={<LayoutList className="h-3.5 w-3.5" />}
          onClick={() => {}}
          active={false}
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
        <ActionButton
          label={
            treeControls.allSectionsExpanded
              ? "Collapse all sections"
              : "Expand all sections"
          }
          icon={<SquareStack className="h-3.5 w-3.5" />}
          onClick={treeControls.toggleSectionsCollapse}
          active={false}
        />
        <div className="flex-1" />
        <ActionButton
          label="Collapse sidebar"
          icon={<PanelLeftClose className="h-3.5 w-3.5" />}
          onClick={onCollapseSidebar}
        />
      </div>
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
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
      style={
        active
          ? { background: "color-mix(in oklab, var(--primary) 12%, transparent)" }
          : undefined
      }
    >
      {icon}
    </button>
  );
}

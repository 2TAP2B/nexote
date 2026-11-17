"use client";

import {
  ArrowDownWideNarrow,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus,
  FolderPlus,
  LayoutList,
  LocateFixed,
  Menu,
  PanelLeftClose,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { AuthGate } from "@/components/auth/AuthProvider";
import { AuthSplash } from "@/components/auth/AuthScreens";
import CommandPalette from "@/components/CommandPalette";
import ContextMenu from "@/components/ContextMenu";
import CollectionFormDialog from "@/components/CollectionFormDialog";
import CollectionGallery from "@/components/CollectionGallery";
import EditorPane from "@/components/EditorPane";
import FileTree, { TREE_SORT_LABELS, type TreeControls } from "@/components/FileTree";
import MobileBottomBar from "@/components/MobileBottomBar";
import Ribbon, { type SidebarView } from "@/components/Ribbon";
import SettingsPanel from "@/components/SettingsPanel";
import Shortcuts from "@/components/Shortcuts";
import TopBar from "@/components/TopBar";
import { useCanEdit } from "@/components/useCanEdit";
import { useSwipeSidebar } from "@/components/useSwipeSidebar";
import MobileApp from "@/components/mobile/MobileApp";
import { api } from "@/lib/api";
import type { CollectionMeta } from "@/lib/api";
import { DASHBOARD_ID, NotesProvider, useNotes, type TreeSort } from "@/lib/notes-context";
import { pickShell, savedInterfaceMode, type Shell } from "@/lib/shell";

// One address for every device: the touch interface (phones, tablets, narrow
// windows) or the desktop one, chosen once when the app starts (Settings ›
// General › Interface). Not switched on resize or rotation, which would
// remount the editor mid-typing. The server renders neither (the choice
// needs the device), so nothing mismatches on hydration.
const startShell = { current: null as Shell | null };
function useStartShell(): Shell | null {
  return useSyncExternalStore(
    () => () => {},
    () => (startShell.current ??= pickShell(savedInterfaceMode())),
    () => null,
  );
}

export default function Page() {
  const shell = useStartShell();
  // Server render (static HTML) and the first client frame: the splash, so
  // something branded shows before the scripts have loaded.
  if (!shell) return <AuthSplash />;
  return (
    <AuthGate>
      <NotesProvider>
        <ShellSwitch shell={shell} />
        {shell === "touch" ? <MobileApp /> : <AppShell />}
      </NotesProvider>
    </AuthGate>
  );
}

// Settings › General › Interface changed to a mode that picks the other
// shell: reload into it. Reads the saved value, not settings.interface:
// NotesProvider starts with the defaults before it loads the saved settings,
// and that first "auto" must not count as a change.
function ShellSwitch({ shell }: { shell: Shell }) {
  const { settings } = useNotes();
  useEffect(() => {
    if (pickShell(savedInterfaceMode()) !== shell) window.location.reload();
  }, [settings.interface, shell]);
  return null;
}

function AppShell() {
  const { openDaily, openTab, openNoteInVault, activeNote, create, listCollections } = useNotes();
  const { canEditSpace } = useCanEdit();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>("tree");
  // Restore the last sidebar section after mount so a reload reopens where
  // the user left off (same storage key as the mobile shell). Effect-based
  // restore — a localStorage useState initializer breaks hydration.
  useEffect(() => {
    const saved = localStorage.getItem("nexote:sidebar-view");
    if (saved && saved !== "tree" && saved !== "images") {
      setSidebarView(saved as SidebarView);
    }
  }, []);
  // Features toggles: if the persisted/active view is hidden, fall back to tree.
  const { settings } = useNotes();
  useEffect(() => {
    if (sidebarView === "tags" && !settings.showTagsSection) setSidebarView("tree");
    else if (sidebarView === "tasks" && !settings.showTasksSection) setSidebarView("tree");
  }, [sidebarView, settings.showTagsSection, settings.showTasksSection]);
  const [tagSelection, setTagSelection] = useState<string | null>(null);
  const [colorScheme, setColorScheme] = useState<string>("default");
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [galleryCollection, setGalleryCollection] = useState<CollectionMeta | null>(null);
  const [collectionFormOpen, setCollectionFormOpen] = useState(false);
  const [treeControls, setTreeControls] = useState<TreeControls>({
    allExpanded: true,
    toggleExpandCollapse: () => {},
    revealActive: () => {},
  });

  useSwipeSidebar({
    focus: mobileOpen ? "sidebar" : "editor",
    // No spaces pane in this drawer layout: swiping past the tree keeps it open.
    onFocus: (pane) => setMobileOpen(pane === "sidebar" || pane === "spaces"),
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
    const onSelectView = (e: Event) => {
      const detail = (e as CustomEvent).detail as SidebarView;
      if (detail) setSidebarView(detail);
    };    const onSelectTag = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if (detail) {
        setTagSelection(detail);
        setSidebarView("tags");
      }
    };
    const onOpenCollection = (e: Event) => {
      const folder = (e as CustomEvent).detail as string;
      if (!folder) return;
      void listCollections().then((cols) => {
        const col = cols.find((c) => c.name === folder);
        if (col) setGalleryCollection(col);
      });
    };
    window.addEventListener("nexote:toggle-sidebar", onToggle);
    window.addEventListener("nexote:open-palette", onOpenPalette);
    window.addEventListener("nexote:open-settings", onOpenSettings);
    window.addEventListener("nexote:select-view", onSelectView as EventListener);
    window.addEventListener("nexote:select-tag", onSelectTag as EventListener);
    window.addEventListener("nexote:open-collection", onOpenCollection as EventListener);
    const onNewCollection = () => setCollectionFormOpen(true);
    window.addEventListener("nexote:new-collection", onNewCollection);
    return () => {
      window.removeEventListener("nexote:toggle-sidebar", onToggle);
      window.removeEventListener("nexote:open-palette", onOpenPalette);
      window.removeEventListener("nexote:open-settings", onOpenSettings);
      window.removeEventListener("nexote:select-view", onSelectView as EventListener);
      window.removeEventListener("nexote:select-tag", onSelectTag as EventListener);
      window.removeEventListener("nexote:open-collection", onOpenCollection as EventListener);
      window.removeEventListener("nexote:new-collection", onNewCollection);
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

  // Persist the sidebar section so a reload reopens where the user left off.
  useEffect(() => {
    localStorage.setItem("nexote:sidebar-view", sidebarView);
  }, [sidebarView]);

  // Hydrate + sync the color scheme class on <html>.
  useEffect(() => {
    const saved = localStorage.getItem("nexote:color-scheme");
    if (saved) setColorScheme(saved);
  }, []);

  // Persistent desktop TOC panel: survives gallery open/close and reloads.
  const [tocOpen, setTocOpen] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("nexote:toc-open") === "1") setTocOpen(true);
  }, []);
  useEffect(() => {
    localStorage.setItem("nexote:toc-open", tocOpen ? "1" : "0");
  }, [tocOpen]);
  useEffect(() => {
    const el = document.documentElement;
    // Remove any existing scheme-* class, then add the new one (if not default).
    el.classList.forEach((c) => {
      if (c.startsWith("scheme-")) el.classList.remove(c);
    });
    if (colorScheme && colorScheme !== "default") {
      el.classList.add(`scheme-${colorScheme}`);
    }
    try {
      localStorage.setItem("nexote:color-scheme", colorScheme);
    } catch {
      // ignore
    }
  }, [colorScheme]);

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
          {/* Left section: collapse toggle + search above sidebar */}
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
              <button
                type="button"
                aria-label="Search"
                title="Search"
                onClick={() => setPaletteOpen(true)}
                className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 hover:text-foreground rounded-md hover:bg-white/5"
              >
                <Search size={18} />
              </button>
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
              activeView={sidebarView}
              onSelectView={setSidebarView}
              onOpenDaily={() => void openDaily()}
              onCommandPalette={() => setPaletteOpen(true)}
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
              view={sidebarView}
              onCollapseSidebar={() => setCollapsed(true)}
              onNewNote={() => document.getElementById("nexote-new-note-btn")?.click()}
              onOpenDaily={() => void openDaily()}
              treeControls={treeControls}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <FileTree
                collapsed={collapsed}
                view={sidebarView}
                selectedTag={tagSelection}
                onSelectTagConsumed={() => setTagSelection(null)}
                onSelectView={setSidebarView}
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
            {galleryCollection ? (
              <CollectionGallery
                embedded
                open={Boolean(galleryCollection)}
                collection={galleryCollection}
                onClose={() => {
                  setSidebarView("collections");
                  setGalleryCollection(null);
                }}
                onExit={() => {
                  // Leaving the gallery returns to the dashboard, not back to an
                  // item still open as the active note (which would loop).
                  setSidebarView("collections");
                  setGalleryCollection(null);
                  void openTab(DASHBOARD_ID);
                }}
                onOpenNote={(vaultId, id) => void openNoteInVault(vaultId, id)}
                onCollectionChanged={setGalleryCollection}
              />
            ) : (
              <EditorPane
                tocOpen={tocOpen}
                onToggleToc={() => setTocOpen((v) => !v)}
                onCloseCollectionItem={() => {
                  // Returning to the gallery also brings the sidebar back to
                  // the Collections section, so the user keeps browsing there.
                  setSidebarView("collections");
                  const col = activeNote?.collection;
                  if (col) {
                    void listCollections().then((cols) => {
                      const found = cols.find((c) => c.id === col);
                      if (found) setGalleryCollection(found);
                    });
                  }
                }}
              />
            )}
          </main>
        </div>

        {/* Floating new-note button (desktop only); viewers can't add notes. */}
        {canEditSpace && (
          <button
            type="button"
            aria-label="New note"
            title="New note"
            onClick={() => void create()}
            className="nexote-fab fixed bottom-6 right-6 z-30 hidden md:flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-[transform,bottom] hover:scale-105 active:scale-95"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            <FilePlus className="h-5 w-5" />
          </button>
        )}

        <MobileBottomBar onOpenPalette={() => setPaletteOpen(true)} />

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
        />

        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          colorScheme={colorScheme}
          onColorSchemeChange={setColorScheme}
        />

<CollectionFormDialog
          open={collectionFormOpen}
          onClose={() => setCollectionFormOpen(false)}
          onSaved={() => {
            setCollectionFormOpen(false);
            window.dispatchEvent(new CustomEvent("nexote:refresh-data"));
          }}
        />
      </div>
    </>
  );
}

const VIEW_TITLES: Record<Exclude<SidebarView, "tree">, string> = {
  recent: "Recent",
  shortcuts: "Shortcuts",
  bookmarks: "Bookmarks",
  journal: "Daily notes",
  tags: "Tags",
  tasks: "Tasks",
  collections: "Collections",
};

function SidebarHeader({
  collapsed,
  view,
  onCollapseSidebar,
  onNewNote,
  onOpenDaily,
  treeControls,
}: {
  collapsed: boolean;
  view: SidebarView;
  onCollapseSidebar: () => void;
  onNewNote: () => void;
  onOpenDaily: () => void;
  treeControls: TreeControls;
}) {
  // Viewers of a shared space can't add notes or folders (hooks before the early return).
  const { canEditSpace } = useCanEdit();
  const { settings, updateSettings, activeNote } = useNotes();
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  if (collapsed) return null;

  // Non-tree views: title-only bar with New note (+ Open today for journal).
  if (view !== "tree") {
    return (
      <div
        className="flex items-center gap-0.5 px-2 py-1.5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span
          className="truncate px-1 text-sm font-medium"
          style={{ color: "var(--foreground)" }}
        >
          {VIEW_TITLES[view]}
        </span>
        <div className="flex-1" />
        {view === "journal" && (
          <ActionButton
            label="Open today's note"
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            onClick={onOpenDaily}
          />
        )}
        {canEditSpace && (
          <ActionButton
            label="New note"
            icon={<FilePlus className="h-3.5 w-3.5" />}
            onClick={onNewNote}
          />
        )}
        <ActionButton
          label="Collapse sidebar"
          icon={<PanelLeftClose className="h-3.5 w-3.5" />}
          onClick={onCollapseSidebar}
        />
      </div>
    );
  }

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Root tree header */}
      <div className="flex items-center gap-0.5 px-2 py-1.5">
        {canEditSpace && (
          <>
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
          </>
        )}
        <ActionButton
          label={`Sort notes: ${TREE_SORT_LABELS[settings.treeSort]}`}
          icon={<ArrowDownWideNarrow className="h-3.5 w-3.5" />}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setSortMenu({ x: r.left, y: r.bottom + 4 });
          }}
          active={sortMenu !== null}
        />
        <ActionButton
          label={settings.treeCards ? "Compact view" : "Card view (previews)"}
          icon={<LayoutList className="h-3.5 w-3.5" />}
          onClick={() => updateSettings({ treeCards: !settings.treeCards })}
          active={settings.treeCards}
        />
        <ActionButton
          label="Show current note in the tree"
          icon={<LocateFixed className="h-3.5 w-3.5" />}
          onClick={treeControls.revealActive}
          disabled={!activeNote}
        />
        <ActionButton
          label={treeControls.allExpanded ? "Collapse all" : "Expand all"}
          icon={
            treeControls.allExpanded ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )
          }
          onClick={treeControls.toggleExpandCollapse}
        />
        {sortMenu && (
          <ContextMenu
            x={sortMenu.x}
            y={sortMenu.y}
            onClose={() => setSortMenu(null)}
            items={(Object.keys(TREE_SORT_LABELS) as TreeSort[]).map((sort) => ({
              label: TREE_SORT_LABELS[sort],
              icon: settings.treeSort === sort ? <Check className="h-4 w-4" /> : <span className="inline-block h-4 w-4" />,
              onClick: () => updateSettings({ treeSort: sort }),
            }))}
          />
        )}
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
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex h-7 w-7 items-center justify-center transition-colors rounded-md hover:bg-white/5",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
        disabled ? "opacity-30 pointer-events-none" : "",
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

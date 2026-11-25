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
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { AuthGate } from "@/components/auth/AuthProvider";
import { AuthSplash } from "@/components/auth/AuthScreens";
import CommandPalette from "@/components/CommandPalette";
import ContextMenu from "@/components/ContextMenu";
import { collectionIdFrom, NEW_COLLECTION_EVENT, newCollection, OPEN_COLLECTION_EVENT, openCollection } from "@/components/collections/actions";
import CollectionEditor from "@/components/collections/CollectionEditor";
import CollectionView from "@/components/collections/CollectionView";
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
import QuickCapturePane from "@/components/mobile/QuickCapturePane";
import ThreadView from "@/components/threads/ThreadView";
import { OPEN_QUICK_NOTES_EVENT, threadRefFrom } from "@/components/threads/threadEvents";
import { useAndroidBack } from "@/lib/android-back";
import { refreshAndroidTheme, startAndroidBridge, useAndroidShareCount } from "@/lib/android-bridge";
import { api } from "@/lib/api";
import { isAndroidApp } from "@/lib/app-info";
import { DASHBOARD_ID, NotesProvider, useNotes, type TreeSort } from "@/lib/notes-context";
import { pickShell, savedInterfaceMode, type Shell } from "@/lib/shell";
import { OPEN_THREAD_EVENT } from "@/lib/threads";

type MainView =
  | { kind: "quick" }
  | { kind: "thread"; vaultId: string; id: string; fromQuick: boolean }
  | { kind: "collection"; id: string };

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
  // Android app: hello, info and theme right away, independent of sign-in,
  // so the engine error screen can still offer another data folder.
  useEffect(() => startAndroidBridge(), []);
  // Server render (static HTML) and the first client frame: the splash, so
  // something branded shows before the scripts have loaded.
  if (!shell) return <AuthSplash />;
  return (
    <AuthGate>
      <NotesProvider>
        <ShellSwitch shell={shell} />
        {shell === "touch" ? <MobileApp /> : <AppShell />}
        {isAndroidApp && <AndroidShareOpener />}
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

// Android app: opens quick notes for every share from another app (the
// quick-notes composer takes its text and files). After the shell, so the
// shell's listeners are up when this effect runs, and only once the provider
// has restored the tabs, which would otherwise replace the dashboard quick
// notes open on. The shell's own background now exists: the system bars
// follow it.
function AndroidShareOpener() {
  const { loading } = useNotes();
  const shares = useAndroidShareCount();
  const opened = useRef(0);
  useEffect(() => refreshAndroidTheme(), []);
  useEffect(() => {
    if (loading || shares === opened.current) return;
    opened.current = shares;
    window.dispatchEvent(new CustomEvent(OPEN_QUICK_NOTES_EVENT));
  }, [loading, shares]);
  return null;
}

function AppShell() {
  const { openDaily, openTab, openNoteInVault, activeNote, activeId, create } = useNotes();
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
    else if (sidebarView === "threads" && !settings.showThreadsSection) setSidebarView("tree");
  }, [sidebarView, settings.showTagsSection, settings.showTasksSection, settings.showThreadsSection]);
  const [tagSelection, setTagSelection] = useState<string | null>(null);
  // Quick notes or a thread shown full size in place of the editor (the
  // thread is also highlighted in the Threads view). `fromQuick`: the thread
  // was opened from quick notes, so going back returns there.
  const [mainView, setMainView] = useState<MainView | null>(null);
  const [colorScheme, setColorScheme] = useState<string>("default");
  const [sidebarWidth, setSidebarWidth] = useState(280);
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
    };
    // A #tag in the editor or a thread: the sidebar must be showing to list it.
    const onSelectTag = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if (detail) {
        setTagSelection(detail);
        setSidebarView("tags");
        setCollapsed(false);
      }
    };
    // A thread opened from quick notes (or from a thread opened there) keeps
    // the way back to quick notes.
    const onOpenThread = (e: Event) => {
      const ref = threadRefFrom(e);
      if (!ref) return;
      setMainView((prev) => ({
        kind: "thread",
        ...ref,
        fromQuick: prev?.kind === "quick" || (prev?.kind === "thread" && prev.fromQuick),
      }));
    };
    const onOpenQuickNotes = () => setMainView({ kind: "quick" });
    const onOpenCollection = (e: Event) => {
      const id = collectionIdFrom(e);
      if (id) setMainView({ kind: "collection", id });
    };
    window.addEventListener("nexote:toggle-sidebar", onToggle);
    window.addEventListener("nexote:open-palette", onOpenPalette);
    window.addEventListener("nexote:open-settings", onOpenSettings);
    window.addEventListener("nexote:select-view", onSelectView as EventListener);
    window.addEventListener("nexote:select-tag", onSelectTag as EventListener);
    window.addEventListener(OPEN_COLLECTION_EVENT, onOpenCollection);
    window.addEventListener(OPEN_THREAD_EVENT, onOpenThread);
    window.addEventListener(OPEN_QUICK_NOTES_EVENT, onOpenQuickNotes);
    const onNewCollection = () => setCollectionFormOpen(true);
    window.addEventListener(NEW_COLLECTION_EVENT, onNewCollection);
    return () => {
      window.removeEventListener("nexote:toggle-sidebar", onToggle);
      window.removeEventListener("nexote:open-palette", onOpenPalette);
      window.removeEventListener("nexote:open-settings", onOpenSettings);
      window.removeEventListener("nexote:select-view", onSelectView as EventListener);
      window.removeEventListener("nexote:select-tag", onSelectTag as EventListener);
      window.removeEventListener(OPEN_COLLECTION_EVENT, onOpenCollection);
      window.removeEventListener(OPEN_THREAD_EVENT, onOpenThread);
      window.removeEventListener(OPEN_QUICK_NOTES_EVENT, onOpenQuickNotes);
      window.removeEventListener(NEW_COLLECTION_EVENT, onNewCollection);
    };
  }, []);

  // Back from a thread: to quick notes if it was opened there, else the
  // editor. Back from a gallery whose item is the active note: the dashboard
  // (the editor would show the item, whose ✕ reopens the gallery — a loop).
  const leaveMainView = useCallback(() => {
    if (mainView?.kind === "collection" && activeNote?.collection) {
      setMainView(null);
      void openTab(DASHBOARD_ID);
      return;
    }
    setMainView((prev) => (prev?.kind === "thread" && prev.fromQuick ? { kind: "quick" } : null));
  }, [mainView, activeNote?.collection, openTab]);
  // Keyed by the view: stepping from a thread back to quick notes keeps a
  // main view open, and the next Back must reach it again.
  useAndroidBack(leaveMainView, mainView?.kind ?? false);
  useAndroidBack(() => setMobileOpen(false), mobileOpen);

  // Opening a note (another active tab) shows the editor again. Not on the
  // first run: the tab restore at startup isn't the user opening a note.
  const prevActiveIdRef = useRef(activeId);
  useEffect(() => {
    if (prevActiveIdRef.current === activeId) return;
    prevActiveIdRef.current = activeId;
    setMainView(null);
  }, [activeId]);

  // Escape steps back out of the main view — unless something else used the
  // key (ThreadView cancelling an edit, a menu or dialog closing on it) or it
  // was typed in a text field (the composer, the palette, the editor).
  useEffect(() => {
    if (!mainView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Sheets and dialogs close on Escape themselves, without marking it handled.
      if (document.querySelector('[aria-modal="true"]')) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      leaveMainView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mainView, leaveMainView]);

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
              quickNotesActive={mainView?.kind === "quick"}
              mainViewOpen={mainView !== null}
              onOpenQuickNotes={() => setMainView({ kind: "quick" })}
              onTabClick={() => setMainView(null)}
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
                openThreadId={mainView?.kind === "thread" ? mainView.id : null}
                openCollectionId={mainView?.kind === "collection" ? mainView.id : null}
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
            {/* Quick notes and threads take the editor's place (a thread can't
                open in the editor); data-thread-panel keeps FileTree's arrow
                keys out of their buttons. */}
            {mainView ? (
              <div data-thread-panel className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
                {mainView.kind === "quick" ? (
                  <QuickCapturePane variant="desktop" focused onBack={() => setMainView(null)} />
                ) : mainView.kind === "collection" ? (
                  <CollectionView
                    key={mainView.id}
                    collectionId={mainView.id}
                    variant="desktop"
                    onClose={leaveMainView}
                    onOpenItem={(it) => {
                      setMainView(null);
                      void openNoteInVault(it.vaultId, it.id);
                    }}
                  />
                ) : (
                  <ThreadView
                    key={`${mainView.vaultId}:${mainView.id}`}
                    vaultId={mainView.vaultId}
                    id={mainView.id}
                    variant="desktop"
                    onClose={leaveMainView}
                  />
                )}
              </div>
            ) : (
              <EditorPane
                tocOpen={tocOpen}
                onToggleToc={() => setTocOpen((v) => !v)}
                onCloseCollectionItem={() => {
                  if (activeNote?.collection) setMainView({ kind: "collection", id: activeNote.collection });
                }}
              />
            )}
          </main>
        </div>

        {/* Floating new-note button (desktop only); viewers can't add notes.
            Hidden over quick notes and threads: it would cover their send button. */}
        {canEditSpace && !mainView && (
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

        {collectionFormOpen && (
          <CollectionEditor
            touch={false}
            onClose={() => setCollectionFormOpen(false)}
            onSaved={(c) => {
              setCollectionFormOpen(false);
              openCollection(c.id);
            }}
          />
        )}
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
  threads: "Threads",
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
        {canEditSpace &&
          (view === "collections" ? (
            <ActionButton
              label="New collection"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={newCollection}
            />
          ) : (
            <ActionButton
              label="New note"
              icon={<FilePlus className="h-3.5 w-3.5" />}
              onClick={onNewNote}
            />
          ))}
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

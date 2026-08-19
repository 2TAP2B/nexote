"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CommandPalette from "@/components/CommandPalette";
import DeleteConfirm from "@/components/DeleteConfirm";
import FileTree, { type TreeControls } from "@/components/FileTree";
import { MoveToDialog } from "@/components/FileTree";
import type { SidebarView } from "@/components/Ribbon";
import { useSwipeSidebar } from "@/components/useSwipeSidebar";
import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";

import MobileBottomPill from "./MobileBottomPill";
import MobileNoteView from "./MobileNoteView";
import MobileOverflowMenu from "./MobileOverflowMenu";
import MobileSettings from "./MobileSettings";
import MobileSidebar from "./MobileSidebar";
import MobileTabSwitcher from "./MobileTabSwitcher";

export default function MobileApp() {
  const {
    activeId,
    activeNote,
    activeVault,
    openTabs,
    openTab,
    create,
    openDaily,
    remove,
    removeJournal,
    journalNotes,
    moveNote,
    moveNoteToVault,
    switchVault,
    allVaultData,
    vaults,
  } = useNotes();

  // --- Screen / overlay state ---
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowPos, setOverflowPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [treeControls, setTreeControls] = useState<TreeControls | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  // Sidebar view + selected tag — lifted here so the CommandPalette can switch
  // the view BEFORE the sidebar mounts (the event arrives while the sidebar is
  // closed; we set the view then open the sidebar).
  const [sidebarView, setSidebarView] = useState<SidebarView>("tree");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Persist the sidebar section (tree/recent/shortcuts/bookmarks/tags/tasks/
  // images/journal) + selected tag across reloads, so the app reopens where the
  // user left off instead of dropping back to the root note tree.
  useEffect(() => {
    const saved = localStorage.getItem("nexote:sidebar-view");
    if (saved && saved !== "tree") setSidebarView(saved as SidebarView);
    const tag = localStorage.getItem("nexote:selected-tag");
    if (tag) setSelectedTag(tag);
  }, []);
  useEffect(() => {
    localStorage.setItem("nexote:sidebar-view", sidebarView);
  }, [sidebarView]);
  useEffect(() => {
    if (selectedTag) localStorage.setItem("nexote:selected-tag", selectedTag);
    else localStorage.removeItem("nexote:selected-tag");
  }, [selectedTag]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [colorScheme, setColorScheme] = useState("default");

  // Hydrate the saved color scheme from localStorage on mount. The effect
  // below applies it + forces .dark on <html>.
  useEffect(() => {
    const saved = localStorage.getItem("nexote:color-scheme");
    if (saved) setColorScheme(saved);
  }, []);
  useEffect(() => {
    const el = document.documentElement;
    // Apply the saved color scheme. next-themes manages the .dark/.light class
    // via useTheme (toggled from the dashboard top bar); we only add the
    // scheme-specific class here so color schemes (Nord, Dracula, …) work.
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

  // --- Tab navigation for the back/forward arrows ---
  // The bottom-pill arrows cycle through the open tabs in the SAME order shown
  // in the tab overview (MobileTabSwitcher / desktop TopBar): the dashboard is
  // always the far-left (first) tab, followed by the open notes. Left moves
  // back toward the dashboard, right moves forward through the tab list.
  const tabOrder = openTabs;
  const activeTabIndex = tabOrder.indexOf(activeId ?? "");
  // Back is available from any tab after the dashboard; on the dashboard it's
  // disabled. Forward is available unless we're on the last tab.
  const canGoBack = activeTabIndex > 0;
  const canGoForward =
    activeTabIndex >= 0 && activeTabIndex < tabOrder.length - 1;

  const goToPrevTab = useCallback(() => {
    const idx = openTabs.indexOf(activeId ?? "");
    if (idx > 0) void openTab(openTabs[idx - 1]);
  }, [openTabs, activeId, openTab]);

  const goToNextTab = useCallback(() => {
    const idx = openTabs.indexOf(activeId ?? "");
    if (idx >= 0 && idx < openTabs.length - 1) void openTab(openTabs[idx + 1]);
  }, [openTabs, activeId, openTab]);

  // Android PWA system-back handling: the back button should step back through
  // the note history instead of closing the app. We push a history entry for
  // each note the user opens and, on popstate, restore the previous tab. When
  // the history is back to the dashboard, the next back exits the app.
  const historyRef = useRef<string[]>([DASHBOARD_ID]);
  const openTabRef = useRef(openTab);
  openTabRef.current = openTab;
  useEffect(() => {
    if (!activeId || activeId === DASHBOARD_ID) return;
    const last = historyRef.current[historyRef.current.length - 1];
    if (last !== activeId) {
      historyRef.current.push(activeId);
      try {
        window.history.pushState({ nexoteDepth: historyRef.current.length }, "");
      } catch {
        // ignore
      }
    }
  }, [activeId]);

  useEffect(() => {
    const onPop = () => {
      if (historyRef.current.length > 1) {
        historyRef.current.pop();
        const prev = historyRef.current[historyRef.current.length - 1];
        void openTabRef.current(prev);
        // Re-push so a subsequent back within the app returns here, and the
        // final back (from the dashboard) exits the app.
        try {
          window.history.pushState({ nexoteDepth: historyRef.current.length }, "");
        } catch {
          // ignore
        }
      }
      // At depth 1 (dashboard) we let the default back behavior exit the app.
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const handleNewNote = useCallback(() => {
    void create();
  }, [create]);

  // Close the sidebar and tab switcher when the active note changes (e.g. the
  // user tapped a note in the tree).
  useEffect(() => {
    setSidebarOpen(false);
  }, [activeId]);

  // The shared CommandPalette dispatches nexote:select-view and
  // nexote:select-tag events for its "Go to …" / "Toggle sidebar" commands.
  // On mobile: set the sidebar view/tag FIRST, then open the sidebar so the
  // correct view is already showing when the panel slides in.
  useEffect(() => {
    const onSelectView = (e: Event) => {
      const detail = (e as CustomEvent).detail as SidebarView;
      if (detail) setSidebarView(detail);
      setSidebarOpen(true);
    };
    const onSelectTag = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if (detail) setSelectedTag(detail);
      setSidebarView("tags");
      setSidebarOpen(true);
    };
    const onToggleSidebar = () => setSidebarOpen((v) => !v);
    const onOpenSettings = () => setSettingsOpen(true);
    window.addEventListener("nexote:select-view", onSelectView as EventListener);
    window.addEventListener("nexote:select-tag", onSelectTag as EventListener);
    window.addEventListener("nexote:toggle-sidebar", onToggleSidebar);
    window.addEventListener("nexote:open-settings", onOpenSettings);
    return () => {
      window.removeEventListener("nexote:select-view", onSelectView as EventListener);
      window.removeEventListener("nexote:select-tag", onSelectTag as EventListener);
      window.removeEventListener("nexote:toggle-sidebar", onToggleSidebar);
      window.removeEventListener("nexote:open-settings", onOpenSettings);
    };
  }, []);

  // Execute a move chosen in the MoveToDialog. Within the active vault uses
  // moveNote (path change); to another vault uses moveNoteToVault.
  const performMoveTo = useCallback(
    async (dstVaultId: string, dstPath: string) => {
      const id = moveTo;
      if (!id) return;
      setMoveTo(null);
      if (dstVaultId === (activeVault?.id ?? "")) {
        await moveNote(id, dstPath);
      } else {
        if (activeVault?.id) switchVault(activeVault.id);
        await moveNoteToVault(id, dstVaultId);
      }
    },
    [moveTo, activeVault, moveNote, moveNoteToVault, switchVault],
  );

  // Swipe to open/close the sidebar.
  useSwipeSidebar({
    onOpen: () => setSidebarOpen(true),
    onClose: () => setSidebarOpen(false),
    open: sidebarOpen,
  });

  // Keep the body background dark for the mobile shell.
  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "var(--mob-bg, #1a1d29)";
    return () => {
      document.body.style.backgroundColor = prev;
    };
  }, []);

  return (
    <div
      className="mob-shell-root flex h-[100dvh] w-full flex-col overflow-hidden"
      style={
        {
          background: "var(--mob-bg)",
          // Let the swipe hook receive horizontal drags (open/close sidebar)
          // while still allowing native vertical scrolling in lists/editor.
          touchAction: "pan-y",
        } as React.CSSProperties
      }
    >
      <MobileNoteView
        activeNote={activeNote}
        isDashboard={activeId === DASHBOARD_ID}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOverflow={(x, y) => {
          setOverflowPos({ x, y });
          setOverflowOpen(true);
        }}
        onSearch={() => setPaletteOpen(true)}
        onNewNote={handleNewNote}
        onOpenSettings={() => setSettingsOpen(true)}
        openDaily={openDaily}
      />

      <MobileBottomPill
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={goToPrevTab}
        onForward={goToNextTab}
        onSearch={() => setPaletteOpen(true)}
        onNewNote={handleNewNote}
        onOpenTabs={() => setTabSwitcherOpen(true)}
        tabCount={openTabs.length}
      />

      <MobileSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onControlsReady={setTreeControls}
        treeControls={treeControls}
        view={sidebarView}
        selectedTag={selectedTag}
        onSelectView={setSidebarView}
        onSelectTagConsumed={() => setSelectedTag(null)}
      />

      {tabSwitcherOpen && (
        <MobileTabSwitcher
          onClose={() => setTabSwitcherOpen(false)}
          onNewTab={handleNewNote}
        />
      )}

      {overflowOpen && overflowPos && activeNote && (
        <MobileOverflowMenu
          x={overflowPos.x}
          y={overflowPos.y}
          noteId={activeNote.id}
          onClose={() => setOverflowOpen(false)}
          onDelete={(id) => {
            setOverflowOpen(false);
            setPendingDelete(id);
          }}
          onMoveTo={(id) => {
            setOverflowOpen(false);
            setMoveTo(id);
          }}
          onRename={() => {
            // Rename deferred — close the menu. Inline rename can be added later.
            setOverflowOpen(false);
          }}
        />
      )}

      <MoveToDialog
        open={moveTo !== null}
        vaults={vaults}
        allVaultData={allVaultData}
        activeVaultId={activeVault?.id ?? ""}
        onClose={() => setMoveTo(null)}
        onMove={performMoveTo}
      />

      <DeleteConfirm
        open={pendingDelete !== null}
        noteId={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async (id) => {
          setPendingDelete(null);
          if (journalNotes.some((n) => n.id === id)) {
            await removeJournal(id);
          } else {
            await remove(id);
          }
        }}
      />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <MobileSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        colorScheme={colorScheme}
        onColorSchemeChange={setColorScheme}
      />
    </div>
  );
}
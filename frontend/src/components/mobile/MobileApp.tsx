"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import CommandPalette from "@/components/CommandPalette";
import DeleteConfirm from "@/components/DeleteConfirm";
import FileTree, { type TreeControls } from "@/components/FileTree";
import { MoveToDialog } from "@/components/FileTree";
import type { SidebarView } from "@/components/Ribbon";
import SettingsPanel from "@/components/SettingsPanel";
import { useSwipeSidebar } from "@/components/useSwipeSidebar";
import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";

import MobileBottomPill from "./MobileBottomPill";
import MobileNoteView from "./MobileNoteView";
import MobileOverflowMenu from "./MobileOverflowMenu";
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
    // Always force dark on mobile so scheme dark variants match.
    el.classList.add("dark");
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

  // --- Navigation history stack (browser-like back/forward across notes) ---
  // past: notes visited before the current one (oldest first).
  // future: notes to re-visit via forward (oldest first).
  const historyRef = useRef<{ past: string[]; future: string[] }>({
    past: [],
    future: [],
  });
  // A flag to suppress history pushes while we're navigating via back/forward.
  const navigatingRef = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const refreshNavState = useCallback(() => {
    const h = historyRef.current;
    setCanGoBack(h.past.length > 0);
    setCanGoForward(h.future.length > 0);
  }, []);

  // Track activeId changes and update the history stack.
  useEffect(() => {
    if (activeId == null) return;
    if (navigatingRef.current) {
      navigatingRef.current = false;
      refreshNavState();
      return;
    }
    // A normal open: push the previous activeId into past, clear future.
    const h = historyRef.current;
    // Only push if there's a previous id and it differs.
    if (h.past[h.past.length - 1] !== activeId) {
      // Avoid pushing the very first dashboard load.
      if (h.past.length === 0 && activeId === DASHBOARD_ID) {
        // initial load — no history entry
      }
    }
    refreshNavState();
  }, [activeId, refreshNavState]);

  // Wrap openTab so a normal open pushes history.
  const openWithHistory = useCallback(
    async (id: string) => {
      const h = historyRef.current;
      if (activeId != null && id !== activeId) {
        h.past.push(activeId);
        h.future = [];
      }
      navigatingRef.current = false;
      await openTab(id);
      refreshNavState();
    },
    [activeId, openTab, refreshNavState],
  );

  const goBack = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past.pop()!;
    if (activeId != null) h.future.push(activeId);
    navigatingRef.current = true;
    void openTab(prev);
    refreshNavState();
  }, [activeId, openTab, refreshNavState]);

  const goForward = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future.pop()!;
    if (activeId != null) h.past.push(activeId);
    navigatingRef.current = true;
    void openTab(next);
    refreshNavState();
  }, [activeId, openTab, refreshNavState]);

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
        openWithHistory={openWithHistory}
        openDaily={openDaily}
      />

      <MobileBottomPill
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={goBack}
        onForward={goForward}
        onSearch={() => setPaletteOpen(true)}
        onNewNote={handleNewNote}
        onOpenTabs={() => setTabSwitcherOpen(true)}
        tabCount={openTabs.length}
      />

      {sidebarOpen && (
        <MobileSidebar
          onClose={() => setSidebarOpen(false)}
          onControlsReady={setTreeControls}
          treeControls={treeControls}
          view={sidebarView}
          selectedTag={selectedTag}
          onSelectView={setSidebarView}
          onSelectTagConsumed={() => setSelectedTag(null)}
        />
      )}

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

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        colorScheme={colorScheme}
        onColorSchemeChange={setColorScheme}
      />
    </div>
  );
}
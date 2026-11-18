"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import CommandPalette from "@/components/CommandPalette";
import CollectionFormDialog from "@/components/CollectionFormDialog";
import CollectionGallery from "@/components/CollectionGallery";
import DeleteConfirm from "@/components/DeleteConfirm";
import FileTree, { type TreeControls } from "@/components/FileTree";
import { NotebookSheet } from "@/components/mobile/NotebookPicker";
import { notebookKey } from "@/lib/notebooks";
import NoteHistoryPanel from "@/components/NoteHistoryPanel";
import type { SidebarView } from "@/components/Ribbon";
import MobileSpacesPane from "@/components/spaces/MobileSpacesPane";
import { useCanEdit } from "@/components/useCanEdit";
import { useSwipeSidebar, type PagerFocus } from "@/components/useSwipeSidebar";
import QuickCapturePane from "./QuickCapturePane";
import ThreadView from "@/components/threads/ThreadView";
import { threadRefFrom, threadsViewTagFrom, type ThreadRef } from "@/components/threads/threadEvents";
import { api } from "@/lib/api";
import type { CollectionMeta } from "@/lib/api";
import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";
import { replaceOrAddTitleHeading } from "@/lib/note-utils";
import { OPEN_THREAD_EVENT, OPEN_THREADS_VIEW_EVENT } from "@/lib/threads";

import MobileBottomPill from "./MobileBottomPill";
import MobileNoteView from "./MobileNoteView";
import MobileOverflowMenu from "./MobileOverflowMenu";
import MobileSettings from "./MobileSettings";
import MobileSidebar from "./MobileSidebar";
import MobileTabSwitcher from "./MobileTabSwitcher";
import MobileTocPane from "./MobileTocPane";

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
    openNoteInVault,
    isJournalNote,
    refreshNoteBody,
    save,
    notesById,
    listCollections,
    activeSpaceId,
    noteVaultMap,
    allVaultData,
  } = useNotes();
  const { canEditSpace } = useCanEdit();

  // --- Screen / overlay state ---
  const { theme, setTheme } = useTheme();
  const [pagerFocus, setPagerFocus] = useState<PagerFocus>("editor");
  // Restore the focused pane after mount (spaces/sidebar/toc were open before
  // the reload). Effect-based, not a localStorage useState initializer: the
  // server prerender can't read localStorage, and a client-only initializer
  // causes a hydration attribute mismatch React then refuses to patch.
  useEffect(() => {
    const saved = localStorage.getItem("nexote:pager-focus");
    if (saved === "spaces" || saved === "sidebar" || saved === "toc") setPagerFocus(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem("nexote:pager-focus", pagerFocus);
  }, [pagerFocus]);
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [galleryCollection, setGalleryCollection] = useState<CollectionMeta | null>(null);
  const [collectionFormOpen, setCollectionFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [treeControls, setTreeControls] = useState<TreeControls | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  // Sidebar view + selected tag — lifted here so the CommandPalette can switch
  // the view BEFORE the sidebar mounts (the event arrives while the sidebar is
  // closed; we set the view then open the sidebar).
  const [sidebarView, setSidebarView] = useState<SidebarView>("tree");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // Threads: the thread in the full-screen overlay (also highlighted in the
  // Threads view), and a tag filter requested for the Threads view ("" = none).
  const [openThreadRef, setOpenThreadRef] = useState<ThreadRef | null>(null);
  const [threadTag, setThreadTag] = useState<string | null>(null);

  // Persist the sidebar section (tree/recent/shortcuts/bookmarks/tags/tasks/
  // collections/journal) + selected tag across reloads, so the app reopens where
  // the user left off instead of dropping back to the root note tree.
  useEffect(() => {
    const saved = localStorage.getItem("nexote:sidebar-view");
    if (saved && saved !== "tree") {
      // "images" was removed — fall back to tree if it was the last view.
      if (saved === "images") {
        localStorage.removeItem("nexote:sidebar-view");
      } else {
        setSidebarView(saved as SidebarView);
      }
    }
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

  // Android PWA system-back is now handled by real URL routing (pushState in
  // NotesProvider). The browser history stack lets back/forward navigate
  // between notes naturally; the final back exits the app.

  // Viewers can't add notes to the active space.
  const handleNewNote = useCallback(() => {
    if (canEditSpace) void create();
  }, [create, canEditSpace]);

  // Close the sidebar and tab switcher when the active note changes (e.g. the
  // user tapped a note in the tree). Hidden on the load-time restore: the
  // tab restore assigns an active id right after mount (null → restored id),
  // which must not force the editor pane (it would beat the persisted
  // pagerFocus). Only changes after the first assignment close the sidebar.
  // Switching spaces also swaps the active tab; the user stays on the pane
  // they switched from (the spaces pane sends them to the tree).
  const prevActiveIdRef = useRef<string | null | undefined>(undefined);
  const prevSpaceIdRef = useRef(activeSpaceId);
  useEffect(() => {
    const spaceChanged = prevSpaceIdRef.current !== activeSpaceId;
    prevSpaceIdRef.current = activeSpaceId;
    if (prevActiveIdRef.current === undefined) {
      prevActiveIdRef.current = activeId ?? null;
      return;
    }
    if (prevActiveIdRef.current === activeId) return;
    prevActiveIdRef.current = activeId ?? null;
    if (spaceChanged) return;
    setPagerFocus("editor");
    // A note opened from a thread (a [[link]]) shows instead of the thread.
    setOpenThreadRef(null);
  }, [activeId, activeSpaceId]);

  // The shared CommandPalette dispatches nexote:select-view and
  // nexote:select-tag events for its "Go to …" / "Toggle sidebar" commands.
  // On mobile: set the sidebar view/tag FIRST, then open the sidebar so the
  // correct view is already showing when the panel slides in.
  useEffect(() => {
    // Leaving the note for the sidebar: drop editor focus first, or the touch
    // keyboard stays up for a field that is sliding off screen.
    const blurPagerField = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest(".mob-pager")) active.blur();
    };
    const onSelectView = (e: Event) => {
      const detail = (e as CustomEvent).detail as SidebarView;
      if (detail) setSidebarView(detail);
      blurPagerField();
      setPagerFocus("sidebar");
    };
    const onSelectTag = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if (detail) setSelectedTag(detail);
      setSidebarView("tags");
      blurPagerField();
      setPagerFocus("sidebar");
    };
    const onToggleSidebar = () =>
      setPagerFocus((v) => (v === "editor" ? "sidebar" : "editor"));
    const onOpenSettings = () => setSettingsOpen(true);
    const onOpenCollection = (e: Event) => {
      const folder = (e as CustomEvent).detail as string;
      if (!folder) return;
      void listCollections().then((cols) => {
        const col = cols.find((c) => c.name === folder);
        if (col) {
          setGalleryCollection(col);
          setPagerFocus("editor");
        }
      });
    };
    const onOpenThread = (e: Event) => {
      const ref = threadRefFrom(e);
      if (!ref) return;
      blurPagerField();
      setOpenThreadRef(ref);
    };
    // Like a "Go to" view: the sidebar on the Threads view, now filtered.
    // Closes the thread overlay so a #tag tapped in a thread shows the list.
    const onOpenThreadsView = (e: Event) => {
      setThreadTag(threadsViewTagFrom(e));
      setSidebarView("threads");
      setOpenThreadRef(null);
      blurPagerField();
      setPagerFocus("sidebar");
    };
    window.addEventListener("nexote:select-view", onSelectView as EventListener);
    window.addEventListener("nexote:select-tag", onSelectTag as EventListener);
    window.addEventListener("nexote:toggle-sidebar", onToggleSidebar);
    window.addEventListener("nexote:open-settings", onOpenSettings);
    window.addEventListener("nexote:open-collection", onOpenCollection as EventListener);
    window.addEventListener(OPEN_THREAD_EVENT, onOpenThread);
    window.addEventListener(OPEN_THREADS_VIEW_EVENT, onOpenThreadsView);
    const onNewCollection = () => setCollectionFormOpen(true);
    window.addEventListener("nexote:new-collection", onNewCollection);
    return () => {
      window.removeEventListener("nexote:select-view", onSelectView as EventListener);
      window.removeEventListener("nexote:select-tag", onSelectTag as EventListener);
      window.removeEventListener("nexote:toggle-sidebar", onToggleSidebar);
      window.removeEventListener("nexote:open-settings", onOpenSettings);
      window.removeEventListener("nexote:open-collection", onOpenCollection as EventListener);
      window.removeEventListener(OPEN_THREAD_EVENT, onOpenThread);
      window.removeEventListener(OPEN_THREADS_VIEW_EVENT, onOpenThreadsView);
      window.removeEventListener("nexote:new-collection", onNewCollection);
    };
  }, []);

  // Execute a move chosen in the "Move to…" sheet. Within the active vault uses
  // moveNote (path change); to another vault (any space) uses moveNoteToVault.
  const performMoveTo = useCallback(
    async (dstVaultId: string, dstPath: string) => {
      const id = moveTo;
      if (!id) return;
      setMoveTo(null);
      if (dstVaultId === (activeVault?.id ?? "")) {
        await moveNote(id, dstPath);
      } else {
        if (activeVault?.id) switchVault(activeVault.id);
        await moveNoteToVault(id, dstVaultId, dstPath);
      }
    },
    [moveTo, activeVault, moveNote, moveNoteToVault, switchVault],
  );

  // The note's current notebook, marked in the sheet.
  const moveFrom = moveTo ? noteVaultMap[moveTo] : undefined;
  const moveSelected =
    moveTo && moveFrom
      ? notebookKey({
          vaultId: moveFrom,
          folder: allVaultData[moveFrom]?.notes.find((n) => n.id === moveTo)?.path ?? "",
        })
      : undefined;

  // Swipe to pan between the spaces / sidebar / editor / contents panes —
  // from the pill or anywhere in the editor pane.
  useSwipeSidebar({ focus: pagerFocus, onFocus: setPagerFocus, swipeFromContent: true });

  // Keep the body background in sync with the mobile shell (so the safe-area
  // / overscroll areas match). Uses the CSS variable so it follows the active
  // color scheme + light/dark mode.
  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "var(--mob-bg)";
    return () => {
      document.body.style.backgroundColor = prev;
    };
  }, []);

  // The pager pans with transforms only; the shell never scrolls sideways.
  // When the browser scrolls it anyway to reveal a focused field in a pane
  // that's off screen (the touch keyboard opening), two half panes show:
  // undo that scroll right away.
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const reset = () => {
      if (shell.scrollLeft !== 0) shell.scrollLeft = 0;
    };
    shell.addEventListener("scroll", reset, { passive: true });
    return () => shell.removeEventListener("scroll", reset);
  }, []);

  return (
    <div
      ref={shellRef}
      className="mob-shell-root flex h-[100dvh] w-full flex-col overflow-hidden"
      data-pager-focus={pagerFocus}
      style={
        {
          background: "var(--mob-bg)",
          // Let the swipe hook receive horizontal drags (pan between sidebar
          // and note view) while still allowing native vertical scrolling in
          // lists/editor.
          touchAction: "pan-y",
        } as React.CSSProperties
      }
    >
      {/* Pager — a "quadruple width canvas". The spaces pane, the sidebar
          pane (note tree), the note view and the right pane each take a full
          viewport; the track is 400vw and pans in/out so no pane ever
          shrinks. From the tree, one more swipe right shows the spaces. The
          right pane is the table of contents for a note and quick capture on
          the dashboard (swipe left there to jot something down). */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="mob-pager flex h-full w-[400%]">
          <MobileSpacesPane onShowTree={() => setPagerFocus("sidebar")} />

          <MobileSidebar
            onClose={() => setPagerFocus("editor")}
            onControlsReady={setTreeControls}
            treeControls={treeControls}
            view={sidebarView}
            selectedTag={selectedTag}
            onSelectView={setSidebarView}
            onSelectTagConsumed={() => setSelectedTag(null)}
            threadTag={threadTag}
            onThreadTagConsumed={() => setThreadTag(null)}
            openThreadId={openThreadRef?.id ?? null}
          />

          <main className="relative flex h-full w-1/4 shrink-0 flex-col overflow-hidden">
          <MobileNoteView
            activeNote={activeNote}
            isDashboard={activeId === DASHBOARD_ID}
            onOpenSidebar={() => setPagerFocus("sidebar")}
            onOverflow={() => setOverflowOpen(true)}
            onSearch={() => setPaletteOpen(true)}
            onNewNote={handleNewNote}
            onOpenSettings={() => setSettingsOpen(true)}
            openDaily={openDaily}
            onCloseCollectionItem={() => {
              // Return to the gallery of the collection that owns this item,
              // keeping the sidebar on its Collections section.
              setSidebarView("collections");
              const col = activeNote?.collection;
              if (!col) return;
              void listCollections().then((cols) => {
                const found = cols.find((c) => c.id === col);
                if (found) setGalleryCollection(found);
              });
            }}
          />

          <MobileBottomPill
            autoHideKey={activeId === DASHBOARD_ID || !activeNote ? undefined : activeNote.id}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onBack={goToPrevTab}
            onForward={goToNextTab}
            onDashboard={() => void openTab(DASHBOARD_ID)}
            onSearch={() => setPaletteOpen(true)}
            onNewNote={handleNewNote}
            onOpenTabs={() => setTabSwitcherOpen(true)}
            tabCount={openTabs.length}
            onOpenSidebar={() => setPagerFocus("sidebar")}
            onOpenToc={() => setPagerFocus("toc")}
            onOpenDaily={() => void openDaily()}
            onOpenSettings={() => setSettingsOpen(true)}
            onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
            onCommandPalette={() => setPaletteOpen(true)}
          />
          </main>

          {activeId === DASHBOARD_ID ? (
            <QuickCapturePane
              focused={pagerFocus === "toc"}
              onBack={() => setPagerFocus("editor")}
            />
          ) : (
            <MobileTocPane
              noteId={activeId ?? ""}
              focused={pagerFocus === "toc"}
              onClose={() => setPagerFocus("editor")}
            />
          )}
        </div>
      </div>

      {tabSwitcherOpen && (
        <MobileTabSwitcher
          onClose={() => setTabSwitcherOpen(false)}
          onNewTab={handleNewNote}
        />
      )}

      {overflowOpen && activeNote && (
        <MobileOverflowMenu
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
          onRename={(id) => {
            setOverflowOpen(false);
            const note = notesById[id];
            const current = note?.title ?? "Untitled";
            const next = window.prompt("Rename note", current);
            if (!next || next.trim() === current) return;
            const title = next.trim() || "Untitled";
            if (note) {
              void save(id, { title, body: replaceOrAddTitleHeading(note.body, title) });
            }
          }}
          onHistory={(id) => {
            setOverflowOpen(false);
            setHistoryOpen(true);
          }}
          onToc={() => {
            setOverflowOpen(false);
            setPagerFocus("toc");
          }}
        />
      )}

      {historyOpen && activeNote && (
        <NoteHistoryPanel
          open={historyOpen}
          noteId={activeNote.id}
          isJournal={isJournalNote(activeNote.id)}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => void refreshNoteBody(activeNote.id)}
        />
      )}

      {moveTo !== null && (
        <NotebookSheet
          title="Move to…"
          description="Pick a vault or folder. Moving it into another space takes it out of this one."
          selected={moveSelected}
          onPick={(n) => void performMoveTo(n.vaultId, n.folder)}
          onClose={() => setMoveTo(null)}
        />
      )}

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

      {/* The open thread, full screen. Portaled out of the pager (its
          transform would anchor a fixed overlay to the track); above the
          pager and pill, below settings, action sheets and the palette. */}
      {openThreadRef &&
        createPortal(
          <div
            role="dialog"
            aria-label="Thread"
            className="mob-shell-root fixed inset-0 z-[55] flex flex-col overflow-hidden"
            style={{ background: "var(--mob-bg)" }}
          >
            <ThreadView
              key={`${openThreadRef.vaultId}:${openThreadRef.id}`}
              vaultId={openThreadRef.vaultId}
              id={openThreadRef.id}
              variant="mobile"
              onClose={() => setOpenThreadRef(null)}
            />
          </div>,
          document.body,
        )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <MobileSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        colorScheme={colorScheme}
        onColorSchemeChange={setColorScheme}
      />

      {galleryCollection && (
        <CollectionGallery
          open={Boolean(galleryCollection)}
          collection={galleryCollection}
          onClose={() => {
            setSidebarView("collections");
            setGalleryCollection(null);
          }}
          onExit={() => {
            // Leaving the gallery lands on the sidebar's Collections list; the
            // note pane behind it shows the dashboard, not an item still open
            // as the active note (which would loop).
            setSidebarView("collections");
            setGalleryCollection(null);
            setPagerFocus("sidebar");
            void openTab(DASHBOARD_ID);
          }}
          onOpenNote={(vaultId, id) => void openNoteInVault(vaultId, id)}
          onCollectionChanged={setGalleryCollection}
        />
      )}

      <CollectionFormDialog
        open={collectionFormOpen}
        onClose={() => setCollectionFormOpen(false)}
        onSaved={() => {
          setCollectionFormOpen(false);
          window.dispatchEvent(new CustomEvent("nexote:refresh-data"));
        }}
      />
    </div>
  );
}
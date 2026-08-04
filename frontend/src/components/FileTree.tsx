"use client";

import {
  ArrowLeft,
  ArrowDownUp,
  Bookmark,
  BookmarkCheck,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Edit3,
  FileText,
  FilePlus,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  GraduationCap,
  Heart,
  Home,
  LayoutList,
  Music,
  Pin,
  Rows3,
  Settings2,
  Shield,
  SquareArrowOutUpRight,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";

function replaceOrAddH1(body: string, title: string): string {
  const h1 = `# ${title}`;
  if (/^# .+$/m.test(body)) {
    return body.replace(/^# .+$/m, h1);
  }
  return body ? `${h1}\n\n${body}` : h1;
}

const iconMap: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Database,
  Folder,
  Star,
  Bookmark,
  FileText,
  Settings: Settings2,
  GraduationCap,
  Heart,
  Home,
  Music,
  Shield,
  Zap,
};

function getVaultIcon(iconName?: string) {
  if (!iconName) return Database;
  return iconMap[iconName] ?? Database;
}

import ContextMenu, { type MenuItem } from "./ContextMenu";
import DeleteConfirm from "./DeleteConfirm";
import FolderCreateDialog from "./FolderCreateDialog";

type TreeNode = {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  notes: { id: string; title: string }[];
};

function emptyTree(): TreeNode {
  return { name: "", path: "", children: new Map(), notes: [] };
}

function buildTree(
  notes: { id: string; title: string; path: string }[],
  folders: { path: string; name: string }[],
): TreeNode {
  const root = emptyTree();
  for (const f of folders) {
    let node = root;
    const segs = f.path.split("/");
    let cur = "";
    for (const seg of segs) {
      cur = cur ? `${cur}/${seg}` : seg;
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, path: cur, children: new Map(), notes: [] };
        node.children.set(seg, child);
      }
      node = child;
    }
  }
  for (const n of notes) {
    let node = root;
    if (n.path) {
      const segs = n.path.split("/");
      let cur = "";
      for (const seg of segs) {
        cur = cur ? `${cur}/${seg}` : seg;
        let child = node.children.get(seg);
        if (!child) {
          child = { name: seg, path: cur, children: new Map(), notes: [] };
          node.children.set(seg, child);
        }
        node = child;
      }
    }
    node.notes.push({ id: n.id, title: n.title });
  }
  return root;
}

function allFolderPaths(node: TreeNode, acc: string[] = []): string[] {
  for (const child of node.children.values()) {
    acc.push(child.path);
    allFolderPaths(child, acc);
  }
  return acc;
}

export type TreeControls = {
  expandAll: () => void;
  collapseAll: () => void;
  toggleSort: () => void;
  sorted: boolean;
  allExpanded: boolean;
  toggleExpandCollapse: () => void;
  allSectionsExpanded: boolean;
  toggleSectionsCollapse: () => void;
  // Folder view state (exposed so the sidebar header can switch)
  folderMode: boolean;
  folderName: string;
  folderViewMode: "compact" | "detailed";
  onToggleFolderViewMode: () => void;
  folderSort: boolean;
  onToggleFolderSort: () => void;
  onNewNoteInFolder: () => void;
  onExitFolder: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
};

type FileTreeProps = {
  collapsed: boolean;
  onControlsReady?: (c: TreeControls) => void;
};

export default function FileTree({ collapsed, onControlsReady }: FileTreeProps) {
  const {
    notes,
    folders,
    bookmarks,
    shortcuts,
    activeId,
    openTab,
    create,
    copyNote,
    moveNoteToVault,
    createFolder,
    removeFolder,
    moveNote,
    remove,
    notesById,
    refresh,
    save,
    toggleBookmark,
    toggleShortcut,
    vaults,
    activeVault,
    allVaultData,
    openNoteInVault,
    openJournalNote,
    switchVault,
    renameVault,
    setVaultIcon,
    treeMode,
    journalNotes,
  } = useNotes();
  const tree = useMemo(() => buildTree(notes, folders ?? []), [notes, folders]);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const isFolderOpen = useCallback(
    (path: string) => openMap[path] ?? true,
    [openMap],
  );
  // Recent excludes notes already pinned as shortcuts, so a note doesn't
  // appear in both the Shortcuts and Recent sections.
  const recentNotes = useMemo(
    () => notes.filter((n) => !shortcuts.has(n.id)),
    [notes, shortcuts],
  );

  // Flat ordered list of visible items per section for keyboard nav.
  type NavItem = { type: "note"; id: string } | { type: "folder"; path: string };

  // Shortcuts nav list
  const shortcutsNavItems = useMemo(() => {
    const items: NavItem[] = [];
    for (const n of notes) if (shortcuts.has(n.id)) items.push({ type: "note", id: n.id });
    return items;
  }, [notes, shortcuts]);

  // Recent nav list
  const recentNavItems = useMemo(() => {
    return recentNotes.map((n) => ({ type: "note", id: n.id }) as NavItem);
  }, [recentNotes]);

  // Journal nav list (vault-independent)
  const journalNavItems = useMemo(() => {
    return journalNotes.map((n) => ({ type: "note", id: n.id }) as NavItem);
  }, [journalNotes]);

  // Vault tree nav list (notes + folders)
  const vaultNavItems = useMemo(() => {
    const items: NavItem[] = [];
    const walk = (node: TreeNode) => {
      for (const [, child] of node.children) {
        items.push({ type: "folder", path: child.path });
        if (isFolderOpen(child.path)) walk(child);
      }
      for (const n of node.notes) {
        items.push({ type: "note", id: n.id });
      }
    };
    if (activeVault) {
      const vaultData = allVaultData[activeVault.id];
      if (vaultData) {
        const vaultTree = buildTree(vaultData.notes, vaultData.folders);
        walk(vaultTree);
      }
    }
    return items;
  }, [notes, activeVault, allVaultData, isFolderOpen]);

  // Which sections are currently available (for Tab cycling)
  const availableSections = useMemo(() => {
    const secs: string[] = [];
    if (shortcutsNavItems.length > 0) secs.push("shortcuts");
    if (recentNavItems.length > 0) secs.push("recent");
    if (journalNavItems.length > 0) secs.push("journal");
    secs.push("vault");
    return secs;
  }, [shortcutsNavItems.length, recentNavItems.length, journalNavItems.length]);

  // Active navigation section + selected index within it.
  const [navSection, setNavSection] = useState<string>("vault");
  const [treeSelectedNav, setTreeSelectedNav] = useState<string | null>(null);
  const [drillPath, setDrillPath] = useState<string | null>(null);
  const [folderHistory, setFolderHistory] = useState<string[]>([]);
  const [folderHistoryIndex, setFolderHistoryIndex] = useState(-1);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [sorted, setSorted] = useState(false);

  // Collapsible section states
  const [shortcutsExpanded, setShortcutsExpanded] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [journalExpanded, setJournalExpanded] = useState(true);
  const [vaultExpandedMap, setVaultExpandedMap] = useState<Record<string, boolean>>({});
  const [folderViewMode, setFolderViewMode] = useState<"compact" | "detailed">("detailed");
  const [folderSort, setFolderSort] = useState(false);

  // Tracks which section a note was opened from, so the active highlight
  // only appears in the section the user actually clicked (not in every
  // section that happens to list the note).
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const sectionOpenRef = useRef(false);

  // Get the nav items for the current section.
  const currentNavItems = useCallback((): NavItem[] => {
    if (navSection === "shortcuts") return shortcutsNavItems;
    if (navSection === "recent") return recentNavItems;
    if (navSection === "journal") return journalNavItems;
    return vaultNavItems;
  }, [navSection, shortcutsNavItems, recentNavItems, journalNavItems, vaultNavItems]);

  // Clear activeSource when activeId changes from outside a section open
  // (e.g. command palette, daily note, tab click), so stale source tags
  // don't cause false highlights.
  useEffect(() => {
    if (sectionOpenRef.current) {
      sectionOpenRef.current = false;
      return;
    }
    setActiveSource(null);
  }, [activeId]);

  // Open a note and record which section it was opened from.
  const openFromSection = useCallback(
    (section: string, id: string) => {
      sectionOpenRef.current = true;
      setActiveSource(section);
      openTab(id);
    },
    [openTab],
  );

  // Context menu state.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  // Folder-create dialog state.
  const [folderDialog, setFolderDialog] = useState<{
    open: boolean;
    parentPath?: string;
  }>({ open: false });

  // Vault icon picker state
  const [vaultIconPicker, setVaultIconPicker] = useState<{
    vaultId: string;
    x: number;
    y: number;
  } | null>(null);
  const vaultIconPickerRef = useRef<HTMLDivElement>(null);

  // Inline rename state.
  const [renaming, setRenaming] = useState<{
    id: string;
    value: string;
  } | null>(null);

  // Drag state.
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [dragOverVaultId, setDragOverVaultId] = useState<string | null>(null);

  // Navigate into a folder (advanced mode detail view). Pushes onto the
  // history stack so left/right arrow keys can go back/forward.
  const navigateToFolder = useCallback((path: string) => {
    setDrillPath(path);
    setFolderHistory((prev) => {
      const trimmed = prev.slice(0, folderHistoryIndex + 1);
      return [...trimmed, path];
    });
    setFolderHistoryIndex((i) => i + 1);
  }, [folderHistoryIndex]);

  const folderGoBack = useCallback(() => {
    if (folderHistoryIndex > 0) {
      const newIndex = folderHistoryIndex - 1;
      setFolderHistoryIndex(newIndex);
      setDrillPath(folderHistory[newIndex]);
    } else if (folderHistoryIndex === 0) {
      setFolderHistoryIndex(-1);
      setDrillPath(null);
      // Restore tree selection to the folder we just left.
      const lastFolder = folderHistory[0];
      if (lastFolder) setTreeSelectedNav(`folder:${lastFolder}`);
    }
  }, [folderHistoryIndex, folderHistory]);

  const folderGoForward = useCallback(() => {
    if (folderHistoryIndex < folderHistory.length - 1) {
      const newIndex = folderHistoryIndex + 1;
      setFolderHistoryIndex(newIndex);
      setDrillPath(folderHistory[newIndex]);
    }
  }, [folderHistoryIndex, folderHistory]);

  // Arrow-key navigation in the main tree (not folder detail view).
  // Tab/Shift+Tab = switch between sections (shortcuts/recent/vault).
  // Up/down = move within section. Right/Enter = open note or enter folder.
  // Left = clear selection. Space = toggle folder. Shift+Left = focus tree.
  useEffect(() => {
    if (drillPath !== null || showBookmarksOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      // Tab / Shift+Tab — switch between sections.
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const secs = availableSections;
        if (secs.length === 0) return;
        const curIdx = secs.indexOf(navSection);
        const nextIdx = e.shiftKey
          ? (curIdx <= 0 ? secs.length - 1 : curIdx - 1)
          : (curIdx < 0 ? 0 : (curIdx + 1) % secs.length);
        setNavSection(secs[nextIdx]);
        setTreeSelectedNav(null);
        return;
      }

      if (
        e.key !== "ArrowUp" && e.key !== "ArrowDown" &&
        e.key !== "ArrowRight" && e.key !== "ArrowLeft" &&
        e.key !== "Enter" && e.key !== " "
      ) return;
      e.preventDefault();
      e.stopPropagation();

      const items = currentNavItems();
      if (items.length === 0) return;
      const navKeys = items.map((it) =>
        it.type === "note" ? `note:${it.id}` : `folder:${it.path}`,
      );
      const currentIdx = treeSelectedNav ? navKeys.indexOf(treeSelectedNav) : -1;

      if (e.key === "ArrowDown") {
        const next = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, items.length - 1);
        setTreeSelectedNav(navKeys[next]);
      } else if (e.key === "ArrowUp") {
        const next = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
        setTreeSelectedNav(navKeys[next]);
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (currentIdx < 0) return;
        const item = items[currentIdx];
        if (item.type === "note") {
          if (navSection === "journal") {
            sectionOpenRef.current = true;
            setActiveSource("journal");
            void openJournalNote(item.id);
          } else {
            openFromSection(navSection === "vault" ? (activeVault ? `vault:${activeVault.id}` : "simple") : navSection, item.id);
          }
          window.dispatchEvent(new CustomEvent("nexote:focus-note-end"));
        } else {
          navigateToFolder(item.path);
        }
      } else if (e.key === "ArrowLeft") {
        if (e.shiftKey) {
          // Shift+Left = return focus to the tree (stay in tree, clear selection).
          setTreeSelectedNav(null);
        } else {
          setTreeSelectedNav(null);
        }
      } else if (e.key === " ") {
        if (currentIdx < 0) return;
        const item = items[currentIdx];
        if (item.type === "folder") {
          setOpenMap((prev) => ({ ...prev, [item.path]: !(prev[item.path] ?? true) }));
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drillPath, showBookmarksOnly, availableSections, navSection, currentNavItems, treeSelectedNav, openTab, openFromSection, openJournalNote, navigateToFolder, activeVault, setOpenMap]);

  // Listen for "focus tree" event (Shift+Left from editor) — select the
  // currently open note in the vault section so arrows work immediately.
  useEffect(() => {
    const onFocusTree = () => {
      setNavSection("vault");
      if (activeId) {
        setTreeSelectedNav(`note:${activeId}`);
      } else {
        const items = vaultNavItems;
        if (items.length > 0) {
          setTreeSelectedNav(items[0].type === "note" ? `note:${items[0].id}` : `folder:${(items[0] as { path: string }).path}`);
        }
      }
    };
    window.addEventListener("nexote:focus-tree", onFocusTree);
    return () => window.removeEventListener("nexote:focus-tree", onFocusTree);
  }, [activeId, vaultNavItems]);

  // Scroll the keyboard-selected item into view in the tree.
  useEffect(() => {
    if (!treeSelectedNav) return;
    const [type, ...rest] = treeSelectedNav.split(":");
    const id = rest.join(":");
    const selector = type === "note" ? `[data-note-id="${id}"]` : `[data-folder-path="${id}"]`;
    const el = document.querySelector(selector);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [treeSelectedNav]);

  const expandAll = useCallback(() => {
    const paths = allFolderPaths(tree);
    const next: Record<string, boolean> = {};
    for (const p of paths) next[p] = true;
    setOpenMap(next);
  }, [tree]);

  const collapseAll = useCallback(() => {
    const paths = allFolderPaths(tree);
    const next: Record<string, boolean> = {};
    for (const p of paths) next[p] = false;
    setOpenMap(next);
  }, [tree]);

  const toggleSort = useCallback(() => setSorted((v) => !v), []);

  // Listen for the "toggle bookmarks view" event from the sidebar header icon.
  useEffect(() => {
    const onToggleBookmarks = () =>
      setShowBookmarksOnly((v) => !v);
    const onShowFileTree = () => setShowBookmarksOnly(false);
    window.addEventListener("nexote:toggle-bookmarks", onToggleBookmarks);
    window.addEventListener("nexote:show-filetree", onShowFileTree);
    return () => {
      window.removeEventListener("nexote:toggle-bookmarks", onToggleBookmarks);
      window.removeEventListener("nexote:show-filetree", onShowFileTree);
    };
  }, []);

  const folderPaths = useMemo(() => allFolderPaths(tree), [tree]);
  const allExpanded = folderPaths.every((p) => openMap[p] ?? true);

  const toggleExpandCollapse = useCallback(() => {
    if (allExpanded) collapseAll();
    else expandAll();
  }, [allExpanded, collapseAll, expandAll]);

  // Section collapse state: Shortcuts, Recent, Journal, and all vault sections.
  const allSectionsExpanded =
    shortcutsExpanded &&
    recentExpanded &&
    journalExpanded &&
    vaults.every((v) => vaultExpandedMap[v.id] ?? true);

  const setAllSections = useCallback(
    (expanded: boolean) => {
      setShortcutsExpanded(expanded);
      setRecentExpanded(expanded);
      setJournalExpanded(expanded);
      setVaultExpandedMap(
        Object.fromEntries(vaults.map((v) => [v.id, expanded])),
      );
    },
    [vaults],
  );

  const toggleSectionsCollapse = useCallback(() => {
    setAllSections(!allSectionsExpanded);
  }, [allSectionsExpanded, setAllSections]);

  // Vault icon options for the picker
  const vaultIconOptions = useMemo(() => {
    return [
      { name: "Database", icon: Database },
      { name: "Folder", icon: Folder },
      { name: "Star", icon: Star },
      { name: "Bookmark", icon: Bookmark },
      { name: "FileText", icon: FileText },
      { name: "Settings", icon: Settings2 },
      { name: "GraduationCap", icon: GraduationCap },
      { name: "Heart", icon: Heart },
      { name: "Home", icon: Home },
      { name: "Music", icon: Music },
      { name: "Shield", icon: Shield },
      { name: "Zap", icon: Zap },
    ];
  }, []);

  // Vault context menu handler
  const handleVaultContextMenu = useCallback(
    (e: React.MouseEvent, vaultId: string, vaultName: string) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: "Rename vault",
            icon: <Edit3 size={14} />,
            onClick: () => {
              setRenaming({ id: `vault:${vaultId}`, value: vaultName });
            },
          },
          {
            label: "Pick icon",
            icon: <Settings2 size={14} />,
            onClick: () => {
              setVaultIconPicker({ vaultId, x: e.clientX, y: e.clientY });
            },
          },
        ],
      });
    },
    [],
  );

  // Close icon picker on outside mousedown (not click — the opening
  // click has already fired by the time the popover renders, so a
  // "click" listener would close it immediately).
  useEffect(() => {
    if (!vaultIconPicker) return;
    const onDown = (e: MouseEvent) => {
      if (
        vaultIconPickerRef.current &&
        !vaultIconPickerRef.current.contains(e.target as Node)
      ) {
        setVaultIconPicker(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVaultIconPicker(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [vaultIconPicker]);

  const openFolderDialog = useCallback((parentPath?: string) => {
    setFolderDialog({ open: true, parentPath });
  }, []);

  const handleCreateHere = useCallback(() => {
    void create(drillPath ? { path: drillPath } : undefined);
  }, [create, drillPath]);

  const handleNewFolderHere = useCallback(() => {
    openFolderDialog(drillPath ?? undefined);
  }, [openFolderDialog, drillPath]);

  useEffect(() => {
    onControlsReady?.({
      expandAll,
      collapseAll,
      toggleSort,
      sorted,
      allExpanded,
      toggleExpandCollapse,
      allSectionsExpanded,
      toggleSectionsCollapse,
      folderMode: drillPath !== null && treeMode === "advanced",
      folderName: drillPath ? (drillPath.split("/").pop() || drillPath) : "",
      folderViewMode,
      onToggleFolderViewMode: () => setFolderViewMode((m) => (m === "detailed" ? "compact" : "detailed")),
      folderSort,
      onToggleFolderSort: () => setFolderSort((s) => !s),
      onNewNoteInFolder: handleCreateHere,
      onExitFolder: () => {
        const lastFolder = drillPath;
        setDrillPath(null);
        setFolderHistory([]);
        setFolderHistoryIndex(-1);
        if (lastFolder) setTreeSelectedNav(`folder:${lastFolder}`);
      },
      canGoBack: folderHistoryIndex >= 0,
      canGoForward: folderHistoryIndex < folderHistory.length - 1,
      onGoBack: folderGoBack,
      onGoForward: folderGoForward,
    });
  }, [
    onControlsReady,
    expandAll,
    collapseAll,
    toggleSort,
    sorted,
    allExpanded,
    toggleExpandCollapse,
    allSectionsExpanded,
    toggleSectionsCollapse,
    drillPath,
    treeMode,
    folderViewMode,
    folderSort,
    handleCreateHere,
    folderHistoryIndex,
    folderHistory.length,
    folderGoBack,
    folderGoForward,
  ]);

  const handleCreateFolder = useCallback(
    (fullPath: string) => {
      void createFolder(fullPath);
    },
    [createFolder],
  );

  // Rename a note by saving the new title, syncing with H1 in body.
  const handleRename = useCallback(
    async (id: string, newTitle: string) => {
      // Handle vault rename
      if (id.startsWith("vault:")) {
        const vaultId = id.slice(6);
        await renameVault(vaultId, newTitle);
        return;
      }
      const cached = notesById[id];
      if (!cached) return;
      await save(id, {
        title: newTitle,
        body: replaceOrAddH1(cached.body, newTitle),
      });
    },
    [notesById, save, renameVault],
  );

  // Move a note to a new path via context, then refresh.
  const handleMoveNote = useCallback(
    (id: string, path: string) => {
      void moveNote(id, path);
    },
    [moveNote],
  );

  // Delete a folder via context, then refresh.
  const handleDeleteFolder = useCallback(
    (path: string) => {
      void removeFolder(path);
    },
    [removeFolder],
  );

  // Drag and drop handlers.
  const handleNoteDragStart = useCallback((id: string) => {
    setDragNoteId(id);
  }, []);

  const handleFolderDrop = useCallback(
    (folderPath: string) => {
      if (dragNoteId && dragNoteId !== "") {
        void moveNote(dragNoteId, folderPath);
      }
      setDragNoteId(null);
      setDragOverPath(null);
    },
    [dragNoteId, moveNote],
  );

  // Drop a dragged note into a different vault (moves it).
  const handleVaultDrop = useCallback(
    (dstVaultId: string) => {
      if (dragNoteId && dragNoteId !== "") {
        void moveNoteToVault(dragNoteId, dstVaultId);
      }
      setDragNoteId(null);
      setDragOverPath(null);
      setDragOverVaultId(null);
    },
    [dragNoteId, moveNoteToVault],
  );

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        <button id="nexote-new-note-btn" type="button" className="hidden" onClick={handleCreateHere} />
        <button id="nexote-new-folder-btn" type="button" className="hidden" onClick={handleNewFolderHere} />
      </div>
    );
  }

  const inFolderMode = drillPath !== null && treeMode === "advanced";

  return (
    <div className="flex h-full flex-col">
      <button id="nexote-new-note-btn" type="button" className="hidden" onClick={handleCreateHere} />
      <button id="nexote-new-folder-btn" type="button" className="hidden" onClick={handleNewFolderHere} />

      <div className="relative flex-1 overflow-hidden">
        {/* Root tree panel — slides left when entering folder */}
        <div
          className="absolute inset-0 overflow-y-auto px-1 pb-2 pt-1 transition-transform duration-300 ease-in-out"
          style={{
            transform: inFolderMode ? "translateX(-100%)" : "translateX(0)",
            pointerEvents: inFolderMode ? "none" : "auto",
          }}
        >
          {showBookmarksOnly ? (
            <BookmarksList
              notes={notes.filter((n) => bookmarks.has(n.id))}
              activeId={activeId}
              activeSource={activeSource}
              onOpen={(id) => openFromSection("bookmarks", id)}
              onDelete={setPendingDelete}
              onCopy={copyNote}
              onBookmark={toggleBookmark}
              onShortcut={toggleShortcut}
              bookmarks={bookmarks}
              shortcuts={shortcuts}
              onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
              renaming={renaming}
              setRenaming={setRenaming}
              onRename={handleRename}
              onMoveNote={handleMoveNote}
            />
          ) : drillPath !== null && treeMode !== "advanced" ? (
            <DrillView
              path={drillPath}
              notes={notes}
              folders={folders ?? []}
              activeId={activeId}
              activeSource={activeSource}
              onOpen={(id) => openFromSection("drill", id)}
              onDelete={setPendingDelete}
              onCopy={copyNote}
              onBookmark={toggleBookmark}
              onShortcut={toggleShortcut}
              bookmarks={bookmarks}
              shortcuts={shortcuts}
              onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
              renaming={renaming}
              setRenaming={setRenaming}
              onRename={handleRename}
              onMoveNote={handleMoveNote}
              onBack={() => setDrillPath(null)}
              onDrillInto={setDrillPath}
            />
          ) : treeMode === "simple" ? (
            <div>
              <TreeChildren
                node={tree}
                depth={0}
                activeId={activeId}
                activeSource={activeSource}
                sectionTag="simple"
                treeSelectedNav={treeSelectedNav}
                setTreeSelectedNav={setTreeSelectedNav}
                onOpen={(id) => openFromSection("simple", id)}
                onDelete={setPendingDelete}
                onCopy={copyNote}
                onBookmark={toggleBookmark}
                onShortcut={toggleShortcut}
                bookmarks={bookmarks}
                shortcuts={shortcuts}
                isFolderOpen={isFolderOpen}
                setOpenMap={setOpenMap}
                sorted={sorted}
                onNoteDragStart={handleNoteDragStart}
                onFolderDragOver={setDragOverPath}
                onFolderDrop={handleFolderDrop}
                dragOverPath={dragOverPath}
                onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
                renaming={renaming}
                setRenaming={setRenaming}
                onRename={handleRename}
                onMoveNote={handleMoveNote}
                onDeleteFolder={handleDeleteFolder}
                onNewNoteInFolder={(path) => void create({ path })}
                onNewFolderInFolder={(path) => openFolderDialog(path)}
                onDrillInto={setDrillPath}
              />
            </div>
          ) : (
            <>
              {/* Shortcuts section */}
              {shortcuts.size > 0 && (
                <CollapsibleSection
                  title="Shortcuts"
                  count={shortcuts.size}
                  expanded={shortcutsExpanded}
                  onToggle={() => setShortcutsExpanded((v) => !v)}
                  icon={<Pin className="h-3.5 w-3.5 shrink-0" style={{ color: navSection === "shortcuts" ? "var(--primary)" : "#6b6b70" }} />}
                  sectionActive={navSection === "shortcuts"}
                >
                  <ul>
                    {notes
                      .filter((n) => shortcuts.has(n.id))
                      .sort((a, b) => a.title.localeCompare(b.title))
                      .map((n) => (
                        <NoteItem
                          key={n.id}
                          note={n}
                          depth={0}
                          active={n.id === activeId && activeSource === "shortcuts"}
                          activeId={activeId}
                          treeSelectedNav={navSection === "shortcuts" ? treeSelectedNav : null}
                          setTreeSelectedNav={setTreeSelectedNav}
                          onOpen={(id) => openFromSection("shortcuts", id)}
                          onDelete={setPendingDelete}
                          onCopy={copyNote}
                          onBookmark={toggleBookmark}
                          onShortcut={toggleShortcut}
                          bookmarks={bookmarks}
                          shortcuts={shortcuts}
                          onNoteDragStart={handleNoteDragStart}
                          onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
                          renaming={renaming}
                          setRenaming={setRenaming}
                          onRename={handleRename}
                          onMoveNote={handleMoveNote}
                          isFolderOpen={() => false}
                          setOpenMap={() => {}}
                          sorted={false}
                          onFolderDragOver={() => {}}
                          onFolderDrop={() => {}}
                          dragOverPath={null}
                          onDeleteFolder={() => {}}
                          onNewNoteInFolder={() => {}}
                          onNewFolderInFolder={() => {}}
                          onDrillInto={() => {}}
                        />
                      ))}
                  </ul>
                </CollapsibleSection>
              )}

              {/* Recent files section */}
              <CollapsibleSection
                title="Recent"
                count={Math.min(10, recentNotes.length)}
                expanded={recentExpanded}
                onToggle={() => setRecentExpanded((v) => !v)}
                icon={<Clock className="h-3.5 w-3.5 shrink-0" style={{ color: navSection === "recent" ? "var(--primary)" : "#6b6b70" }} />}
                sectionActive={navSection === "recent"}
              >
                <RecentFilesList
                  notes={recentNotes}
                  activeId={activeId}
                  activeSource={activeSource}
                  treeSelectedNav={navSection === "recent" ? treeSelectedNav : null}
                  setTreeSelectedNav={setTreeSelectedNav}
                  onOpen={(id) => openFromSection("recent", id)}
                  onDelete={setPendingDelete}
                  onCopy={copyNote}
                  onBookmark={toggleBookmark}
                  onShortcut={toggleShortcut}
                  bookmarks={bookmarks}
                  shortcuts={shortcuts}
                  onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
                  renaming={renaming}
                  setRenaming={setRenaming}
                  onRename={handleRename}
                  onMoveNote={handleMoveNote}
                />
              </CollapsibleSection>

              {/* Journal section */}
              {journalNotes.length > 0 && (
                <CollapsibleSection
                  title="Journal"
                  count={journalNotes.length}
                  expanded={journalExpanded}
                  onToggle={() => setJournalExpanded((v) => !v)}
                  icon={<Calendar className="h-3.5 w-3.5 shrink-0" style={{ color: navSection === "journal" ? "var(--primary)" : "#6b6b70" }} />}
                  sectionActive={navSection === "journal"}
                >
                  <ul>
                    {journalNotes
                      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                      .map((n) => (
                        <NoteItem
                          key={n.id}
                          note={n}
                          depth={0}
                          active={n.id === activeId && activeSource === "journal"}
                          activeId={activeId}
                          treeSelectedNav={navSection === "journal" ? treeSelectedNav : null}
                          setTreeSelectedNav={setTreeSelectedNav}
                          onOpen={(id) => {
                            sectionOpenRef.current = true;
                            setActiveSource("journal");
                            void openJournalNote(id);
                          }}
                          onDelete={setPendingDelete}
                          onCopy={copyNote}
                          onBookmark={toggleBookmark}
                          onShortcut={toggleShortcut}
                          bookmarks={bookmarks}
                          shortcuts={shortcuts}
                          onNoteDragStart={() => {}}
                          onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
                          renaming={renaming}
                          setRenaming={setRenaming}
                          onRename={handleRename}
                          onMoveNote={() => {}}
                          isFolderOpen={() => false}
                          setOpenMap={() => {}}
                          sorted={false}
                          onFolderDragOver={() => {}}
                          onFolderDrop={() => {}}
                          dragOverPath={null}
                          onDeleteFolder={() => {}}
                          onNewNoteInFolder={() => {}}
                          onNewFolderInFolder={() => {}}
                          onDrillInto={() => {}}
                        />
                      ))}
                  </ul>
                </CollapsibleSection>
              )}

              {/* Vault sections */}
              {vaults.map((vault) => {
                const vaultData = allVaultData[vault.id];
                if (!vaultData) return null;
                const isExpanded = vaultExpandedMap[vault.id] ?? true;
                const isActiveVault = vault.id === activeVault?.id;
                const vaultTree = buildTree(vaultData.notes, vaultData.folders);
                return (
                  <CollapsibleSection
                    key={vault.id}
                    title={vault.name}
                    count={vaultData.notes.length}
                    expanded={isExpanded}
                    onToggle={() =>
                      setVaultExpandedMap((prev) => ({
                        ...prev,
                        [vault.id]: !isExpanded,
                      }))
                    }
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragNoteId) setDragOverVaultId(vault.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverVaultId === vault.id) setDragOverVaultId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleVaultDrop(vault.id);
                    }}
                    dropActive={dragNoteId !== null && dragOverVaultId === vault.id}
                    icon={(() => {
                      const VaultIcon = getVaultIcon(vault.icon);
                      return <VaultIcon className="h-3.5 w-3.5 shrink-0" style={{ opacity: isActiveVault ? 1 : 0.6, color: navSection === "vault" ? "var(--primary)" : undefined }} />;
                    })()}
                    bold={isActiveVault}
                    sectionActive={navSection === "vault"}
                    onContextMenu={(e) => handleVaultContextMenu(e, vault.id, vault.name)}
                    editing={renaming?.id === `vault:${vault.id}`}
                    editValue={renaming?.id === `vault:${vault.id}` ? renaming.value : undefined}
                    onEditChange={(v) =>
                      setRenaming({ id: `vault:${vault.id}`, value: v })
                    }
                    onEditCommit={() => {
                      if (renaming) {
                        void handleRename(`vault:${vault.id}`, renaming.value.trim() || vault.name);
                      }
                      setRenaming(null);
                    }}
                    onEditCancel={() => setRenaming(null)}
                  >
                    {isActiveVault ? (
                      <TreeChildren
                        node={vaultTree}
                        depth={0}
                        activeId={activeId}
                        activeSource={activeSource}
                        sectionTag={`vault:${vault.id}`}
                        treeSelectedNav={navSection === "vault" ? treeSelectedNav : null}
                        setTreeSelectedNav={setTreeSelectedNav}
                        onOpen={(id) => openFromSection(`vault:${vault.id}`, id)}
                        onDelete={setPendingDelete}
                        onCopy={copyNote}
                        onBookmark={toggleBookmark}
                        onShortcut={toggleShortcut}
                        bookmarks={bookmarks}
                        shortcuts={shortcuts}
                        isFolderOpen={isFolderOpen}
                        setOpenMap={setOpenMap}
                        sorted={sorted}
                        onNoteDragStart={handleNoteDragStart}
                        onFolderDragOver={setDragOverPath}
                        onFolderDrop={handleFolderDrop}
                        dragOverPath={dragOverPath}
                        onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
                        renaming={renaming}
                        setRenaming={setRenaming}
                        onRename={handleRename}
                        onMoveNote={handleMoveNote}
                        onDeleteFolder={handleDeleteFolder}
                        onNewNoteInFolder={(path) => void create({ path })}
                        onNewFolderInFolder={(path) => openFolderDialog(path)}
                        onDrillInto={navigateToFolder}
                      />
                    ) : (
                      <VaultNoteList
                        vaultId={vault.id}
                        notes={vaultData.notes}
                        folders={vaultData.folders}
                        activeId={activeId}
                        activeSource={activeSource}
                        onOpen={(id) => {
                          sectionOpenRef.current = true;
                          setActiveSource(`vault:${vault.id}`);
                          openNoteInVault(vault.id, id);
                        }}
                        onDrillInto={() => {
                          switchVault(vault.id);
                        }}
                      />
                    )}
                  </CollapsibleSection>
                );
              })}
            </>
          )}
        </div>

        {/* Folder view panel — slides in from right */}
        {drillPath !== null && treeMode === "advanced" && (
          <div className="absolute inset-0 overflow-y-auto px-1 pb-2 pt-1 slide-in-right"
          >
            <FolderDetailView
              path={drillPath}
              notes={notes}
              activeId={activeId}
              activeSource={activeSource}
              notesById={notesById}
              onOpen={(id) => openFromSection("drill", id)}
              onBack={() => {
                const lastFolder = drillPath;
                setDrillPath(null);
                setFolderHistory([]);
                setFolderHistoryIndex(-1);
                if (lastFolder) setTreeSelectedNav(`folder:${lastFolder}`);
              }}
              canGoBack={folderHistoryIndex >= 0}
              canGoForward={folderHistoryIndex < folderHistory.length - 1}
              onGoBack={folderGoBack}
              onGoForward={folderGoForward}
              viewMode={folderViewMode}
              onToggleViewMode={() => setFolderViewMode((m) => m === "detailed" ? "compact" : "detailed")}
              onNewNote={handleCreateHere}
              sort={folderSort}
              onToggleSort={() => setFolderSort((s) => !s)}
            />
          </div>
        )}
      </div>

      {/* Vault switcher + settings at the bottom */}
      <div
        className="flex shrink-0 items-center gap-2"
        style={{ height: 34, paddingLeft: 14, paddingRight: 14, borderTop: "1px solid var(--border)" }}
      >
        <Database size={12} className="shrink-0" style={{ color: "#6b6b70" }} />
        <select
          value={activeVault?.id ?? ""}
          onChange={(e) => switchVault(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none cursor-pointer"
          style={{ appearance: "none", color: "#c8c8cc", fontSize: 13 }}
        >
          {vaults.map((v) => (
            <option key={v.id} value={v.id} style={{ background: "var(--background)" }}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("nexote:open-settings"))
          }
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/5"
          style={{ color: "#6b6b70" }}
        >
          <Settings2 size={12} />
        </button>
      </div>

      <DeleteConfirm
        open={pendingDelete !== null}
        noteId={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async (id) => {
          setPendingDelete(null);
          await remove(id);
        }}
      />

      <FolderCreateDialog
        open={folderDialog.open}
        parentPath={folderDialog.parentPath}
        onClose={() => setFolderDialog({ open: false })}
        onCreate={handleCreateFolder}
      />

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Vault icon picker popover */}
      {vaultIconPicker && (
        <div
          ref={vaultIconPickerRef}
          className="fixed z-50 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 shadow-lg"
          style={{ left: vaultIconPicker.x, top: vaultIconPicker.y }}
        >
          <div className="mb-1 px-2 text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
            Pick vault icon
          </div>
          <div className="grid grid-cols-4 gap-1">
            {vaultIconOptions.map(({ name, icon: Icon }) => (
              <button
                key={name}
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded hover:bg-white/10"
                title={name}
                onClick={() => {
                  setVaultIcon(vaultIconPicker.vaultId, name);
                  setVaultIconPicker(null);
                }}
              >
                <Icon className="h-4 w-4" style={{ color: "#c8c8cc" }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type TreeChildProps = {
  depth: number;
  activeId: string | null;
  activeSource?: string | null;
  sectionTag?: string;
  treeSelectedNav?: string | null;
  setTreeSelectedNav?: (nav: string | null) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onBookmark: (id: string) => void;
  bookmarks: Set<string>;
  onShortcut: (id: string) => void;
  shortcuts: Set<string>;
  isFolderOpen: (path: string) => boolean;
  setOpenMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  sorted: boolean;
  onNoteDragStart: (id: string) => void;
  onFolderDragOver: (path: string | null) => void;
  onFolderDrop: (path: string) => void;
  dragOverPath: string | null;
  onContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  renaming: { id: string; value: string } | null;
  setRenaming: (r: { id: string; value: string } | null) => void;
  onRename: (id: string, title: string) => void;
  onMoveNote: (id: string, path: string) => void;
  onDeleteFolder: (path: string) => void;
  onNewNoteInFolder: (path: string) => void;
  onNewFolderInFolder: (path: string) => void;
  onDrillInto: (path: string) => void;
};

function TreeChildren(props: TreeChildProps & { node: TreeNode }) {
  const { node, depth, sorted, ...rest } = props;
  const folders = [...node.children.values()];
  const notes = [...node.notes];
  if (sorted) {
    folders.sort((a, b) => a.name.localeCompare(b.name));
    notes.sort((a, b) => a.title.localeCompare(b.title));
  }
  const childProps = { ...rest, sorted };
  return (
    <ul>
      {folders.map((child) => (
        <FolderItem key={child.path} {...childProps} node={child} depth={depth} />
      ))}
      {notes.map((n) => (
        <NoteItem
          key={n.id}
          {...childProps}
          note={n}
          depth={depth}
          active={
            n.id === rest.activeId &&
            (rest.sectionTag === undefined || rest.activeSource === rest.sectionTag)
          }
        />
      ))}
    </ul>
  );
}

function FolderItem(props: TreeChildProps & { node: TreeNode; depth: number }) {
  const {
    node,
    depth,
    isFolderOpen,
    setOpenMap,
    sorted,
    onFolderDragOver,
    onFolderDrop,
    dragOverPath,
    onContextMenu,
    onNewNoteInFolder,
    onNewFolderInFolder,
    onDeleteFolder,
    onDrillInto,
    treeSelectedNav,
    setTreeSelectedNav,
  } = props;
  const open = isFolderOpen(node.path);
  const isDragOver = dragOverPath === node.path;
  const isSelected = treeSelectedNav === `folder:${node.path}`;

  return (
    <li>
      <div
        data-folder-path={node.path}
        draggable={false}
        onMouseEnter={() => setTreeSelectedNav?.(`folder:${node.path}`)}
        onDragOver={(e) => {
          e.preventDefault();
          onFolderDragOver(node.path);
        }}
        onDragLeave={() => {
          if (dragOverPath === node.path) onFolderDragOver(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          onFolderDrop(node.path);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e.clientX, e.clientY, [
            {
              label: "New note",
              icon: <FilePlus className="h-4 w-4" />,
              onClick: () => onNewNoteInFolder(node.path),
            },
            {
              label: "New subfolder",
              icon: <FolderPlus className="h-4 w-4" />,
              onClick: () => onNewFolderInFolder(node.path),
            },
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Delete folder",
              icon: <Trash2 className="h-4 w-4" />,
              danger: true,
              onClick: () => onDeleteFolder(node.path),
            },
          ]);
        }}
          className={[
            "group flex w-full items-center gap-2 transition-colors",
            isDragOver
              ? "bg-primary/20"
              : "hover:bg-white/5",
          ].join(" ")}
          style={{
            height: 33,
            paddingLeft: 14 + depth * 14,
            paddingRight: 14,
            borderRadius: 5,
            background: isSelected ? "rgba(255,255,255,0.10)" : undefined,
            outline: undefined,
          }}
        >
          <button
            type="button"
            onClick={() => onDrillInto(node.path)}
            className="flex items-center gap-2 min-w-0 flex-1"
            style={{ height: 33 }}
          >
            <ChevronRight
              className={[
                "h-3 w-3 shrink-0 transition-transform",
                open ? "rotate-90" : "",
              ].join(" ")}
              style={{ color: "#6b6b70" }}
            />
            {open ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0" style={{ color: "#6b6b70" }} />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: "#6b6b70" }} />
            )}
            <span className="truncate" style={{ fontSize: 13, fontWeight: 500, color: "#c8c8cc" }}>{node.name}</span>
          </button>
          <button
            type="button"
            aria-label={`Toggle ${node.name} folder`}
            title="Expand / collapse"
            onClick={(e) => {
              e.stopPropagation();
              setOpenMap((prev) => ({ ...prev, [node.path]: !open }));
            }}
            className="shrink-0 p-0.5 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            style={{ color: "#6b6b70" }}
          >
            <ChevronRight
              className={["h-3.5 w-3.5 transition-transform", open ? "rotate-90" : ""].join(" ")}
            />
          </button>
        </div>
      {open && (
        <TreeChildren
          {...props}
          node={node}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

function NoteItem(
  props: TreeChildProps & {
    note: { id: string; title: string };
    depth: number;
    active: boolean;
  },
) {
  const {
    note,
    depth,
    active,
    treeSelectedNav,
    setTreeSelectedNav,
    onOpen,
    onDelete,
    onCopy,
    onBookmark,
    bookmarks,
    onShortcut,
    shortcuts,
    onNoteDragStart,
    onContextMenu,
    renaming,
    setRenaming,
    onRename,
    onMoveNote,
  } = props;

  const isRenaming = renaming?.id === note.id;
  const isBookmarked = bookmarks.has(note.id);
  const isShortcut = shortcuts.has(note.id);
  const isSelected = treeSelectedNav === `note:${note.id}`;

  return (
    <li>
      <div
        data-note-id={note.id}
        draggable
        onDragStart={() => onNoteDragStart(note.id)}
        onMouseEnter={() => setTreeSelectedNav?.(`note:${note.id}`)}
        onClick={() => !isRenaming && onOpen(note.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e.clientX, e.clientY, [
            {
              label: "Open in new tab",
              icon: <SquareArrowOutUpRight className="h-4 w-4" />,
              onClick: () => onOpen(note.id),
            },
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Make a copy",
              icon: <Copy className="h-4 w-4" />,
              onClick: () => onCopy(note.id),
            },
            {
              label: "Move to root",
              icon: <FolderInput className="h-4 w-4" />,
              onClick: () => onMoveNote(note.id, ""),
            },
            {
              label: isShortcut ? "Remove shortcut" : "Add shortcut",
              icon: isShortcut
                ? <BookmarkCheck className="h-4 w-4" />
                : <Star className="h-4 w-4" />,
              onClick: () => onShortcut(note.id),
            },
            {
              label: isBookmarked ? "Remove from bookmarks" : "Add to bookmarks",
              icon: <Bookmark className="h-4 w-4" />,
              onClick: () => onBookmark(note.id),
            },
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Rename",
              icon: <Edit3 className="h-4 w-4" />,
              onClick: () => setRenaming({ id: note.id, value: note.title }),
            },
            {
              label: "Delete",
              icon: <Trash2 className="h-4 w-4" />,
              danger: true,
              onClick: () => onDelete(note.id),
            },
          ]);
        }}
        className={[
          "group flex w-full items-center gap-2 transition-colors",
          active ? "" : "hover:bg-white/5",
        ].join(" ")}
        style={{
          height: 33,
          paddingLeft: 30 + depth * 14,
          paddingRight: 14,
          borderRadius: 5,
          background: active
            ? "var(--primary)"
            : isSelected
              ? "rgba(255,255,255,0.10)"
              : undefined,
          outline: undefined,
        }}
      >
        <FileText
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: active ? "var(--primary-foreground)" : "#6b6b70" }}
        />
        {isRenaming ? (
          <input
            value={renaming.value}
            autoFocus
            onChange={(e) =>
              setRenaming({ id: note.id, value: e.target.value })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRename(note.id, renaming.value.trim() || "Untitled");
                setRenaming(null);
              }
              if (e.key === "Escape") setRenaming(null);
            }}
            onBlur={() => {
              if (renaming.value !== note.title) {
                onRename(note.id, renaming.value.trim() || "Untitled");
              }
              setRenaming(null);
            }}
            className="min-w-0 flex-1 rounded border px-1 outline-none"
            style={{
              background: "var(--background)",
              borderColor: "var(--ring)",
              fontSize: 13,
              color: "var(--foreground)",
            }}
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setRenaming({ id: note.id, value: note.title })}
            className="min-w-0 flex-1 truncate text-left"
            style={{
              fontSize: 13,
              color: active ? "var(--primary-foreground)" : "#c8c8cc",
            }}
          >
            {note.title || "Untitled"}
          </button>
        )}
        <button
          type="button"
          aria-label="Delete note"
          title="Delete note"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
          className="shrink-0 p-0.5 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
          style={{ color: active ? "var(--primary-foreground)" : "#6b6b70" }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

function BookmarksList({
  notes,
  activeId,
  activeSource,
  onOpen,
  onDelete,
  onCopy,
  onBookmark,
  onShortcut,
  bookmarks,
  shortcuts,
  onContextMenu,
  renaming,
  setRenaming,
  onRename,
  onMoveNote,
}: {
  notes: { id: string; title: string; path: string }[];
  activeId: string | null;
  activeSource: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onBookmark: (id: string) => void;
  onShortcut: (id: string) => void;
  bookmarks: Set<string>;
  shortcuts: Set<string>;
  onContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  renaming: { id: string; value: string } | null;
  setRenaming: (r: { id: string; value: string } | null) => void;
  onRename: (id: string, title: string) => void;
  onMoveNote: (id: string, path: string) => void;
}) {
  const sorted = [...notes].sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  return (
    <ul>
      {sorted.length === 0 && (
        <li className="px-3 py-2 text-xs text-muted-foreground/50">
          No bookmarked notes yet.
        </li>
      )}
      {sorted.map((n) => (
        <NoteItem
          key={n.id}
          note={n}
          depth={0}
          active={n.id === activeId && activeSource === "bookmarks"}
          activeId={activeId}
          onOpen={onOpen}
          onDelete={onDelete}
          onCopy={onCopy}
          onBookmark={onBookmark}
          onShortcut={onShortcut}
          bookmarks={bookmarks}
          shortcuts={shortcuts}
          onNoteDragStart={() => {}}
          onContextMenu={onContextMenu}
          renaming={renaming}
          setRenaming={setRenaming}
          onRename={onRename}
          onMoveNote={onMoveNote}
          isFolderOpen={() => false}
          setOpenMap={() => {}}
          sorted={false}
          onFolderDragOver={() => {}}
          onFolderDrop={() => {}}
          dragOverPath={null}
          onDeleteFolder={() => {}}
          onNewNoteInFolder={() => {}}
          onNewFolderInFolder={() => {}}
          onDrillInto={() => {}}
        />
      ))}
    </ul>
  );
}

// --- Recent Files section ---
function RecentFiles({
  notes,
  activeId,
  onOpen,
  expanded,
  onToggle,
}: {
  notes: { id: string; title: string; updatedAt: string }[];
  activeId: string | null;
  onOpen: (id: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const recent = [...notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);

  if (recent.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={[
            "h-3 w-3 shrink-0 transition-transform",
            expanded ? "rotate-90" : "",
          ].join(" ")}
        />
        <Clock className="h-3 w-3 shrink-0" />
        <span>Recent</span>
        <span className="ml-auto text-muted-foreground/50">{recent.length}</span>
      </button>
      {expanded && (
        <ul>
          {recent.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onOpen(n.id)}
                className={[
                  "flex w-full items-center gap-1.5 px-2 py-0.5 text-sm transition-colors",
                  n.id === activeId
                    ? "text-foreground"
                    : "text-foreground/70 hover:bg-muted",
                ].join(" ")}
                style={{ paddingLeft: 24 }}
              >
                <FileText
                  className={[
                    "h-3.5 w-3.5 shrink-0",
                    n.id === activeId
                      ? "text-primary"
                      : "text-muted-foreground/60",
                  ].join(" ")}
                />
                <span className="truncate">{n.title || "Untitled"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Helpers for folder detail view ---

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function timeBucket(updatedAt: string): "today" | "yesterday" | "week" | "older" {
  const updated = new Date(updatedAt);
  const now = new Date();
  const today = startOfDay(now);
  const updatedDay = startOfDay(updated);
  const diffDays = Math.round((today.getTime() - updatedDay.getTime()) / 86400000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "week";
  return "older";
}

const BUCKET_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 days",
  older: "Older",
};

const BUCKET_ORDER = ["today", "yesterday", "week", "older"] as const;

function formatTime(updatedAt: string) {
  const d = new Date(updatedAt);
  const now = new Date();
  const sameDay = startOfDay(d).getTime() === startOfDay(now).getTime();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const diffDays = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000);
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Build a preview snippet from the note body, skipping the first H1
// heading (which is the title) and taking the next meaningful content.
// Strips HTML tags, markdown markers, and image/link syntax.
function makeSnippetAfterH1(body: string | undefined, max = 100) {
  if (!body) return "";
  const lines = body.split("\n");
  let start = 0;
  if (lines[0] && /^#\s+/.test(lines[0])) {
    start = 1;
  }
  const rest = lines
    .slice(start)
    .map((l) =>
      l
        .replace(/<[^>]+>/g, " ")
        .replace(/^#+\s*/, "")
        .replace(/[*_`~]/g, "")
        .replace(/\[(.+?)\]\(.+?\)/g, "$1")
        .replace(/!\[.*?\]\(.*?\)/g, "")
        .replace(/^\s*[-+*]\s+/, "")
        .trim(),
    )
    .filter((l) => l.length > 0);
  const text = rest.join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// --- Folder detail view (advanced mode) ---
// Shows notes in a folder grouped by time buckets with previews.
function FolderDetailView({
  path,
  notes,
  activeId,
  activeSource,
  notesById,
  onOpen,
  onBack,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  viewMode,
  onToggleViewMode,
  onNewNote,
  sort,
  onToggleSort,
}: {
  path: string;
  notes: { id: string; title: string; path: string; updatedAt: string }[];
  activeId: string | null;
  activeSource: string | null;
  notesById: Record<string, { body?: string }>;
  onOpen: (id: string) => void;
  onBack: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  viewMode: "compact" | "detailed";
  onToggleViewMode: () => void;
  onNewNote: () => void;
  sort: boolean;
  onToggleSort: () => void;
}) {
  const folderName = path.split("/").pop() || path;
  const folderNotes = notes
    .filter((n) => n.path === path)
    .sort((a, b) => {
      if (sort) return a.title.localeCompare(b.title);
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  // Flat ordered list of note ids for keyboard navigation.
  const flatIds = useMemo(() => folderNotes.map((n) => n.id), [folderNotes]);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const ai = flatIds.indexOf(activeId ?? "");
    return ai >= 0 ? ai : 0;
  });

  // Reset selection when the folder changes.
  useEffect(() => {
    const ai = flatIds.indexOf(activeId ?? "");
    setSelectedIndex(ai >= 0 ? ai : 0);
  }, [path, flatIds, activeId]);

  // Group by time bucket.
  const grouped = useMemo(() => {
    const map: Record<string, typeof folderNotes> = {};
    for (const n of folderNotes) {
      const b = timeBucket(n.updatedAt);
      (map[b] ??= []).push(n);
    }
    return map;
  }, [folderNotes]);

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, [path]);

  // Keyboard navigation via window listener (more reliable than element
  // focus, which can be stolen by the editor or lost to the scroll
  // container). We use capture phase so we get the event before the
  // scroll container and can preventDefault.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't interfere when the editor or an input is focused.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || el.closest(".milkdown") || el.closest(".ProseMirror"))) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "ArrowDown") {
          setSelectedIndex((i) => Math.min(i + 1, flatIds.length - 1));
        } else if (e.key === "ArrowUp") {
          setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "ArrowRight" || e.key === "Enter") {
          if (flatIds[selectedIndex]) onOpen(flatIds[selectedIndex]);
        } else if (e.key === "ArrowLeft") {
          onGoBack();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [flatIds, selectedIndex, onOpen, onGoBack]);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="flex flex-col outline-none"
    >
      {/* Note list — compact or detailed */}
      <div className="pt-1">
        {folderNotes.length === 0 && (
          <div className="px-3 py-2 text-xs" style={{ color: "#6b6b70", paddingLeft: 30 }}>
            This folder has no notes.
          </div>
        )}
        {viewMode === "compact" ? (
          <ul>
            {folderNotes.map((n) => {
              const flatIndex = flatIds.indexOf(n.id);
              const active = n.id === activeId && activeSource === "drill";
              const selected = flatIndex === selectedIndex;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(n.id)}
                    onMouseEnter={() => setSelectedIndex(flatIndex)}
                    className="group flex w-full items-center gap-2 transition-colors hover:bg-white/5"
                    style={{
                      height: 33,
                      paddingLeft: 14,
                      paddingRight: 14,
                      borderRadius: 5,
                      background: active ? "var(--primary)" : selected ? "rgba(255,255,255,0.06)" : undefined,
                    }}
                  >
                    <FileText
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: active ? "var(--primary-foreground)" : "#6b6b70" }}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-left"
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: active ? "var(--primary-foreground)" : "#c8c8cc",
                      }}
                    >
                      {n.title || "Untitled"}
                    </span>
                    <span
                      className="shrink-0"
                      style={{ fontSize: 11, color: active ? "var(--primary-foreground)" : "#6b6b70", opacity: 0.8 }}
                    >
                      {formatTime(n.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          BUCKET_ORDER.map((bucket) => {
            const items = grouped[bucket];
            if (!items || items.length === 0) return null;
            return (
              <div key={bucket} className="mb-2">
                <div
                  className="px-3 pb-1 pt-2"
                  style={{ fontSize: 12, fontWeight: 500, color: "#6b6b70", paddingLeft: 14 }}
                >
                  {BUCKET_LABELS[bucket]}
                </div>
                <ul>
                  {items.map((n) => {
                    const flatIndex = flatIds.indexOf(n.id);
                    const active = n.id === activeId && activeSource === "drill";
                    const selected = flatIndex === selectedIndex;
                    const snippet = makeSnippetAfterH1(notesById[n.id]?.body);
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(n.id)}
                          onMouseEnter={() => setSelectedIndex(flatIndex)}
                          className="group flex w-full flex-col gap-0.5 transition-colors hover:bg-white/5"
                          style={{
                            paddingLeft: 14,
                            paddingRight: 14,
                            paddingTop: 7,
                            paddingBottom: 7,
                            borderRadius: 5,
                            background: active
                              ? "var(--primary)"
                              : selected
                                ? "rgba(255,255,255,0.06)"
                                : undefined,
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <FileText
                              className="h-3.5 w-3.5 shrink-0"
                              style={{ color: active ? "var(--primary-foreground)" : "#6b6b70" }}
                            />
                            <span
                              className="min-w-0 flex-1 truncate text-left"
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: active ? "var(--primary-foreground)" : "#c8c8cc",
                              }}
                            >
                              {n.title || "Untitled"}
                            </span>
                            <span
                              className="shrink-0"
                              style={{
                                fontSize: 11,
                                color: active ? "var(--primary-foreground)" : "#6b6b70",
                                opacity: 0.8,
                              }}
                            >
                              {formatTime(n.updatedAt)}
                            </span>
                          </div>
                          {snippet && (
                            <span
                              className="truncate text-left"
                              style={{
                                fontSize: 12,
                                color: active ? "var(--primary-foreground)" : "#6b6b70",
                                opacity: 0.7,
                                paddingLeft: 22,
                              }}
                            >
                              {snippet}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// --- Drill-in view (shows contents of a specific folder) ---
function DrillView({
  path,
  notes,
  folders,
  activeId,
  activeSource,
  onOpen,
  onDelete,
  onCopy,
  onBookmark,
  onShortcut,
  bookmarks,
  shortcuts,
  onContextMenu,
  renaming,
  setRenaming,
  onRename,
  onMoveNote,
  onBack,
  onDrillInto,
}: {
  path: string;
  notes: { id: string; title: string; path: string }[];
  folders: { path: string; name: string }[];
  activeId: string | null;
  activeSource: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onBookmark: (id: string) => void;
  onShortcut: (id: string) => void;
  bookmarks: Set<string>;
  shortcuts: Set<string>;
  onContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  renaming: { id: string; value: string } | null;
  setRenaming: (r: { id: string; value: string } | null) => void;
  onRename: (id: string, title: string) => void;
  onMoveNote: (id: string, path: string) => void;
  onBack: () => void;
  onDrillInto: (path: string) => void;
}) {
  // Filter folders that are direct children of `path`.
  const subFolders = folders.filter(
    (f) => {
      if (f.path === path) return false;
      if (!f.path.startsWith(path + "/")) return false;
      const rest = f.path.slice(path.length + 1);
      return !rest.includes("/");
    },
  );
  // Filter notes that are directly in `path`.
  const folderNotes = notes.filter((n) => n.path === path);

  const segments = path.split("/");

  return (
    <div>
      {/* Back arrow + breadcrumb */}
      <div className="flex items-center gap-2 mb-1" style={{ height: 34, paddingLeft: 14, paddingRight: 14, borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          aria-label="Back to tree"
          title="Back to tree"
          onClick={onBack}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/5"
          style={{ color: "#6b6b70" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden" style={{ fontSize: 12 }}>
          {segments.map((seg, i) => {
            const fullPath = segments.slice(0, i + 1).join("/");
            const isLast = i === segments.length - 1;
            return (
              <span key={i} className="flex items-center gap-0.5 shrink-0">
                {i > 0 && <span style={{ color: "#6b6b70" }}>/</span>}
                <button
                  type="button"
                  onClick={() => !isLast && onDrillInto(fullPath)}
                  className="truncate transition-colors"
                  style={{
                    color: isLast ? "#c8c8cc" : "#6b6b70",
                    fontWeight: isLast ? 500 : 400,
                  }}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* Subfolders */}
      <ul>
        {subFolders.map((f) => (
          <li key={f.path}>
            <div
              className="group flex w-full items-center gap-2 hover:bg-white/5 transition-colors"
              style={{ height: 33, paddingLeft: 14, paddingRight: 14, borderRadius: 5 }}
            >
              <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: "#6b6b70" }} />
              <button
                type="button"
                onClick={() => onDrillInto(f.path)}
                className="min-w-0 flex-1 truncate text-left"
                style={{ fontSize: 13, fontWeight: 500, color: "#c8c8cc" }}
              >
                {f.name}
              </button>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: "#6b6b70" }} />
            </div>
          </li>
        ))}
      </ul>

      {/* Notes in this folder */}
      <ul>
        {folderNotes.map((n) => (
          <NoteItem
            key={n.id}
            note={n}
            depth={0}
            active={n.id === activeId && activeSource === "drill"}
            activeId={activeId}
            onOpen={onOpen}
            onDelete={onDelete}
            onCopy={onCopy}
            onBookmark={onBookmark}
            onShortcut={onShortcut}
            bookmarks={bookmarks}
            shortcuts={shortcuts}
            onNoteDragStart={() => {}}
            onContextMenu={onContextMenu}
            renaming={renaming}
            setRenaming={setRenaming}
            onRename={onRename}
            onMoveNote={onMoveNote}
            isFolderOpen={() => false}
            setOpenMap={() => {}}
            sorted={false}
            onFolderDragOver={() => {}}
            onFolderDrop={() => {}}
            dragOverPath={null}
            onDeleteFolder={() => {}}
            onNewNoteInFolder={() => {}}
            onNewFolderInFolder={() => {}}
            onDrillInto={() => {}}
          />
        ))}
        {folderNotes.length === 0 && subFolders.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground/50">
            This folder is empty.
          </li>
        )}
      </ul>
    </div>
  );
}

// --- Collapsible Section wrapper ---
function CollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  icon,
  bold,
  children,
  onDragOver,
  onDragLeave,
  onDrop,
  dropActive,
  onContextMenu,
  editing,
  editValue,
  onEditChange,
  onEditCommit,
  onEditCancel,
  sectionActive,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
  bold?: boolean;
  children: React.ReactNode;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  dropActive?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  editing?: boolean;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onEditCommit?: () => void;
  onEditCancel?: () => void;
  sectionActive?: boolean;
}) {
  return (
    <div
      className="mb-3 last:mb-0"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={dropActive ? { borderRadius: 5, background: "var(--primary)" } : undefined}
    >
      <div
        className="flex w-full items-center gap-2 transition-colors hover:bg-white/5"
        style={{ height: 34, paddingLeft: 14, paddingRight: 14, borderRadius: 5 }}
        onContextMenu={onContextMenu}
      >
        <ChevronRight
          className={[
            "h-3 w-3 shrink-0 transition-transform",
            expanded ? "rotate-90" : "",
          ].join(" ")}
          style={{ color: "#6b6b70" }}
        />
        {icon ?? (
          <span className="h-3.5 w-3.5 shrink-0" style={{ color: "#6b6b70" }} />
        )}
        {editing ? (
          <input
            value={editValue ?? ""}
            autoFocus
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEditCommit?.();
              }
              if (e.key === "Escape") onEditCancel?.();
            }}
            onBlur={() => onEditCommit?.()}
            className="min-w-0 flex-1 rounded border px-1 outline-none"
            style={{
              background: "var(--background)",
              borderColor: "var(--ring)",
              fontSize: 13.5,
              color: "var(--foreground)",
              height: 24,
            }}
          />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-center"
          >
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                color: sectionActive ? "var(--primary)" : "#c8c8cc",
              }}
            >
              {title}
            </span>
            {count > 0 && (
              <span
                className="ml-auto"
                style={{ fontSize: 12, color: "#6b6b70" }}
              >
                {count}
              </span>
            )}
          </button>
        )}
      </div>
      {expanded && <div className="mt-0.5">{children}</div>}
    </div>
  );
}

// --- Recent Files List ---
function RecentFilesList({
  notes,
  activeId,
  activeSource,
  treeSelectedNav,
  setTreeSelectedNav,
  onOpen,
  onDelete,
  onCopy,
  onBookmark,
  onShortcut,
  bookmarks,
  shortcuts,
  onContextMenu,
  renaming,
  setRenaming,
  onRename,
  onMoveNote,
}: {
  notes: { id: string; title: string; path: string; updatedAt: string }[];
  activeId: string | null;
  activeSource: string | null;
  treeSelectedNav?: string | null;
  setTreeSelectedNav?: (nav: string | null) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onBookmark: (id: string) => void;
  onShortcut: (id: string) => void;
  bookmarks: Set<string>;
  shortcuts: Set<string>;
  onContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  renaming: { id: string; value: string } | null;
  setRenaming: (r: { id: string; value: string } | null) => void;
  onRename: (id: string, title: string) => void;
  onMoveNote: (id: string, path: string) => void;
}) {
  const recent = [...notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);

  if (recent.length === 0) return null;

  return (
    <ul>
      {recent.map((n) => (
        <NoteItem
          key={n.id}
          note={n}
          depth={0}
          active={n.id === activeId && activeSource === "recent"}
          activeId={activeId}
          treeSelectedNav={treeSelectedNav}
          setTreeSelectedNav={setTreeSelectedNav}
          onOpen={onOpen}
          onDelete={onDelete}
          onCopy={onCopy}
          onBookmark={onBookmark}
          onShortcut={onShortcut}
          bookmarks={bookmarks}
          shortcuts={shortcuts}
          onNoteDragStart={() => {}}
          onContextMenu={onContextMenu}
          renaming={renaming}
          setRenaming={setRenaming}
          onRename={onRename}
          onMoveNote={onMoveNote}
          isFolderOpen={() => false}
          setOpenMap={() => {}}
          sorted={false}
          onFolderDragOver={() => {}}
          onFolderDrop={() => {}}
          dragOverPath={null}
          onDeleteFolder={() => {}}
          onNewNoteInFolder={() => {}}
          onNewFolderInFolder={() => {}}
          onDrillInto={() => {}}
        />
      ))}
    </ul>
  );
}

// --- Vault Note List (for non-active vaults) ---
function VaultNoteList({
  vaultId,
  notes,
  folders,
  activeId,
  activeSource,
  onOpen,
  onDrillInto,
}: {
  vaultId: string;
  notes: { id: string; title: string; path: string }[];
  folders: { path: string; name: string }[];
  activeId: string | null;
  activeSource: string | null;
  onOpen: (vaultId: string, noteId: string) => void;
  onDrillInto: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...notes]
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, showAll ? 100 : 5);

  if (notes.length === 0 && folders.length === 0) {
    return (
      <div className="px-3 py-1 text-xs" style={{ color: "#6b6b70", paddingLeft: 30 }}>
        Empty vault
      </div>
    );
  }

  return (
    <div>
      <ul>
        {sorted.map((n) => {
          const active = n.id === activeId && activeSource === `vault:${vaultId}`;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onOpen(vaultId, n.id)}
                className="flex w-full items-center gap-2 transition-colors hover:bg-white/5"
                style={{
                  height: 33,
                  paddingLeft: 30,
                  paddingRight: 14,
                  borderRadius: 5,
                  background: active ? "var(--primary)" : undefined,
                }}
              >
                <FileText
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: active ? "var(--primary-foreground)" : "#6b6b70" }}
                />
                <span
                  className="truncate"
                  style={{
                    fontSize: 13,
                    color: active ? "var(--primary-foreground)" : "#c8c8cc",
                  }}
                >
                  {n.title || "Untitled"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {notes.length > 5 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="hover:text-foreground"
          style={{ fontSize: 12, color: "#6b6b70", paddingLeft: 30, paddingTop: 4 }}
        >
          Show all {notes.length}…
        </button>
      )}
      {showAll && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="hover:text-foreground"
          style={{ fontSize: 12, color: "#6b6b70", paddingLeft: 30, paddingTop: 4 }}
        >
          Show less
        </button>
      )}
      <button
        type="button"
        onClick={onDrillInto}
        className="flex w-full items-center gap-1.5 hover:text-foreground"
        style={{ fontSize: 12, color: "#6b6b70", paddingLeft: 30, paddingTop: 4, paddingRight: 14, height: 28 }}
      >
        <ChevronRight className="h-3 w-3" />
        <span>Switch to this vault</span>
      </button>
    </div>
  );
}
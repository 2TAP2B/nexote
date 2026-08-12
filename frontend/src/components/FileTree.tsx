"use client";

import {
  ArrowLeft,
  ArrowDownUp,
  Bookmark,
  BookmarkCheck,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
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
  Hash,
  Heart,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  List,
  ListTodo,
  Music,
  Settings2,
  Shield,
  Square,
  SquareArrowOutUpRight,
  Star,
  Tag as TagIcon,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNotes } from "@/lib/notes-context";
import { api, type FolderMeta, type ImageMeta, type NoteMeta, type TagCount, type TaskItem, type VaultMeta } from "@/lib/api";

import { type SidebarView } from "./Ribbon";

function replaceOrAddTitleHeading(body: string, title: string): string {
  const heading = `## ${title}`;
  if (/^##? .+$/m.test(body)) {
    return body.replace(/^##? .+$/m, heading);
  }
  return body ? `${heading}\n\n${body}` : heading;
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

// True on primary input devices that don't have a fine pointer (phones,
// tablets) — used to disable native HTML5 drag-and-drop on note rows, since a
// `draggable` row eats the first tap on touch screens.
const isCoarsePointer =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

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
  view?: SidebarView;
  selectedTag?: string | null;
  onSelectTagConsumed?: () => void;
  onControlsReady?: (c: TreeControls) => void;
  onSelectView?: (view: SidebarView) => void;
};

export default function FileTree({ collapsed, view = "tree", selectedTag, onSelectTagConsumed, onControlsReady, onSelectView }: FileTreeProps) {
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
    removeJournal,
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
    tagsByVault,
    refreshTags,
    addTagToNote,
    removeTagFromNote,
    renameTagInVault,
    deleteTagInVault,
    tasks,
    refreshTasks,
    toggleTaskItem,
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

  // Each sidebar view maps to the nav section that drives keyboard nav.
  const navSectionForView: Record<SidebarView, string> = {
    tree: "vault",
    recent: "recent",
    shortcuts: "shortcuts",
    bookmarks: "bookmarks",
    journal: "journal",
    tags: "tags",
    tasks: "tasks",
    images: "images",
  };

  // Shortcuts nav list (sorted by updatedAt desc to match the detailed view)
  const shortcutsNavItems = useMemo(() => {
    return notes
      .filter((n) => shortcuts.has(n.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((n) => ({ type: "note", id: n.id }) as NavItem);
  }, [notes, shortcuts]);

  // Recent nav list (sorted by updatedAt desc, excludes shortcuts)
  const recentNavItems = useMemo(() => {
    return recentNotes
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((n) => ({ type: "note", id: n.id }) as NavItem);
  }, [recentNotes]);

  // Bookmarks nav list (sorted by updatedAt desc)
  const bookmarksNavItems = useMemo(() => {
    return notes
      .filter((n) => bookmarks.has(n.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((n) => ({ type: "note", id: n.id }) as NavItem);
  }, [notes, bookmarks]);

  // Journal nav list (vault-independent, sorted by updatedAt desc)
  const journalNavItems = useMemo(() => {
    return journalNotes
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((n) => ({ type: "note", id: n.id }) as NavItem);
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

  // Map note id → folder path, for ArrowLeft "go to parent folder" in the
  // vault tree. Built from the active vault's notes (or simple-mode notes).
  const notePathMap = useMemo(() => {
    const map: Record<string, string> = {};
    const src = activeVault ? allVaultData[activeVault.id]?.notes : notes;
    if (src) for (const n of src) map[n.id] = n.path;
    return map;
  }, [notes, activeVault, allVaultData]);

  // Which sections are currently available (for Tab cycling) — one per view.
  const availableSections = useMemo(() => {
    return [navSectionForView[view]];
  }, [view]);

  // Active navigation section + selected index within it.
  const [navSection, setNavSection] = useState<string>("vault");
  const [treeSelectedNav, setTreeSelectedNav] = useState<string | null>(null);
  const [drillPath, setDrillPath] = useState<string | null>(null);
  const [folderHistory, setFolderHistory] = useState<string[]>([]);
  const [folderHistoryIndex, setFolderHistoryIndex] = useState(-1);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState<{ id: string; vaultId: string } | null>(null);
  const [sorted, setSorted] = useState(false);

  // Keep the keyboard-nav section in sync with the active sidebar view.
  useEffect(() => {
    setNavSection(navSectionForView[view]);
    setTreeSelectedNav(null);
  }, [view]);

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
    if (navSection === "bookmarks") return bookmarksNavItems;
    return vaultNavItems;
  }, [navSection, shortcutsNavItems, recentNavItems, journalNavItems, bookmarksNavItems, vaultNavItems]);

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

  // Move-to dialog state: the note being moved. The dialog lets the user pick
  // a destination folder (in any vault) or another vault entirely.
  const [moveTo, setMoveTo] = useState<{ noteId: string } | null>(null);

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

  // Arrow-key navigation in the sidebar.
  // Up/down = move within the current view's list.
  // Right = expand folder / move to first child / open note.
  // Left = collapse folder / move to parent folder.
  // Enter = open note / toggle folder. Space = toggle folder.
  useEffect(() => {
    if (view === "tree" && drillPath !== null) return;
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
      } else if (e.key === "ArrowRight") {
        if (currentIdx < 0) return;
        const item = items[currentIdx];
        if (item.type === "folder") {
          // Collapsed folder → expand; expanded folder → move to first child.
          if (!isFolderOpen(item.path)) {
            setOpenMap((prev) => ({ ...prev, [item.path]: true }));
          } else {
            const next = Math.min(currentIdx + 1, items.length - 1);
            setTreeSelectedNav(navKeys[next]);
          }
        } else {
          // Note → open it.
          if (navSection === "journal") {
            sectionOpenRef.current = true;
            setActiveSource("journal");
            void openJournalNote(item.id);
          } else {
            openFromSection(navSection === "vault" ? (activeVault ? `vault:${activeVault.id}` : "simple") : navSection, item.id);
          }
          window.dispatchEvent(new CustomEvent("nexote:focus-note-end"));
        }
      } else if (e.key === "Enter") {
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
          // Folder → open the slide-in detail view.
          navigateToFolder(item.path);
        }
      } else if (e.key === "ArrowLeft") {
        if (currentIdx < 0) {
          setTreeSelectedNav(null);
          return;
        }
        const item = items[currentIdx];
        if (item.type === "folder") {
          // Expanded folder → collapse; collapsed folder → go to parent.
          if (isFolderOpen(item.path)) {
            setOpenMap((prev) => ({ ...prev, [item.path]: false }));
          } else {
            const parentPath = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : null;
            if (parentPath !== null) setTreeSelectedNav(`folder:${parentPath}`);
            else setTreeSelectedNav(null);
          }
        } else {
          // Note → go to parent folder (if any).
          const notePath = notePathMap[item.id] ?? "";
          const parentPath = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : null;
          if (parentPath !== null) setTreeSelectedNav(`folder:${parentPath}`);
          else setTreeSelectedNav(null);
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
  }, [drillPath, view, availableSections, navSection, currentNavItems, treeSelectedNav, openTab, openFromSection, openJournalNote, navigateToFolder, activeVault, setOpenMap, isFolderOpen, notePathMap]);

  // Listen for "focus tree" event (Shift+Left from editor) — select the
  // currently open note in the vault section so arrows work immediately.
  useEffect(() => {
    const onFocusTree = () => {
      onSelectView?.("tree");
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
  }, [activeId, vaultNavItems, onSelectView]);

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
    void create(view === "tree" && drillPath ? { path: drillPath } : undefined);
  }, [create, drillPath, view]);

  const handleNewFolderHere = useCallback(() => {
    openFolderDialog(view === "tree" ? drillPath ?? undefined : undefined);
  }, [openFolderDialog, drillPath, view]);

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
      folderMode: view === "tree" && drillPath !== null && treeMode === "advanced",
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
    view,
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
        body: replaceOrAddTitleHeading(cached.body, newTitle),
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

  // Open the Move-to dialog from a note's context menu.
  const handleMoveTo = useCallback((id: string) => {
    setMoveTo({ noteId: id });
  }, []);

  // Execute the move chosen in the dialog. Moving within the active vault uses
  // moveNote (path change); moving to another vault uses moveNoteToVault.
  const performMoveTo = useCallback(
    async (dstVaultId: string, dstPath: string) => {
      const id = moveTo?.noteId;
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

  const inFolderMode = view === "tree" && drillPath !== null && treeMode === "advanced";

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
          {view === "bookmarks" ? (
            <DetailedNoteList
              notes={notes.filter((n) => bookmarks.has(n.id))}
              notesById={notesById}
              activeId={activeId}
              activeSource={activeSource}
              sourceTag="bookmarks"
              treeSelectedNav={treeSelectedNav}
              setTreeSelectedNav={setTreeSelectedNav}
              onOpen={(id) => openFromSection("bookmarks", id)}
              onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
              onDelete={setPendingDelete}
              onCopy={copyNote}
              onBookmark={toggleBookmark}
              onShortcut={toggleShortcut}
              bookmarks={bookmarks}
              shortcuts={shortcuts}
            />
          ) : view === "recent" ? (
            <DetailedNoteList
              notes={recentNotes}
              notesById={notesById}
              activeId={activeId}
              activeSource={activeSource}
              sourceTag="recent"
              treeSelectedNav={treeSelectedNav}
              setTreeSelectedNav={setTreeSelectedNav}
              onOpen={(id) => openFromSection("recent", id)}
              onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
              onDelete={setPendingDelete}
              onCopy={copyNote}
              onBookmark={toggleBookmark}
              onShortcut={toggleShortcut}
              bookmarks={bookmarks}
              shortcuts={shortcuts}
            />
          ) : view === "shortcuts" ? (
            <DetailedNoteList
              notes={notes.filter((n) => shortcuts.has(n.id))}
              notesById={notesById}
              activeId={activeId}
              activeSource={activeSource}
              sourceTag="shortcuts"
              treeSelectedNav={treeSelectedNav}
              setTreeSelectedNav={setTreeSelectedNav}
              onOpen={(id) => openFromSection("shortcuts", id)}
              onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
              onDelete={setPendingDelete}
              onCopy={copyNote}
              onBookmark={toggleBookmark}
              onShortcut={toggleShortcut}
              bookmarks={bookmarks}
              shortcuts={shortcuts}
            />
          ) : view === "journal" ? (
            <DetailedNoteList
              notes={journalNotes}
              notesById={notesById}
              activeId={activeId}
              activeSource={activeSource}
              sourceTag="journal"
              treeSelectedNav={treeSelectedNav}
              setTreeSelectedNav={setTreeSelectedNav}
              onOpen={(id) => {
                sectionOpenRef.current = true;
                setActiveSource("journal");
                void openJournalNote(id);
              }}
              onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
              onDelete={setPendingDelete}
              onCopy={copyNote}
              onBookmark={toggleBookmark}
              onShortcut={toggleShortcut}
              bookmarks={bookmarks}
              shortcuts={shortcuts}
            />
          ) : view === "tags" ? (
            <TagsView
              tagsByVault={tagsByVault}
              allVaultData={allVaultData}
              vaults={vaults}
              activeId={activeId}
              notesById={notesById}
              initialSelectedTag={selectedTag}
              onInitialTagConsumed={onSelectTagConsumed}
              treeSelectedNav={treeSelectedNav}
              setTreeSelectedNav={setTreeSelectedNav}
              onOpenNote={openNoteInVault}
              onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
              onRenameTag={(vaultId, from, to) => void renameTagInVault(vaultId, from, to)}
              onDeleteTag={(vaultId, tag) => void deleteTagInVault(vaultId, tag)}
              onRefreshTags={(vaultId) => void refreshTags(vaultId)}
            />
          ) : view === "tasks" ? (
            <TasksView
              tasks={tasks}
              activeId={activeId}
              treeSelectedNav={treeSelectedNav}
              setTreeSelectedNav={setTreeSelectedNav}
              onOpenNote={openNoteInVault}
              onToggle={toggleTaskItem}
            />
          ) : view === "images" ? (
            <ImagesView
              vaults={vaults}
              onOpenNote={openNoteInVault}
              onOpenJournalNote={openJournalNote}
            />
          ) : view === "tree" && drillPath !== null && treeMode !== "advanced" ? (
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
              onMoveTo={handleMoveTo}
              onBack={() => setDrillPath(null)}
              onDrillInto={setDrillPath}
            />
          ) : view === "tree" && treeMode === "simple" ? (
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
                onMoveTo={handleMoveTo}
                onDeleteFolder={handleDeleteFolder}
                onNewNoteInFolder={(path) => void create({ path })}
                onNewFolderInFolder={(path) => openFolderDialog(path)}
                onDrillInto={setDrillPath}
              />
            </div>
          ) : (
            <>
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
                      return <VaultIcon className="h-3.5 w-3.5 shrink-0" style={{ opacity: isActiveVault ? 1 : 0.75, color: "var(--primary)" }} />;
                    })()}
                    bold={isActiveVault}
                    headerTint
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
                        onMoveTo={handleMoveTo}
                        onDeleteFolder={handleDeleteFolder}
                        onNewNoteInFolder={(path) => void create({ path })}
                        onNewFolderInFolder={(path) => openFolderDialog(path)}
                        onDrillInto={navigateToFolder}
                        onAddTag={(id) => setTagInput({ id, vaultId: vault.id })}
                        onRemoveTag={(id, tag) => void removeTagFromNote(vault.id, id, tag)}
                        noteTags={(id) => {
                          const data = allVaultData[vault.id];
                          const n = data?.notes.find((nn) => nn.id === id);
                          return n?.tags ?? [];
                        }}
                      />
                    ) : (
                      <TreeChildren
                        node={vaultTree}
                        depth={0}
                        activeId={activeId}
                        activeSource={activeSource}
                        sectionTag={`vault:${vault.id}`}
                        treeSelectedNav={navSection === "vault" ? treeSelectedNav : null}
                        setTreeSelectedNav={setTreeSelectedNav}
                        onOpen={(id) => {
                          sectionOpenRef.current = true;
                          setActiveSource(`vault:${vault.id}`);
                          void openNoteInVault(vault.id, id);
                        }}
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
                        onFolderDrop={(folderPath) => {
                          if (dragNoteId && dragNoteId !== "") {
                            void moveNoteToVault(dragNoteId, vault.id);
                          }
                          setDragNoteId(null);
                          setDragOverPath(null);
                        }}
                        dragOverPath={dragOverPath}
                        onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
                        renaming={renaming}
                        setRenaming={setRenaming}
                        onRename={handleRename}
                        onMoveNote={(id, path) => {
                          switchVault(vault.id);
                          void moveNote(id, path);
                        }}
                        onMoveTo={handleMoveTo}
                        onDeleteFolder={(path) => {
                          switchVault(vault.id);
                          void removeFolder(path);
                        }}
                        onNewNoteInFolder={(path) => {
                          switchVault(vault.id);
                          void create({ path });
                        }}
                        onNewFolderInFolder={(path) => {
                          switchVault(vault.id);
                          openFolderDialog(path);
                        }}
                        onDrillInto={(path) => {
                          switchVault(vault.id);
                          navigateToFolder(path);
                        }}
                        onAddTag={(id) => setTagInput({ id, vaultId: vault.id })}
                        onRemoveTag={(id, tag) => void removeTagFromNote(vault.id, id, tag)}
                        noteTags={(id) => {
                          const data = allVaultData[vault.id];
                          const n = data?.notes.find((nn) => nn.id === id);
                          return n?.tags ?? [];
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
        {view === "tree" && drillPath !== null && treeMode === "advanced" && (
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

      {/* Vault switcher + settings at the bottom (simple mode only shows the
          vault picker; advanced mode has all vaults in the tree above) */}
      <div
        className="flex shrink-0 items-center gap-2"
        style={{ height: 34, paddingLeft: 14, paddingRight: 14, borderTop: "1px solid var(--border)" }}
      >
        {treeMode === "simple" && (
          <>
            <Database size={12} className="shrink-0" style={{ color: "var(--muted-foreground)" }} />
            <select
              value={activeVault?.id ?? ""}
              onChange={(e) => switchVault(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none cursor-pointer"
              style={{ appearance: "none", color: "var(--foreground)", fontSize: 13 }}
            >
              {vaults.map((v) => (
                <option key={v.id} value={v.id} style={{ background: "var(--background)" }}>
                  {v.name}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("nexote:open-settings"))
          }
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/5"
          style={{ color: "var(--muted-foreground)" }}
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
          if (journalNotes.some((n) => n.id === id)) {
            await removeJournal(id);
          } else {
            await remove(id);
          }
        }}
      />

      <FolderCreateDialog
        open={folderDialog.open}
        parentPath={folderDialog.parentPath}
        onClose={() => setFolderDialog({ open: false })}
        onCreate={handleCreateFolder}
      />

      <MoveToDialog
        open={moveTo !== null}
        vaults={vaults}
        allVaultData={allVaultData}
        activeVaultId={activeVault?.id ?? ""}
        onClose={() => setMoveTo(null)}
        onMove={performMoveTo}
      />

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Tag input dialog — a small input that appears below the note row */}
      {tagInput && (
        <TagInputDialog
          noteId={tagInput.id}
          vaultId={tagInput.vaultId}
          existingTags={tagsByVault[tagInput.vaultId]?.map((t) => t.name) ?? []}
          currentTags={allVaultData[tagInput.vaultId]?.notes.find((n) => n.id === tagInput.id)?.tags ?? []}
          onSubmit={async (tag) => {
            await addTagToNote(tagInput.vaultId, tagInput.id, tag);
            setTagInput(null);
          }}
          onClose={() => setTagInput(null)}
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
                <Icon className="h-4 w-4" style={{ color: "var(--foreground)" }} />
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
  onMoveTo?: (id: string) => void;
  onDeleteFolder: (path: string) => void;
  onNewNoteInFolder: (path: string) => void;
  onNewFolderInFolder: (path: string) => void;
  onDrillInto: (path: string) => void;
  onAddTag?: (id: string) => void;
  onRemoveTag?: (id: string, tag: string) => void;
  noteTags?: (id: string) => string[];
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
            onClick={() => {
              if (isCoarsePointer) {
                setOpenMap((prev) => ({ ...prev, [node.path]: !open }));
              } else {
                onDrillInto(node.path);
              }
            }}
            className="flex items-center gap-2 min-w-0 flex-1"
            style={{ height: 33 }}
          >
            <ChevronRight
              className={[
                "h-3 w-3 shrink-0 transition-transform",
                open ? "rotate-90" : "",
              ].join(" ")}
              style={{ color: "var(--muted-foreground)" }}
            />
            {open ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
            )}
            <span className="truncate" style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>{node.name}</span>
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
            style={{ color: "var(--muted-foreground)" }}
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
    onMoveTo,
    onAddTag,
  } = props;

  const isRenaming = renaming?.id === note.id;
  const isBookmarked = bookmarks.has(note.id);
  const isShortcut = shortcuts.has(note.id);
  const isSelected = treeSelectedNav === `note:${note.id}`;

  return (
    <li>
      <div
        data-note-id={note.id}
        // Native HTML5 dragging (drag a note onto a folder) only works with a
        // mouse. On touch devices `draggable` hijacks the first tap as a drag
        // start and suppresses the click, so a note can't be opened — disable
        // it there.
        draggable={!isCoarsePointer}
        onDragStart={() => onNoteDragStart(note.id)}
        onMouseEnter={() => setTreeSelectedNav?.(`note:${note.id}`)}
        onClick={() => !isRenaming && onOpen(note.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const items: MenuItem[] = [
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
            ...(onMoveTo
              ? [{
                  label: "Move to…",
                  icon: <FolderInput className="h-4 w-4" />,
                  onClick: () => onMoveTo(note.id),
                }]
              : []),
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
          ];
          if (onAddTag) {
            items.push({
              label: "Add tag…",
              icon: <Hash className="h-4 w-4" />,
              onClick: () => onAddTag(note.id),
            });
          }
          items.push(
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
          );
          onContextMenu(e.clientX, e.clientY, items);
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
          style={{ color: active ? "var(--primary-foreground)" : "var(--muted-foreground)" }}
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
              color: active ? "var(--primary-foreground)" : "var(--foreground)",
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
          style={{ color: active ? "var(--primary-foreground)" : "var(--muted-foreground)" }}
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
  onMoveTo,
}: {
  notes: { id: string; title: string; path: string }[];
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
  onMoveTo?: (id: string) => void;
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
          onMoveTo={onMoveTo}
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

// --- Helpers for folder detail view ---

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function timeBucket(updatedAt: string): "today" | "yesterday" | "week" | "month" | "older" {
  const updated = new Date(updatedAt);
  const now = new Date();
  const today = startOfDay(now);
  const updatedDay = startOfDay(updated);
  const diffDays = Math.round((today.getTime() - updatedDay.getTime()) / 86400000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "week";
  if (diffDays <= 31) return "month";
  return "older";
}

const BUCKET_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 days",
  month: "Last month",
  older: "Older",
};

const BUCKET_ORDER = ["today", "yesterday", "week", "month", "older"] as const;

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

// --- Detailed note list (time-bucketed with body previews) ---
// Used by the Recent, Shortcuts, Bookmarks, and Daily sidebar views for a
// richer overview than the flat NoteItem list. Notes are grouped by time
// bucket (Today / Yesterday / Last 7 days / Last month / Older) and each
// row shows a snippet of the note body under the title.
function DetailedNoteList({
  notes,
  notesById,
  activeId,
  activeSource,
  sourceTag,
  treeSelectedNav,
  setTreeSelectedNav,
  onOpen,
  onContextMenu,
  onDelete,
  onCopy,
  onBookmark,
  onShortcut,
  bookmarks,
  shortcuts,
}: {
  notes: { id: string; title: string; updatedAt: string; snippet?: string }[];
  notesById: Record<string, { body?: string }>;
  activeId: string | null;
  activeSource: string | null;
  sourceTag: string;
  treeSelectedNav?: string | null;
  setTreeSelectedNav?: (nav: string | null) => void;
  onOpen: (id: string) => void;
  onContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onBookmark: (id: string) => void;
  onShortcut: (id: string) => void;
  bookmarks: Set<string>;
  shortcuts: Set<string>;
}) {
  // Sort by updatedAt desc, then group into time buckets.
  const grouped = useMemo(() => {
    const sorted = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const map: Record<string, typeof notes> = {};
    for (const n of sorted) {
      const b = timeBucket(n.updatedAt);
      (map[b] ??= []).push(n);
    }
    return map;
  }, [notes]);

  return (
    <div className="pt-1">
      {notes.length === 0 && (
        <div className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
          No notes here yet.
        </div>
      )}
      {BUCKET_ORDER.map((bucket) => {
        const items = grouped[bucket];
        if (!items || items.length === 0) return null;
        return (
          <div key={bucket} className="mb-2">
            <div
              className="px-3 pb-1 pt-2"
              style={{ fontSize: 12, fontWeight: 500, color: "var(--muted-foreground)", paddingLeft: 14 }}
            >
              {BUCKET_LABELS[bucket]}
            </div>
            <ul>
              {items.map((n) => {
                const active = n.id === activeId && activeSource === sourceTag;
                const navSelected = treeSelectedNav === `note:${n.id}`;
                const snippet = n.snippet ?? makeSnippetAfterH1(notesById[n.id]?.body);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      data-note-id={n.id}
                      onClick={() => onOpen(n.id)}
                      onMouseEnter={() => setTreeSelectedNav?.(`note:${n.id}`)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const isBookmarked = bookmarks.has(n.id);
                        const isShortcut = shortcuts.has(n.id);
                        onContextMenu(e.clientX, e.clientY, [
                          {
                            label: "Open",
                            icon: <SquareArrowOutUpRight className="h-4 w-4" />,
                            onClick: () => onOpen(n.id),
                          },
                          { label: "", onClick: () => {}, separator: true },
                          {
                            label: "Make a copy",
                            icon: <Copy className="h-4 w-4" />,
                            onClick: () => onCopy(n.id),
                          },
                          {
                            label: isShortcut ? "Remove shortcut" : "Add shortcut",
                            icon: isShortcut
                              ? <BookmarkCheck className="h-4 w-4" />
                              : <Star className="h-4 w-4" />,
                            onClick: () => onShortcut(n.id),
                          },
                          {
                            label: isBookmarked ? "Remove from bookmarks" : "Add to bookmarks",
                            icon: <Bookmark className="h-4 w-4" />,
                            onClick: () => onBookmark(n.id),
                          },
                          { label: "", onClick: () => {}, separator: true },
                          {
                            label: "Delete",
                            icon: <Trash2 className="h-4 w-4" />,
                            danger: true,
                            onClick: () => onDelete(n.id),
                          },
                        ]);
                      }}
                      className="group flex w-full flex-col gap-0.5 transition-colors hover:bg-white/5"
                      style={{
                        paddingLeft: 14,
                        paddingRight: 14,
                        paddingTop: 7,
                        paddingBottom: 7,
                        borderRadius: 5,
                        background: active
                          ? "var(--primary)"
                          : navSelected
                            ? "rgba(255,255,255,0.06)"
                            : undefined,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <FileText
                          className="h-3.5 w-3.5 shrink-0"
                          style={{ color: active ? "var(--primary-foreground)" : "var(--muted-foreground)" }}
                        />
                        <span
                          className="min-w-0 flex-1 truncate text-left"
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: active ? "var(--primary-foreground)" : "var(--foreground)",
                          }}
                        >
                          {n.title || "Untitled"}
                        </span>
                        <span
                          className="shrink-0"
                          style={{
                            fontSize: 11,
                            color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
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
                            color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
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
      })}
    </div>
  );
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
  notes: { id: string; title: string; path: string; updatedAt: string; snippet?: string }[];
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
          <div className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)", paddingLeft: 30 }}>
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
                      style={{ color: active ? "var(--primary-foreground)" : "var(--muted-foreground)" }}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-left"
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: active ? "var(--primary-foreground)" : "var(--foreground)",
                      }}
                    >
                      {n.title || "Untitled"}
                    </span>
                    <span
                      className="shrink-0"
                      style={{ fontSize: 11, color: active ? "var(--primary-foreground)" : "var(--muted-foreground)", opacity: 0.8 }}
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
                  style={{ fontSize: 12, fontWeight: 500, color: "var(--muted-foreground)", paddingLeft: 14 }}
                >
                  {BUCKET_LABELS[bucket]}
                </div>
                <ul>
                  {items.map((n) => {
                    const flatIndex = flatIds.indexOf(n.id);
                    const active = n.id === activeId && activeSource === "drill";
                    const selected = flatIndex === selectedIndex;
                    const snippet = n.snippet ?? makeSnippetAfterH1(notesById[n.id]?.body);
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
                              style={{ color: active ? "var(--primary-foreground)" : "var(--muted-foreground)" }}
                            />
                            <span
                              className="min-w-0 flex-1 truncate text-left"
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: active ? "var(--primary-foreground)" : "var(--foreground)",
                              }}
                            >
                              {n.title || "Untitled"}
                            </span>
                            <span
                              className="shrink-0"
                              style={{
                                fontSize: 11,
                                color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
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
                                color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
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
  onMoveTo,
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
  onMoveTo: (id: string) => void;
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
          style={{ color: "var(--muted-foreground)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden" style={{ fontSize: 12 }}>
          {segments.map((seg, i) => {
            const fullPath = segments.slice(0, i + 1).join("/");
            const isLast = i === segments.length - 1;
            return (
              <span key={i} className="flex items-center gap-0.5 shrink-0">
                {i > 0 && <span style={{ color: "var(--muted-foreground)" }}>/</span>}
                <button
                  type="button"
                  onClick={() => !isLast && onDrillInto(fullPath)}
                  className="truncate transition-colors"
                  style={{
                    color: isLast ? "var(--foreground)" : "var(--muted-foreground)",
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
              <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
              <button
                type="button"
                onClick={() => onDrillInto(f.path)}
                className="min-w-0 flex-1 truncate text-left"
                style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}
              >
                {f.name}
              </button>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
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
          onMoveTo={onMoveTo}
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
  headerTint,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
  bold?: boolean;
  headerTint?: boolean;
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
        style={{
          height: 34,
          paddingLeft: 14,
          paddingRight: 14,
          borderRadius: 5,
          background: headerTint ? "color-mix(in oklab, var(--primary) 7%, transparent)" : undefined,
        }}
        onContextMenu={onContextMenu}
      >
        <ChevronRight
          className={[
            "h-3 w-3 shrink-0 transition-transform",
            expanded ? "rotate-90" : "",
          ].join(" ")}
          style={{ color: "var(--muted-foreground)" }}
        />
        {icon ?? (
          <span className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
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
                color: sectionActive ? "var(--primary)" : "var(--foreground)",
              }}
            >
              {title}
            </span>
            {count > 0 && (
              <span
                className="ml-auto"
                style={{ fontSize: 12, color: "var(--muted-foreground)" }}
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
  onMoveTo,
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
  onMoveTo: (id: string) => void;
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
          onMoveTo={onMoveTo}
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
// --- Tags View ---
// Shows tags from all vaults as a flat alphabetical list. Clicking a tag
// shows notes that carry it. Context menu: rename / delete tag.
function TagsView({
  tagsByVault,
  allVaultData,
  vaults,
  activeId,
  notesById,
  initialSelectedTag,
  onInitialTagConsumed,
  treeSelectedNav,
  setTreeSelectedNav,
  onOpenNote,
  onContextMenu,
  onRenameTag,
  onDeleteTag,
  onRefreshTags,
}: {
  tagsByVault: Record<string, TagCount[]>;
  allVaultData: Record<string, { notes: NoteMeta[]; folders: FolderMeta[] }>;
  vaults: VaultMeta[];
  activeId: string | null;
  notesById: Record<string, { body?: string; title?: string }>;
  initialSelectedTag?: string | null;
  onInitialTagConsumed?: () => void;
  treeSelectedNav?: string | null;
  setTreeSelectedNav?: (nav: string | null) => void;
  onOpenNote: (vaultId: string, noteId: string) => void;
  onContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  onRenameTag: (vaultId: string, from: string, to: string) => void;
  onDeleteTag: (vaultId: string, tag: string) => void;
  onRefreshTags: (vaultId: string) => void;
}) {
  useEffect(() => {
    for (const v of vaults) onRefreshTags(v.id);
  }, [vaults, onRefreshTags]);

  const allTags = useMemo(() => {
    const map = new Map<string, { name: string; count: number; vaults: string[] }>();
    for (const v of vaults) {
      const tags = tagsByVault[v.id] ?? [];
      for (const t of tags) {
        const existing = map.get(t.name);
        if (existing) {
          existing.count += t.count;
          if (!existing.vaults.includes(v.id)) existing.vaults.push(v.id);
        } else {
          map.set(t.name, { name: t.name, count: t.count, vaults: [v.id] });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tagsByVault, vaults]);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Apply a tag selected from outside (e.g. clicking a #tag pill in the
  // editor) once, then let the parent clear the pending request.
  useEffect(() => {
    if (initialSelectedTag) {
      setSelectedTag(initialSelectedTag);
      onInitialTagConsumed?.();
    }
  }, [initialSelectedTag, onInitialTagConsumed]);

  const matchingNotes = useMemo(() => {
    if (!selectedTag) return [];
    const result: { vaultId: string; vaultName: string; id: string; title: string; updatedAt: string; snippet?: string }[] = [];
    for (const v of vaults) {
      const data = allVaultData[v.id];
      if (!data) continue;
      for (const n of data.notes) {
        if (n.tags?.includes(selectedTag)) {
          result.push({ vaultId: v.id, vaultName: v.name, id: n.id, title: n.title, updatedAt: n.updatedAt, snippet: n.snippet });
        }
      }
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [selectedTag, allVaultData, vaults]);

  if (selectedTag) {
    return (
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setSelectedTag(null)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors hover:bg-white/5"
          style={{ borderRadius: 5, color: "var(--muted-foreground)" }}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Tags</span>
        </button>
        <div
          className="px-3 pb-1 pt-1"
          style={{ fontSize: 12, fontWeight: 500, color: "var(--muted-foreground)", paddingLeft: 14 }}
        >
          #{selectedTag} · {matchingNotes.length} {matchingNotes.length === 1 ? "note" : "notes"}
        </div>
        <ul>
          {matchingNotes.length === 0 && (
            <li className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
              No notes with this tag.
            </li>
          )}
          {matchingNotes.map((n) => {
            const active = n.id === activeId;
            const navSelected = treeSelectedNav === `note:${n.id}`;
            const snippet = n.snippet ?? makeSnippetAfterH1(notesById[n.id]?.body);
            return (
              <li key={`${n.vaultId}:${n.id}`}>
                <button
                  type="button"
                  data-note-id={n.id}
                  onClick={() => onOpenNote(n.vaultId, n.id)}
                  onMouseEnter={() => setTreeSelectedNav?.(`note:${n.id}`)}
                  className="group flex w-full flex-col gap-0.5 transition-colors hover:bg-white/5"
                  style={{
                    paddingLeft: 14,
                    paddingRight: 14,
                    paddingTop: 7,
                    paddingBottom: 7,
                    borderRadius: 5,
                    background: active ? "var(--primary)" : navSelected ? "rgba(255,255,255,0.06)" : undefined,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <FileText
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: active ? "var(--primary-foreground)" : "var(--muted-foreground)" }}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-left"
                      style={{ fontSize: 13, fontWeight: 500, color: active ? "var(--primary-foreground)" : "var(--foreground)" }}
                    >
                      {n.title || "Untitled"}
                    </span>
                    <span
                      className="shrink-0"
                      style={{ fontSize: 11, color: active ? "var(--primary-foreground)" : "var(--muted-foreground)", opacity: 0.7 }}
                    >
                      {n.vaultName}
                    </span>
                  </div>
                  {snippet && (
                    <span
                      className="truncate text-left"
                      style={{ fontSize: 12, color: active ? "var(--primary-foreground)" : "var(--muted-foreground)", opacity: 0.7, paddingLeft: 22 }}
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
  }

  return (
    <div className="pt-1">
      {allTags.length === 0 && (
        <div className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
          No tags yet. Add tags to notes via the context menu.
        </div>
      )}
      <ul>
        {allTags.map((t) => {
          const navKey = `tag:${t.name}`;
          const navSelected = treeSelectedNav === navKey;
          return (
            <li key={t.name}>
              <button
                type="button"
                data-tag-name={t.name}
                onClick={() => {
                  setSelectedTag(t.name);
                  setTreeSelectedNav?.(null);
                }}
                onMouseEnter={() => setTreeSelectedNav?.(navKey)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu(e.clientX, e.clientY, [
                    {
                      label: "Rename tag",
                      icon: <Edit3 className="h-4 w-4" />,
                      onClick: () => {
                        const newName = window.prompt("Rename tag:", t.name);
                        if (newName && newName.trim() && newName !== t.name) {
                          for (const vid of t.vaults) onRenameTag(vid, t.name, newName.trim());
                        }
                      },
                    },
                    {
                      label: "Delete tag",
                      icon: <Trash2 className="h-4 w-4" />,
                      danger: true,
                      onClick: () => {
                        if (window.confirm(`Delete tag "${t.name}" from all notes?`)) {
                          for (const vid of t.vaults) onDeleteTag(vid, t.name);
                        }
                      },
                    },
                  ]);
                }}
                className="group flex w-full items-center gap-2 transition-colors hover:bg-white/5"
                style={{
                  height: 33,
                  paddingLeft: 14,
                  paddingRight: 14,
                  borderRadius: 5,
                  background: navSelected ? "rgba(255,255,255,0.06)" : undefined,
                }}
              >
                <Hash
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: "var(--primary)" }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-left"
                  style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}
                >
                  {t.name}
                </span>
                <span
                  className="shrink-0"
                  style={{ fontSize: 12, color: "var(--muted-foreground)" }}
                >
                  {t.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Tasks View ---
// Shows all checkbox items across all vaults as one flat list. Unchecked
// tasks first, then a collapsible "Completed" section. Each row has an
// inline checkbox toggle + task text + a small info line (note / vault / time).
function TasksView({
  tasks,
  activeId,
  treeSelectedNav,
  setTreeSelectedNav,
  onOpenNote,
  onToggle,
}: {
  tasks: TaskItem[];
  activeId: string | null;
  treeSelectedNav?: string | null;
  setTreeSelectedNav?: (nav: string | null) => void;
  onOpenNote: (vaultId: string, noteId: string) => void;
  onToggle: (vaultId: string, noteId: string, line: number, checked: boolean) => void;
}) {
  const [showCompleted, setShowCompleted] = useState(true);

  const unchecked = useMemo(
    () => tasks.filter((t) => !t.checked).sort((a, b) => a.noteTitle.localeCompare(b.noteTitle)),
    [tasks],
  );
  const completed = useMemo(
    () => tasks.filter((t) => t.checked).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tasks],
  );

  const renderTask = (t: TaskItem) => {
    const navKey = `task:${t.vaultId}:${t.noteId}:${t.line}`;
    const navSelected = treeSelectedNav === navKey;
    return (
      <li key={`${t.vaultId}:${t.noteId}:${t.line}`}>
        <div
          data-task-key={`${t.vaultId}:${t.noteId}:${t.line}`}
          onMouseEnter={() => setTreeSelectedNav?.(navKey)}
          className="group flex w-full items-start gap-2 transition-colors hover:bg-white/5"
          style={{
            paddingLeft: 14,
            paddingRight: 14,
            paddingTop: 7,
            paddingBottom: 7,
            borderRadius: 5,
            background: navSelected ? "rgba(255,255,255,0.06)" : undefined,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(t.vaultId, t.noteId, t.line, !t.checked);
            }}
            className="mt-0.5 flex shrink-0 items-center justify-center rounded"
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: t.checked ? "none" : "1.5px solid var(--muted-foreground)",
              background: t.checked ? "var(--primary)" : "transparent",
            }}
          >
            {t.checked && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => onOpenNote(t.vaultId, t.noteId)}
            className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
          >
            <span
              className="truncate"
              style={{
                fontSize: 13,
                fontWeight: 400,
                color: t.checked ? "var(--muted-foreground)" : "var(--foreground)",
                textDecoration: t.checked ? "line-through" : "none",
                opacity: t.checked ? 0.6 : 1,
              }}
            >
              {t.text || "(empty task)"}
            </span>
            <span
              className="truncate"
              style={{ fontSize: 11, color: "var(--muted-foreground)", opacity: 0.7 }}
            >
              {t.noteTitle || "Untitled"} · {t.vaultName} · {formatTime(t.updatedAt)}
            </span>
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="pt-1">
      {tasks.length === 0 && (
        <div className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
          No tasks found. Add "- [ ]" checkboxes to your notes.
        </div>
      )}
      <ul>
        {unchecked.map((t) => renderTask(t))}
      </ul>
      {completed.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="flex w-full items-center gap-1 px-3 py-1 text-xs transition-colors hover:bg-white/5"
            style={{ borderRadius: 5, color: "var(--muted-foreground)" }}
          >
            <ChevronRight
              className={["h-3 w-3 shrink-0 transition-transform", showCompleted ? "rotate-90" : ""].join(" ")}
            />
            <span>Completed · {completed.length}</span>
          </button>
          {showCompleted && (
            <ul>
              {completed.map((t) => renderTask(t))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// --- Images view ---
// A gallery of every image across all vaults, newest-first. Tiles open a
// lightbox with insert/copy/open/delete actions. Refreshes on activation and
// when the editor dispatches nexote:image-uploaded.
type ImageItem = { vaultId: string; vaultName: string; meta: ImageMeta };

function ImagesView({
  vaults,
  onOpenNote,
  onOpenJournalNote,
}: {
  vaults: VaultMeta[];
  onOpenNote: (vaultId: string, noteId: string) => void;
  onOpenJournalNote: (noteId: string) => void;
}) {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<ImageItem | null>(null);
  const [mode, setMode] = useState<"gallery" | "list">(() => {
    if (typeof window === "undefined") return "gallery";
    return window.localStorage.getItem("nexote-images-view") === "list" ? "list" : "gallery";
  });

  // Persist the gallery/list choice across view switches and reloads.
  useEffect(() => {
    try {
      window.localStorage.setItem("nexote-images-view", mode);
    } catch {
      // storage unavailable — ignore
    }
  }, [mode]);

  const load = useCallback(async () => {
    setLoading(true);
    const all: ImageItem[] = [];
    // Journal images use the "journal" pseudo-vault (see backend resolveStore).
    const queries = [
      ...vaults.map(async (v) => {
        const res = await api.listImages(v.id);
        for (const meta of res.images ?? []) {
          all.push({ vaultId: v.id, vaultName: v.name, meta });
        }
      }),
      api.listImages("journal").then((res) => {
        for (const meta of res.images ?? []) {
          all.push({ vaultId: "journal", vaultName: "Journal", meta });
        }
      }),
    ];
    await Promise.all(
      queries.map((p) => p.catch((err) => console.error("[nexote-images]", err))),
    );
    all.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
    setItems(all);
    setLoading(false);
  }, [vaults]);

  useEffect(() => {
    void load();
    const onUploaded = () => void load();
    window.addEventListener("nexote:image-uploaded", onUploaded);
    return () => window.removeEventListener("nexote:image-uploaded", onUploaded);
  }, [load]);

  const insertImage = (item: ImageItem) => {
    window.dispatchEvent(
      new CustomEvent("nexote:insert-image", { detail: { url: item.meta.url } }),
    );
  };

  const copyMarkdown = async (item: ImageItem) => {
    try {
      await navigator.clipboard.writeText(`![${item.meta.name}](${item.meta.url})`);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  const deleteImage = async (item: ImageItem) => {
    if (!window.confirm(`Delete ${item.meta.name}?`)) return;
    try {
      const rel = item.meta.path ? `${item.meta.path}/${item.meta.name}` : item.meta.name;
      await api.removeImage(item.vaultId, rel);
      if (preview?.meta.name === item.meta.name) setPreview(null);
      void load();
    } catch (err) {
      console.error("[nexote-images]", err);
    }
  };

  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50";

  const viewToggle = (
    <div className="mb-1 flex items-center justify-end px-1">
      <div className="flex overflow-hidden rounded-md border border-border/70">
        <button
          type="button"
          aria-label="Gallery view"
          title="Gallery view"
          onClick={() => setMode("gallery")}
          className="flex h-6 w-7 items-center justify-center transition-colors hover:bg-white/5"
          style={
            mode === "gallery"
              ? { color: "var(--primary)", background: "color-mix(in oklab, var(--primary) 12%, transparent)" }
              : { color: "var(--muted-foreground)", opacity: 0.7 }
          }
        >
          <LayoutGrid size={13} />
        </button>
        <button
          type="button"
          aria-label="List view"
          title="List view"
          onClick={() => setMode("list")}
          className="flex h-6 w-7 items-center justify-center transition-colors hover:bg-white/5"
          style={
            mode === "list"
              ? { color: "var(--primary)", background: "color-mix(in oklab, var(--primary) 12%, transparent)" }
              : { color: "var(--muted-foreground)", opacity: 0.7 }
          }
        >
          <List size={13} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="pt-1">
      {!loading && items.length > 0 && viewToggle}
      {loading ? (
        <div className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
          Loading images…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <ImageIcon size={20} style={{ color: "var(--muted-foreground)", opacity: 0.6 }} />
          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            No images yet. Paste or upload an image into a note and it will
            appear here.
          </div>
        </div>
      ) : mode === "gallery" ? (
        <div className="grid grid-cols-2 gap-1 px-1">
          {items.map((item) => (
            <button
              key={`${item.vaultId}:${item.meta.name}`}
              type="button"
              onClick={() => setPreview(item)}
              className="group relative overflow-hidden rounded-md border border-border/60 bg-muted/20 transition-colors hover:border-border"
              title={`${item.meta.name} · ${item.vaultName}`}
            >
              <img
                src={item.meta.url}
                alt={item.meta.name}
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
              <span
                className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-left text-[10px] text-white"
              >
                {item.vaultName}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={`${item.vaultId}:${item.meta.name}`}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setPreview(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPreview(item);
                  }
                }}
                className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-white/5"
              >
                <img
                  src={item.meta.url}
                  alt={item.meta.name}
                  className="h-10 w-10 shrink-0 rounded border border-border/60 object-cover"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {item.meta.name}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {item.vaultName} · {item.meta.path || "root"} ·{" "}
                    {formatTime(item.meta.updatedAt)}
                    {item.meta.usedBy && item.meta.usedBy.length > 0
                      ? ` · in ${item.meta.usedBy.length} note${item.meta.usedBy.length === 1 ? "" : "s"}`
                      : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    title="Insert into note"
                    onClick={(e) => {
                      e.stopPropagation();
                      insertImage(item);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    <SquareArrowOutUpRight size={14} />
                  </button>
                  <button
                    type="button"
                    title="Copy markdown link"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyMarkdown(item);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteImage(item);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 overflow-auto bg-black/10 p-2">
              <img
                src={preview.meta.url}
                alt={preview.meta.name}
                className="mx-auto max-h-[55vh] max-w-full object-contain"
              />
            </div>
            <div className="shrink-0 border-t border-border px-3 py-2">
              <div className="truncate text-xs font-medium text-foreground">
                {preview.meta.name}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {preview.vaultName} · {preview.meta.path || "root"} ·{" "}
                {formatTime(preview.meta.updatedAt)}
                {preview.meta.usedBy && preview.meta.usedBy.length > 0
                  ? ` · in ${preview.meta.usedBy.length} note${preview.meta.usedBy.length === 1 ? "" : "s"}`
                  : " · not in any note"}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => insertImage(preview)} className={buttonClass}>
                  <SquareArrowOutUpRight size={13} />
                  Insert into note
                </button>
                <button type="button" onClick={() => copyMarkdown(preview)} className={buttonClass}>
                  <Copy size={13} />
                  Copy link
                </button>
                {preview.meta.usedBy?.[0] && (
                  <button
                    type="button"
                    onClick={() => {
                      const note = preview.meta.usedBy![0];
                      setPreview(null);
                      if (preview.vaultId === "journal") {
                        onOpenJournalNote(note.noteId);
                      } else {
                        onOpenNote(preview.vaultId, note.noteId);
                      }
                    }}
                    className={buttonClass}
                  >
                    <FileText size={13} />
                    Open note
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteImage(preview)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
                <button type="button" onClick={() => setPreview(null)} className={buttonClass}>
                  <X size={13} />
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Move To Dialog ---
// Lets the user move a note to a folder (in any vault) or to another vault.
// Lists each vault with its folders as a collapsible tree of destinations.
export function MoveToDialog({
  open,
  vaults,
  allVaultData,
  activeVaultId,
  onClose,
  onMove,
}: {
  open: boolean;
  vaults: VaultMeta[];
  allVaultData: Record<string, { notes: NoteMeta[]; folders: FolderMeta[] }>;
  activeVaultId: string;
  onClose: () => void;
  onMove: (dstVaultId: string, dstPath: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const buttonBase =
    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60";

  const renderVault = (v: VaultMeta) => {
    const data = allVaultData[v.id];
    const folders = (data?.folders ?? []).slice().sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    return (
      <div key={v.id} className="mb-1">
        <div className="px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {v.name}
        </div>
        <button
          type="button"
          className={buttonBase}
          onClick={() => onMove(v.id, "")}
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-foreground">Root</span>
          {v.id === activeVaultId && (
            <span className="ml-auto text-[10px] text-muted-foreground">current</span>
          )}
        </button>
        {folders.map((f) => (
          <button
            key={f.path}
            type="button"
            className={buttonBase}
            style={{ paddingLeft: 24 + (f.path.split("/").length - 1) * 14 }}
            onClick={() => onMove(v.id, f.path)}
          >
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-foreground">{f.path}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Move note to"
        className="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">Move note to…</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pick a folder or vault.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {vaults.length === 0 && (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              No vaults available.
            </div>
          )}
          {vaults.map(renderVault)}
        </div>
        <div className="flex shrink-0 justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Tag Input Dialog ---
// A small inline input that appears below a note row when the user selects
// "Add tag…" from the context menu. Shows a # prefix, autocompletes from
// existing tags, and submits on Enter.
function TagInputDialog({
  noteId,
  vaultId: _vaultId,
  existingTags,
  currentTags,
  onSubmit,
  onClose,
}: {
  noteId: string;
  vaultId: string;
  existingTags: string[];
  currentTags: string[];
  onSubmit: (tag: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position the dialog below the note row.
  useEffect(() => {
    const el = document.querySelector(`[data-note-id="${noteId}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({ left: rect.left + 14, top: rect.bottom + 2 });
    } else {
      setPos({ left: 200, top: 200 });
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [noteId]);

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-tag-input-dialog]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const val = value.trim().toLowerCase().replace(/^#/, "");
  const suggestions = val
    ? existingTags
        .filter((t) => t.includes(val) && !currentTags.includes(t))
        .slice(0, 6)
    : existingTags.filter((t) => !currentTags.includes(t)).slice(0, 6);

  const submit = (tag: string) => {
    const clean = tag.trim().toLowerCase().replace(/^#/, "");
    if (clean && !currentTags.includes(clean)) {
      onSubmit(clean);
    }
  };

  if (!pos) return null;

  return (
    <div
      data-tag-input-dialog
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        zIndex: 9999,
      }}
      className="w-56 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-2" style={{ borderBottom: suggestions.length > 0 ? "1px solid var(--border)" : undefined }}>
        <Hash className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--primary)" }} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSelectedSuggestion(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions.length > 0 && selectedSuggestion >= 0 && selectedSuggestion < suggestions.length && val) {
                submit(suggestions[selectedSuggestion]);
              } else {
                submit(value);
              }
            } else if (e.key === "ArrowDown" && suggestions.length > 0) {
              e.preventDefault();
              setSelectedSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp" && suggestions.length > 0) {
              e.preventDefault();
              setSelectedSuggestion((i) => Math.max(i - 1, 0));
            }
          }}
          placeholder="tag name…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--foreground)" }}
        />
        <kbd
          className="shrink-0 rounded px-1 text-xs"
          style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
        >
          ↵
        </kbd>
      </div>
      {suggestions.length > 0 && (
        <ul className="py-1">
          {suggestions.map((tag, i) => (
            <li key={tag}>
              <button
                type="button"
                onMouseEnter={() => setSelectedSuggestion(i)}
                onClick={() => submit(tag)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors"
                style={{
                  background: i === selectedSuggestion ? "color-mix(in oklab, var(--primary) 12%, transparent)" : undefined,
                  color: "var(--foreground)",
                }}
              >
                <Hash className="h-3 w-3 shrink-0" style={{ color: "var(--primary)" }} />
                <span className="truncate">{tag}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

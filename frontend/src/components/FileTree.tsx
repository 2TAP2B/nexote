"use client";

import {
  ArrowLeft,
  ArrowDownUp,
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Disc3,
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
import { api, isCollectionsVault, type CollectionMeta, type FolderMeta, type ImageMeta, type NoteMeta, type TagCount, type TaskItem, type VaultMeta } from "@/lib/api";
import { replaceOrAddTitleHeading } from "@/lib/note-utils";

import { type SidebarView } from "./Ribbon";

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
    journalNotes,
    tagsByVault,
    refreshTags,
    removeTagFromNote,
    renameTagInVault,
    deleteTagInVault,
    tasks,
    refreshTasks,
    toggleTaskItem,
    isJournalNote,
    noteVaultMap,
    openDaily,
    renameFolder,
  } = useNotes();
  const tree = useMemo(() => buildTree(notes, folders ?? []), [notes, folders]);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const isFolderOpen = useCallback(
    (path: string) => openMap[path] ?? true,
    [openMap],
  );

  // Load the collection definitions so collection cards can map an item's
  // collection id to its display name for accurate counts. Also reload on
  // nexote:refresh-data (e.g. after a new collection is created).
  useEffect(() => {
    const reload = () => void api.listCollections().then((res) => setCollections(res.collections ?? []));
    reload();
    window.addEventListener("nexote:refresh-data", reload);
    return () => window.removeEventListener("nexote:refresh-data", reload);
  }, []);

  // Names of every collection (folder-per-collection). Used to strip stale
  // collection folders (created by older item forms, e.g. myvault/Vinyls) out
  // of regular vault trees — collections belong to the Collections vault and
  // their galleries, not the note tree.
  const collectionNames = useMemo(
    () => new Set(collections.map((c) => c.name)),
    [collections],
  );
  const stripCollectionFolders = useCallback(
    (folders: FolderMeta[] | undefined) =>
      (folders ?? []).filter((f) => !collectionNames.has(f.path.split("/")[0])),
    [collectionNames],
  );
  // Recent excludes notes already pinned as shortcuts, so a note doesn't
  // appear in both the Shortcuts and Recent sections. Recent / Shortcuts /
  // Bookmarks are aggregated across ALL vaults so they work as one set for
  // every vault, regardless of which vault is currently active.
  // Collection item notes are excluded: they belong to their collection
  // gallery, not the generic note lists.
  const allVaultNotes = useMemo(() => {
    const list: (NoteMeta & { vaultId: string })[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (!n.collection) list.push({ ...n, vaultId: v.id });
      }
    }
    return list;
  }, [vaults, allVaultData]);

  // Collection item notes (notes tagged with a collection), aggregated across
  // ALL vaults. Used only for the collection item counts.
  const allCollectionNotes = useMemo(() => {
    const list: (NoteMeta & { vaultId: string })[] = [];
    for (const v of vaults) {
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (n.collection) list.push({ ...n, vaultId: v.id });
      }
    }
    return list;
  }, [vaults, allVaultData]);

  // Map collection display name -> total item count aggregated across ALL
  // vaults (items may live in any vault, not just the Collections vault).
  // Used by the collection cards in the sidebar.
  const collectionItemCounts = useMemo(() => {
    const byId: Record<string, number> = {};
    for (const n of allCollectionNotes) {
      if (n.collection) byId[n.collection] = (byId[n.collection] ?? 0) + 1;
    }
    const byName: Record<string, number> = {};
    for (const c of collections) {
      const count = byId[c.id] ?? 0;
      if (count > 0) byName[c.name] = count;
    }
    return byName;
  }, [allCollectionNotes, collections]);

  const recentNotes = useMemo(
    () => allVaultNotes.filter((n) => !shortcuts.has(n.id)),
    [allVaultNotes, shortcuts],
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
    collections: "collections",
  };

  // Shortcuts nav list (sorted by updatedAt desc to match the detailed view)
  const shortcutsNavItems = useMemo(() => {
    return allVaultNotes
      .filter((n) => shortcuts.has(n.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((n) => ({ type: "note", id: n.id }) as NavItem);
  }, [allVaultNotes, shortcuts]);

  // Recent nav list (sorted by updatedAt desc, excludes shortcuts)
  const recentNavItems = useMemo(() => {
    return recentNotes
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((n) => ({ type: "note", id: n.id }) as NavItem);
  }, [recentNotes]);

  // Bookmarks nav list (sorted by updatedAt desc)
  const bookmarksNavItems = useMemo(() => {
    return allVaultNotes
      .filter((n) => bookmarks.has(n.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((n) => ({ type: "note", id: n.id }) as NavItem);
  }, [allVaultNotes, bookmarks]);

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
        const vaultTree = buildTree(
          vaultData.notes.filter((n) => !n.collection),
          stripCollectionFolders(vaultData.folders),
        );
        walk(vaultTree);
      }
    }
    return items;
  }, [notes, activeVault, allVaultData, isFolderOpen, stripCollectionFolders]);

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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
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

  // Persist which vaults in the sidebar tree are expanded/collapsed, so a
  // reload restores the user's layout instead of expanding every vault.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("nexote:vault-expanded");
      if (stored) setVaultExpandedMap(JSON.parse(stored) as Record<string, boolean>);
    } catch {
      // ignore malformed stored state
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("nexote:vault-expanded", JSON.stringify(vaultExpandedMap));
    } catch {
      // ignore
    }
  }, [vaultExpandedMap]);

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
  // (e.g. command palette, tab click), so stale source tags don't cause
  // false highlights. Journal notes only ever appear in the journal view,
  // so opening one (e.g. the daily note) always highlights it there.
  useEffect(() => {
    if (sectionOpenRef.current) {
      sectionOpenRef.current = false;
      return;
    }
    setActiveSource(activeId && isJournalNote(activeId) ? "journal" : null);
  }, [activeId, isJournalNote]);

  // Open a note and record which section it was opened from. The note may
  // belong to any vault (aggregated Recent/Shortcuts/Bookmarks sections), so
  // route through the vault-aware opener when it isn't in the active vault.
  const openFromSection = useCallback(
    (section: string, id: string) => {
      sectionOpenRef.current = true;
      setActiveSource(section);
      const vaultId = noteVaultMap[id];
      if (vaultId && vaultId !== activeVault?.id) {
        void openNoteInVault(vaultId, id);
      } else {
        void openTab(id);
      }
    },
    [noteVaultMap, activeVault, openNoteInVault, openTab],
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

  // Arrow-key navigation in the sidebar.
  // Up/down = move within the current view's list.
  // Right = expand folder / move to first child / open note.
  // Left = collapse folder / move to parent folder.
  // Enter = open note / toggle folder. Space = toggle folder.
  useEffect(() => {
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
          // Folder → toggle open/closed.
          setOpenMap((prev) => ({ ...prev, [item.path]: !(prev[item.path] ?? true) }));
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
  }, [view, availableSections, navSection, currentNavItems, treeSelectedNav, openTab, openFromSection, openJournalNote, activeVault, setOpenMap, isFolderOpen, notePathMap]);

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
    void create();
  }, [create]);

  const handleNewFolderHere = useCallback(() => {
    openFolderDialog();
  }, [openFolderDialog]);

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
      // Handle folder rename — id is "folder:<oldPath>"
      if (id.startsWith("folder:")) {
        const oldPath = id.slice(7);
        const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
        const newPath = parent ? `${parent}/${newTitle}` : newTitle;
        if (oldPath === newPath) return;
        await renameFolder(oldPath, newPath);
        return;
      }
      const cached = notesById[id];
      if (!cached) return;
      await save(id, {
        title: newTitle,
        body: replaceOrAddTitleHeading(cached.body, newTitle),
      });
    },
    [notesById, save, renameVault, renameFolder],
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

  return (
    <div className="flex h-full flex-col">
      <button id="nexote-new-note-btn" type="button" className="hidden" onClick={handleCreateHere} />
      <button id="nexote-new-folder-btn" type="button" className="hidden" onClick={handleNewFolderHere} />

      <div className="relative flex-1 overflow-hidden">
        {/* Root tree panel */}
        <div className="absolute inset-0 overflow-y-auto px-1 pb-2 pt-1">
          {view === "bookmarks" ? (
            <DetailedNoteList
              notes={allVaultNotes.filter((n) => bookmarks.has(n.id))}
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
              notes={allVaultNotes.filter((n) => shortcuts.has(n.id))}
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
            <CalendarView
              journalNotes={journalNotes}
              activeId={activeId}
              onOpenNote={(id) => {
                sectionOpenRef.current = true;
                setActiveSource("journal");
                void openJournalNote(id);
              }}
              onOpenDaily={() => void openDaily()}
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
          ) : view === "collections" ? (
            <CollectionsView
              collections={collections}
              collectionItemCounts={collectionItemCounts}
            />
          ) : (
            <>
              {/* Vault sections — skip the system Collections vault; collections
                  have their own sidebar view now. Collection item notes are
                  excluded from the tree: they live in their collection
                  gallery. */}
              {vaults.filter((v) => !isCollectionsVault(v)).map((vault) => {
                const vaultData = allVaultData[vault.id];
                if (!vaultData) return null;
                const isExpanded = vaultExpandedMap[vault.id] ?? true;
                const isActiveVault = vault.id === activeVault?.id;
                const vaultNotes = vaultData.notes.filter((n) => !n.collection);
                const vaultTree = buildTree(vaultNotes, stripCollectionFolders(vaultData.folders));
                return (
                  <CollapsibleSection
                    key={vault.id}
                    title={vault.name}
                    count={vaultNotes.length}
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
                        collectionsVault={isCollectionsVault(vault)}
                        collectionItemCounts={collectionItemCounts}
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
                        collectionsVault={isCollectionsVault(vault)}
                        collectionItemCounts={collectionItemCounts}
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
  collectionsVault?: boolean;
  collectionItemCounts?: Record<string, number>;
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
      {rest.collectionsVault
        ? folders.map((child) => (
            <CollectionCard key={child.path} {...childProps} node={child} depth={0} />
          ))
        : folders.map((child) => (
            <FolderItem key={child.path} {...childProps} node={child} depth={depth} />
          ))}
      {notes.map((n) => (
        <NoteItem
          key={n.id}
          {...childProps}
          note={n}
          noteParentPath={node.path}
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
    treeSelectedNav,
    setTreeSelectedNav,
    renaming,
    setRenaming,
    onRename,
  } = props;
  const open = isFolderOpen(node.path);
  const isDragOver = dragOverPath === node.path;
  const isSelected = treeSelectedNav === `folder:${node.path}`;
  const isFolderRenaming = renaming?.id === `folder:${node.path}`;

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
              label: "Rename folder",
              icon: <Edit3 className="h-4 w-4" />,
              onClick: () => {
                setRenaming({ id: `folder:${node.path}`, value: node.name });
              },
            },
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
              // A folder in the Collections vault maps to a collection. Open
              // its gallery instead of just expanding the folder.
              window.dispatchEvent(
                new CustomEvent("nexote:open-collection", { detail: node.path }),
              );
              setOpenMap((prev) => ({ ...prev, [node.path]: !open }));
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
            {isFolderRenaming ? (
              <input
                autoFocus
                value={renaming.value}
                onChange={(e) => setRenaming({ id: `folder:${node.path}`, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onRename(`folder:${node.path}`, renaming.value.trim() || node.name);
                    setRenaming(null);
                  }
                  if (e.key === "Escape") setRenaming(null);
                }}
                onBlur={() => {
                  onRename(`folder:${node.path}`, renaming.value.trim() || node.name);
                  setRenaming(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded border border-border px-1 py-0.5 text-xs"
                style={{ color: "var(--foreground)", background: "var(--background)" }}
              />
            ) : (
              <span className="truncate" style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>{node.name}</span>
            )}
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

// A collection shown as a distinct card inside the Collections vault — not a
// folder row. Clicking opens the collection's gallery.
function CollectionCard(props: TreeChildProps & { node: TreeNode }) {
  const { node, collectionItemCounts } = props;
  const itemCount = collectionItemCounts?.[node.name] ?? 0;

  return (
    <li className="px-1.5">
      <button
        type="button"
        data-folder-path={node.path}
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent("nexote:open-collection", { detail: node.path }),
          );
        }}
        className="group flex w-full items-center gap-2.5 rounded-lg border border-border p-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
        style={{ background: "var(--background)" }}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "color-mix(in oklab, var(--primary) 12%, transparent)", color: "var(--primary)" }}
        >
          <Disc3 className="h-4.5 w-4.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="truncate"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}
          >
            {node.name}
          </span>
          <span
            className="truncate"
            style={{ fontSize: 11, color: "var(--muted-foreground)" }}
          >
            {itemCount > 0 ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : "Empty collection"}
          </span>
        </span>
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </li>
  );
}

function NoteItem(
  props: TreeChildProps & {
    note: { id: string; title: string };
    depth: number;
    active: boolean;
    // Folder the note lives in ("" = vault root). Present only in the tree
    // view, so the "New folder here…" context item is offered there.
    noteParentPath?: string;
  },
) {
  const {
    note,
    depth,
    active,
    noteParentPath,
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
    onNewFolderInFolder,
    onMoveNote,
    onMoveTo,
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
            ...(noteParentPath !== undefined
              ? [{
                  label: "New folder here…",
                  icon: <FolderPlus className="h-4 w-4" />,
                  onClick: () => onNewFolderInFolder(noteParentPath),
                }]
              : []),
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
          No tags yet. Add tags to notes with #tag in the text.
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
  const [showCompleted, setShowCompleted] = useState(false);

  const unchecked = useMemo(
    () => tasks.filter((t) => !t.checked).sort((a, b) => a.noteTitle.localeCompare(b.noteTitle)),
    [tasks],
  );
  const completed = useMemo(
    () => tasks.filter((t) => t.checked).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tasks],
  );

  // Group open tasks by their owning note (unchecked is already note-sorted)
  // so the list reads as sections instead of repeating the note name per row.
  const groupedOpen = useMemo(() => {
    const groups: {
      vaultId: string;
      noteId: string;
      title: string;
      tasks: TaskItem[];
    }[] = [];
    for (const t of unchecked) {
      const last = groups[groups.length - 1];
      if (last && last.vaultId === t.vaultId && last.noteId === t.noteId) {
        last.tasks.push(t);
      } else {
        groups.push({
          vaultId: t.vaultId,
          noteId: t.noteId,
          title: t.noteTitle || "Untitled",
          tasks: [t],
        });
      }
    }
    return groups;
  }, [unchecked]);

  const renderTask = (t: TaskItem, showNote: boolean) => {
    const navKey = `task:${t.vaultId}:${t.noteId}:${t.line}`;
    const navSelected = treeSelectedNav === navKey;
    return (
      <li key={`${t.vaultId}:${t.noteId}:${t.line}`}>
        <div
          data-task-key={`${t.vaultId}:${t.noteId}:${t.line}`}
          onMouseEnter={() => setTreeSelectedNav?.(navKey)}
          className="group flex w-full items-start gap-2.5 transition-colors hover:bg-white/5"
          style={{
            paddingLeft: 14,
            paddingRight: 14,
            paddingTop: 6,
            paddingBottom: 6,
            borderRadius: 5,
            background: navSelected ? "rgba(255,255,255,0.06)" : undefined,
          }}
        >
          <button
            type="button"
            aria-label={t.checked ? "Mark as open" : "Mark as done"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(t.vaultId, t.noteId, t.line, !t.checked);
            }}
            className="mt-0.5 flex shrink-0 items-center justify-center transition-colors"
            style={{
              width: 20,
              height: 20,
              minHeight: 20,
              borderRadius: 6,
              border: "2px solid var(--primary)",
              background: t.checked ? "var(--primary)" : "transparent",
            }}
          >
            {t.checked && (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
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
              {showNote
                ? `${t.noteTitle || "Untitled"} · ${t.vaultName} · ${formatTime(t.updatedAt)}`
                : `${t.vaultName} · ${formatTime(t.updatedAt)}`}
            </span>
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="pt-1">
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <ListTodo size={20} style={{ color: "var(--muted-foreground)", opacity: 0.6 }} />
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
            No tasks yet. Add &quot;- [ ]&quot; checkboxes to your notes.
          </div>
        </div>
      ) : (
        <>
          {/* Open tasks grouped by note */}
          <ul>
            {groupedOpen.map((g) => (
              <li key={`${g.vaultId}:${g.noteId}`}>
                <button
                  type="button"
                  onClick={() => onOpenNote(g.vaultId, g.noteId)}
                  className="flex w-full items-center gap-1.5 transition-colors hover:bg-white/5"
                  style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 9, paddingBottom: 3, borderRadius: 5 }}
                >
                  <FileText
                    size={11}
                    className="shrink-0"
                    style={{ color: "var(--muted-foreground)", opacity: 0.7 }}
                  />
                  <span
                    className="truncate"
                    style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)" }}
                  >
                    {g.title}
                  </span>
                  <span
                    className="ml-auto shrink-0 rounded-full px-1.5"
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: "var(--primary)",
                      background: "color-mix(in oklab, var(--primary) 10%, transparent)",
                    }}
                  >
                    {g.tasks.length}
                  </span>
                </button>
                <ul>
                  {g.tasks.map((t) => renderTask(t, false))}
                </ul>
              </li>
            ))}
          </ul>

          {/* Completed */}
          {completed.length > 0 && (
            <div className="mt-2" style={{ borderTop: "1px solid color-mix(in oklab, var(--muted-foreground) 15%, transparent)" }}>
              <button
                type="button"
                onClick={() => setShowCompleted((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 transition-colors hover:bg-white/5"
                style={{ borderRadius: 5, color: "var(--muted-foreground)" }}
              >
                <ChevronRight
                  className={["h-3 w-3 shrink-0 transition-transform", showCompleted ? "rotate-90" : ""].join(" ")}
                />
                <span style={{ fontSize: 11, fontWeight: 600 }}>Completed</span>
                <span
                  className="shrink-0 rounded-full px-1.5"
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    background: "color-mix(in oklab, var(--muted-foreground) 12%, transparent)",
                  }}
                >
                  {completed.length}
                </span>
              </button>
              {showCompleted && (
                <ul>
                  {completed.map((t) => renderTask(t, true))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Calendar / Journal view ---
// A month grid where days with journal notes show a dot. Clicking a day that
// has a note opens it; clicking today opens-or-creates the daily note. Below
// the grid is a compact list of the selected month's notes.
function CalendarView({
  journalNotes,
  activeId,
  onOpenNote,
  onOpenDaily,
}: {
  journalNotes: { id: string; title: string; updatedAt: string }[];
  activeId: string | null;
  onOpenNote: (id: string) => void;
  onOpenDaily: () => void;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Map "YYYY-MM-DD" -> note id for quick lookup.
  const notesByDate = useMemo(() => {
    const m: Record<string, string> = {};
    for (const n of journalNotes) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(n.title)) m[n.title] = n.id;
    }
    return m;
  }, [journalNotes]);

  const monthNotes = useMemo(
    () =>
      journalNotes
        .filter((n) => n.title.startsWith(`${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`))
        .sort((a, b) => b.title.localeCompare(a.title)),
    [journalNotes, cursor],
  );

  const firstDay = new Date(cursor.year, cursor.month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Mon=0 … Sun=6
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const monthName = firstDay.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const weekdays = ["M", "T", "W", "T", "F", "S", "S"];

  const goPrev = () =>
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  const goNext = () =>
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));
  const goToday = () => {
    const d = new Date();
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  const handleDayClick = (day: number) => {
    const dateStr = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const noteId = notesByDate[dateStr];
    if (noteId) {
      onOpenNote(noteId);
    } else if (dateStr === todayStr) {
      onOpenDaily();
    }
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="pt-1">
      {/* Month navigation */}
      <div className="mb-1 flex items-center gap-1 px-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={goPrev}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={goToday}
          className="flex-1 truncate text-center"
          style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}
          title="Jump to today"
        >
          {monthName}
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={goNext}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="mb-0.5 grid grid-cols-7 px-2">
        {weekdays.map((w, i) => (
          <div
            key={i}
            className="text-center"
            style={{ fontSize: 10, fontWeight: 500, color: "var(--muted-foreground)", opacity: 0.6 }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5 px-1.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const dateStr = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const hasNote = Boolean(notesByDate[dateStr]);
          const isToday = dateStr === todayStr;
          const isActive = hasNote && notesByDate[dateStr] === activeId;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleDayClick(day)}
              className="relative flex h-8 items-center justify-center rounded-md transition-colors"
              style={{
                fontSize: 13,
                color: isToday
                  ? "var(--primary)"
                  : "var(--muted-foreground)",
                fontWeight: isToday ? 600 : 400,
                background: isActive
                  ? "color-mix(in oklab, var(--primary) 18%, transparent)"
                  : isToday
                    ? "color-mix(in oklab, var(--primary) 8%, transparent)"
                    : "transparent",
                border: isToday && !isActive ? "1px solid color-mix(in oklab, var(--primary) 30%, transparent)" : "1px solid transparent",
              }}
            >
              {day}
              {hasNote && (
                <span
                  className="absolute bottom-0.5 h-1 w-1 rounded-full"
                  style={{ background: "var(--primary)", opacity: isActive ? 1 : 0.5 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Today button */}
      <div className="mt-1.5 px-2">
        <button
          type="button"
          onClick={onOpenDaily}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 transition-colors hover:bg-muted/50"
          style={{ fontSize: 12, fontWeight: 500, color: "var(--foreground)" }}
        >
          <CalendarDays size={13} style={{ color: "var(--primary)" }} />
          Open today&apos;s note
        </button>
      </div>

      {/* Month's notes list */}
      {monthNotes.length > 0 && (
        <div className="mt-2">
          <div
            className="px-3 pb-1 pt-1.5"
            style={{ fontSize: 11, fontWeight: 500, color: "var(--muted-foreground)" }}
          >
            {monthNotes.length} note{monthNotes.length === 1 ? "" : "s"} this month
          </div>
          <ul>
            {monthNotes.map((n) => {
              const isActive = n.id === activeId;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onOpenNote(n.id)}
                    className="group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors hover:bg-white/5"
                    style={{
                      background: isActive ? "rgba(255,255,255,0.10)" : undefined,
                    }}
                  >
                    <CalendarDays
                      size={13}
                      className="shrink-0"
                      style={{ color: isActive ? "var(--primary)" : "var(--muted-foreground)", opacity: 0.7 }}
                    />
                    <span
                      className="truncate"
                      style={{
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? "var(--primary)" : "var(--foreground)",
                      }}
                    >
                      {n.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Collections view ---
// Lists every collection as a card with item count. Clicking a card dispatches
// nexote:open-collection, which page.tsx / MobileApp.tsx handle by opening the
// fullscreen CollectionGallery overlay.
function CollectionsView({
  collections,
  collectionItemCounts,
}: {
  collections: CollectionMeta[];
  collectionItemCounts: Record<string, number>;
}) {
  const sorted = collections
    .filter((c) => !c.hidden)
    .sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="pt-1">
      <div className="mb-1.5 flex items-center justify-end px-1.5">
        <button
          type="button"
          aria-label="New collection"
          title="New collection"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("nexote:new-collection"),
            )
          }
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <FilePlus size={15} />
        </button>
      </div>
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <Disc3 size={20} style={{ color: "var(--muted-foreground)", opacity: 0.6 }} />
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
            No collections yet. Click + to create one.
          </div>
        </div>
      ) : (
        <ul className="space-y-1 px-1.5">
          {sorted.map((col) => {
            const itemCount = collectionItemCounts[col.id] ?? 0;
            return (
              <li key={col.id}>
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("nexote:open-collection", {
                        detail: col.name,
                      }),
                    )
                  }
                  className="group flex w-full items-center gap-2.5 rounded-lg border border-border p-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
                  style={{ background: "var(--background)" }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "color-mix(in oklab, var(--primary) 12%, transparent)", color: "var(--primary)" }}
                  >
                    <Disc3 className="h-4.5 w-4.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className="truncate"
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}
                    >
                      {col.name}
                    </span>
                    <span
                      className="truncate"
                      style={{ fontSize: 11, color: "var(--muted-foreground)" }}
                    >
                      {itemCount > 0
                        ? `${itemCount} item${itemCount === 1 ? "" : "s"}`
                        : "Empty collection"}
                    </span>
                  </span>
                  {col.pinned && (
                    <Star
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: "var(--primary)", fill: "var(--primary)" }}
                    />
                  )}
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              </li>
            );
          })}
        </ul>
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
          {vaults.filter((v) => !isCollectionsVault(v)).map(renderVault)}
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


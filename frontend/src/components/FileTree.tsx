"use client";

import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
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
  Settings2,
  SquareArrowOutUpRight,
  Star,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useNotes } from "@/lib/notes-context";

function replaceOrAddH1(body: string, title: string): string {
  const h1 = `# ${title}`;
  if (/^# .+$/m.test(body)) {
    return body.replace(/^# .+$/m, h1);
  }
  return body ? `${h1}\n\n${body}` : h1;
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
    activeId,
    openTab,
    create,
    copyNote,
    createFolder,
    removeFolder,
    moveNote,
    remove,
    notesById,
    refresh,
    save,
    toggleBookmark,
    vaults,
    activeVault,
    allVaultData,
    openNoteInVault,
    switchVault,
  } = useNotes();
  const tree = useMemo(() => buildTree(notes, folders ?? []), [notes, folders]);
  const [drillPath, setDrillPath] = useState<string | null>(null);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [sorted, setSorted] = useState(false);

  // Collapsible section states
  const [shortcutsExpanded, setShortcutsExpanded] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [vaultExpandedMap, setVaultExpandedMap] = useState<Record<string, boolean>>({});

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

  // Inline rename state.
  const [renaming, setRenaming] = useState<{
    id: string;
    value: string;
  } | null>(null);

  // Drag state.
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const isFolderOpen = useCallback(
    (path: string) => openMap[path] ?? true,
    [openMap],
  );

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

  useEffect(() => {
    onControlsReady?.({
      expandAll,
      collapseAll,
      toggleSort,
      sorted,
      allExpanded,
      toggleExpandCollapse,
    });
  }, [
    onControlsReady,
    expandAll,
    collapseAll,
    toggleSort,
    sorted,
    allExpanded,
    toggleExpandCollapse,
  ]);

  const openFolderDialog = useCallback((parentPath?: string) => {
    setFolderDialog({ open: true, parentPath });
  }, []);

  const handleCreateFolder = useCallback(
    (fullPath: string) => {
      void createFolder(fullPath);
    },
    [createFolder],
  );

  // Rename a note by saving the new title, syncing with H1 in body.
  const handleRename = useCallback(
    async (id: string, newTitle: string) => {
      const cached = notesById[id];
      if (!cached) return;
      await save(id, {
        title: newTitle,
        body: replaceOrAddH1(cached.body, newTitle),
      });
    },
    [notesById, save],
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

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        <button id="nexote-new-note-btn" type="button" className="hidden" onClick={() => void create()} />
        <button id="nexote-new-folder-btn" type="button" className="hidden" onClick={() => openFolderDialog()} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <button id="nexote-new-note-btn" type="button" className="hidden" onClick={() => void create()} />
      <button id="nexote-new-folder-btn" type="button" className="hidden" onClick={() => openFolderDialog()} />

      <div className="flex-1 overflow-y-auto px-1 pb-2 pt-1">
        {showBookmarksOnly ? (
          <BookmarksList
            notes={notes.filter((n) => bookmarks.has(n.id))}
            activeId={activeId}
            onOpen={openTab}
            onDelete={setPendingDelete}
            onCopy={copyNote}
            onBookmark={toggleBookmark}
            bookmarks={bookmarks}
            onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
            renaming={renaming}
            setRenaming={setRenaming}
            onRename={handleRename}
            onMoveNote={handleMoveNote}
          />
        ) : drillPath !== null ? (
          <DrillView
            path={drillPath}
            notes={notes}
            folders={folders ?? []}
            activeId={activeId}
            onOpen={openTab}
            onDelete={setPendingDelete}
            onCopy={copyNote}
            onBookmark={toggleBookmark}
            bookmarks={bookmarks}
            onContextMenu={(x, y, items) => setCtxMenu({ x, y, items })}
            renaming={renaming}
            setRenaming={setRenaming}
            onRename={handleRename}
            onMoveNote={handleMoveNote}
            onBack={() => setDrillPath(null)}
            onDrillInto={setDrillPath}
          />
        ) : (
          <>
            {/* Shortcuts section */}
            {bookmarks.size > 0 && (
              <CollapsibleSection
                title="Shortcuts"
                count={bookmarks.size}
                expanded={shortcutsExpanded}
                onToggle={() => setShortcutsExpanded((v) => !v)}
              >
                <ul>
                  {notes
                    .filter((n) => bookmarks.has(n.id))
                    .sort((a, b) => a.title.localeCompare(b.title))
                    .map((n) => (
                      <NoteItem
                        key={n.id}
                        note={n}
                        depth={0}
                        active={n.id === activeId}
                        activeId={activeId}
                        onOpen={openTab}
                        onDelete={setPendingDelete}
                        onCopy={copyNote}
                        onBookmark={toggleBookmark}
                        bookmarks={bookmarks}
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
              count={Math.min(10, notes.length)}
              expanded={recentExpanded}
              onToggle={() => setRecentExpanded((v) => !v)}
            >
              <RecentFilesList notes={notes} activeId={activeId} onOpen={openTab} />
            </CollapsibleSection>

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
                  icon={<Database className="h-3.5 w-3.5 shrink-0" style={{ opacity: isActiveVault ? 1 : 0.6 }} />}
                  bold={isActiveVault}
                >
                  {isActiveVault ? (
                    <TreeChildren
                      node={vaultTree}
                      depth={0}
                      activeId={activeId}
                      onOpen={openTab}
                      onDelete={setPendingDelete}
                      onCopy={copyNote}
                      onBookmark={toggleBookmark}
                      bookmarks={bookmarks}
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
                  ) : (
                    <VaultNoteList
                      vaultId={vault.id}
                      notes={vaultData.notes}
                      folders={vaultData.folders}
                      activeId={activeId}
                      onOpen={openNoteInVault}
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

      {/* Vault switcher + settings at the bottom */}
      <div
        className="flex shrink-0 items-center gap-1 px-2 py-1.5"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <Database size={12} className="shrink-0 text-muted-foreground/60" />
        <select
          value={activeVault?.id ?? ""}
          onChange={(e) => switchVault(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none cursor-pointer"
          style={{ appearance: "none" }}
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
          className="flex h-6 w-6 items-center justify-center text-muted-foreground/60 hover:text-foreground rounded hover:bg-white/5"
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
    </div>
  );
}

type TreeChildProps = {
  depth: number;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onBookmark: (id: string) => void;
  bookmarks: Set<string>;
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
        <NoteItem key={n.id} {...childProps} note={n} depth={depth} active={n.id === rest.activeId} />
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
  } = props;
  const open = isFolderOpen(node.path);
  const isDragOver = dragOverPath === node.path;

  return (
    <li>
      <div
        draggable={false}
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
            "flex w-full items-center gap-1 py-1 text-sm transition-colors",
            isDragOver
              ? "bg-primary/20"
              : "text-foreground/80 hover:bg-muted",
          ].join(" ")}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <button
            type="button"
            onClick={() => setOpenMap((prev) => ({ ...prev, [node.path]: !open }))}
            className="flex items-center gap-1 min-w-0 flex-1"
          >
            <ChevronRight
              className={[
                "h-3.5 w-3.5 shrink-0 text-muted-foreground/75 transition-transform",
                open ? "rotate-90" : "",
              ].join(" ")}
            />
            {open ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground/75" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground/75" />
            )}
            <span className="truncate font-medium">{node.name}</span>
          </button>
          <button
            type="button"
            aria-label={`Open ${node.name} folder`}
            title="Open folder"
            onClick={(e) => {
              e.stopPropagation();
              onDrillInto(node.path);
            }}
            className="shrink-0 p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <ChevronRight className="h-3.5 w-3.5" />
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
    onOpen,
    onDelete,
    onCopy,
    onBookmark,
    bookmarks,
    onNoteDragStart,
    onContextMenu,
    renaming,
    setRenaming,
    onRename,
    onMoveNote,
  } = props;

  const isRenaming = renaming?.id === note.id;
  const isBookmarked = bookmarks.has(note.id);

  return (
    <li>
      <div
        draggable
        onDragStart={() => onNoteDragStart(note.id)}
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
              label: isBookmarked ? "Remove from shortcuts" : "Add to shortcuts",
              icon: isBookmarked
                ? <BookmarkCheck className="h-4 w-4" />
                : <Star className="h-4 w-4" />,
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
          "group flex w-full items-center gap-1.5 py-1 text-sm transition-colors",
          active
            ? "text-foreground"
            : "text-foreground/80 hover:bg-muted",
        ].join(" ")}
        style={{ paddingLeft: 24 + depth * 12 }}
      >
        <FileText
          className={[
            "h-4 w-4 shrink-0",
            active ? "text-primary" : "text-muted-foreground/75",
          ].join(" ")}
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
            className="min-w-0 flex-1 rounded border border-ring bg-background px-1 text-sm text-foreground outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => onOpen(note.id)}
            onDoubleClick={() => setRenaming({ id: note.id, value: note.title })}
            className="min-w-0 flex-1 truncate text-left"
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
          className="shrink-0 p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
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
  onOpen,
  onDelete,
  onCopy,
  onBookmark,
  bookmarks,
  onContextMenu,
  renaming,
  setRenaming,
  onRename,
  onMoveNote,
}: {
  notes: { id: string; title: string; path: string }[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onBookmark: (id: string) => void;
  bookmarks: Set<string>;
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
          active={n.id === activeId}
          activeId={activeId}
          onOpen={onOpen}
          onDelete={onDelete}
          onCopy={onCopy}
          onBookmark={onBookmark}
          bookmarks={bookmarks}
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

// --- Drill-in view (shows contents of a specific folder) ---
function DrillView({
  path,
  notes,
  folders,
  activeId,
  onOpen,
  onDelete,
  onCopy,
  onBookmark,
  bookmarks,
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
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onBookmark: (id: string) => void;
  bookmarks: Set<string>;
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
      <div className="flex items-center gap-1 px-2 py-1.5 mb-1" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          aria-label="Back to tree"
          title="Back to tree"
          onClick={onBack}
          className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-white/5"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 text-xs text-muted-foreground/80 overflow-hidden">
          {segments.map((seg, i) => {
            const fullPath = segments.slice(0, i + 1).join("/");
            const isLast = i === segments.length - 1;
            return (
              <span key={i} className="flex items-center gap-0.5 shrink-0">
                {i > 0 && <span className="text-muted-foreground/40">/</span>}
                <button
                  type="button"
                  onClick={() => !isLast && onDrillInto(fullPath)}
                  className={[
                    "truncate transition-colors",
                    isLast
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
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
              className="group flex w-full items-center gap-1 py-1 text-sm text-foreground/80 hover:bg-muted transition-colors"
              style={{ paddingLeft: 12 }}
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground/75" />
              <button
                type="button"
                onClick={() => onDrillInto(f.path)}
                className="min-w-0 flex-1 truncate text-left font-medium"
              >
                {f.name}
              </button>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
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
            active={n.id === activeId}
            activeId={activeId}
            onOpen={onOpen}
            onDelete={onDelete}
            onCopy={onCopy}
            onBookmark={onBookmark}
            bookmarks={bookmarks}
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
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
  bold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        style={bold ? { color: "var(--foreground)" } : undefined}
      >
        <ChevronRight
          className={[
            "h-3 w-3 shrink-0 transition-transform",
            expanded ? "rotate-90" : "",
          ].join(" ")}
        />
        {icon}
        <span className={bold ? "font-semibold" : "font-medium"}>{title}</span>
        <span className="ml-auto text-muted-foreground/50">{count}</span>
      </button>
      {expanded && <div className="mt-0.5">{children}</div>}
      <div className="mt-1 mb-1 mx-2 border-t" style={{ borderColor: "var(--border)" }} />
    </div>
  );
}

// --- Recent Files List ---
function RecentFilesList({
  notes,
  activeId,
  onOpen,
}: {
  notes: { id: string; title: string; updatedAt: string }[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const recent = [...notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);

  if (recent.length === 0) return null;

  return (
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
            style={{ paddingLeft: 20 }}
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
  );
}

// --- Vault Note List (for non-active vaults) ---
function VaultNoteList({
  vaultId,
  notes,
  folders,
  activeId,
  onOpen,
  onDrillInto,
}: {
  vaultId: string;
  notes: { id: string; title: string; path: string }[];
  folders: { path: string; name: string }[];
  activeId: string | null;
  onOpen: (vaultId: string, noteId: string) => void;
  onDrillInto: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const recent = [...notes]
    .sort((a, b) => {
      // Use title as fallback if updatedAt not available
      return a.title.localeCompare(b.title);
    })
    .slice(0, showAll ? 100 : 5);

  if (notes.length === 0 && folders.length === 0) {
    return (
      <div className="px-3 py-1 text-xs text-muted-foreground/50">
        Empty vault
      </div>
    );
  }

  return (
    <div>
      <ul>
        {recent.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onOpen(vaultId, n.id)}
              className="flex w-full items-center gap-1.5 px-2 py-0.5 text-sm text-foreground/70 hover:bg-muted transition-colors"
              style={{ paddingLeft: 20 }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <span className="truncate">{n.title || "Untitled"}</span>
              {n.path && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground/40">
                  {n.path.split("/")[0]}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {notes.length > 5 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="px-3 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Show all {notes.length}…
        </button>
      )}
      {showAll && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="px-3 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Show less
        </button>
      )}
      <button
        type="button"
        onClick={onDrillInto}
        className="flex w-full items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        style={{ paddingLeft: 20 }}
      >
        <ChevronRight className="h-3 w-3" />
        <span>Switch to this vault</span>
      </button>
    </div>
  );
}
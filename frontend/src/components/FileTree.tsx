"use client";

import {
  ChevronRight,
  Edit3,
  FileText,
  FilePlus,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
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
    activeId,
    openTab,
    create,
    createFolder,
    moveNote,
    remove,
    notesById,
    refresh,
    save,
  } = useNotes();
  const tree = useMemo(() => buildTree(notes, folders ?? []), [notes, folders]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [sorted, setSorted] = useState(false);

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

  // Move a note to a new path via the API, then refresh.
  const handleMoveNote = useCallback(
    async (id: string, path: string) => {
      const cached = notesById[id];
      if (!cached) return;
      try {
        await fetch(`/api/notes/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: cached.title,
            body: cached.body,
            path,
          }),
        });
        await refresh();
      } catch {
        // ignore
      }
    },
    [notesById, refresh],
  );

  // Delete a folder via the API, then refresh.
  const handleDeleteFolder = useCallback(
    async (path: string) => {
      try {
        await fetch(`/api/folders/${encodeURIComponent(path)}`, {
          method: "DELETE",
        });
        await refresh();
      } catch {
        // ignore
      }
    },
    [refresh],
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
        <TreeChildren
          node={tree}
          depth={0}
          activeId={activeId}
          onOpen={openTab}
          onDelete={setPendingDelete}
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
        />
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
    onNoteDragStart,
    onContextMenu,
    renaming,
    setRenaming,
    onRename,
    onMoveNote,
  } = props;

  const isRenaming = renaming?.id === note.id;

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
              label: "Rename",
              icon: <Edit3 className="h-4 w-4" />,
              onClick: () => setRenaming({ id: note.id, value: note.title }),
            },
            {
              label: "Move to root",
              icon: <FolderInput className="h-4 w-4" />,
              onClick: () => onMoveNote(note.id, ""),
            },
            { label: "", onClick: () => {}, separator: true },
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
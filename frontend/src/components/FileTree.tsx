"use client";

import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useNotes } from "@/lib/notes-context";

import DeleteConfirm from "./DeleteConfirm";

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
  // Ensure every folder from the API exists in the tree, even if empty.
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

// Collect every folder path in the tree (for expand/collapse all).
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
  // Whether all folders are currently expanded (drives the merged
  // expand/collapse toggle button).
  allExpanded: boolean;
  // Toggles between expand-all and collapse-all based on allExpanded.
  toggleExpandCollapse: () => void;
};

type FileTreeProps = {
  collapsed: boolean;
  onControlsReady?: (c: TreeControls) => void;
};

export default function FileTree({ collapsed, onControlsReady }: FileTreeProps) {
  const { notes, folders, activeId, openTab, create, createFolder, remove } =
    useNotes();
  const tree = useMemo(() => buildTree(notes, folders), [notes, folders]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Open-state map keyed by folder path. Defaults to open.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [sorted, setSorted] = useState(false);

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

  // Compute whether all folders are expanded.
  const folderPaths = useMemo(() => allFolderPaths(tree), [tree]);
  const allExpanded = folderPaths.every((p) => openMap[p] ?? true);

  const toggleExpandCollapse = useCallback(() => {
    if (allExpanded) {
      collapseAll();
    } else {
      expandAll();
    }
  }, [allExpanded, collapseAll, expandAll]);

  // Expose controls to the parent (sidebar header buttons).
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

  // New folder: prompt for a name, create an empty folder on disk.
  const newFolder = useCallback(async () => {
    const name = window.prompt("New folder name");
    if (!name) return;
    await createFolder(name);
  }, [createFolder]);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        {/* Hidden buttons so the sidebar header can trigger actions. */}
        <button id="nexote-new-note-btn" type="button" className="hidden" onClick={() => void create()} />
        <button id="nexote-new-folder-btn" type="button" className="hidden" onClick={() => void newFolder()} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Hidden trigger buttons for the sidebar header actions. */}
      <button id="nexote-new-note-btn" type="button" className="hidden" onClick={() => void create()} />
      <button id="nexote-new-folder-btn" type="button" className="hidden" onClick={() => void newFolder()} />

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
    </div>
  );
}

function TreeChildren({
  node,
  depth,
  activeId,
  onOpen,
  onDelete,
  isFolderOpen,
  setOpenMap,
  sorted,
}: {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  isFolderOpen: (path: string) => boolean;
  setOpenMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  sorted: boolean;
}) {
  const folders = [...node.children.values()];
  const notes = [...node.notes];
  if (sorted) {
    folders.sort((a, b) => a.name.localeCompare(b.name));
    notes.sort((a, b) => a.title.localeCompare(b.title));
  }
  return (
    <ul>
      {folders.map((child) => (
        <FolderItem
          key={child.path}
          node={child}
          depth={depth}
          activeId={activeId}
          onOpen={onOpen}
          onDelete={onDelete}
          isFolderOpen={isFolderOpen}
          setOpenMap={setOpenMap}
          sorted={sorted}
        />
      ))}
      {notes.map((n) => (
        <NoteItem
          key={n.id}
          note={n}
          depth={depth}
          active={n.id === activeId}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

function FolderItem({
  node,
  depth,
  activeId,
  onOpen,
  onDelete,
  isFolderOpen,
  setOpenMap,
  sorted,
}: {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  isFolderOpen: (path: string) => boolean;
  setOpenMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  sorted: boolean;
}) {
  const open = isFolderOpen(node.path);
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          setOpenMap((prev) => ({ ...prev, [node.path]: !open }))
        }
        className="flex w-full items-center gap-1 rounded-lg px-2 py-1 text-sm text-foreground/80 transition-colors hover:bg-muted"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <ChevronRight
          className={[
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-90" : "",
          ].join(" ")}
        />
        {open ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <TreeChildren
          node={node}
          depth={depth + 1}
          activeId={activeId}
          onOpen={onOpen}
          onDelete={onDelete}
          isFolderOpen={isFolderOpen}
          setOpenMap={setOpenMap}
          sorted={sorted}
        />
      )}
    </li>
  );
}

function NoteItem({
  note,
  depth,
  active,
  onOpen,
  onDelete,
}: {
  note: { id: string; title: string };
  depth: number;
  active: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <li>
      <div
        className={[
          "group flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-sm transition-colors",
          active
            ? "bg-primary/15 text-foreground"
            : "text-foreground/80 hover:bg-muted",
        ].join(" ")}
        style={{ paddingLeft: 24 + depth * 12 }}
      >
        <FileText
          className={[
            "h-3.5 w-3.5 shrink-0",
            active ? "text-primary" : "text-muted-foreground",
          ].join(" ")}
        />
        <button
          type="button"
          onClick={() => onOpen(note.id)}
          className="min-w-0 flex-1 truncate text-left"
        >
          {note.title || "Untitled"}
        </button>
        <button
          type="button"
          aria-label="Delete note"
          title="Delete note"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
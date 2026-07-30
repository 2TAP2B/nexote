"use client";

import { ChevronRight, FileText, Folder, FolderOpen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

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

// Build a tree from note metadata. Root-level notes (path === "") go directly
// under the root; notes with a path like "Journal/2026" nest into folders.
function buildTree(notes: { id: string; title: string; path: string }[]): TreeNode {
  const root = emptyTree();
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

type FileTreeProps = {
  collapsed: boolean;
};

export default function FileTree({ collapsed }: FileTreeProps) {
  const { notes, activeId, openTab, create, remove } = useNotes();
  const tree = useMemo(() => buildTree(notes), [notes]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  if (collapsed) {
    // Collapsed rail: just a "new note" icon button.
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        <button
          type="button"
          aria-label="New note"
          title="New note"
          onClick={() => void create()}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90"
        >
          <FileText className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Files
        </h2>
        <button
          type="button"
          aria-label="New note"
          title="New note"
          onClick={() => void create()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <FileText className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        <TreeChildren
          node={tree}
          depth={0}
          activeId={activeId}
          onOpen={openTab}
          onDelete={setPendingDelete}
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
}: {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <ul className={depth === 0 ? "" : ""}>
      {[...node.children.values()].map((child) => (
        <FolderItem
          key={child.path}
          node={child}
          depth={depth}
          activeId={activeId}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
      {node.notes.map((n) => (
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
}: {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
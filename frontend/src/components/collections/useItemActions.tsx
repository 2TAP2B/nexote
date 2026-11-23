"use client";

import { History, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { CollectionMeta, Note } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import type { SheetAction } from "../mobile/MobileActionSheet";
import { ConfirmDialog } from "../ResponsiveDialog";
import { useCanEdit } from "../useCanEdit";
import { openCollection, useCollectionActions } from "./actions";
import ItemEditor from "./ItemEditor";
import type { CollectionItem } from "./items";
import { DELETE_ITEM_MESSAGE, itemMenuSections } from "./menus";
import { useCollections } from "./useCollections";

export type OpenItem = {
  collection: CollectionMeta | null;
  /** The item as the lists know it (null while its vault is unknown, or for other notes). */
  item: CollectionItem | null;
  pinned: boolean;
  canEdit: boolean;
};

/**
 * The open collection item's collection and list entry. Covers, fields and
 * the pin come from the vault's list metas: the cached open note keeps its
 * old frontmatter after a pin or an "Edit details" save until it reloads.
 */
export function useOpenItem(note: Note | null): OpenItem {
  const { noteVaultMap, allVaultData } = useNotes();
  const { collections } = useCollections();
  const { canEditNote } = useCanEdit();
  const isItem = note?.type === "collection-item";
  const collectionId = isItem ? note.collection : undefined;
  const noteId = isItem ? note.id : undefined;
  const vaultId = noteId ? noteVaultMap[noteId] : undefined;
  const vaultNotes = vaultId ? allVaultData[vaultId]?.notes : undefined;

  const collection = useMemo(
    () => (collectionId ? collections.find((c) => c.id === collectionId) ?? null : null),
    [collections, collectionId],
  );
  const listMeta = useMemo(() => (noteId ? vaultNotes?.find((n) => n.id === noteId) : undefined), [vaultNotes, noteId]);

  if (!isItem || !note) return { collection: null, item: null, pinned: false, canEdit: false };
  return {
    collection,
    item: vaultId ? { ...(listMeta ?? note), vaultId } : null,
    // An unpinned list entry omits the flag, so it must not fall back to the stale note.
    pinned: listMeta ? Boolean(listMeta.pinned) : Boolean(note.pinned),
    canEdit: canEditNote(note.id),
  };
}

/**
 * The open item's menu (the editor bar's More button, the phone's ⋯) and the
 * dialogs it opens: "Edit details", the delete confirmation and an error
 * line. Render `element` once next to the menu's trigger.
 */
export function useItemActions(
  note: Note | null,
  { touch, onOpenHistory }: { touch: boolean; onOpenHistory?: () => void },
): OpenItem & { sections: SheetAction[][]; edit: () => void; element: ReactNode } {
  const open = useOpenItem(note);
  const { collection, item, pinned, canEdit } = open;
  const { pinItem, deleteItem } = useCollectionActions();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : "Something went wrong"));
  };

  const base = item
    ? itemMenuSections({
        pinned,
        touch,
        // Editing needs the collection's fields; it's there once the shared list has loaded.
        canEdit: canEdit && collection !== null,
        onEdit: () => setEditing(true),
        onTogglePin: () => run(() => pinItem(item, !pinned)),
        onDelete: () => setConfirmingDelete(true),
      })
    : [];
  const history: SheetAction[] = onOpenHistory
    ? [{ label: "Version history", icon: <History size={touch ? 19 : 15} />, onClick: onOpenHistory }]
    : [];
  // History sits with "Edit details"; pin and delete keep their own groups.
  const sections = base.length > 0 ? [[...base[0], ...history], ...base.slice(1)] : [history];

  const element = (
    <>
      {editing && collection && item && (
        <ItemEditor
          touch={touch}
          collection={collection}
          item={item}
          onClose={() => setEditing(false)}
          onDeleted={() => openCollection(collection.id)}
        />
      )}
      {confirmingDelete && item && (
        <ConfirmDialog
          touch={touch}
          title={`Delete “${item.title || "Untitled"}”?`}
          message={DELETE_ITEM_MESSAGE}
          onConfirm={() =>
            run(async () => {
              await deleteItem(item);
              // Back to where the item came from.
              if (item.collection) openCollection(item.collection);
            })
          }
          onClose={() => setConfirmingDelete(false)}
        />
      )}
      {error && <ErrorLine touch={touch} text={error} onDismiss={() => setError(null)} />}
    </>
  );

  return { ...open, sections, edit: () => setEditing(true), element };
}

// Portaled: the phone pager moves its panes with transforms, which would
// trap a fixed element inside the pane.
function ErrorLine({ touch, text, onDismiss }: { touch: boolean; text: string; onDismiss: () => void }) {
  return createPortal(
    <div
      role="alert"
      className="fixed left-1/2 z-[70] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full bg-red-600 py-1.5 pl-4 pr-1.5 text-white shadow-lg"
      style={{
        bottom: touch ? "calc(env(safe-area-inset-bottom, 0px) + 96px)" : 24,
        fontSize: touch ? 14 : 12,
      }}
    >
      <span className="min-w-0 truncate">{text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className={"flex shrink-0 items-center justify-center rounded-full hover:bg-white/15 " + (touch ? "h-8 w-8" : "h-6 w-6")}
      >
        <X size={touch ? 16 : 13} />
      </button>
    </div>,
    document.body,
  );
}

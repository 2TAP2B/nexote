"use client";

import { EyeOff, FolderOpen, LayoutDashboard, Pencil, Pin, PinOff, Plus, SquarePen, Trash2 } from "lucide-react";

import type { CollectionMeta } from "@/lib/api";
import type { SheetAction } from "../mobile/MobileActionSheet";

// The menus of a collection and of an item, the same everywhere they open
// (long press / right-click on a row or card, a header's More button, the
// item view). Groups for MobileActionSheet; ActionMenu flattens them for the
// desktop. Entries that change something are left out for viewers.

const size = (touch: boolean) => (touch ? 19 : 15);

// Confirmation texts, the same wherever the action is offered.
export const HIDE_COLLECTION_MESSAGE = "You can show it again in Settings › Vaults.";
export const DELETE_ITEM_MESSAGE = "This cannot be undone.";
export function deleteCollectionMessage(items: number): string {
  if (items === 0) return "It has no items. This cannot be undone.";
  return `${items === 1 ? "Its 1 item is" : `Its ${items} items are`} deleted too. This cannot be undone.`;
}

export function itemMenuSections({
  pinned,
  touch,
  canEdit,
  onOpen,
  onEdit,
  onTogglePin,
  onDelete,
}: {
  pinned: boolean;
  touch: boolean;
  canEdit: boolean;
  /** Left out where the item is already open. */
  onOpen?: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}): SheetAction[][] {
  const s = size(touch);
  return [
    [
      ...(onOpen ? [{ label: "Open", icon: <FolderOpen size={s} />, onClick: onOpen }] : []),
      ...(canEdit ? [{ label: "Edit details", icon: <SquarePen size={s} />, onClick: onEdit }] : []),
    ],
    canEdit
      ? [
          pinned
            ? { label: "Unpin", icon: <PinOff size={s} />, onClick: onTogglePin }
            : { label: "Pin to top", icon: <Pin size={s} />, onClick: onTogglePin },
        ]
      : [],
    canEdit ? [{ label: "Delete item", icon: <Trash2 size={s} />, danger: true, onClick: onDelete }] : [],
  ];
}

export function collectionMenuSections({
  collection,
  touch,
  canEdit,
  onOpen,
  onAddItem,
  onEdit,
  onTogglePinned,
  onHide,
  onDelete,
}: {
  collection: CollectionMeta;
  touch: boolean;
  canEdit: boolean;
  /** Left out inside the open gallery. */
  onOpen?: () => void;
  onAddItem: () => void;
  onEdit: () => void;
  onTogglePinned: () => void;
  onHide: () => void;
  /** Built-in collections can only be hidden (the server brings them back). */
  onDelete: () => void;
}): SheetAction[][] {
  const s = size(touch);
  return [
    [
      ...(onOpen ? [{ label: "Open", icon: <FolderOpen size={s} />, onClick: onOpen }] : []),
      ...(canEdit
        ? [
            { label: "Add item", icon: <Plus size={s} />, onClick: onAddItem },
            { label: "Edit collection", icon: <Pencil size={s} />, onClick: onEdit },
          ]
        : []),
    ],
    canEdit
      ? [
          collection.pinned
            ? { label: "Remove from dashboard", icon: <PinOff size={s} />, onClick: onTogglePinned }
            : { label: "Show on dashboard", icon: <LayoutDashboard size={s} />, onClick: onTogglePinned },
          { label: "Hide collection", icon: <EyeOff size={s} />, onClick: onHide },
        ]
      : [],
    canEdit && !collection.builtIn
      ? [{ label: "Delete collection", icon: <Trash2 size={s} />, danger: true, onClick: onDelete }]
      : [],
  ];
}

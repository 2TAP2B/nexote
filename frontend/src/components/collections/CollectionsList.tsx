"use client";

import { Library, Pin, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { CollectionMeta } from "@/lib/api";
import { ActionMenu, type MenuAnchor } from "../ActionMenu";
import { ConfirmDialog } from "../ResponsiveDialog";
import { useLongPress, type MenuOpener } from "../threads/useLongPress";
import { useCanEdit } from "../useCanEdit";
import { newCollection, openCollection, useCollectionActions } from "./actions";
import { CollectionBadge, ItemCover } from "./CollectionArt";
import { collectionMenuSections, deleteCollectionMessage, HIDE_COLLECTION_MESSAGE } from "./menus";
import CollectionEditor from "./CollectionEditor";
import ItemEditor from "./ItemEditor";
import { useCollectionItems, type CollectionItem } from "./items";
import { useCollections } from "./useCollections";

type Fs = { title: number; meta: number; body: number };

const countLabel = (n: number) => (n === 0 ? "No items yet" : n === 1 ? "1 item" : `${n} items`);

/**
 * The Collections sidebar view: every visible collection (pinned first, then
 * by name) with its item count and the newest covers; tap opens the gallery,
 * long press / right-click opens the collection menu.
 */
export default function CollectionsList({
  touch,
  openCollectionId,
}: {
  touch: boolean;
  /** The collection whose gallery is showing, highlighted. */
  openCollectionId?: string | null;
}) {
  const { collections, loaded } = useCollections();
  const itemsById = useCollectionItems();
  const { canEditSpace } = useCanEdit();
  const actions = useCollectionActions();
  const [menu, setMenu] = useState<{ collection: CollectionMeta; at: MenuAnchor } | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [adding, setAdding] = useState<CollectionMeta | null>(null);
  const [editing, setEditing] = useState<CollectionMeta | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "hide" | "delete"; collection: CollectionMeta } | null>(null);

  const rows = useMemo(
    () =>
      collections
        .filter((c) => !c.hidden)
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.name.localeCompare(b.name)),
    [collections],
  );

  const fs: Fs = touch ? { title: 15, meta: 12, body: 13 } : { title: 13, meta: 11, body: 12 };

  const run = (p: Promise<unknown>) => {
    setMenuError(null);
    p.catch((e: unknown) => setMenuError(e instanceof Error && e.message ? e.message : "Something went wrong"));
  };

  const itemsOf = (c: CollectionMeta): CollectionItem[] => itemsById.get(c.id) ?? [];

  return (
    <div className="flex flex-col pt-1">
      {menuError && (
        <p className="flex items-start gap-2 px-3 py-2" style={{ fontSize: fs.body, color: "var(--destructive, #ef4444)" }}>
          <span className="min-w-0 flex-1">{menuError}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setMenuError(null)} className="shrink-0">
            <X size={touch ? 16 : 13} />
          </button>
        </p>
      )}

      {!loaded && rows.length === 0 && (
        <p className="px-3 py-2" style={{ fontSize: fs.body, color: "var(--muted-foreground)" }}>
          Loading…
        </p>
      )}
      {loaded && rows.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center" style={{ color: "var(--muted-foreground)" }}>
          <Library size={touch ? 28 : 22} style={{ opacity: 0.6 }} />
          <p style={{ fontSize: fs.title, color: "var(--foreground)", fontWeight: 500 }}>No collections yet</p>
          <p style={{ fontSize: fs.body }}>Collect records, books, games — anything with a cover.</p>
          {canEditSpace && (
            <button
              type="button"
              onClick={newCollection}
              className="mt-1 flex items-center gap-1.5 rounded-full px-3"
              style={{
                height: touch ? 40 : 30,
                fontSize: fs.body,
                fontWeight: 500,
                background: "var(--primary)",
                color: "var(--primary-foreground)",
              }}
            >
              <Plus size={touch ? 16 : 14} />
              New collection
            </button>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-0.5 px-1">
          {rows.map((c) => (
            <CollectionRow
              key={c.id}
              collection={c}
              items={itemsOf(c)}
              active={c.id === openCollectionId}
              touch={touch}
              fs={fs}
              onMenu={(at, via) => setMenu({ collection: c, at: { ...at, via } })}
            />
          ))}
          {canEditSpace && (
            <li>
              <button
                type="button"
                onClick={newCollection}
                className="tree-row flex w-full items-center gap-2.5 text-left"
                style={{
                  minHeight: touch ? 56 : 44,
                  padding: touch ? "8px 10px" : "6px 8px",
                  borderRadius: 6,
                  color: "var(--muted-foreground)",
                }}
              >
                <span
                  className="flex shrink-0 items-center justify-center"
                  style={{
                    width: touch ? 36 : 30,
                    height: touch ? 36 : 30,
                    borderRadius: 8,
                    border: "1.5px dashed color-mix(in oklab, var(--foreground) 25%, transparent)",
                  }}
                >
                  <Plus size={touch ? 18 : 15} />
                </span>
                <span style={{ fontSize: fs.title, fontWeight: 500 }}>New collection</span>
              </button>
            </li>
          )}
        </ul>
      )}

      {menu && (
        <ActionMenu
          at={menu.at}
          touch={touch}
          title={menu.collection.name}
          subtitle={countLabel(itemsOf(menu.collection).length)}
          sections={collectionMenuSections({
            collection: menu.collection,
            touch,
            canEdit: canEditSpace,
            onOpen: () => openCollection(menu.collection.id),
            onAddItem: () => setAdding(menu.collection),
            onEdit: () => setEditing(menu.collection),
            onTogglePinned: () => run(actions.pinCollection(menu.collection, !menu.collection.pinned)),
            onHide: () => setConfirm({ kind: "hide", collection: menu.collection }),
            onDelete: () => setConfirm({ kind: "delete", collection: menu.collection }),
          })}
          onClose={() => setMenu(null)}
        />
      )}

      {adding && <ItemEditor touch={touch} collection={adding} onClose={() => setAdding(null)} />}
      {editing && <CollectionEditor touch={touch} collection={editing} onClose={() => setEditing(null)} />}

      {confirm && (
        <ConfirmDialog
          touch={touch}
          title={confirm.kind === "hide" ? `Hide “${confirm.collection.name}”?` : `Delete “${confirm.collection.name}”?`}
          message={
            confirm.kind === "hide" ? HIDE_COLLECTION_MESSAGE : deleteCollectionMessage(itemsOf(confirm.collection).length)
          }
          confirmLabel={confirm.kind === "hide" ? "Hide" : "Delete"}
          onConfirm={() =>
            run(
              confirm.kind === "hide"
                ? actions.hideCollection(confirm.collection)
                : actions.deleteCollection(confirm.collection, itemsOf(confirm.collection)),
            )
          }
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function CollectionRow({
  collection: c,
  items,
  active,
  touch,
  fs,
  onMenu,
}: {
  collection: CollectionMeta;
  items: CollectionItem[];
  active: boolean;
  touch: boolean;
  fs: Fs;
  onMenu: (at: { x: number; y: number }, via: MenuOpener) => void;
}) {
  const pressHandlers = useLongPress(onMenu);
  // The newest items' covers, newest on top of the stack.
  const covers = useMemo(
    () => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3),
    [items],
  );
  return (
    <li>
      <button
        type="button"
        {...pressHandlers}
        onClick={() => openCollection(c.id)}
        className={"tree-row flex w-full select-none items-center gap-2.5 text-left" + (active ? " tree-active" : "")}
        style={{
          minHeight: touch ? 56 : 44,
          padding: touch ? "8px 10px" : "6px 8px",
          borderRadius: 6,
          WebkitTouchCallout: "none",
        }}
      >
        <CollectionBadge collection={c} size={touch ? 36 : 30} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="tree-row-title truncate"
            style={{ fontSize: fs.title, fontWeight: 500, color: active ? undefined : "var(--foreground)" }}
          >
            {c.name}
          </span>
          <span className="flex items-center gap-1" style={{ fontSize: fs.meta, color: "var(--muted-foreground)" }}>
            {c.pinned && <Pin size={touch ? 12 : 11} className="shrink-0" aria-label="On the dashboard" />}
            <span className="truncate">{countLabel(items.length)}</span>
          </span>
        </span>
        {covers.length > 0 && (
          <span className="flex shrink-0 flex-row-reverse items-center">
            {covers.map((it, i) => (
              <span
                key={it.id}
                className="block"
                style={{
                  marginLeft: i === covers.length - 1 ? 0 : -8,
                  borderRadius: 6,
                  boxShadow: "0 0 0 2px var(--sidebar, var(--background))",
                  zIndex: covers.length - i,
                }}
              >
                <ItemCover
                  cover={it.cover}
                  collection={c}
                  radius={6}
                  iconSize={12}
                  className={touch ? "h-[26px] w-[26px]" : "h-[22px] w-[22px]"}
                />
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
}

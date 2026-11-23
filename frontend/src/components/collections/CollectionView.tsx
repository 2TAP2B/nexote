"use client";

import {
  ArrowDownAZ,
  ArrowUpDown,
  Calendar,
  CalendarPlus,
  ChevronLeft,
  Clock,
  Hash,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Type,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { CollectionMeta } from "@/lib/api";
import { ActionMenu, anchorBelow, type MenuAnchor } from "../ActionMenu";
import type { SheetAction } from "../mobile/MobileActionSheet";
import { SHELL_PALETTE } from "../mobile/mobileTheme";
import { ConfirmDialog } from "../ResponsiveDialog";
import { JumpButton, useScrolledAway } from "../threads/JumpButton";
import { HeaderButton, MemoToast, useMemoToast } from "../threads/MemoChrome";
import { useLongPress, type MenuOpener } from "../threads/useLongPress";
import { useCanEdit } from "../useCanEdit";
import { useCollectionActions } from "./actions";
import { useCollections } from "./useCollections";
import { CollectionBadge, ItemCover } from "./CollectionArt";
import CollectionEditor from "./CollectionEditor";
import ItemEditor from "./ItemEditor";
import {
  itemMatches,
  itemSubtitle,
  sortItems,
  sortLabel,
  sortOptions,
  useCollectionItems,
  type CollectionItem,
  type ItemSort,
} from "./items";
import {
  collectionMenuSections,
  DELETE_ITEM_MESSAGE,
  deleteCollectionMessage,
  HIDE_COLLECTION_MESSAGE,
  itemMenuSections,
} from "./menus";

// A collection's gallery (phone overlay, desktop main area): its items as a
// cover grid or a list, with search, a sort, Yes/No field filters and the
// collection's menu. Long press / right-click on an item opens its menu; a
// tap opens the item. Sort and layout are remembered per collection.

type Props = {
  collectionId: string;
  variant: "mobile" | "desktop";
  onClose: () => void;
  onOpenItem: (item: CollectionItem) => void;
};

type View = "grid" | "list";
type Prefs = { sort: ItemSort; view: View };

const DEFAULT_PREFS: Prefs = { sort: "title", view: "grid" };
const prefsKey = (id: string) => `nexote:collection-view:${id}`;

const NO_ITEMS: CollectionItem[] = [];
const SUBTLE = "color-mix(in srgb, var(--mob-text) 6%, transparent)";

// Only the sort's shape is checked here: whether the collection still has
// that field is decided once it is loaded (see `sort` in GalleryPane).
const isItemSort = (v: unknown): v is ItemSort =>
  typeof v === "string" && (v === "title" || v === "added" || v === "updated" || (v.startsWith("field:") && v.length > 6));

const isView = (v: unknown): v is View => v === "grid" || v === "list";

function readPrefs(id: string): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(prefsKey(id));
    if (!raw) return DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFS;
    const sort = "sort" in parsed ? parsed.sort : undefined;
    const view = "view" in parsed ? parsed.view : undefined;
    return {
      sort: isItemSort(sort) ? sort : DEFAULT_PREFS.sort,
      view: isView(view) ? view : DEFAULT_PREFS.view,
    };
  } catch {
    // Unreadable JSON or storage blocked (private mode): the defaults do.
    return DEFAULT_PREFS;
  }
}

function writePrefs(id: string, prefs: Prefs) {
  try {
    window.localStorage.setItem(prefsKey(id), JSON.stringify(prefs));
  } catch {
    // Storage full or blocked: the choice just isn't remembered.
  }
}

function sortIcon(sort: ItemSort, collection: CollectionMeta, size: number): ReactNode {
  if (sort === "title") return <ArrowDownAZ size={size} />;
  if (sort === "added") return <CalendarPlus size={size} />;
  if (sort === "updated") return <Clock size={size} />;
  const field = collection.fields.find((f) => `field:${f.key}` === sort);
  if (field?.type === "number") return <Hash size={size} />;
  if (field?.type === "date") return <Calendar size={size} />;
  return <Type size={size} />;
}

const countLabel = (n: number) => (n === 1 ? "1 item" : `${n} items`);
const itemTitle = (item: CollectionItem) => item.title || "Untitled";

type Menu =
  | { kind: "collection"; at: MenuAnchor }
  | { kind: "sort"; at: MenuAnchor }
  | { kind: "item"; item: CollectionItem; at: MenuAnchor };

type Confirm = { kind: "hide" } | { kind: "delete" } | { kind: "delete-item"; item: CollectionItem };

export default function CollectionView(props: Props) {
  // Another collection opened in place starts fresh: its own sort, layout,
  // search and filters.
  return <GalleryPane key={props.collectionId} {...props} />;
}

function GalleryPane({ collectionId, variant, onClose, onOpenItem }: Props) {
  const mobile = variant === "mobile";
  const column = mobile ? "w-full" : "mx-auto w-full max-w-6xl";
  const { collections, loaded } = useCollections();
  const collection = collections.find((c) => c.id === collectionId) ?? null;
  const allItems = useCollectionItems().get(collectionId) ?? NO_ITEMS;
  const { canEditSpace, canEditVault } = useCanEdit();
  const actions = useCollectionActions();
  const { toast, showToast, dismissToast } = useMemoToast();

  const [prefs, setPrefsState] = useState<Prefs>(() => readPrefs(collectionId));
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // The item editor: a new item (item null) or an existing one.
  const [itemEditor, setItemEditor] = useState<{ item: CollectionItem | null } | null>(null);
  const [editingCollection, setEditingCollection] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const { away } = useScrolledAway(scrollRef, "top", 600);

  const setPrefs = (next: Prefs) => {
    setPrefsState(next);
    writePrefs(collectionId, next);
  };

  // A remembered field sort whose field was removed falls back to the title.
  const sorts = useMemo(() => (collection ? sortOptions(collection) : []), [collection]);
  const sort: ItemSort = sorts.includes(prefs.sort) ? prefs.sort : "title";

  // Yes/No fields that at least one item has set to "Yes".
  const chips = useMemo(() => {
    if (!collection) return [];
    return collection.fields
      .filter((f) => f.type === "boolean")
      .map((field) => ({ field, count: allItems.filter((i) => i.fields?.[field.key] === "true").length }))
      .filter((c) => c.count > 0);
  }, [collection, allItems]);
  // Only filters with a chip on screen apply: one that vanished can't be cleared.
  const filterKeys = useMemo(
    () => chips.filter((c) => activeFilters.has(c.field.key)).map((c) => c.field.key),
    [chips, activeFilters],
  );

  const visible = useMemo(() => {
    if (!collection) return NO_ITEMS;
    const matching = allItems.filter(
      (item) => itemMatches(item, query) && filterKeys.every((key) => item.fields?.[key] === "true"),
    );
    return sortItems(matching, sort, collection);
  }, [collection, allItems, query, filterKeys, sort]);

  // Escape closes an open desktop menu, not the view: the desktop host
  // closes the main view on an unhandled Escape (capture phase, so first).
  useEffect(() => {
    if (!menu || mobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setMenu(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu, mobile]);

  // The actions throw Errors with a readable message; the fallback covers anything else.
  const run = (task: () => Promise<void>, fallback: string, after?: () => void) => {
    task().then(after, (e: unknown) => showToast(e instanceof Error && e.message ? e.message : fallback));
  };

  const toggleFilter = (key: string) =>
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const clearFilters = () => {
    setQuery("");
    setActiveFilters(new Set());
  };

  const openMore = () => {
    const el = moreRef.current;
    setMenu({ kind: "collection", at: !mobile && el ? anchorBelow(el) : { x: 0, y: 0, via: "press" } });
  };

  const name = collection?.name || "Collection";
  const fs = mobile ? { input: 16, row: 15 } : { input: 13, row: 14 };
  const controlHeight = mobile ? 40 : 34;

  const collectionSections = (c: CollectionMeta): SheetAction[][] =>
    collectionMenuSections({
      collection: c,
      touch: mobile,
      canEdit: canEditSpace,
      onAddItem: () => setItemEditor({ item: null }),
      onEdit: () => setEditingCollection(true),
      onTogglePinned: () => run(() => actions.pinCollection(c, !c.pinned), "Couldn't change the dashboard"),
      onHide: () => setConfirm({ kind: "hide" }),
      onDelete: () => setConfirm({ kind: "delete" }),
    });

  const itemSections = (item: CollectionItem): SheetAction[][] =>
    itemMenuSections({
      pinned: Boolean(item.pinned),
      touch: mobile,
      canEdit: canEditVault(item.vaultId),
      onOpen: () => onOpenItem(item),
      onEdit: () => setItemEditor({ item }),
      onTogglePin: () => run(() => actions.pinItem(item, !item.pinned), "Couldn't pin the item"),
      onDelete: () => setConfirm({ kind: "delete-item", item }),
    });

  const sortSections = (c: CollectionMeta): SheetAction[][] => [
    sorts.map((s) => ({
      label: sortLabel(s, c),
      icon: sortIcon(s, c, mobile ? 19 : 15),
      checked: s === sort,
      onClick: () => setPrefs({ ...prefs, sort: s }),
    })),
  ];

  const onItemMenu = (item: CollectionItem) => (at: { x: number; y: number }, via: MenuOpener) =>
    setMenu({ kind: "item", item, at: { ...at, via } });

  // ---- content ----
  let content: ReactNode;
  if (!collection) {
    content = !loaded ? (
      <Notice title="Loading…" text="" />
    ) : (
      <Notice title="This collection no longer exists" text="It was deleted or you no longer have access to it." />
    );
  } else if (allItems.length === 0) {
    content = (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <CollectionBadge collection={collection} size={56} />
        <p className="mt-2 text-[15px] font-semibold" style={{ color: "var(--mob-text)" }}>
          No items yet
        </p>
        <p className="text-[13px]" style={{ color: "var(--mob-muted)" }}>
          {canEditSpace ? `Add the first item to ${name}.` : `Nothing has been added to ${name} yet.`}
        </p>
        {canEditSpace && (
          <button
            type="button"
            onClick={() => setItemEditor({ item: null })}
            className="mt-3 flex items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white transition-transform active:scale-95"
            style={{ height: controlHeight, background: "var(--mob-accent)" }}
          >
            <Plus size={16} strokeWidth={2.4} />
            Add item
          </button>
        )}
      </div>
    );
  } else if (visible.length === 0) {
    content = (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-1 px-6 py-12 text-center">
        <p className="text-sm font-medium" style={{ color: "var(--mob-text)" }}>
          No matching items
        </p>
        <p className="text-xs" style={{ color: "var(--mob-muted)" }}>
          Try another search or filter.
        </p>
        <button
          type="button"
          onClick={clearFilters}
          className="mt-3 rounded-full px-4 text-sm font-medium transition-transform active:scale-95"
          style={{ height: mobile ? 40 : 32, background: "var(--mob-surface)", color: "var(--mob-text)" }}
        >
          Clear filters
        </button>
      </div>
    );
  } else if (prefs.view === "grid") {
    content = (
      <ul
        className={mobile ? "grid gap-x-3 gap-y-5" : "grid gap-x-5 gap-y-6"}
        style={{ gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(168px, 1fr))" }}
      >
        {visible.map((item) => (
          <GalleryCard
            key={`${item.vaultId}/${item.id}`}
            item={item}
            collection={collection}
            mobile={mobile}
            onOpen={() => onOpenItem(item)}
            onMenu={onItemMenu(item)}
          />
        ))}
      </ul>
    );
  } else {
    content = (
      <ul className="flex flex-col gap-0.5">
        {visible.map((item) => (
          <GalleryRow
            key={`${item.vaultId}/${item.id}`}
            item={item}
            collection={collection}
            mobile={mobile}
            titleSize={fs.row}
            onOpen={() => onOpenItem(item)}
            onMenu={onItemMenu(item)}
          />
        ))}
      </ul>
    );
  }

  const showToolbar = collection !== null && allItems.length > 0;

  return (
    <section
      aria-label={`Collection: ${name}`}
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{ ...SHELL_PALETTE, background: "var(--mob-bg)", color: "var(--mob-text)" }}
    >
      {/* Header */}
      <div
        className="shrink-0 px-3"
        style={{
          paddingTop: mobile ? "calc(env(safe-area-inset-top, 0px) + 8px)" : 8,
          paddingBottom: 8,
          borderBottom: "1px solid var(--mob-surface)",
        }}
      >
        <div className={"flex items-center gap-3 " + column}>
          <HeaderButton label={mobile ? "Back" : "Close collection"} onClick={onClose}>
            {mobile ? <ChevronLeft size={22} /> : <X size={20} />}
          </HeaderButton>
          {collection && <CollectionBadge collection={collection} size={36} />}
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-lg font-semibold leading-tight" style={{ color: "var(--mob-text)" }}>
              {name}
            </h1>
            {collection && (
              <span className="truncate pt-0.5 text-[12px]" style={{ color: "var(--mob-muted)" }}>
                {countLabel(allItems.length)}
              </span>
            )}
          </div>
          {collection && canEditSpace && (
            <button
              type="button"
              aria-label="Add item"
              title="Add item"
              onClick={() => setItemEditor({ item: null })}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-transform active:scale-95"
              style={{ background: "var(--mob-accent)" }}
            >
              <Plus size={20} strokeWidth={2.4} />
            </button>
          )}
          {collection && canEditSpace && (
            <div ref={moreRef} className="shrink-0">
              <HeaderButton label="More" onClick={openMore}>
                <MoreHorizontal size={20} />
              </HeaderButton>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar: search, sort, layout, then the Yes/No filters */}
      {collection && showToolbar && (
        <div className="shrink-0 px-3 pt-3">
          <div className={"flex flex-col gap-2 " + column}>
            <div className="flex items-center gap-2">
              <div
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3"
                style={{ height: controlHeight, background: SUBTLE }}
              >
                <Search size={mobile ? 16 : 14} className="shrink-0" style={{ color: "var(--mob-muted)" }} />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // A typed search clears first; the host closes the view on the next Escape.
                    if (e.key === "Escape" && query) {
                      e.preventDefault();
                      setQuery("");
                    }
                  }}
                  placeholder={`Search ${name}`}
                  aria-label={`Search ${name}`}
                  enterKeyHint="search"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--mob-muted)] [&::-webkit-search-cancel-button]:hidden"
                  style={{ fontSize: fs.input, color: "var(--mob-text)" }}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                    className="flex shrink-0 items-center justify-center rounded-full"
                    style={{ color: "var(--mob-muted)", width: mobile ? 32 : 22, height: mobile ? 32 : 22 }}
                  >
                    <X size={mobile ? 16 : 13} />
                  </button>
                )}
              </div>
              <button
                type="button"
                aria-label={`Sort: ${sortLabel(sort, collection)}`}
                title={`Sort: ${sortLabel(sort, collection)}`}
                onClick={(e) =>
                  setMenu({ kind: "sort", at: mobile ? { x: 0, y: 0, via: "press" } : anchorBelow(e.currentTarget) })
                }
                className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl transition-transform active:scale-95"
                style={{
                  height: controlHeight,
                  minWidth: controlHeight,
                  padding: mobile ? 0 : "0 10px",
                  background: SUBTLE,
                  color: "var(--mob-text)",
                }}
              >
                <ArrowUpDown size={mobile ? 17 : 14} style={{ color: "var(--mob-muted)" }} />
                {!mobile && <span className="max-w-[10rem] truncate text-[13px]">{sortLabel(sort, collection)}</span>}
              </button>
              <div
                role="group"
                aria-label="Layout"
                className="flex shrink-0 items-center rounded-full p-0.5"
                style={{ height: controlHeight, background: SUBTLE }}
              >
                {(
                  [
                    { view: "grid", label: "Grid", Icon: LayoutGrid },
                    { view: "list", label: "List", Icon: List },
                  ] as const
                ).map(({ view, label, Icon }) => {
                  const on = prefs.view === view;
                  return (
                    <button
                      key={view}
                      type="button"
                      aria-label={label}
                      title={label}
                      aria-pressed={on}
                      onClick={() => setPrefs({ ...prefs, view })}
                      className="flex h-full items-center justify-center rounded-full transition-colors"
                      style={{
                        width: mobile ? 38 : 32,
                        background: on ? "var(--mob-bg)" : "transparent",
                        color: on ? "var(--mob-text)" : "var(--mob-muted)",
                        boxShadow: on ? "0 1px 2px rgba(0, 0, 0, 0.12)" : undefined,
                      }}
                    >
                      <Icon size={mobile ? 17 : 15} />
                    </button>
                  );
                })}
              </div>
            </div>
            {chips.length > 0 && (
              <div className="no-scrollbar -mx-3 flex items-center gap-1.5 overflow-x-auto px-3">
                {chips.map(({ field, count }) => {
                  const active = activeFilters.has(field.key);
                  return (
                    <FilterChip
                      key={field.key}
                      active={active}
                      touch={mobile}
                      title={active ? `Show all items` : `Only items with “${field.label}”`}
                      onClick={() => toggleFilter(field.key)}
                    >
                      <span>{field.label}</span>
                      <span className="tabular-nums" style={{ opacity: 0.7 }}>
                        {count}
                      </span>
                    </FilterChip>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Items */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3"
          style={{
            touchAction: "pan-y",
            paddingBottom: mobile ? "calc(env(safe-area-inset-bottom, 0px) + 24px)" : 24,
          }}
        >
          <div className={"flex min-h-full flex-col " + column}>{content}</div>
        </div>
        <JumpButton
          show={away}
          direction="up"
          label="Back to top"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="absolute right-3 z-10"
          style={{ bottom: mobile ? "calc(env(safe-area-inset-bottom, 0px) + 12px)" : 12 }}
        />
      </div>

      <MemoToast toast={toast} onDismiss={dismissToast} />

      {menu && collection && menu.kind === "collection" && (
        <ActionMenu
          at={menu.at}
          touch={mobile}
          title={collection.name}
          subtitle={countLabel(allItems.length)}
          sections={collectionSections(collection)}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && collection && menu.kind === "sort" && (
        <ActionMenu
          at={menu.at}
          touch={mobile}
          title="Sort by"
          sections={sortSections(collection)}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && collection && menu.kind === "item" && (
        <ActionMenu
          at={menu.at}
          touch={mobile}
          title={itemTitle(menu.item)}
          subtitle={itemSubtitle(collection, menu.item) || undefined}
          sections={itemSections(menu.item)}
          onClose={() => setMenu(null)}
        />
      )}

      {confirm?.kind === "hide" && collection && (
        <ConfirmDialog
          touch={mobile}
          title={`Hide “${collection.name}”?`}
          message={HIDE_COLLECTION_MESSAGE}
          confirmLabel="Hide"
          onConfirm={() => run(() => actions.hideCollection(collection), "Couldn't hide the collection", onClose)}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "delete" && collection && (
        <ConfirmDialog
          touch={mobile}
          title={`Delete “${collection.name}”?`}
          message={deleteCollectionMessage(allItems.length)}
          onConfirm={() =>
            run(() => actions.deleteCollection(collection, allItems), "Couldn't delete the collection", onClose)
          }
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "delete-item" && (
        <ConfirmDialog
          touch={mobile}
          title={`Delete “${itemTitle(confirm.item)}”?`}
          message={DELETE_ITEM_MESSAGE}
          onConfirm={() => {
            const { item } = confirm;
            run(() => actions.deleteItem(item), "Couldn't delete the item");
          }}
          onClose={() => setConfirm(null)}
        />
      )}

      {itemEditor && collection && (
        <ItemEditor touch={mobile} collection={collection} item={itemEditor.item} onClose={() => setItemEditor(null)} />
      )}
      {editingCollection && collection && (
        <CollectionEditor
          touch={mobile}
          collection={collection}
          onClose={() => setEditingCollection(false)}
          onRemoved={onClose}
        />
      )}
    </section>
  );
}

function GalleryCard({
  item,
  collection,
  mobile,
  onOpen,
  onMenu,
}: {
  item: CollectionItem;
  collection: CollectionMeta;
  mobile: boolean;
  onOpen: () => void;
  onMenu: (at: { x: number; y: number }, via: MenuOpener) => void;
}) {
  const press = useLongPress(onMenu);
  const subtitle = itemSubtitle(collection, item);
  return (
    <li className="min-w-0">
      <button
        type="button"
        {...press}
        onClick={onOpen}
        className="group flex w-full min-w-0 select-none flex-col text-left outline-none transition-transform active:scale-[0.98] focus-visible:rounded-[14px] focus-visible:ring-2 focus-visible:ring-[var(--mob-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mob-bg)]"
        style={{ WebkitTouchCallout: "none" }}
      >
        {/* The lift and shadow sit on a wrapper: the cover's own inline
            hairline shadow would override a shadow class on it. */}
        <span
          className={
            "block w-full transition-[transform,box-shadow] duration-200" +
            (mobile ? "" : " group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_20px_-6px_rgba(0,0,0,0.35)]")
          }
          style={{ borderRadius: 14 }}
        >
          <ItemCover
            cover={item.cover}
            collection={collection}
            className="aspect-square w-full"
            radius={14}
            iconSize={mobile ? 34 : 38}
            pinned={Boolean(item.pinned)}
          />
        </span>
        <span className="mt-2 line-clamp-2 text-[14px] font-medium leading-snug" style={{ color: "var(--mob-text)" }}>
          {itemTitle(item)}
        </span>
        {subtitle && (
          <span className="mt-0.5 w-full truncate text-[12px]" style={{ color: "var(--mob-muted)" }}>
            {subtitle}
          </span>
        )}
      </button>
    </li>
  );
}

function GalleryRow({
  item,
  collection,
  mobile,
  titleSize,
  onOpen,
  onMenu,
}: {
  item: CollectionItem;
  collection: CollectionMeta;
  mobile: boolean;
  titleSize: number;
  onOpen: () => void;
  onMenu: (at: { x: number; y: number }, via: MenuOpener) => void;
}) {
  const press = useLongPress(onMenu);
  const subtitle = itemSubtitle(collection, item, 3);
  return (
    <li>
      <button
        type="button"
        {...press}
        onClick={onOpen}
        className="flex w-full min-w-0 select-none items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--mob-text)_6%,transparent)] active:bg-[color-mix(in_srgb,var(--mob-text)_10%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--mob-accent)]"
        style={{ WebkitTouchCallout: "none", minHeight: mobile ? 72 : 68 }}
      >
        <ItemCover cover={item.cover} collection={collection} className="h-14 w-14" radius={10} iconSize={22} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium" style={{ fontSize: titleSize, color: "var(--mob-text)" }}>
            {itemTitle(item)}
          </span>
          {subtitle && (
            <span className="truncate text-[12px]" style={{ color: "var(--mob-muted)" }}>
              {subtitle}
            </span>
          )}
        </span>
        {item.pinned && (
          <Pin size={mobile ? 15 : 13} aria-label="Pinned" className="shrink-0" style={{ color: "var(--mob-accent)" }} />
        )}
      </button>
    </li>
  );
}

function FilterChip({
  active,
  touch,
  title,
  onClick,
  children,
}: {
  active: boolean;
  touch: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className="flex shrink-0 items-center gap-1.5 rounded-full px-3 transition-colors"
      style={{
        height: touch ? 32 : 26,
        fontSize: touch ? 13 : 12,
        color: active ? "#fff" : "var(--mob-text)",
        background: active ? "var(--mob-accent)" : "color-mix(in srgb, var(--mob-text) 7%, transparent)",
      }}
    >
      {children}
    </button>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-sm font-medium" style={{ color: title === "Loading…" ? "var(--mob-muted)" : "var(--mob-text)" }}>
        {title}
      </p>
      {text && (
        <p className="text-xs" style={{ color: "var(--mob-muted)" }}>
          {text}
        </p>
      )}
    </div>
  );
}

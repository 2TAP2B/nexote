"use client";

import { CircleCheck, MessagesSquare, Pin, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { commentLabel, lastActivity, openThread, replyLabel, threadPreview, threadTags, type Thread } from "@/lib/threads";
import { ActionMenu, type MenuAnchor } from "../ActionMenu";
import type { SheetAction } from "../mobile/MobileActionSheet";
import { isPriorityLevel, PRIORITIES, PRIORITY_LEVELS, PriorityBadge, type PriorityLevel } from "./priority";
import { threadMarkSections } from "./threadActions";
import { useAllThreads } from "./useAllThreads";
import { useLongPress, type MenuOpener } from "./useLongPress";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// "YYYY-MM-DD HH:MM" (local) → the short time the note lists use: the time
// today, the weekday this week, else the date.
function activityLabel(stamp: string): string {
  const d = new Date(stamp.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Pinned threads on top, then open ones, solved ones last; each group by
// newest activity.
const rank = (t: Thread) => (t.pinned ? 0 : t.done ? 2 : 1);

type Menu = { thread: Thread; at: MenuAnchor };

/**
 * The Threads sidebar view: every thread (personal store and vaults) —
 * pinned first, solved last, else newest activity first — with a search
 * field, a tag / priority / solved filter, and a long-press (touch) or
 * right-click (desktop) menu to pin, solve or prioritise a thread.
 */
export default function ThreadsList({
  touch = false,
  openThreadId,
}: {
  touch?: boolean;
  /** The thread showing in the thread view, highlighted. */
  openThreadId?: string | null;
}) {
  const { threads, loaded, error } = useAllThreads();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [priority, setPriority] = useState<PriorityLevel | null>(null);
  const [showSolved, setShowSolved] = useState(true);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      threads
        .map((t) => ({ thread: t, activity: lastActivity(t), tags: threadTags(t) }))
        .sort((a, b) => rank(a.thread) - rank(b.thread) || b.activity.localeCompare(a.activity)),
    [threads],
  );

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  // Only the priorities in use get a chip (plus an active one gone meanwhile).
  const priorities = useMemo(
    () => PRIORITY_LEVELS.filter((p) => p === priority || rows.some((r) => r.thread.priority === p)),
    [rows, priority],
  );
  const anySolved = rows.some((r) => r.thread.done);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!tag || r.tags.includes(tag)) &&
        (priority === null || r.thread.priority === priority) &&
        (showSolved || !r.thread.done) &&
        (!q ||
          r.thread.title.toLowerCase().includes(q) ||
          r.thread.posts.some((p) => p.text.toLowerCase().includes(q))),
    );
  }, [rows, query, tag, priority, showSolved]);

  const menuSections = (thread: Thread): SheetAction[][] => [
    [{ label: "Open", icon: <MessagesSquare size={touch ? 19 : 14} />, onClick: () => openThread(thread) }],
    ...threadMarkSections(thread, setMenuError),
  ];

  const fs = touch
    ? { title: 15, body: 13, meta: 12, input: 16 }
    : { title: 13, body: 12, meta: 11, input: 13 };

  return (
    <div className="flex flex-col pt-1">
      {/* Search */}
      <div className="px-2 pb-1.5">
        <div
          className="flex items-center gap-2 rounded-md px-2"
          style={{
            height: touch ? 40 : 30,
            background: "color-mix(in oklab, var(--foreground) 6%, transparent)",
          }}
        >
          <Search size={touch ? 16 : 14} className="shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads"
            aria-label="Search threads"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            style={{ fontSize: fs.input, color: "var(--foreground)" }}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="flex shrink-0 items-center justify-center"
              style={{ color: "var(--muted-foreground)", width: touch ? 32 : 20, height: touch ? 32 : 20 }}
            >
              <X size={touch ? 16 : 13} />
            </button>
          )}
        </div>
      </div>

      {/* Filters: every tag across the threads (the active one clears on
          tap), the priorities in use, and whether solved threads show. */}
      {(tagCounts.length > 0 || priorities.length > 0 || anySolved) && (
        <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto px-2 pb-2">
          {tag && !tagCounts.some(([name]) => name === tag) && (
            <TagChip name={tag} count={0} active touch={touch} onClick={() => setTag(null)} />
          )}
          {tagCounts.map(([name, count]) => (
            <TagChip
              key={name}
              name={name}
              count={count}
              active={tag === name}
              touch={touch}
              onClick={() => setTag(tag === name ? null : name)}
            />
          ))}
          {priorities.map((p) => {
            const { Icon, color, label } = PRIORITIES[p];
            const active = priority === p;
            return (
              <FilterChip
                key={p}
                active={active}
                touch={touch}
                title={active ? "Clear priority filter" : `Only P${p} · ${label}`}
                onClick={() => setPriority(active ? null : p)}
              >
                <Icon size={touch ? 13 : 12} style={active ? undefined : { color }} />
                <span>P{p}</span>
              </FilterChip>
            );
          })}
          {anySolved && (
            <FilterChip
              active={showSolved}
              touch={touch}
              title={showSolved ? "Hide solved threads" : "Show solved threads"}
              onClick={() => setShowSolved(!showSolved)}
            >
              <CircleCheck size={touch ? 13 : 12} style={showSolved ? undefined : { color: "#22c55e" }} />
              <span>Solved</span>
            </FilterChip>
          )}
        </div>
      )}

      {menuError && (
        <p className="flex items-start gap-2 px-3 py-2" style={{ fontSize: fs.body, color: "var(--destructive, #ef4444)" }}>
          <span className="min-w-0 flex-1">{menuError}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setMenuError(null)} className="shrink-0">
            <X size={touch ? 16 : 13} />
          </button>
        </p>
      )}

      {error && (
        <p className="px-3 py-2" style={{ fontSize: fs.body, color: "var(--muted-foreground)" }}>
          Couldn&apos;t load threads: {error}
        </p>
      )}
      {!loaded && !error && rows.length === 0 && (
        <p className="px-3 py-2" style={{ fontSize: fs.body, color: "var(--muted-foreground)" }}>
          Loading…
        </p>
      )}
      {loaded && rows.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center" style={{ color: "var(--muted-foreground)" }}>
          <MessagesSquare size={touch ? 28 : 22} style={{ opacity: 0.6 }} />
          <p style={{ fontSize: fs.title, color: "var(--foreground)", fontWeight: 500 }}>No threads yet</p>
          <p style={{ fontSize: fs.body }}>Swipe left on a quick note to start a thread.</p>
        </div>
      )}
      {loaded && rows.length > 0 && visible.length === 0 && (
        <p className="px-3 py-2" style={{ fontSize: fs.body, color: "var(--muted-foreground)" }}>
          No matching threads.
        </p>
      )}

      <ul>
        {visible.map(({ thread: t, activity, tags }) => (
          <ThreadRow
            key={`${t.vaultId}/${t.id}`}
            thread={t}
            activity={activity}
            tags={tags}
            active={t.id === openThreadId}
            touch={touch}
            fs={fs}
            onMenu={(at, via) => setMenu({ thread: t, at: { ...at, via } })}
          />
        ))}
      </ul>

      {/* Right-click with a mouse gets the desktop menu; a long press (or
          Android's touch contextmenu) the sheet. */}
      {menu && (
        <ActionMenu
          at={menu.at}
          touch={touch}
          title={menu.thread.title || "Untitled thread"}
          sections={menuSections(menu.thread)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function ThreadRow({
  thread: t,
  activity,
  tags,
  active,
  touch,
  fs,
  onMenu,
}: {
  thread: Thread;
  activity: string;
  tags: string[];
  active: boolean;
  touch: boolean;
  fs: { title: number; body: number; meta: number };
  onMenu: (at: { x: number; y: number }, via: MenuOpener) => void;
}) {
  const pressHandlers = useLongPress(onMenu);
  const snippet = threadPreview(t);
  return (
    <li>
      <button
        type="button"
        data-thread-id={t.id}
        {...pressHandlers}
        onClick={() => openThread(t)}
        className={"tree-row flex w-full select-none flex-col gap-0.5 text-left" + (active ? " tree-active" : "")}
        style={{
          minHeight: touch ? 44 : 33,
          paddingLeft: touch ? 11 : 9,
          paddingRight: touch ? 12 : 10,
          paddingTop: 7,
          paddingBottom: 7,
          borderRadius: 5,
          borderLeft: `3px solid ${isPriorityLevel(t.priority) ? PRIORITIES[t.priority].color : "transparent"}`,
          WebkitTouchCallout: "none",
        }}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          {t.pinned && <Pin size={touch ? 13 : 12} className="shrink-0" style={{ color: "var(--primary)" }} aria-label="Pinned" />}
          <span
            className={"tree-row-title min-w-0 flex-1 truncate" + (t.done ? " line-through" : "")}
            style={{
              fontSize: fs.title,
              fontWeight: 500,
              color: active ? undefined : "var(--foreground)",
              opacity: t.done ? 0.6 : undefined,
            }}
          >
            {t.title || "Untitled thread"}
          </span>
          {t.done && <CircleCheck size={touch ? 14 : 12} className="shrink-0" style={{ color: "#22c55e" }} aria-label="Solved" />}
          <span className="shrink-0 tabular-nums" style={{ fontSize: fs.meta, color: "var(--muted-foreground)" }}>
            {activityLabel(activity)}
          </span>
        </span>
        {snippet && (
          <span className="tree-card-snippet w-full" style={{ fontSize: fs.body, color: "var(--muted-foreground)" }}>
            {snippet}
          </span>
        )}
        <span
          className="flex w-full min-w-0 items-center gap-1.5 truncate"
          style={{ fontSize: fs.meta, color: "var(--muted-foreground)" }}
        >
          <PriorityBadge priority={t.priority} size={touch ? 12 : 11} />
          <span className="shrink-0">{[replyLabel(t), commentLabel(t)].filter(Boolean).join(" · ")}</span>
          {tags.slice(0, 3).map((name) => (
            <span key={name} className="truncate" style={{ color: "var(--primary)", opacity: 0.85 }}>
              #{name}
            </span>
          ))}
        </span>
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
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className="flex shrink-0 items-center gap-1 rounded-full px-2 transition-colors"
      style={{
        height: touch ? 32 : 24,
        fontSize: touch ? 13 : 12,
        color: active ? "var(--primary-foreground)" : "var(--foreground)",
        background: active ? "var(--primary)" : "color-mix(in oklab, var(--foreground) 7%, transparent)",
      }}
    >
      {children}
    </button>
  );
}

function TagChip({
  name,
  count,
  active,
  touch,
  onClick,
}: {
  name: string;
  count: number;
  active: boolean;
  touch: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? "Clear tag filter" : `Only threads with #${name}`}
      className="flex shrink-0 items-center gap-1 rounded-full px-2.5 transition-colors"
      style={{
        height: touch ? 32 : 24,
        fontSize: touch ? 13 : 12,
        color: active ? "var(--primary-foreground)" : "var(--foreground)",
        background: active ? "var(--primary)" : "color-mix(in oklab, var(--foreground) 7%, transparent)",
      }}
    >
      <span>#{name}</span>
      {count > 0 && <span style={{ opacity: 0.7 }}>{count}</span>}
      {active && <X size={touch ? 14 : 12} />}
    </button>
  );
}

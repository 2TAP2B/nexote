"use client";

import { MessagesSquare, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { lastActivity, openThread, replyLabel, threadPreview, threadTags } from "@/lib/threads";
import { useAllThreads } from "./useAllThreads";

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

/**
 * The Threads sidebar view: every thread (personal store and vaults), newest
 * activity first, with a search field and a tag filter.
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

  const rows = useMemo(
    () =>
      threads
        .map((t) => ({ thread: t, activity: lastActivity(t), tags: threadTags(t) }))
        .sort((a, b) => b.activity.localeCompare(a.activity)),
    [threads],
  );

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!tag || r.tags.includes(tag)) &&
        (!q ||
          r.thread.title.toLowerCase().includes(q) ||
          r.thread.posts.some((p) => p.text.toLowerCase().includes(q))),
    );
  }, [rows, query, tag]);

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

      {/* Tag filter: every tag across the threads; the active one clears on tap. */}
      {tagCounts.length > 0 && (
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
        </div>
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
        {visible.map(({ thread: t, activity, tags }) => {
          const active = t.id === openThreadId;
          const snippet = threadPreview(t);
          return (
            <li key={`${t.vaultId}/${t.id}`}>
              <button
                type="button"
                data-thread-id={t.id}
                onClick={() => openThread(t)}
                className={"tree-row flex w-full flex-col gap-0.5 text-left" + (active ? " tree-active" : "")}
                style={{
                  minHeight: touch ? 44 : 33,
                  paddingLeft: touch ? 14 : 12,
                  paddingRight: touch ? 12 : 10,
                  paddingTop: 7,
                  paddingBottom: 7,
                  borderRadius: 5,
                }}
              >
                <span className="flex w-full min-w-0 items-baseline gap-2">
                  <span
                    className="tree-row-title min-w-0 flex-1 truncate"
                    style={{ fontSize: fs.title, fontWeight: 500, color: active ? undefined : "var(--foreground)" }}
                  >
                    {t.title || "Untitled thread"}
                  </span>
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
                  <span className="shrink-0">{replyLabel(t)}</span>
                  {tags.slice(0, 3).map((name) => (
                    <span key={name} className="truncate" style={{ color: "var(--primary)", opacity: 0.85 }}>
                      #{name}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
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

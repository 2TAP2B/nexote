"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { NoteMeta } from "@/lib/api";
import { formatTitle, useNotes } from "@/lib/notes-context";
import { localDateKey } from "@/lib/note-utils";
import JournalCalendar from "./JournalCalendar";

const DATE_TITLE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

// A journal note's day: its title (YYYY-MM-DD, also for notes written ahead
// or after the fact), else the day it was created — like the calendar.
const dayOf = (n: Pick<NoteMeta, "title" | "createdAt">) =>
  DATE_TITLE.test(n.title) ? n.title : localDateKey(new Date(n.createdAt));

const atMidnight = (key: string) => new Date(`${key}T00:00`);

/**
 * The entry's heading in the list. The tile beside it already shows the
 * weekday and the day, so recent entries read "Today", "Yesterday",
 * "Saturday" and older ones "November 17"; a note with a title of its own
 * keeps that title.
 */
function entryTitle(n: Pick<NoteMeta, "title">, day: string, todayKey: string, dateFormat: string): string {
  if (!DATE_TITLE.test(n.title)) return n.title || "Untitled";
  if (dateFormat.trim()) return formatTitle(dateFormat.trim(), atMidnight(day));
  const days = Math.round((atMidnight(todayKey).getTime() - atMidnight(day).getTime()) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days === -1) return "Tomorrow";
  const d = atMidnight(day);
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/**
 * The Daily-notes sidebar view (desktop and phone): the journal calendar,
 * then the displayed month's entries newest first — a date tile, the day
 * and a two-line preview of what was written. In the current month, a day
 * without an entry yet starts with a "Write today's entry" row.
 */
export default function DailyNotesView({
  journalNotes,
  activeId,
  touch,
  onOpenNote,
  onOpenDaily,
}: {
  journalNotes: NoteMeta[];
  activeId: string | null;
  touch: boolean;
  onOpenNote: (id: string) => void;
  onOpenDaily: (date?: string) => void;
}) {
  const { settings } = useNotes();
  const dateFormat = settings.dailyDateFormat;
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  const onMonthChange = useCallback((year: number, month: number) => setCursor({ year, month }), []);
  // Client-only "today" (no SSR/hydration date mismatch), like the calendar.
  const [todayKey, setTodayKey] = useState<string | null>(null);
  useEffect(() => setTodayKey(localDateKey(new Date())), []);

  const monthKey = cursor ? `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}` : null;
  const entries = useMemo(
    () =>
      monthKey
        ? journalNotes
            .map((n) => ({ note: n, day: dayOf(n) }))
            .filter((e) => e.day.startsWith(monthKey))
            .sort((a, b) => b.day.localeCompare(a.day) || b.note.updatedAt.localeCompare(a.note.updatedAt))
        : [],
    [journalNotes, monthKey],
  );

  const showsToday = Boolean(todayKey && monthKey && todayKey.startsWith(monthKey));
  const todayMissing = showsToday && !entries.some((e) => e.day === todayKey);
  const monthName = cursor ? new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long" }) : "";

  const fs = touch ? { title: 15, body: 13, label: 12 } : { title: 13, body: 12, label: 11 };

  return (
    <div className="flex flex-col px-1.5 pt-1">
      <JournalCalendar onOpenJournal={onOpenNote} onOpenDay={(date) => onOpenDaily(date)} onMonthChange={onMonthChange} />

      {cursor && todayKey && (
        <section className="mt-3 flex flex-col" aria-label={`Entries in ${monthName}`}>
          <div className="flex items-baseline justify-between px-2.5 pb-1.5">
            <span
              className="font-semibold uppercase tracking-wide"
              style={{ fontSize: fs.label, color: "var(--muted-foreground)" }}
            >
              Entries
            </span>
            {entries.length > 0 && (
              <span className="tabular-nums" style={{ fontSize: fs.label, color: "var(--muted-foreground)" }}>
                {entries.length}
              </span>
            )}
          </div>

          <ul className="flex flex-col gap-0.5">
            {todayMissing && (
              <li>
                <EntryRow
                  touch={touch}
                  fs={fs}
                  tile={<DateTile day={todayKey} touch={touch} today placeholder />}
                  title="Today"
                  preview={<span style={{ color: "var(--primary)" }}>Write today&apos;s entry</span>}
                  active={false}
                  onClick={() => onOpenDaily()}
                />
              </li>
            )}
            {entries.map(({ note, day }) => (
              <li key={note.id}>
                <EntryRow
                  touch={touch}
                  fs={fs}
                  tile={<DateTile day={day} touch={touch} today={day === todayKey} />}
                  title={entryTitle(note, day, todayKey, dateFormat)}
                  preview={
                    note.snippet ? (
                      note.snippet
                    ) : (
                      <span className="italic" style={{ opacity: 0.7 }}>
                        Nothing written yet
                      </span>
                    )
                  }
                  active={note.id === activeId}
                  onClick={() => onOpenNote(note.id)}
                />
              </li>
            ))}
          </ul>

          {entries.length === 0 && !todayMissing && (
            <p className="px-2.5 py-2" style={{ fontSize: fs.body, color: "var(--muted-foreground)" }}>
              No entries in {monthName}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function EntryRow({
  touch,
  fs,
  tile,
  title,
  preview,
  active,
  onClick,
}: {
  touch: boolean;
  fs: { title: number; body: number };
  tile: React.ReactNode;
  title: string;
  preview: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={"tree-row flex w-full items-start gap-3 text-left" + (active ? " tree-active" : "")}
      style={{ padding: touch ? "8px 10px" : "6px 8px", borderRadius: 8 }}
    >
      {tile}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5" style={{ paddingTop: touch ? 3 : 2 }}>
        <span
          className="tree-row-title truncate"
          style={{ fontSize: fs.title, fontWeight: 500, color: active ? undefined : "var(--foreground)" }}
        >
          {title}
        </span>
        <span className="line-clamp-2 break-words leading-snug" style={{ fontSize: fs.body, color: "var(--muted-foreground)" }}>
          {preview}
        </span>
      </span>
    </button>
  );
}

/**
 * Weekday and day of an entry, like a tear-off calendar sheet. Today's is
 * filled with the accent (as in the calendar above); the "write today's
 * entry" row gets a dashed outline with a plus.
 */
function DateTile({
  day,
  touch,
  today = false,
  placeholder = false,
}: {
  day: string;
  touch: boolean;
  today?: boolean;
  placeholder?: boolean;
}) {
  const d = atMidnight(day);
  const size = touch ? { w: 46, h: 50, num: 18, wd: 10 } : { w: 38, h: 42, num: 15, wd: 9 };
  return (
    <span
      aria-hidden
      className="flex shrink-0 flex-col items-center justify-center"
      style={{
        width: size.w,
        height: size.h,
        borderRadius: 10,
        background: placeholder ? "transparent" : today ? "var(--primary)" : "color-mix(in oklab, var(--foreground) 6%, transparent)",
        border: placeholder ? "1.5px dashed color-mix(in oklab, var(--primary) 60%, transparent)" : undefined,
        color: placeholder ? "var(--primary)" : today ? "var(--primary-foreground)" : "var(--foreground)",
      }}
    >
      {placeholder ? (
        <Plus size={touch ? 20 : 17} />
      ) : (
        <>
          <span
            className="font-semibold uppercase leading-none tracking-wide"
            style={{ fontSize: size.wd, opacity: today ? 0.85 : 0.55 }}
          >
            {d.toLocaleDateString(undefined, { weekday: "short" })}
          </span>
          <span className="font-semibold leading-none tabular-nums" style={{ fontSize: size.num, marginTop: 3 }}>
            {d.getDate()}
          </span>
        </>
      )}
    </span>
  );
}

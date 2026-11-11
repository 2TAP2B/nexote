"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { localDateKey } from "@/lib/note-utils";
import { useNotes } from "@/lib/notes-context";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DATE_TITLE = /^\d{4}-\d{2}-\d{2}$/;

// Month calendar for the journal, shared by the desktop dashboard and the
// Daily-notes sidebar view (desktop + mobile). Today is filled; days with a
// journal note carry a dot and open it; any other day (past or future)
// creates its note.
export default function JournalCalendar({
  onOpenJournal,
  onOpenDay,
  onMonthChange,
}: {
  onOpenJournal: (id: string) => void;
  onOpenDay: (date: string) => void;
  // Fires with the displayed month (0-based) whenever it changes.
  onMonthChange?: (year: number, month: number) => void;
}) {
  const { journalNotes } = useNotes();
  // Client-only "today": avoids an SSR/hydration date mismatch.
  const [today, setToday] = useState<Date | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => setToday(new Date()), []);

  // Journal notes are titled by their day (YYYY-MM-DD), which also covers
  // notes created ahead of / after the fact; others fall back to their
  // creation day. Newest edit wins a collision.
  const journalByDay = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of [...journalNotes].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
      map.set(DATE_TITLE.test(j.title) ? j.title : localDateKey(new Date(j.createdAt)), j.id);
    }
    return map;
  }, [journalNotes]);

  const month = today ? new Date(today.getFullYear(), today.getMonth() + offset, 1) : null;
  const monthYear = month?.getFullYear();
  const monthIndex = month?.getMonth();
  useEffect(() => {
    if (monthYear !== undefined && monthIndex !== undefined) onMonthChange?.(monthYear, monthIndex);
  }, [monthYear, monthIndex, onMonthChange]);

  if (!today || !month) return null;

  const lead = (month.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const todayKey = localDateKey(today);
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 px-1">
        <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
        {/* The month title doubles as "jump to today" (primary while away
            from the current month), so the header fits the narrow sidebar. */}
        <button
          type="button"
          title="Jump to today"
          onClick={() => setOffset(0)}
          className={`min-w-0 flex-1 truncate rounded-md text-left text-sm font-semibold hover:underline ${offset !== 0 ? "text-primary" : "text-foreground"}`}
        >
          {month.toLocaleDateString(undefined, { month: "long" })}{" "}
          <span className="font-normal opacity-60">{month.getFullYear()}</span>
        </button>
        <button type="button" aria-label="Previous month" onClick={() => setOffset((o) => o - 1)} className="rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Next month" onClick={() => setOffset((o) => o + 1)} className="rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1 text-[10px] font-medium uppercase text-muted-foreground/70">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`pad-${i}`} />;
          const key = localDateKey(d);
          const journalId = journalByDay.get(key);
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              title={journalId ? `Open journal ${key}` : `Create journal note for ${key}`}
              onClick={() => (journalId ? onOpenJournal(journalId) : onOpenDay(key))}
              className={`group relative flex aspect-square items-center justify-center rounded-md text-xs tabular-nums transition-colors ${
                journalId ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {/* Inner highlight, inset from the cell so it never touches
                  neighbouring cells. Only today is filled; journal days show
                  their dot marker below the number. */}
              <span
                className={`absolute inset-[3px] rounded-[7px] ${
                  isToday ? "bg-primary" : "group-hover:ring-1 group-hover:ring-primary/50"
                }`}
              />
              <span className={`relative ${isToday ? "font-semibold text-primary-foreground" : ""}`}>{d.getDate()}</span>
              {journalId && (
                <span className={`absolute bottom-1 h-1 w-1 rounded-full ${isToday ? "bg-primary-foreground" : "bg-primary"}`} />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

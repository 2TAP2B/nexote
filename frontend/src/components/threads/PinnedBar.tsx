"use client";

import { ChevronRight, Pin } from "lucide-react";
import { useState, type ReactNode } from "react";

import { BottomSheet } from "../mobile/BottomSheet";

export type PinnedItem = {
  key: string;
  text: string;
  /** Small line under it in the list (time, kind). */
  sub?: string;
  /** Extra mark before the text (thread icon, priority badge). */
  icon?: ReactNode;
  done?: boolean;
  onSelect: () => void;
};

/**
 * Pinned memos, threads or posts, Telegram style: a slim bar under the
 * header shows the first pinned item and how many there are; tapping it
 * opens the whole list, and picking one jumps to it (or opens it).
 */
export function PinnedBar({ items, title = "Pinned" }: { items: PinnedItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const first = items[0];
  return (
    <>
      <button
        type="button"
        onClick={() => (items.length === 1 ? first.onSelect() : setOpen(true))}
        aria-label={items.length === 1 ? `Pinned: ${first.text}` : `${items.length} pinned`}
        className="flex w-full shrink-0 items-center gap-2 px-3 py-1.5 text-left text-[13px] active:opacity-70"
        style={{ borderBottom: "1px solid var(--mob-surface, var(--border))", color: "var(--mob-text, var(--foreground))" }}
      >
        <Pin size={14} className="shrink-0" style={{ color: "var(--mob-accent, var(--primary))" }} />
        {first.icon}
        <span className={"min-w-0 flex-1 truncate" + (first.done ? " line-through opacity-60" : "")}>{first.text}</span>
        {items.length > 1 && (
          <span className="flex shrink-0 items-center gap-0.5 text-xs" style={{ color: "var(--mob-muted, var(--muted-foreground))" }}>
            {items.length}
            <ChevronRight size={14} />
          </span>
        )}
      </button>
      {open && (
        <BottomSheet title={title} subtitle={`${items.length} pinned`} onClose={() => setOpen(false)}>
          {({ closeNow }) => (
            <ul className="mx-3 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl bg-muted/60">
              {items.map((item, i) => (
                <li key={item.key}>
                  {i > 0 && <div aria-hidden className="ml-11 border-t border-border/70" />}
                  <button
                    type="button"
                    onClick={() => {
                      closeNow();
                      item.onSelect();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted"
                  >
                    <Pin size={16} className="shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {item.icon}
                        <span className={"truncate text-[15px]" + (item.done ? " line-through opacity-60" : "")}>{item.text}</span>
                      </span>
                      {item.sub && <span className="truncate text-xs text-muted-foreground">{item.sub}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </BottomSheet>
      )}
    </>
  );
}

"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { BottomSheet } from "./BottomSheet";

export type SheetAction = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  checked?: boolean;
};

/**
 * Obsidian-style mobile menu: a bottom sheet (see BottomSheet) with actions
 * in rounded groups.
 */
export function MobileActionSheet({
  title,
  subtitle,
  sections,
  onClose,
}: {
  title?: string;
  subtitle?: string;
  /** Groups of actions; empty groups are skipped. */
  sections: SheetAction[][];
  onClose: () => void;
}) {
  const groups = sections.filter((s) => s.length > 0);
  return (
    <BottomSheet title={title} subtitle={subtitle} onClose={onClose}>
      {({ closeNow }) => (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3">
          {groups.map((group, i) => (
            <ul key={i} className="shrink-0 overflow-hidden rounded-xl bg-muted/60">
              {group.map((action, j) => (
                // Labels may repeat (two threads with one title); the list is fixed while shown.
                <li key={`${j}-${action.label}`}>
                  {j > 0 && <div aria-hidden className="ml-[52px] border-t border-border/70" />}
                  <button
                    type="button"
                    // Actions close at once: they may open a sheet or dialog of their own.
                    onClick={() => {
                      closeNow();
                      action.onClick();
                    }}
                    className={
                      "flex w-full items-center gap-4 px-4 py-3 text-left text-[15px] transition-colors active:bg-muted" +
                      (action.danger ? " text-red-600 dark:text-red-400" : "")
                    }
                  >
                    <span className={"flex w-5 shrink-0 justify-center" + (action.danger ? "" : " text-muted-foreground")}>
                      {action.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    {action.checked && <Check size={18} className="shrink-0 text-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

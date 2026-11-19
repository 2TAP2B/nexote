"use client";

import { ChevronDown, ChevronsUp, Equal, Flame, Moon, type LucideIcon } from "lucide-react";

// Priorities for threads and their posts: 1 is the most urgent. Each has a
// color and an icon, so a list reads at a glance (and without color vision).

export type PriorityLevel = 1 | 2 | 3 | 4 | 5;

export const PRIORITIES: Record<PriorityLevel, { label: string; color: string; Icon: LucideIcon }> = {
  1: { label: "Critical", color: "#ef4444", Icon: Flame },
  2: { label: "High", color: "#f97316", Icon: ChevronsUp },
  3: { label: "Medium", color: "#eab308", Icon: Equal },
  4: { label: "Low", color: "#3b82f6", Icon: ChevronDown },
  5: { label: "Someday", color: "#94a3b8", Icon: Moon },
};

export const PRIORITY_LEVELS: PriorityLevel[] = [1, 2, 3, 4, 5];

export function isPriorityLevel(p: number): p is PriorityLevel {
  return p >= 1 && p <= 5 && Number.isInteger(p);
}

/** Icon plus "P2" in the priority's color; nothing for no priority. */
export function PriorityBadge({ priority, size = 12, label = false }: { priority: number; size?: number; label?: boolean }) {
  if (!isPriorityLevel(priority)) return null;
  const { Icon, color, label: name } = PRIORITIES[priority];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
      title={`Priority ${priority} · ${name}`}
    >
      <Icon size={size} strokeWidth={2.5} />P{priority}
      {label && <span className="font-medium">· {name}</span>}
    </span>
  );
}

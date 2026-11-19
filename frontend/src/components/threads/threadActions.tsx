"use client";

import { CircleCheck, CircleSlash, Pin, PinOff, RotateCcw } from "lucide-react";

import { setThreadMeta, type PostFlags, type Thread } from "@/lib/threads";
import type { SheetAction } from "../mobile/MobileActionSheet";
import { PRIORITIES, PRIORITY_LEVELS } from "./priority";

// The pin / priority / solved entries for a thread or a thread post, the
// same in every menu: the thread view's More menu, a thread card's or row's
// long press, a post's selection actions. Groups for MobileActionSheet; the
// desktop context menu flattens them.

type Marks = { pinned: boolean; priority: number; done: boolean };

/** Entries that change marks via `apply` (a thread's frontmatter or a post's heading). */
export function markSections(marks: Marks, apply: (patch: Partial<PostFlags>) => void, noun: "thread" | "post"): SheetAction[][] {
  return [
    [
      marks.pinned
        ? { label: "Unpin", icon: <PinOff size={19} />, onClick: () => apply({ pinned: false }) }
        : { label: "Pin", icon: <Pin size={19} />, onClick: () => apply({ pinned: true }) },
      marks.done
        ? { label: "Reopen", icon: <RotateCcw size={19} />, onClick: () => apply({ done: false }) }
        : { label: noun === "thread" ? "Mark as solved" : "Mark as done", icon: <CircleCheck size={19} />, onClick: () => apply({ done: true }) },
    ],
    [
      ...PRIORITY_LEVELS.map((level): SheetAction => {
        const { label, color, Icon } = PRIORITIES[level];
        return {
          label: `P${level} · ${label}`,
          icon: <Icon size={19} style={{ color }} />,
          checked: marks.priority === level,
          onClick: () => apply({ priority: marks.priority === level ? 0 : level }),
        };
      }),
      ...(marks.priority
        ? [{ label: "No priority", icon: <CircleSlash size={19} />, onClick: () => apply({ priority: 0 }) }]
        : []),
    ],
  ];
}

/** The mark entries for a whole thread (saved to its frontmatter). */
export function threadMarkSections(thread: Thread, onError?: (message: string) => void): SheetAction[][] {
  return markSections(
    thread,
    (patch) =>
      void setThreadMeta(thread, patch).catch((e: unknown) =>
        onError?.(e instanceof Error ? e.message : "Couldn't change the thread"),
      ),
    "thread",
  );
}

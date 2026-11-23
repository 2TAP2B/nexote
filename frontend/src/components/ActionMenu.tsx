"use client";

import { Check } from "lucide-react";

import ContextMenu, { type MenuItem } from "./ContextMenu";
import { MobileActionSheet, type SheetAction } from "./mobile/MobileActionSheet";

/**
 * Where a menu was asked for: a touch long press, a right-click (Android's
 * long press fires that too) or a desktop button (the menu sits under it).
 */
export type MenuAnchor = { x: number; y: number; via: "press" | "contextmenu" | "button" };

/** The anchor for a menu opened by a button: right-aligned under it. */
export function anchorBelow(el: Element): MenuAnchor {
  const r = el.getBoundingClientRect();
  return { x: Math.max(8, r.right - 220), y: r.bottom + 6, via: "button" };
}

/** Sheet groups → one desktop menu: separators between groups, a check on the current choice. */
export function flattenSections(sections: SheetAction[][]): MenuItem[] {
  return sections
    .filter((s) => s.length > 0)
    .flatMap((group, i) => [
      ...(i > 0 ? [{ label: "", onClick: () => {}, separator: true }] : []),
      ...group.map(
        (a): MenuItem => ({
          label: a.label,
          icon: a.checked ? <Check size={14} /> : a.icon,
          onClick: a.onClick,
          danger: a.danger,
        }),
      ),
    ]);
}

/**
 * One menu, two shapes: a mouse (right-click or a desktop button) gets the
 * small desktop menu at the pointer, a finger the bottom sheet. Sections are
 * the sheet's groups; the desktop menu separates them with lines.
 */
export function ActionMenu({
  at,
  touch,
  title,
  subtitle,
  sections,
  onClose,
}: {
  at: MenuAnchor;
  /** The touch shell: always the sheet. */
  touch: boolean;
  title?: string;
  subtitle?: string;
  sections: SheetAction[][];
  onClose: () => void;
}) {
  if (!touch && at.via !== "press") {
    return <ContextMenu x={at.x} y={at.y} items={flattenSections(sections)} onClose={onClose} />;
  }
  return <MobileActionSheet title={title} subtitle={subtitle} sections={sections} onClose={onClose} />;
}

"use client";

import { ListTree } from "lucide-react";

import type { TocHeading } from "@/components/MilkdownEditor";

export const TOC_HEADING_SELECTOR =
  ".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6";

type Props = {
  headings: TocHeading[];
  activeIndex: number;
  variant: "mobile" | "desktop";
  onSelect: (index: number) => void;
};

// Presentational table-of-contents list. The mobile pane and the desktop
// docked panel share the row rendering; `variant` just selects the styling
// variables (mobile --mob-* tokens vs desktop theme tokens).
export default function TocList({ headings, activeIndex, variant, onSelect }: Props) {
  if (headings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <ListTree
          className={variant === "desktop" ? "h-6 w-6" : ""}
          style={variant === "desktop" ? { color: "var(--muted-foreground)" } : { color: "var(--mob-muted)" }}
          aria-hidden
        />
        <p
          className={variant === "desktop" ? "text-xs" : "text-[13px]"}
          style={variant === "desktop" ? { color: "var(--muted-foreground)" } : { color: "var(--mob-muted)" }}
        >
          No headings yet
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {headings.map((h, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={`${h.pos}-${i}`}
            type="button"
            onClick={() => onSelect(i)}
            aria-current={active ? "true" : undefined}
            className={
              variant === "desktop"
                ? "flex w-full items-center rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-muted/60"
                : "flex w-full items-center rounded-lg px-2 py-2 text-left transition-opacity active:opacity-70"
            }
            style={
              variant === "desktop"
                ? active
                  ? {
                      background: "color-mix(in oklab, var(--primary) 12%, transparent)",
                      color: "var(--primary)",
                      fontWeight: 600,
                      paddingLeft: 8 + (h.level - 1) * 12,
                    }
                  : { color: "var(--muted-foreground)", paddingLeft: 8 + (h.level - 1) * 12 }
                : {
                    paddingLeft: 8 + (h.level - 1) * 12,
                    background: active
                      ? "color-mix(in srgb, var(--mob-accent) 14%, transparent)"
                      : "transparent",
                    color: active ? "var(--mob-accent)" : "var(--mob-text)",
                    fontWeight: active ? 600 : 400,
                  }
            }
          >
            <span className="min-w-0 flex-1 truncate">{h.text}</span>
          </button>
        );
      })}
    </div>
  );
}
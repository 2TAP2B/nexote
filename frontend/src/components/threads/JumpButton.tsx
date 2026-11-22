"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";

/**
 * Whether a scroller is away from an edge: "bottom" for chat-like lists
 * (newest at the bottom), "top" for notes. `threshold` is how far, in px.
 */
export function useScrolledAway(
  ref: RefObject<HTMLElement | null>,
  edge: "top" | "bottom",
  threshold = 240,
): { away: boolean; setAway: (v: boolean) => void } {
  const [away, setAway] = useState(false);
  // Re-attached after every render: the scroller may mount later (a note
  // opened after the dashboard), and content changes come with renders, so
  // the check right here also catches new posts. Listening is cheap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const fromEdge = edge === "top" ? el.scrollTop : el.scrollHeight - el.clientHeight - el.scrollTop;
      setAway(fromEdge > threshold);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  });
  return { away, setAway };
}

/**
 * A small round button that jumps to the latest post or to the top. Kept
 * small and quiet so it doesn't pull the eye away from the text; it only
 * shows when the scroller is away from that edge.
 */
export function JumpButton({
  show,
  direction,
  label,
  onClick,
  className = "",
  style,
}: {
  show: boolean;
  direction: "up" | "down";
  label: string;
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      onClick={onClick}
      className={
        "flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-all duration-200 active:scale-95 " +
        (show ? "pointer-events-auto opacity-80 hover:opacity-100" : "pointer-events-none translate-y-2 opacity-0") +
        " " +
        className
      }
      style={{
        background: "color-mix(in srgb, var(--background) 85%, transparent)",
        borderColor: "var(--border)",
        color: "var(--muted-foreground)",
        ...style,
      }}
    >
      <Icon size={15} />
    </button>
  );
}

"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

// A three-state light/dark/system toggle. next-themes handles persistence
// and applying the `.dark` class; this component just renders the current
// state and cycles it.
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid a hydration mismatch: next-themes resolves the theme on the client
  // only, so render a stable placeholder until mounted.
  useEffect(() => setMounted(true), []);

  const next = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const label = mounted ? (theme ?? "system") : "system";
  const icon = !mounted
    ? "◯"
    : label === "light"
      ? "☀"
      : label === "dark"
        ? "☾"
        : "◯";

  return (
    <button
      type="button"
      onClick={next}
      aria-label={`Theme: ${label}. Click to cycle.`}
      title={`Theme: ${label}`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}
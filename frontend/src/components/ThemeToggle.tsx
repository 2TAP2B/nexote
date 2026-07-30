"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

// A three-state light/dark/system toggle. next-themes handles persistence and
// applying the `.dark` class; this component renders the current state with a
// lucide icon and cycles it.
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
  const Icon = !mounted
    ? Monitor
    : label === "light"
      ? Sun
      : label === "dark"
        ? Moon
        : Monitor;

  return (
    <button
      type="button"
      onClick={next}
      aria-label={`Theme: ${label}. Click to cycle.`}
      title={`Theme: ${label}`}
      className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
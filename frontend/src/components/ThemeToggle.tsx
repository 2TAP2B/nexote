"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

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
      className="flex h-9 w-9 items-center justify-center text-muted-foreground/85 transition-colors hover:text-foreground rounded-md hover:bg-white/5"
    >
      <Icon size={18} />
    </button>
  );
}

"use client";

import {
  CalendarDays,
  ClipboardList,
  Code2,
  Copy,
  FileStack,
  GitGraph,
  LayoutDashboard,
  Terminal,
  Upload,
} from "lucide-react";

import ThemeToggle from "./ThemeToggle";

type RibbonProps = {
  onCommandPalette: () => void;
  onDaily: () => void;
};

export default function Ribbon({ onCommandPalette, onDaily }: RibbonProps) {
  const icons: { icon: typeof FileStack; label: string; onClick: () => void }[] = [
    { icon: FileStack, label: "Vault", onClick: () => {} },
    { icon: GitGraph, label: "Graph view", onClick: () => {} },
    { icon: LayoutDashboard, label: "Dashboard", onClick: () => {} },
    { icon: CalendarDays, label: "Calendar", onClick: onDaily },
    { icon: Copy, label: "Pages", onClick: () => {} },
    { icon: Terminal, label: "Command palette", onClick: onCommandPalette },
    { icon: ClipboardList, label: "Checklist", onClick: () => {} },
    { icon: Upload, label: "Upload", onClick: () => {} },
  ];

  return (
    <div
      className="flex h-full w-10 shrink-0 flex-col items-center pt-1"
      style={{ background: "var(--icon-rail)", borderRight: "1px solid var(--border)" }}
    >
      {icons.map((it) => (
        <button
          key={it.label}
          type="button"
          aria-label={it.label}
          title={it.label}
          onClick={it.onClick}
          className="flex h-9 w-9 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground rounded-md hover:bg-white/5"
        >
          <it.icon size={18} />
        </button>
      ))}

      <div className="flex-1" />

      <div className="flex flex-col items-center pb-2 gap-0.5">
        <button
          type="button"
          aria-label="Code"
          title="Code"
          className="flex h-9 w-9 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground rounded-md hover:bg-white/5"
        >
          <Code2 size={18} />
        </button>
        <ThemeToggle />
      </div>
    </div>
  );
}

"use client";

import {
  ArrowRight,
  CalendarDays,
  Disc3,
  FilePlus,
  FileText,
  Keyboard,
  LayoutDashboard,
  PanelLeftClose,
  Search,
} from "lucide-react";
import { useState } from "react";

import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";
import VinylFormDialog from "./VinylFormDialog";
import VinylGallery from "./VinylGallery";

type Props = {
  onOpenPalette?: () => void;
};

type Action = {
  label: string;
  hint: string;
  icon: React.ReactNode;
  run: () => void;
};

export default function WelcomeDashboard({ onOpenPalette }: Props) {
  const { notes, openTab, openNoteInVault, create, openDaily } = useNotes();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const openPalette = () => {
    if (onOpenPalette) {
      onOpenPalette();
    } else {
      window.dispatchEvent(new CustomEvent("nexote:open-palette"));
    }
  };

  const actions: Action[] = [
    {
      label: "Create new note",
      hint: "Ctrl+Shift+N",
      icon: <FilePlus className="h-5 w-5" />,
      run: () => void create(),
    },
    {
      label: "Open today's daily note",
      hint: "Ctrl+D",
      icon: <CalendarDays className="h-5 w-5" />,
      run: () => void openDaily(),
    },
    {
      label: "Search notes",
      hint: "Ctrl+P",
      icon: <Search className="h-5 w-5" />,
      run: openPalette,
    },
    {
      label: "Toggle sidebar",
      hint: "Ctrl+B",
      icon: <PanelLeftClose className="h-5 w-5" />,
      run: () =>
        window.dispatchEvent(new CustomEvent("nexote:toggle-sidebar")),
    },
  ];

  const recent = [...notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);

  return (
    <main className="flex flex-1 items-start justify-center overflow-y-auto bg-background p-6 md:p-10">
      <div className="flex w-full max-w-3xl flex-col gap-8">
        {/* Hero */}
        <div className="flex flex-col items-center gap-2 pt-4 text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: "var(--muted)" }}
          >
            <FileText className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: "var(--foreground)" }}
          >
            Welcome to Nexote
          </h1>
          <p className="text-sm text-muted-foreground">
            A markdown note-taking app. Create a note, open today's journal, or
            search your vault.
          </p>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.run}
              className="group flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors group-hover:text-primary">
                {action.icon}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground">
                  {action.label}
                </span>
                <kbd className="mt-0.5 w-fit rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                  {action.hint}
                </kbd>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary" />
            </button>
          ))}
        </div>

        {/* Vinyl collection */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            className="group flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Disc3 className="h-5 w-5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-foreground">
                Vinyl collection
              </span>
              <span className="mt-0.5 text-xs text-muted-foreground">
                Browse the cover gallery
              </span>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary" />
          </button>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="group flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Disc3 className="h-5 w-5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-foreground">
                New vinyl
              </span>
              <span className="mt-0.5 text-xs text-muted-foreground">
                Add an album to your collection
              </span>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary" />
          </button>
        </div>

        {/* Recent notes */}
        {recent.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-muted-foreground">
                Recent notes
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {recent.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void openTab(n.id)}
                  className="group flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">
                      {n.title || "Untitled"}
                    </span>
                    {n.path && (
                      <span className="truncate text-xs text-muted-foreground/60">
                        {n.path}
                      </span>
                    )}
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Keyboard shortcuts reference */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-muted-foreground">
              Keyboard shortcuts
            </h2>
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["Ctrl+Shift+N", "Create new note"],
                  ["Ctrl+D", "Open daily note"],
                  ["Ctrl+Shift+D", "Open dashboard"],
                  ["Ctrl+P", "Command palette / search"],
                  ["Ctrl+S", "Save current note"],
                  ["Ctrl+W", "Close tab"],
                  ["Ctrl+Tab", "Next tab"],
                  ["Ctrl+B", "Toggle sidebar"],
                  ["Esc", "Close dialog"],
                ].map(([key, label]) => (
                  <tr key={key} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-muted-foreground">
                      {label}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                        {key}
                      </kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <VinylGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onOpenNote={(vaultId, id) => void openNoteInVault(vaultId, id)}
      />
      <VinylFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => setGalleryOpen(false)}
      />
    </main>
  );
}
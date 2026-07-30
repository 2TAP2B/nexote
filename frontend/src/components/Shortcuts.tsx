"use client";

import { useEffect } from "react";

import { useNotes } from "@/lib/notes-context";

type ShortcutsProps = {
  onOpenPalette: () => void;
};

// Global keyboard shortcuts, active inside the NotesProvider:
//   Cmd/Ctrl+N  create a new note
//   Cmd/Ctrl+S  force-save the current note (prevents the browser save dialog)
//   Cmd/Ctrl+P  open the command palette (prevents the browser print dialog)
// The handler reads the freshest draft from the provider, so it works even
// while the EditorPane debounce timer is still pending.
export default function Shortcuts({ onOpenPalette }: ShortcutsProps) {
  const { create, forceSave, activeId } = useNotes();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        void create();
        return;
      }
      if (e.key === "s" || e.key === "S") {
        if (!activeId) return;
        e.preventDefault();
        void forceSave();
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        onOpenPalette();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [create, forceSave, activeId, onOpenPalette]);

  return null;
}
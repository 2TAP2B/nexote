"use client";

import { useEffect } from "react";

import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";
import { useCanEdit } from "@/components/useCanEdit";

type ShortcutsProps = {
  onOpenPalette: () => void;
};

// Global keyboard shortcuts, active inside the NotesProvider:
//   Cmd/Ctrl+Shift+N  create a new note (Shift needed — Ctrl+N is reserved by the browser)
//   Cmd/Ctrl+S        force-save the current note
//   Cmd/Ctrl+P        open the command palette (quick switcher)
//   Cmd/Ctrl+Shift+P  open the command palette
//   Cmd/Ctrl+W        close the active tab
//   Cmd/Ctrl+Tab      cycle to the next open tab
//   Cmd/Ctrl+Shift+Tab  cycle to the previous open tab
//   Cmd/Ctrl+B        toggle the sidebar
//   Cmd/Ctrl+\        toggle the sidebar (alias, like VS Code)
//   Cmd/Ctrl+D        open today's daily note (may conflict with bookmark in some browsers)
//   Cmd/Ctrl+Shift+F  open the command palette (search across notes)
//   Cmd/Ctrl+Shift+D  open the dashboard (pinned tab)
//   Cmd/Ctrl+Shift+L  jump back to the note tree from the editor
//   Escape            close command palette / dialogs (handled by those components)
//                    — also returns focus to the tree when the editor is focused
export default function Shortcuts({ onOpenPalette }: ShortcutsProps) {
  const { create, forceSave, activeId, closeTab, openTabs, openTab, openDaily } =
    useNotes();
  const { canEditNote } = useCanEdit();

  // Ctrl/Cmd+Shift+L — jump back to the note tree from anywhere (editor,
  // dashboard, etc.). Always available, regardless of focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "l" && e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("nexote:focus-tree"));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      // Ctrl/Cmd+Shift+N — new note.
      // Plain Ctrl+N is reserved by the browser (opens a new window) and the
      // keydown event never reaches JavaScript, so we use Shift+N instead.
      if (key === "n" && e.shiftKey) {
        e.preventDefault();
        document.getElementById("nexote-new-note-btn")?.click();
        return;
      }

      // Ctrl/Cmd+S — force save
      if (key === "s" && !e.shiftKey && !e.altKey) {
        if (activeId) {
          e.preventDefault();
          if (canEditNote(activeId)) void forceSave();
        }
        return;
      }

      // Ctrl/Cmd+P or Ctrl/Cmd+Shift+P — command palette
      if (key === "p") {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Ctrl/Cmd+Shift+F — command palette (search across notes)
      if (key === "f" && e.shiftKey) {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Ctrl/Cmd+W — close active tab
      if (key === "w" && !e.shiftKey && !e.altKey) {
        if (activeId) {
          e.preventDefault();
          closeTab(activeId);
        }
        return;
      }

      // Ctrl/Cmd+Tab — next tab; Ctrl/Cmd+Shift+Tab — previous tab
      if (key === "tab") {
        if (openTabs.length < 2) return;
        e.preventDefault();
        const idx = activeId ? openTabs.indexOf(activeId) : -1;
        if (e.shiftKey) {
          const prev = idx <= 0 ? openTabs.length - 1 : idx - 1;
          void openTab(openTabs[prev]);
        } else {
          const next = idx < 0 ? 0 : (idx + 1) % openTabs.length;
          void openTab(openTabs[next]);
        }
        return;
      }

      // Ctrl/Cmd+B or Ctrl/Cmd+\ — toggle sidebar
      if (key === "b" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("nexote:toggle-sidebar"));
        return;
      }

      if (key === "\\" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("nexote:toggle-sidebar"));
        return;
      }

      // Ctrl/Cmd+D — daily note
      if (key === "d" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void openDaily();
        return;
      }

      // Ctrl/Cmd+Shift+D — open dashboard (pinned tab)
      if (key === "d" && e.shiftKey) {
        e.preventDefault();
        void openTab(DASHBOARD_ID);
        return;
      }
    };

    // Use capture phase so we intercept before the browser's built-in
    // shortcuts (especially Ctrl+N for new window).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    create,
    forceSave,
    activeId,
    canEditNote,
    closeTab,
    openTabs,
    openTab,
    openDaily,
    onOpenPalette,
  ]);

  return null;
}
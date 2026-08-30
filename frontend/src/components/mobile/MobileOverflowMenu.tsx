"use client";

import {
  Bookmark,
  BookmarkCheck,
  Copy,
  Edit3,
  FolderInput,
  History,
  Sparkles,
  SquareArrowOutUpRight,
  Star,
  Trash2,
} from "lucide-react";

import ContextMenu, { type MenuItem } from "@/components/ContextMenu";
import { generateNoteTitle } from "@/lib/ai";
import { replaceOrAddTitleHeading } from "@/lib/note-utils";
import { useNotes } from "@/lib/notes-context";

type Props = {
  x: number;
  y: number;
  noteId: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  onMoveTo: (id: string) => void;
  onRename: (id: string) => void;
  onHistory: (id: string) => void;
};

// The ⋮ overflow menu for the currently open note. Mirrors the desktop
// note-row context menu, dispatching to the same NotesProvider actions.
export default function MobileOverflowMenu({
  x,
  y,
  noteId,
  onClose,
  onDelete,
  onMoveTo,
  onRename,
  onHistory,
}: Props) {
  const {
    bookmarks,
    shortcuts,
    toggleBookmark,
    toggleShortcut,
    copyNote,
    openTab,
    save,
    settings,
    notesById,
  } = useNotes();

  const isBookmarked = bookmarks.has(noteId);
  const isShortcut = shortcuts.has(noteId);

  const handleGenerateTitle = async () => {
    onClose();
    const body = notesById[noteId]?.body ?? "";
    if (!body.trim() || !settings.aiBaseUrl.trim()) return;
    try {
      const title = await generateNoteTitle(
        {
          baseUrl: settings.aiBaseUrl,
          apiKey: settings.aiApiKey,
          model: settings.aiModel,
        },
        body,
      );
      if (!title) return;
      await save(noteId, { title, body: replaceOrAddTitleHeading(body, title) });
    } catch (e) {
      console.error("[nexote-ai]", e instanceof Error ? e.message : String(e));
    }
  };

  const hasAI = Boolean(settings.aiBaseUrl.trim());

  const items: MenuItem[] = [
    {
      label: "Open in new tab",
      icon: <SquareArrowOutUpRight className="h-4 w-4" />,
      onClick: () => void openTab(noteId),
    },
    { label: "", onClick: () => {}, separator: true },
    {
      label: "Make a copy",
      icon: <Copy className="h-4 w-4" />,
      onClick: () => void copyNote(noteId),
    },
    {
      label: "Note history",
      icon: <History className="h-4 w-4" />,
      onClick: () => onHistory(noteId),
    },
    ...(hasAI
      ? [{
          label: "Generate AI title",
          icon: <Sparkles className="h-4 w-4" />,
          onClick: () => void handleGenerateTitle(),
        }]
      : []),
    {
      label: "Move to…",
      icon: <FolderInput className="h-4 w-4" />,
      onClick: () => onMoveTo(noteId),
    },
    {
      label: isShortcut ? "Remove shortcut" : "Add shortcut",
      icon: isShortcut ? <BookmarkCheck className="h-4 w-4" /> : <Star className="h-4 w-4" />,
      onClick: () => toggleShortcut(noteId),
    },
    {
      label: isBookmarked ? "Remove from bookmarks" : "Add to bookmarks",
      icon: <Bookmark className="h-4 w-4" />,
      onClick: () => toggleBookmark(noteId),
    },
    { label: "", onClick: () => {}, separator: true },
    {
      label: "Rename",
      icon: <Edit3 className="h-4 w-4" />,
      onClick: () => onRename(noteId),
    },
    {
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      onClick: () => onDelete(noteId),
    },
  ];

  return (
    <ContextMenu x={x} y={y} items={items} onClose={onClose} />
  );
}
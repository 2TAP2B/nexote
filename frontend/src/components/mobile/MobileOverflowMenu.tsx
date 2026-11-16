"use client";

import {
  Bookmark,
  BookmarkCheck,
  Copy,
  Edit3,
  FolderInput,
  History,
  ListTree,
  Sparkles,
  SquareArrowOutUpRight,
  Star,
  Trash2,
} from "lucide-react";

import { generateNoteTitle } from "@/lib/ai";
import { replaceOrAddTitleHeading } from "@/lib/note-utils";
import { useNotes } from "@/lib/notes-context";
import { useCanEdit } from "@/components/useCanEdit";
import { MobileActionSheet, type SheetAction } from "./MobileActionSheet";

type Props = {
  noteId: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  onMoveTo: (id: string) => void;
  onRename: (id: string) => void;
  onHistory: (id: string) => void;
  onToc: () => void;
};

// The ⋮ menu for the open note, as an Obsidian-style bottom sheet. Mirrors
// the desktop note-row context menu, dispatching to the same NotesProvider
// actions.
export default function MobileOverflowMenu({
  noteId,
  onClose,
  onDelete,
  onMoveTo,
  onRename,
  onHistory,
  onToc,
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
  const canEdit = useCanEdit().canEditNote(noteId);

  const note = notesById[noteId];
  const sections: SheetAction[][] = [
    [
      {
        label: isBookmarked ? "Remove from bookmarks" : "Add to bookmarks",
        icon: isBookmarked ? <BookmarkCheck size={19} /> : <Bookmark size={19} />,
        onClick: () => toggleBookmark(noteId),
      },
      {
        label: isShortcut ? "Remove shortcut" : "Add shortcut",
        icon: <Star size={19} />,
        onClick: () => toggleShortcut(noteId),
      },
    ],
    [
      { label: "Open in new tab", icon: <SquareArrowOutUpRight size={19} />, onClick: () => void openTab(noteId) },
      { label: "Table of contents", icon: <ListTree size={19} />, onClick: onToc },
      { label: "Note history", icon: <History size={19} />, onClick: () => onHistory(noteId) },
    ],
    canEdit
      ? [
          { label: "Rename", icon: <Edit3 size={19} />, onClick: () => onRename(noteId) },
          { label: "Move to…", icon: <FolderInput size={19} />, onClick: () => onMoveTo(noteId) },
          { label: "Make a copy", icon: <Copy size={19} />, onClick: () => void copyNote(noteId) },
          ...(hasAI
            ? [{ label: "Generate AI title", icon: <Sparkles size={19} />, onClick: () => void handleGenerateTitle() }]
            : []),
        ]
      : [],
    canEdit ? [{ label: "Delete", icon: <Trash2 size={19} />, danger: true, onClick: () => onDelete(noteId) }] : [],
  ];

  return (
    <MobileActionSheet
      title={note?.title || "Untitled"}
      subtitle={note ? note.path || "No folder" : undefined}
      sections={sections}
      onClose={onClose}
    />
  );
}
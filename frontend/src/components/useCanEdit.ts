"use client";

import { useCallback, useMemo } from "react";

import { useNotes } from "@/lib/notes-context";

export type EditPermissions = {
  /** The active space accepts new notes, folders and collections. */
  canEditSpace: boolean;
  /** The vault's content may change (journal/home are always the user's own). */
  canEditVault: (vaultId: string | null | undefined) => boolean;
  /** The note may change: its vault (else the active space) isn't viewer-only. */
  canEditNote: (noteId: string | null | undefined) => boolean;
};

// Viewers of a shared space read only. The server refuses their changes with
// 403 anyway; these checks keep the UI from offering actions that would fail.
// Unknown vaults count as editable: the list may not have loaded yet, and the
// server stays the authority.
export function useCanEdit(): EditPermissions {
  const { activeSpace, allVaults, noteVaultMap, isJournalNote } = useNotes();
  const viewerVaults = useMemo(
    () => new Set(allVaults.filter((v) => v.role === "viewer").map((v) => v.id)),
    [allVaults],
  );
  const canEditVault = useCallback(
    (vaultId: string | null | undefined) => !vaultId || !viewerVaults.has(vaultId),
    [viewerVaults],
  );
  const canEditSpace = activeSpace?.role !== "viewer";
  const canEditNote = useCallback(
    (noteId: string | null | undefined) => {
      if (!noteId || isJournalNote(noteId)) return true;
      const vaultId = noteVaultMap[noteId];
      return vaultId ? canEditVault(vaultId) : canEditSpace;
    },
    [isJournalNote, canEditVault, noteVaultMap, canEditSpace],
  );
  return useMemo(
    () => ({ canEditSpace, canEditVault, canEditNote }),
    [canEditSpace, canEditVault, canEditNote],
  );
}

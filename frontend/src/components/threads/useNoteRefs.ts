"use client";

import { useCallback, useMemo } from "react";

import { isCollectionsVault } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import { isThreadMeta } from "@/lib/threads";
import type { NoteRef } from "../mobile/MemoBubble";
import { useAllThreads } from "./useAllThreads";

/**
 * What memos can link to ([[Title]]) and "@" suggests: every thread first
 * (those of `preferVaultId` ahead, so a thread's links stay in its vault),
 * then every regular vault note of the active space and the journal. Thread
 * notes kept in a vault count as threads only: they open in the thread view.
 */
export function useNoteRefs(preferVaultId: string | null) {
  const { vaults, allVaultData, journalNotes } = useNotes();
  const { threads } = useAllThreads();

  const noteRefs = useMemo(() => {
    const refs: NoteRef[] = [];
    const ordered = [...threads].sort((a, b) => Number(b.vaultId === preferVaultId) - Number(a.vaultId === preferVaultId));
    for (const t of ordered) {
      if (t.title) {
        refs.push({ id: t.id, title: t.title, vaultId: t.vaultId, where: "Threads", updatedAt: t.updatedAt, thread: true });
      }
    }
    for (const v of vaults) {
      if (isCollectionsVault(v)) continue;
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (!n.title || isThreadMeta(n)) continue;
        refs.push({
          id: n.id,
          title: n.title,
          vaultId: v.id,
          where: n.path ? `${v.name} › ${n.path}` : v.name,
          updatedAt: n.updatedAt,
        });
      }
    }
    for (const n of journalNotes) {
      if (n.title) refs.push({ id: n.id, title: n.title, vaultId: null, where: "Journal", updatedAt: n.updatedAt });
    }
    return refs;
  }, [threads, preferVaultId, vaults, allVaultData, journalNotes]);

  // [[Title]] → note: same title (any case); the first match wins (threads,
  // then the active space's vaults, then the journal).
  const resolve = useCallback(
    (title: string) => {
      const wanted = title.toLowerCase();
      return noteRefs.find((ref) => ref.title.toLowerCase() === wanted) ?? null;
    },
    [noteRefs],
  );

  // "@query" suggestions: titles containing the query, prefix matches first,
  // then the most recently edited.
  const suggest = useCallback(
    (query: string) => {
      const q = query.toLowerCase();
      return noteRefs
        .filter((r) => r.title.toLowerCase().includes(q))
        .sort(
          (a, b) =>
            Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) ||
            b.updatedAt.localeCompare(a.updatedAt),
        )
        .slice(0, 6);
    },
    [noteRefs],
  );

  return { resolve, suggest };
}

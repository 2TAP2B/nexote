"use client";

import { useCallback, useMemo } from "react";

import { isCollectionsVault } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import { useThreads } from "@/lib/threads";
import type { NoteRef } from "../mobile/MemoBubble";

/**
 * What memos can link to ([[Title]]) and "@" suggests: the threads of
 * `threadsVaultId` (null: none) first, then every regular vault note of the
 * active space and the journal. Threads live in the personal store, which is
 * in no vault list, so they're added from the threads cache.
 */
export function useNoteRefs(threadsVaultId: string | null) {
  const { vaults, allVaultData, journalNotes } = useNotes();
  const { threads } = useThreads(threadsVaultId);

  const noteRefs = useMemo(() => {
    const refs: NoteRef[] = [];
    for (const t of threads) {
      if (t.title) {
        refs.push({ id: t.id, title: t.title, vaultId: t.vaultId, where: "Threads", updatedAt: t.updatedAt, thread: true });
      }
    }
    for (const v of vaults) {
      if (isCollectionsVault(v)) continue;
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (!n.title) continue;
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
  }, [threads, vaults, allVaultData, journalNotes]);

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

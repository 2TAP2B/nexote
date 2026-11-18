"use client";

import { useEffect, useMemo } from "react";

import type { VaultMeta } from "@/lib/api";
import { HOME_VAULT, notepadLocation } from "@/lib/notepad";
import { useNotes } from "@/lib/notes-context";
import { isThreadMeta, syncThreads, threadTags, useThreadsIn } from "@/lib/threads";

/**
 * Every thread the user can see, wherever it was written: the personal store,
 * every vault (any space) whose note list holds a thread note, and this
 * device's Notepad vault (where new threads go, before the list shows them).
 * The Notepad location is a per-device setting, so reading only its vault
 * would hide threads written on another device.
 */
export function useAllThreads() {
  const { allVaultData, settings } = useNotes();
  const notepadVault = notepadLocation(settings).vaultId;
  const vaultIds = useMemo(() => {
    const ids = new Set([HOME_VAULT]);
    // A vault no longer reachable would only fail to load.
    if (notepadVault in allVaultData) ids.add(notepadVault);
    for (const [vaultId, data] of Object.entries(allVaultData)) {
      if (data.notes.some(isThreadMeta)) ids.add(vaultId);
    }
    return [...ids].sort();
  }, [allVaultData, notepadVault]);
  // The provider refetches a vault's list on every tree change (SSE): new or
  // deleted threads there reach the cache this way.
  useEffect(() => {
    for (const [vaultId, data] of Object.entries(allVaultData)) syncThreads(vaultId, data.notes);
  }, [allVaultData]);
  return useThreadsIn(vaultIds);
}

export type SharedTag = { name: string; count: number; vaults: string[] };

/**
 * Tags of the notes in `vaults` and of every thread as one namespace, by
 * name. A thread note kept in a vault counts once, as a thread. `vaults` of
 * a tag: the given vaults whose notes carry it (renaming works there).
 */
export function useSharedTags(vaults: VaultMeta[]): SharedTag[] {
  const { tagsByVault, allVaultData } = useNotes();
  const { threads } = useAllThreads();
  return useMemo(() => {
    const map = new Map<string, SharedTag>();
    const add = (name: string, count: number, vaultId?: string) => {
      const tag = map.get(name) ?? { name, count: 0, vaults: [] };
      tag.count += count;
      if (vaultId && !tag.vaults.includes(vaultId)) tag.vaults.push(vaultId);
      map.set(name, tag);
    };
    for (const v of vaults) {
      for (const t of tagsByVault[v.id] ?? []) add(t.name, t.count, v.id);
      // The vault's counts include its thread notes; they're added as threads below.
      for (const n of allVaultData[v.id]?.notes ?? []) {
        if (isThreadMeta(n)) for (const name of n.tags ?? []) add(name, -1);
      }
    }
    for (const t of threads) for (const name of threadTags(t)) add(name, 1);
    // Lists refreshed at different moments can briefly disagree.
    return [...map.values()].filter((t) => t.count > 0).sort((a, b) => a.name.localeCompare(b.name));
  }, [vaults, tagsByVault, allVaultData, threads]);
}

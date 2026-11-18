// Reading the details of the thread events (lib/threads.ts) in the shells.

export type ThreadRef = { vaultId: string; id: string };

/** The `{ vaultId, id }` of an OPEN_THREAD_EVENT, or null when malformed. */
export function threadRefFrom(e: Event): ThreadRef | null {
  if (!(e instanceof CustomEvent)) return null;
  const d: unknown = e.detail;
  if (typeof d !== "object" || d === null || !("vaultId" in d) || !("id" in d)) return null;
  const { vaultId, id } = d;
  return typeof vaultId === "string" && typeof id === "string" && vaultId && id ? { vaultId, id } : null;
}

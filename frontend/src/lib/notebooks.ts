import { isCollectionsVault } from "./api";
import type { FolderMeta, SpaceInfo, VaultMeta } from "./api";

/** A place a note can be saved: a vault's root or one of its folders. */
export type Notebook = { vaultId: string; folder: string; label: string; depth: number };

export const notebookKey = (n: Pick<Notebook, "vaultId" | "folder">) => `${n.vaultId}/${n.folder}`;

/** Every regular vault the user may write to, each followed by its folders
 *  (A–Z, so subfolders follow their parent). With several spaces, labels
 *  start with the space name. */
export function listNotebooks(
  vaults: VaultMeta[],
  data: Record<string, { folders: FolderMeta[] }>,
  spaces: SpaceInfo[] = [],
): Notebook[] {
  const out: Notebook[] = [];
  const spaceName = (id: string) => (spaces.length > 1 ? spaces.find((s) => s.id === id)?.name : undefined);
  for (const v of vaults) {
    if (isCollectionsVault(v) || v.role === "viewer") continue;
    const root = [spaceName(v.spaceId), v.name].filter(Boolean).join(" › ");
    out.push({ vaultId: v.id, folder: "", label: root, depth: 0 });
    const folders = [...(data[v.id]?.folders ?? [])].sort((a, b) => a.path.localeCompare(b.path));
    for (const f of folders) {
      const parts = f.path.split("/");
      out.push({ vaultId: v.id, folder: f.path, label: [root, ...parts].join(" › "), depth: parts.length });
    }
  }
  return out;
}

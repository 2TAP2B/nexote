import { isCollectionsVault } from "./api";
import type { FolderMeta, VaultMeta } from "./api";

/** A place a note can be saved: a vault's root or one of its folders. */
export type Notebook = { vaultId: string; folder: string; label: string; depth: number };

export const notebookKey = (n: Pick<Notebook, "vaultId" | "folder">) => `${n.vaultId}/${n.folder}`;

/** Every regular vault, each followed by its folders (A–Z, so subfolders follow their parent). */
export function listNotebooks(vaults: VaultMeta[], data: Record<string, { folders: FolderMeta[] }>): Notebook[] {
  const out: Notebook[] = [];
  for (const v of vaults) {
    if (isCollectionsVault(v)) continue;
    out.push({ vaultId: v.id, folder: "", label: v.name, depth: 0 });
    const folders = [...(data[v.id]?.folders ?? [])].sort((a, b) => a.path.localeCompare(b.path));
    for (const f of folders) {
      const parts = f.path.split("/");
      out.push({ vaultId: v.id, folder: f.path, label: [v.name, ...parts].join(" › "), depth: parts.length });
    }
  }
  return out;
}

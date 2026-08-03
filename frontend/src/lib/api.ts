// API client for the Nexote Go backend. All note/bookmark/folder routes are
// scoped under a vault ID. During development the requests are proxied to
// http://localhost:8080 via next.config.mjs rewrites.

export type NoteMeta = {
  id: string;
  title: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type Note = NoteMeta & {
  body: string;
};

export type NoteInput = {
  title?: string;
  body?: string;
  path?: string | null;
};

export type FolderMeta = {
  path: string;
  name: string;
};

export type ListResult = {
  notes: NoteMeta[];
  folders: FolderMeta[];
};

export type VaultMeta = {
  id: string;
  name: string;
  icon?: string;
  path: string;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore json parse errors
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const vaultBase = (vaultId: string) => `/api/vaults/${vaultId}`;

export const api = {
  // --- Vaults ---
  listVaults: () =>
    request<{ vaults: VaultMeta[] }>("/api/vaults"),
  createVault: (name: string, icon?: string) =>
    request<VaultMeta>("/api/vaults", {
      method: "POST",
      body: JSON.stringify({ name, icon }),
    }),
  renameVault: (id: string, name: string) =>
    request<VaultMeta>(`/api/vaults/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),
  setVaultIcon: (id: string, icon: string) =>
    request<VaultMeta>(`/api/vaults/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ icon }),
    }),
  deleteVault: (id: string) =>
    request<void>(`/api/vaults/${id}`, { method: "DELETE" }),

  // --- Notes (vault-scoped) ---
  list: (vaultId: string) =>
    request<ListResult>(`${vaultBase(vaultId)}/notes`),
  get: (vaultId: string, id: string) =>
    request<Note>(`${vaultBase(vaultId)}/notes/${id}`),
  daily: (vaultId: string) =>
    request<Note>(`${vaultBase(vaultId)}/notes/daily`),
  create: (vaultId: string, input: NoteInput) =>
    request<Note>(`${vaultBase(vaultId)}/notes`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  copy: (vaultId: string, id: string) =>
    request<Note>(`${vaultBase(vaultId)}/notes/copy`, {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  move: (srcVaultId: string, id: string, dstVaultId: string) =>
    request<Note>(`${vaultBase(srcVaultId)}/notes/move`, {
      method: "POST",
      body: JSON.stringify({ id, dstVaultId }),
    }),
  update: (vaultId: string, id: string, input: NoteInput) =>
    request<Note>(`${vaultBase(vaultId)}/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  remove: (vaultId: string, id: string) =>
    request<void>(`${vaultBase(vaultId)}/notes/${id}`, {
      method: "DELETE",
    }),

  // --- Folders (vault-scoped) ---
  createFolder: (vaultId: string, path: string) =>
    request<{ path: string }>(`${vaultBase(vaultId)}/folders`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  removeFolder: (vaultId: string, path: string) =>
    request<void>(`${vaultBase(vaultId)}/folders/${path}`, {
      method: "DELETE",
    }),

  // --- Bookmarks (vault-scoped) ---
  listBookmarks: (vaultId: string) =>
    request<{ bookmarks: string[] }>(`${vaultBase(vaultId)}/bookmarks`),
  addBookmark: (vaultId: string, id: string) =>
    request<void>(`${vaultBase(vaultId)}/bookmarks`, {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  removeBookmark: (vaultId: string, id: string) =>
    request<void>(`${vaultBase(vaultId)}/bookmarks/${id}`, {
      method: "DELETE",
    }),

  // --- Shortcuts (vault-scoped) ---
  listShortcuts: (vaultId: string) =>
    request<{ shortcuts: string[] }>(`${vaultBase(vaultId)}/shortcuts`),
  addShortcut: (vaultId: string, id: string) =>
    request<void>(`${vaultBase(vaultId)}/shortcuts`, {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  removeShortcut: (vaultId: string, id: string) =>
    request<void>(`${vaultBase(vaultId)}/shortcuts/${id}`, {
      method: "DELETE",
    }),
};
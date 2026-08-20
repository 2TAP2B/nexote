// API client for the Nexote Go backend. All note/bookmark/folder routes are
// scoped under a vault ID. During development the requests are proxied to
// http://localhost:8080 via next.config.mjs rewrites.

export type NoteMeta = {
  id: string;
  title: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  snippet?: string;
  type?: string;
  artist?: string;
  year?: number;
  genre?: string;
  wantlist?: boolean;
  cover?: string;
};

export type Note = NoteMeta & {
  body: string;
};

export type NoteInput = {
  title?: string;
  body?: string;
  path?: string | null;
  type?: string | null;
  artist?: string | null;
  year?: number | null;
  genre?: string | null;
  wantlist?: boolean | null;
  cover?: string | null;
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

export type TagCount = {
  name: string;
  count: number;
};

export type TaskItem = {
  vaultId: string;
  vaultName: string;
  noteId: string;
  noteTitle: string;
  text: string;
  checked: boolean;
  line: number;
  createdAt: string;
  updatedAt: string;
};

export type ImageNote = {
  noteId: string;
  title: string;
};

export type ImageMeta = {
  name: string;
  path: string;
  url: string;
  size: number;
  updatedAt: string;
  usedBy?: ImageNote[];
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
  // Journal (vault-independent) — always available
  journalDaily: () =>
    request<Note>("/api/journal/daily"),
  journalList: () =>
    request<ListResult>("/api/journal/notes"),
  journalGet: (id: string) =>
    request<Note>(`/api/journal/notes/${id}`),
  journalUpdate: (id: string, input: { title?: string; body?: string }) =>
    request<Note>(`/api/journal/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  journalDelete: (id: string) =>
    request<void>(`/api/journal/notes/${id}`, {
      method: "DELETE",
    }),
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

  // --- Tags (vault-scoped) ---
  listTags: (vaultId: string) =>
    request<{ tags: TagCount[] }>(`${vaultBase(vaultId)}/tags`),
  removeTag: (vaultId: string, id: string, tag: string) =>
    request<Note>(`${vaultBase(vaultId)}/notes/${id}/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE",
    }),
  renameTag: (vaultId: string, from: string, to: string) =>
    request<{ renamed: number }>(`${vaultBase(vaultId)}/tags/rename`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),
  deleteTag: (vaultId: string, tag: string) =>
    request<{ removed: number }>(`${vaultBase(vaultId)}/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE",
    }),

  // --- Tasks (vault-independent, scans all vaults) ---
  listTasks: () =>
    request<{ tasks: TaskItem[] }>("/api/tasks"),
  toggleTask: (vaultId: string, noteId: string, line: number, checked: boolean) =>
    request<Note>("/api/tasks", {
      method: "PUT",
      body: JSON.stringify({ vaultId, noteId, line, checked }),
    }),

  // --- Images (vault-scoped) ---
  uploadImage: async (vaultId: string, noteId: string, file: File) => {
    // Multipart upload — the browser sets the boundary, so no Content-Type
    // header is sent (request() forces application/json).
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${vaultBase(vaultId)}/notes/${noteId}/images`, {
      method: "POST",
      body: form,
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
    return (await res.json()) as ImageMeta;
  },
  listImages: (vaultId: string) =>
    request<{ images: ImageMeta[] }>(`${vaultBase(vaultId)}/images`),
  removeImage: (vaultId: string, relPath: string) =>
    request<void>(`${vaultBase(vaultId)}/images/${relPath}`, {
      method: "DELETE",
    }),

  // --- AI (proxied through the backend to avoid CORS + key leakage) ---
  testAI: (config: { baseUrl: string; apiKey: string; model: string }) =>
    request<{ ok: boolean; error?: string }>("/api/ai/test", {
      method: "POST",
      body: JSON.stringify(config),
    }),
};
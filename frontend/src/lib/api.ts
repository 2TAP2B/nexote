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
  icon?: string;
  collection?: string;
  fields?: Record<string, string>;
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
  icon?: string | null;
  collection?: string | null;
  fields?: Record<string, string> | null;
};

export type CollectionFieldType = "text" | "number" | "boolean" | "date";

export type CollectionField = {
  key: string;
  label: string;
  type: CollectionFieldType;
};

export type CollectionMeta = {
  id: string;
  name: string;
  icon?: string;
  pinned: boolean;
  fields: CollectionField[];
  builtIn?: boolean;
  hidden?: boolean;
};

export type FolderMeta = {
  path: string;
  name: string;
  /** Finder-style color label, e.g. "red" | "orange" | "yellow" | "green" | "blue" | "purple". */
  label?: string;
};

// The six macOS label colors offered by the tree context menu.
export const FOLDER_LABEL_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
] as const;
export type FolderLabelColor = (typeof FOLDER_LABEL_COLORS)[number];

export const FOLDER_LABEL_HEX: Record<string, string> = {
  red: "#ff5f57",
  orange: "#ff9f43",
  yellow: "#febc2e",
  green: "#28c840",
  blue: "#0a84ff",
  purple: "#a259f7",
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
  type?: string;
};

// The auto-created system vault that holds collection folders. Hidden from
// every user-facing vault list (tree, move dialog, palette, settings); the
// Collections sidebar view/galleries still read its data. Name-comparison
// fallback covers vaults registered before the backend type field existed.
export function isCollectionsVault(v: Pick<VaultMeta, "name" | "type">): boolean {
  return v.type === "collections" || v.name === "Collections";
}

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

export type HistoryVersion = {
  timestamp: string;
  snippet: string;
};

export type ImageMeta = {
  name: string;
  path: string;
  url: string;
  size: number;
  updatedAt: string;
  usedBy?: ImageNote[];
};

export type GitConfig = {
  enabled: boolean;
  remote: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  includeImages: boolean;
  autoPush: boolean;
  /** Commit+push every N minutes (0 = off). */
  autoSyncMinutes?: number;
  /** Credentials stored in git.json (0600) so background sync can auth. */
  username?: string;
  password?: string;
};

export type GitStatusInfo = {
  enabled: boolean;
  hasRepo: boolean;
  clean: boolean;
  ahead: number;
  behind: number;
  branch: string;
  remote: string;
  dirtyFiles: number;
};

export type GitCommitLogEntry = {
  hash: string;
  message: string;
  author: string;
  when: string;
};

export type SearchHit = {
  id: string;
  title: string;
  path?: string;
  updatedAt: string;
  /** "title" or "content" */
  match: string;
  snippet?: string;
  vaultId: string;
  vaultName: string;
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

  // --- Collections ---
  listCollections: () =>
    request<{ collections: CollectionMeta[] }>("/api/collections"),
  createCollection: (input: {
    name: string;
    icon?: string;
    fields: CollectionField[];
  }) =>
    request<CollectionMeta>("/api/collections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCollection: (
    id: string,
    input: { name?: string; icon?: string; fields?: CollectionField[] },
  ) =>
    request<CollectionMeta>(`/api/collections/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  setCollectionPinned: (id: string, pinned: boolean) =>
    request<CollectionMeta>(`/api/collections/${id}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }),
  setCollectionHidden: (id: string, hidden: boolean) =>
    request<CollectionMeta>(`/api/collections/${id}/hidden`, {
      method: "PATCH",
      body: JSON.stringify({ hidden }),
    }),
  deleteCollection: (id: string) =>
    request<void>(`/api/collections/${id}`, { method: "DELETE" }),

  // --- Notes (vault-scoped) ---
  list: (vaultId: string) =>
    request<ListResult>(`${vaultBase(vaultId)}/notes`),
  // Search: global over all vaults + journal (title & content; ranked).
  search: (q: string) => {
    const qs = new URLSearchParams({ q }).toString();
    return request<{ results: SearchHit[] }>(`/api/search?${qs}`);
  },
  get: (vaultId: string, id: string) =>
    request<Note>(`${vaultBase(vaultId)}/notes/${id}`),
  // Journal (vault-independent) — always available. Opens-or-creates the note
  // for date (local YYYY-MM-DD), past and future days included.
  journalDaily: (date: string) =>
    request<Note>(`/api/journal/daily?${new URLSearchParams({ date })}`),
  journalList: () =>
    request<ListResult>("/api/journal/notes"),
  journalGet: (id: string) =>
    request<Note>(`/api/journal/notes/${id}`),
  journalUpdate: (
    id: string,
    input: { title?: string; body?: string; icon?: string | null },
  ) =>
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
  move: (srcVaultId: string, id: string, dstVaultId: string, dstPath?: string) =>
    request<Note>(`${vaultBase(srcVaultId)}/notes/move`, {
      method: "POST",
      body: JSON.stringify({ id, dstVaultId, ...(dstPath !== undefined ? { dstPath } : {}) }),
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

  // --- Note history (vault-scoped) ---
  listHistory: (vaultId: string, id: string) =>
    request<{ versions: HistoryVersion[] }>(
      `${vaultBase(vaultId)}/notes/${id}/history`,
    ),
  getHistoryVersion: (vaultId: string, id: string, ts: string) =>
    request<Note>(`${vaultBase(vaultId)}/notes/${id}/history/${ts}`),
  restoreHistoryVersion: (vaultId: string, id: string, ts: string) =>
    request<Note>(`${vaultBase(vaultId)}/notes/${id}/history/${ts}/restore`, {
      method: "POST",
    }),

  // --- Journal note history (vault-independent) ---
  journalListHistory: (id: string) =>
    request<{ versions: HistoryVersion[] }>(`/api/journal/notes/${id}/history`),
  journalGetHistoryVersion: (id: string, ts: string) =>
    request<Note>(`/api/journal/notes/${id}/history/${ts}`),
  journalRestoreHistoryVersion: (id: string, ts: string) =>
    request<Note>(`/api/journal/notes/${id}/history/${ts}/restore`, {
      method: "POST",
    }),

  // --- Folders (vault-scoped) ---
  createFolder: (vaultId: string, path: string) =>
    request<{ path: string }>(`${vaultBase(vaultId)}/folders`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  renameFolder: (vaultId: string, oldPath: string, newPath: string) =>
    request<{ path: string }>(`${vaultBase(vaultId)}/folders/${oldPath}`, {
      method: "PUT",
      body: JSON.stringify({ newPath }),
    }),
  setFolderLabel: (vaultId: string, path: string, color: string) =>
    request<void>(`${vaultBase(vaultId)}/folders/label`, {
      method: "PUT",
      body: JSON.stringify({ path, color }),
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

  // --- Git sync (vault-independent, operates on $NEXOTE_HOME root) ---
  gitGetConfig: () =>
    request<GitConfig>("/api/git/config"),
  gitSetConfig: (config: GitConfig) =>
    request<GitConfig>("/api/git/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  gitInit: () =>
    request<{ ok: boolean }>("/api/git/init", { method: "POST" }),
  gitStatus: () =>
    request<GitStatusInfo>("/api/git/status"),
  gitPush: (creds?: { username?: string; password?: string }) =>
    request<{ ok: boolean }>("/api/git/push", {
      method: "POST",
      body: JSON.stringify(creds ?? {}),
    }),
  gitPull: (creds?: { username?: string; password?: string }) =>
    request<{ ok: boolean }>("/api/git/pull", {
      method: "POST",
      body: JSON.stringify(creds ?? {}),
    }),
  gitLog: (limit?: number) =>
    request<{ commits: GitCommitLogEntry[] }>(`/api/git/log${limit ? `?limit=${limit}` : ""}`),

  // --- Metadata lookup (Discogs + Books, proxied through the backend) ---
  getMetadataConfig: () =>
    request<MetadataConfig>("/api/metadata/config"),
  setMetadataConfig: (config: MetadataConfig) =>
    request<MetadataConfig>("/api/metadata/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  discogsRelease: (id: string) =>
    request<MetadataResult>(`/api/metadata/discogs/release?id=${encodeURIComponent(id)}`),
  discogsSearch: (q: string) =>
    request<{ results: MetadataSearchResult[] }>(
      `/api/metadata/discogs/search?q=${encodeURIComponent(q)}`,
    ),
  bookLookup: (isbn: string) =>
    request<MetadataResult>(`/api/metadata/book?isbn=${encodeURIComponent(isbn)}`),
  bookSearch: (q: string) =>
    request<{ results: MetadataSearchResult[] }>(
      `/api/metadata/book/search?q=${encodeURIComponent(q)}`,
    ),
  metadataCover: (input: { vaultId: string; noteId: string; url: string }) =>
    request<{ url: string }>("/api/metadata/cover", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export type MetadataConfig = {
  discogsToken: string;
  // Optional Google Books API key. Raises Google's anonymous per-IP 429
  // limit; when set it is sent server-side only. Configured in Settings ›
  // Metadata lookup, metadata.json or GOOGLE_BOOKS_API_KEY.
  googleBooksKey?: string;
};

export type MetadataResult = {
  source: string;
  externalId: string;
  title: string;
  artists?: string[];
  year?: string;
  genres?: string[];
  label?: string;
  catno?: string;
  pages?: string;
  coverUrl?: string;
  description?: string;
};

export type MetadataSearchResult = {
  source: string;
  externalId: string;
  title: string;
  subtitle?: string;
  coverUrl?: string;
};
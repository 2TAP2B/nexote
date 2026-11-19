// API client for the Nexote Go backend. All note/bookmark/folder routes are
// scoped under a vault ID; vaults belong to spaces. Every route except
// /api/auth/* needs a login session (an HttpOnly cookie). During development
// the requests are proxied to http://localhost:8080 via next.config.mjs
// rewrites.

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
  /** Threads: pinned to the top, priority 1 (highest) … 5, status "done" = solved. */
  pinned?: boolean;
  priority?: number;
  status?: string;
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
  pinned?: boolean;
  /** 0 clears it. */
  priority?: number;
  /** "" clears it. */
  status?: string;
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

// A member's role in a space: owners manage members and delete vaults,
// editors change content, viewers only read.
export type SpaceRole = "owner" | "editor" | "viewer";

export type VaultMeta = {
  id: string;
  name: string;
  icon?: string;
  type?: string;
  spaceId: string;
  /** The logged-in user's role in the vault's space. */
  role: SpaceRole;
  /** Folder on the server; only sent to admins. */
  path?: string;
};

/** A space as the logged-in user sees it. Private = only its owner. */
export type SpaceInfo = {
  id: string;
  name: string;
  icon?: string;
  role: SpaceRole;
  memberCount: number;
  createdAt: string;
};

export type SpaceMember = {
  userId: string;
  username: string;
  displayName: string;
  /** Profile picture version, absent without one (see avatarUrl). */
  avatar?: string;
  role: SpaceRole;
  addedAt: string;
};

export type UserRole = "admin" | "member";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  /** Profile picture version, absent without one (see avatarUrl). */
  avatar?: string;
};

export type AuthStatus = {
  /** No account exists yet: show first-time setup (creates the admin). */
  setupRequired: boolean;
  user: AuthUser | null;
  /** NEXOTE_PUBLIC_URL's origin; passkeys only work when opened there. */
  origin: string;
};

/** Server half of a passkey prompt: pass `options` to lib/webauthn. */
export type CeremonyStart = { ceremonyId: string; options: unknown };

/** Browser's answer to a passkey prompt (credential as JSON). */
export type CeremonyFinish = { ceremonyId: string; credential: unknown; name?: string };

export type PasskeyInfo = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
};

/** Another account, as listed to pick space members. */
export type DirectoryUser = { id: string; username: string; displayName: string; avatar?: string };

/** URL of a user's profile picture; the version makes each upload a new URL. */
export function avatarUrl(userId: string, version: string): string {
  return `/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(version)}`;
}

export type AdminUser = AuthUser & {
  disabled: boolean;
  createdAt: string;
  lastSeenAt?: string;
  /** Number of registered passkeys. */
  passkeys: number;
};

export type AdminInvite = {
  id: string;
  kind: "signup" | "recovery";
  role?: UserRole;
  /** Recovery: display name of the account getting a passkey. */
  user?: string;
  createdBy?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
  status: "pending" | "used" | "expired";
};

/** What an invite or recovery link does, shown before redeeming it. */
export type InviteInfo = {
  kind: "signup" | "recovery";
  role?: UserRole;
  invitedBy?: string;
  expiresAt: string;
  /** Recovery links: the account getting a new passkey. */
  username?: string;
  displayName?: string;
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

/** A note id like the server's (16 base64url characters). */
export function newNoteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/** Fired on window when a request comes back 401 (session gone): the app
 *  returns to the login screen. */
export const AUTH_REQUIRED_EVENT = "nexote:auth-required";

// Turns a failed response into an ApiError carrying the server's message,
// and announces lost sessions (except from the login routes themselves).
async function failure(res: Response, path: string): Promise<ApiError> {
  let message = res.statusText;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      message = body.error;
    }
  } catch {
    // ignore json parse errors
  }
  if (res.status === 401 && !path.startsWith("/api/auth/") && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
  return new ApiError(res.status, message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw await failure(res, path);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const vaultBase = (vaultId: string) => `/api/vaults/${vaultId}`;

export const api = {
  // --- Vaults ---
  listVaults: () =>
    request<{ vaults: VaultMeta[] }>("/api/vaults"),
  createVault: (name: string, spaceId: string, icon?: string) =>
    request<VaultMeta>("/api/vaults", {
      method: "POST",
      body: JSON.stringify({ name, icon, spaceId }),
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

  // --- Collections (one set per space) ---
  listCollections: (spaceId: string) =>
    request<{ collections: CollectionMeta[] }>(`/api/collections?${new URLSearchParams({ space: spaceId })}`),
  createCollection: (
    spaceId: string,
    input: {
      name: string;
      icon?: string;
      fields: CollectionField[];
    },
  ) =>
    request<CollectionMeta>(`/api/collections?${new URLSearchParams({ space: spaceId })}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCollection: (
    spaceId: string,
    id: string,
    input: { name?: string; icon?: string; fields?: CollectionField[] },
  ) =>
    request<CollectionMeta>(`/api/collections/${id}?${new URLSearchParams({ space: spaceId })}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  setCollectionPinned: (spaceId: string, id: string, pinned: boolean) =>
    request<CollectionMeta>(`/api/collections/${id}/pin?${new URLSearchParams({ space: spaceId })}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }),
  setCollectionHidden: (spaceId: string, id: string, hidden: boolean) =>
    request<CollectionMeta>(`/api/collections/${id}/hidden?${new URLSearchParams({ space: spaceId })}`, {
      method: "PATCH",
      body: JSON.stringify({ hidden }),
    }),
  deleteCollection: (spaceId: string, id: string) =>
    request<void>(`/api/collections/${id}?${new URLSearchParams({ space: spaceId })}`, { method: "DELETE" }),

  // --- Notes (vault-scoped) ---
  list: (vaultId: string) =>
    request<ListResult>(`${vaultBase(vaultId)}/notes`),
  // Search: over the user's vaults (one space when spaceId is given) + their
  // journal (title & content; ranked).
  search: (q: string, spaceId?: string) => {
    const qs = new URLSearchParams({ q, ...(spaceId ? { space: spaceId } : {}) }).toString();
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
  // The id is chosen here so a note created offline keeps it after the sync
  // (later edits address it; a replayed create is recognized, not doubled).
  create: (vaultId: string, input: NoteInput) =>
    request<Note>(`${vaultBase(vaultId)}/notes`, {
      method: "POST",
      body: JSON.stringify({ id: newNoteId(), ...input }),
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

  // --- Tasks (vault-independent: the user's vaults, one space when given, + journal) ---
  listTasks: (spaceId?: string) =>
    request<{ tasks: TaskItem[] }>(`/api/tasks${spaceId ? `?${new URLSearchParams({ space: spaceId })}` : ""}`),
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
    const path = `${vaultBase(vaultId)}/notes/${noteId}/images`;
    const res = await fetch(path, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw await failure(res, path);
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
  // Speech-to-text for voice memos: the backend forwards the clip to the
  // endpoint's /v1/audio/transcriptions. The file name's extension tells the
  // API the audio format.
  transcribeAudio: async (
    config: { baseUrl: string; apiKey: string; model: string },
    audio: Blob,
    fileName: string,
    signal?: AbortSignal,
  ) => {
    const form = new FormData();
    form.append("file", audio, fileName);
    form.append("baseUrl", config.baseUrl);
    form.append("apiKey", config.apiKey);
    form.append("model", config.model);
    const res = await fetch("/api/ai/transcribe", { method: "POST", body: form, signal });
    if (!res.ok) throw await failure(res, "/api/ai/transcribe");
    const data: unknown = await res.json();
    if (data && typeof data === "object" && "text" in data && typeof data.text === "string") return data.text;
    throw new ApiError(502, "Unexpected response from the transcription endpoint");
  },

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

  // --- Accounts: passkey login, setup, invites (see lib/webauthn.ts) ---
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  setupBegin: (input: { setupCode: string; username: string; displayName: string }) =>
    request<CeremonyStart>("/api/auth/setup/begin", json("POST", input)),
  setupFinish: (input: CeremonyFinish) =>
    request<{ user: AuthUser }>("/api/auth/setup/finish", json("POST", input)),
  loginBegin: () => request<CeremonyStart>("/api/auth/login/begin", json("POST", {})),
  loginFinish: (input: CeremonyFinish) =>
    request<{ user: AuthUser }>("/api/auth/login/finish", json("POST", input)),
  logout: () => request<void>("/api/auth/logout", json("POST")),
  inviteInfo: (token: string) => request<InviteInfo>(`/api/auth/invites/${encodeURIComponent(token)}`),
  /** Signup links need username + displayName; recovery links nothing. */
  inviteBegin: (token: string, input: { username?: string; displayName?: string }) =>
    request<CeremonyStart>(`/api/auth/invites/${encodeURIComponent(token)}/begin`, json("POST", input)),
  inviteFinish: (token: string, input: CeremonyFinish) =>
    request<{ user: AuthUser }>(`/api/auth/invites/${encodeURIComponent(token)}/finish`, json("POST", input)),

  // --- The logged-in account ---
  me: () => request<{ user: AuthUser; passkeys: PasskeyInfo[] }>("/api/me"),
  updateMe: (input: { displayName: string }) => request<{ user: AuthUser }>("/api/me", json("PATCH", input)),
  /** Cross-device preferences ({} when none): where the Notepad lives, … */
  getPrefs: () => request<{ prefs: Record<string, string> }>("/api/me/prefs"),
  updatePrefs: (
    patch: Partial<Record<"notepadVault" | "notepadFolder" | "notepadInTree" | "memoNoteVault" | "memoNoteFolder", string>>,
  ) => request<{ prefs: Record<string, string> }>("/api/me/prefs", json("PATCH", { prefs: patch })),
  /** Profile picture (PNG, JPEG, GIF or WebP up to 2 MB); multipart like image uploads. */
  setAvatar: async (picture: Blob) => {
    const form = new FormData();
    form.append("file", picture, "avatar");
    const res = await fetch("/api/me/avatar", { method: "PUT", body: form });
    if (!res.ok) throw await failure(res, "/api/me/avatar");
    return (await res.json()) as { user: AuthUser };
  },
  removeAvatar: () => request<{ user: AuthUser }>("/api/me/avatar", json("DELETE")),
  addPasskeyBegin: () => request<CeremonyStart>("/api/me/passkeys/begin", json("POST", {})),
  addPasskeyFinish: (input: CeremonyFinish) => request<PasskeyInfo>("/api/me/passkeys/finish", json("POST", input)),
  renamePasskey: (id: string, name: string) =>
    request<void>(`/api/me/passkeys/${encodeURIComponent(id)}`, json("PATCH", { name })),
  removePasskey: (id: string) => request<void>(`/api/me/passkeys/${encodeURIComponent(id)}`, json("DELETE")),
  /** Active accounts, to add as space members. */
  listUsers: () => request<{ users: DirectoryUser[] }>("/api/users"),

  // --- Administration (admins only) ---
  adminListUsers: () => request<{ users: AdminUser[] }>("/api/admin/users"),
  adminUpdateUser: (id: string, input: { role?: UserRole; disabled?: boolean }) =>
    request<{ user: AuthUser }>(`/api/admin/users/${id}`, json("PATCH", input)),
  /** Single-use link (24h) adding a passkey to the account. */
  adminCreateRecovery: (id: string) =>
    request<{ url: string; expiresAt: string }>(`/api/admin/users/${id}/recovery`, json("POST", {})),
  adminListInvites: () => request<{ invites: AdminInvite[] }>("/api/admin/invites"),
  /** Single-use signup link (7 days); the URL is only returned here. */
  adminCreateInvite: (role: UserRole) =>
    request<{ url: string; id: string; expiresAt: string }>("/api/admin/invites", json("POST", { role })),
  adminDeleteInvite: (id: string) => request<void>(`/api/admin/invites/${id}`, json("DELETE")),

  // --- Spaces and members ---
  listSpaces: () => request<{ spaces: SpaceInfo[] }>("/api/spaces"),
  /** Creates a space owned by the user, with a first "Notes" vault. */
  createSpace: (input: { name: string; icon?: string }) => request<SpaceInfo>("/api/spaces", json("POST", input)),
  updateSpace: (id: string, input: { name?: string; icon?: string }) =>
    request<SpaceInfo>(`/api/spaces/${id}`, json("PATCH", input)),
  /** Deletes the space with all its vaults and notes (owners only). */
  deleteSpace: (id: string) => request<void>(`/api/spaces/${id}`, json("DELETE")),
  listMembers: (id: string) => request<{ members: SpaceMember[] }>(`/api/spaces/${id}/members`),
  /** Adds an existing user or changes their role (owners only). */
  setMember: (id: string, userId: string, role: SpaceRole) =>
    request<{ members: SpaceMember[] }>(`/api/spaces/${id}/members/${userId}`, json("PUT", { role })),
  removeMember: (id: string, userId: string) =>
    request<void>(`/api/spaces/${id}/members/${userId}`, json("DELETE")),
  leaveSpace: (id: string) => request<void>(`/api/spaces/${id}/members/me`, json("DELETE")),
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
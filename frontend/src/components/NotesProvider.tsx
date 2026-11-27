"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api, ApiError, isCollectionsVault, type CollectionMeta, type FolderMeta, type GitConfig, type GitStatusInfo, type Note, type NoteMeta, type SpaceInfo, type TagCount, type TaskItem, type VaultMeta } from "@/lib/api";
import { migrateLegacyDashboard, type DashSection } from "@/lib/dashboard";
import { localDateKey, replaceOrAddTitleHeading } from "@/lib/note-utils";
import { HOME_VAULT, NOTEPAD_TITLE } from "@/lib/notepad";
import { OPEN_WIKILINK_EVENT } from "@/lib/editor-events";
import { NOTE_CHANGE_EVENT, TREE_CHANGE_EVENT } from "@/lib/threads";
import { useAuth } from "@/components/auth/AuthProvider";
import { isAndroidApp } from "@/lib/app-info";
import type { InterfaceMode } from "@/lib/shell";

// Settings that must be one per account (the Notepad has to be the same
// note on every device), kept server-side and applied over the local ones.
const ACCOUNT_SETTINGS = ["notepadVault", "notepadFolder", "notepadInTree", "memoNoteVault", "memoNoteFolder"] as const;
type AccountSetting = (typeof ACCOUNT_SETTINGS)[number];
const isAccountSetting = (k: string): k is AccountSetting => (ACCOUNT_SETTINGS as readonly string[]).includes(k);

type Draft = { title: string; body: string };

// When note bodies were last requested for the offline copy (per page load).
let lastBodyPrecache = 0;

/** Note order in the tree: name (A–Z), last edited, or created (newest first). */
export type TreeSort = "name" | "modified" | "created";

export type AppSettings = {
  // New-note title; date/time codes are filled in by formatTitle. Empty
  // means "Untitled".
  titleTemplate: string;
  editorFontSize: number;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  // Speech-to-text model for quick-notes voice memos (/v1/audio/transcriptions).
  aiTranscribeModel: string;
  // Voice memos may go to a speech-to-text server of their own (speaches,
  // whisper.cpp, Groq…); "" = the AI connection above. The key belongs to
  // that server and is only sent there (lib/ai.ts transcriptionConfig).
  aiTranscribeBaseUrl: string;
  aiTranscribeApiKey: string;
  // Spoken language as an ISO-639-1 code ("de"); "" lets the model detect it.
  aiTranscribeLanguage: string;
  // General — start-up behaviour
  openDashboardOnStart: boolean;
  startVaultId: string; // "" = last active vault
  // Editor
  editorFontFamily: string; // "" = default theme font
  // New note title in its own heading (## title). Off shows a plain
  // paragraph first, like classic Obsidian.
  headingOnNewNote: boolean;
  // Rendered line width: false = wide column, true = narrow readable column.
  readableLineLength: boolean;
  // Raw-markdown textarea is the default editor surface.
  defaultRawMode: boolean;
  // Features — section visibility
  showTagsSection: boolean;
  showTasksSection: boolean;
  showThreadsSection: boolean;
  showTagsOnPalette: boolean;
  // Quick notes › "Make note": where the note goes ("" vault = ask first).
  memoNoteVault: string;
  memoNoteFolder: string;
  // Quick notes › where the "Notepad" note lives: "" = the personal store
  // (only you, never in a tree), else a vault (+ folder) of any space.
  notepadVault: string;
  notepadFolder: string;
  // Whether the Notepad shows in the note tree when it lives in a vault.
  notepadInTree: boolean;
  // Dashboard layouts (Settings › Dashboard): section order, on/off and
  // compact or detailed look, one per interface; null = the default
  // (lib/dashboard.ts). Read them through dashLayout(), which validates.
  dashboardDesktop: DashSection[] | null;
  dashboardTouch: DashSection[] | null;
  // Format of the toolbar's "insert date" (formatTitle codes).
  dateFormat: string;
  // Touch or desktop interface on this device (Settings › General).
  interface: InterfaceMode;
  // Callouts ("> [!info]") and ==highlights== styled and offered in the
  // toolbars (Settings › Editor). Off: shown as plain markdown; files are
  // the same either way.
  calloutsAndHighlights: boolean;
  // Desktop: formatting bar above the note (Settings › Editor).
  formattingToolbar: boolean;
  // Note tree: note order within a folder (folders stay first, A–Z) and the
  // card view (title + preview + date/tags) instead of compact rows.
  treeSort: TreeSort;
  treeCards: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  titleTemplate: "DAY DD-MM-YYYY HH:mm",
  editorFontSize: 16,
  aiBaseUrl: "",
  aiApiKey: "",
  aiModel: "",
  aiTranscribeModel: "whisper-1",
  aiTranscribeBaseUrl: "",
  aiTranscribeApiKey: "",
  aiTranscribeLanguage: "",
  openDashboardOnStart: false,
  startVaultId: "",
  editorFontFamily: "",
  headingOnNewNote: true,
  readableLineLength: false,
  defaultRawMode: false,
  showTagsSection: true,
  showTasksSection: true,
  showThreadsSection: true,
  showTagsOnPalette: true,
  memoNoteVault: "",
  memoNoteFolder: "",
  notepadVault: "",
  notepadFolder: "",
  notepadInTree: true,
  dashboardDesktop: null,
  dashboardTouch: null,
  dateFormat: "YYYY-MM-DD",
  interface: "auto",
  calloutsAndHighlights: true,
  formattingToolbar: true,
  treeSort: "name",
  treeCards: false,
};

type NotesContextValue = {
  // Vaults of the active space (the tree, settings and palette work on these).
  vaults: VaultMeta[];
  activeVault: VaultMeta | null;
  switchVault: (id: string) => void;
  createVault: (name: string, icon?: string) => Promise<void>;
  renameVault: (id: string, name: string) => Promise<void>;
  deleteVault: (id: string) => Promise<void>;
  setVaultIcon: (id: string, icon: string) => Promise<void>;

  // Spaces. allVaults: every vault the user can open, across all spaces.
  allVaults: VaultMeta[];
  spaces: SpaceInfo[];
  activeSpace: SpaceInfo | null;
  activeSpaceId: string | null;
  // Switches the workspace: the space's vaults and its own tab strip.
  switchSpace: (id: string) => void;
  // Reloads spaces + vaults (membership or vaults changed elsewhere).
  refreshSpaces: () => Promise<void>;
  // These reject with the server's message (callers show it inline).
  createSpace: (name: string, icon?: string) => Promise<SpaceInfo>;
  updateSpace: (id: string, patch: { name?: string; icon?: string }) => Promise<SpaceInfo>;
  deleteSpace: (id: string) => Promise<void>;
  leaveSpace: (id: string) => Promise<void>;
  // The active space's collection definitions. Always reads the space that
  // is active when called, so listeners registered earlier stay correct.
  listCollections: () => Promise<CollectionMeta[]>;

  notes: NoteMeta[];
  folders: FolderMeta[];
  bookmarks: Set<string>;
  shortcuts: Set<string>;
  openTabs: string[];
  activeId: string | null;
  activeNote: Note | null;
  isDashboardActive: boolean;
  notesById: Record<string, Note>;
  loading: boolean;
  error: string | null;
  creating: boolean;
  saving: boolean;

  openTab: (id: string) => Promise<void>;
  closeTab: (id: string) => void;
  create: (input?: { title?: string; path?: string; vaultId?: string; rename?: boolean }) => Promise<void>;
  copyNote: (id: string) => Promise<void>;
  moveNoteToVault: (noteId: string, dstVaultId: string, dstPath?: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  setFolderLabel: (vaultId: string, path: string, color: string) => Promise<void>;
  renameFolder: (oldPath: string, newPath: string) => Promise<void>;
  moveNote: (id: string, path: string) => Promise<void>;
  // Opens-or-creates the journal note for date (local YYYY-MM-DD; default today).
  openDaily: (date?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeJournal: (id: string) => Promise<void>;
  save: (id: string, input: Draft) => Promise<void>;
  toggleBookmark: (id: string) => Promise<void>;
  toggleShortcut: (id: string) => Promise<void>;
  setNoteIcon: (id: string, icon: string | null) => Promise<void>;
  forceSave: () => Promise<void>;
  setDraft: (draft: Draft) => void;
  refresh: () => Promise<void>;
  /** Refetch one vault's tree now (any vault of any space), not after the SSE echo. */
  refreshVaultTree: (vaultId: string) => Promise<void>;
  refreshNoteBody: (id: string) => Promise<void>;
  /** New title plus the matching title heading; works for notes never opened. */
  renameNote: (id: string, title: string) => Promise<void>;
  // Multi-vault data for the advanced tree
  allVaultData: Record<string, { notes: NoteMeta[]; folders: FolderMeta[] }>;
  journalNotes: NoteMeta[];
  // Tags
  tagsByVault: Record<string, TagCount[]>;
  refreshTags: (vaultId: string) => Promise<void>;
  removeTagFromNote: (vaultId: string, noteId: string, tag: string) => Promise<void>;
  renameTagInVault: (vaultId: string, from: string, to: string) => Promise<void>;
  deleteTagInVault: (vaultId: string, tag: string) => Promise<void>;
  // Tasks
  tasks: TaskItem[];
  refreshTasks: () => Promise<void>;
  toggleTaskItem: (vaultId: string, noteId: string, line: number, checked: boolean) => Promise<void>;
  openNoteInVault: (vaultId: string, noteId: string) => Promise<void>;
  openJournalNote: (id: string) => Promise<void>;
  isJournalNote: (id: string) => boolean;
  // noteId → vaultId, so vault-scoped ops can route to the owning vault.
  noteVaultMap: Record<string, string>;
  refreshAllMarks: () => Promise<void>;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  // Git sync
  gitConfig: GitConfig | null;
  gitStatus: GitStatusInfo | null;
  refreshGitConfig: () => Promise<void>;
  saveGitConfig: (config: GitConfig) => Promise<void>;
  gitInit: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  gitPush: (creds?: { username?: string; password?: string }) => Promise<void>;
  gitPull: (creds?: { username?: string; password?: string }) => Promise<void>;
};

export const DASHBOARD_ID = "__dashboard__";

// Append a tab id to the open-tab list, keeping the dashboard pinned first.
// Dedupes inside the updater so concurrent opens (e.g. the daily note opened
// twice in quick succession) can never produce two tabs for the same note.
// Returns the same array reference when the id is already present.
function appendOpenTab(tabs: string[], id: string): string[] {
  if (tabs.includes(id)) return tabs;
  return tabs[0] === DASHBOARD_ID
    ? [tabs[0], id, ...tabs.slice(1)]
    : [...tabs, id];
}

// The persisted tab strip (dashboard first), or null when there is none or
// "Show dashboard at start-up" is on. Reads settings straight from storage:
// it runs on mount, before the settings state has been loaded.
function readStoredTabs(): string[] | null {
  try {
    const settings = JSON.parse(localStorage.getItem("nexote:settings") ?? "{}") as Partial<AppSettings>;
    if (settings.openDashboardOnStart) return null;
    const parsed: unknown = JSON.parse(localStorage.getItem("nexote:open-tabs") ?? "null");
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((t): t is string => typeof t === "string");
    return ids.includes(DASHBOARD_ID) ? ids : [DASHBOARD_ID, ...ids];
  } catch {
    return null;
  }
}

// Each space keeps its own tab strip and last vault, restored on switching.
const spaceTabsKey = (spaceId: string) => `nexote:space-tabs:${spaceId}`;
const spaceVaultKey = (spaceId: string) => `nexote:space-vault:${spaceId}`;

// A space's stashed tab strip (dashboard first), or null when none is saved.
function readSpaceTabs(spaceId: string): { openTabs: string[]; activeId: string | null } | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(spaceTabsKey(spaceId)) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const raw: unknown[] = "openTabs" in parsed && Array.isArray(parsed.openTabs) ? parsed.openTabs : [];
    const ids = raw.filter((t): t is string => typeof t === "string");
    const activeId = "activeId" in parsed && typeof parsed.activeId === "string" ? parsed.activeId : null;
    return { openTabs: ids.includes(DASHBOARD_ID) ? ids : [DASHBOARD_ID, ...ids], activeId };
  } catch {
    return null;
  }
}

/** Old id → new id of spaces and vaults the Android app's engine renamed to
 *  a server's ids on the first sync (its local `rekey` event). */
type Rekey = { spaces: Map<string, string>; vaults: Map<string, string> };

// One side of a `rekey` event's data: an object of old id → new id strings.
function idMap(value: unknown): [string, string][] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "");
}

const NotesContext = createContext<NotesContextValue | null>(null);

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used within NotesProvider");
  return ctx;
}

// Replaces tokens in a title template with the current date/time.
// Supported tokens:
//   DAY   → full weekday name (Monday)
//   DDD   → abbreviated weekday (Mon)
//   DD    → day of month, zero-padded (12)
//   MM    → month number, zero-padded (08)
//   MMM   → abbreviated month name (Aug)
//   YY    → 2-digit year (25)
//   YYYY  → 4-digit year (2025)
//   HH    → hours, zero-padded 24h (14)
//   mm    → minutes, zero-padded (30)
//   ss    → seconds, zero-padded (05)
// Any literal text not matching a token is kept as-is.
export function formatTitle(template: string, date = new Date()): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const daysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const pad = (n: number) => String(n).padStart(2, "0");

  // Replace longest tokens first so "YYYY" doesn't partially match "YY".
  return template
    .replace(/DAY/g, days[date.getDay()])
    .replace(/DDD/g, daysShort[date.getDay()])
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MMM/g, monthsShort[date.getMonth()])
    .replace(/YY/g, pad(date.getFullYear() % 100))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}

// --- URL helpers ---
// The app uses pushState to reflect the active note in the URL without a page
// reload. next.config.mjs rewrites /note/*, /journal/*, /dashboard back to the
// SPA shell so deep links work on a fresh load.

// Parse the current URL into { kind, vaultId?, noteId? } or null for the root.
function parseNoteUrl(pathname: string): { kind: "note" | "journal" | "dashboard"; vaultId?: string; noteId?: string } | null {
  // Old /m/... links (before both interfaces shared one address) still
  // resolve: the server redirects them, offline the worker serves the shell.
  const p = pathname.replace(/^\/m(\/|$)/, "/");
  if (p === "/" || p === "/dashboard") return { kind: "dashboard" };
  const noteM = p.match(/^\/note\/([^/]+)\/([^/]+)\/?$/);
  if (noteM) return { kind: "note", vaultId: noteM[1], noteId: noteM[2] };
  const journalM = p.match(/^\/journal\/([^/]+)\/?$/);
  if (journalM) return { kind: "journal", noteId: journalM[1] };
  return null;
}

// Build the URL path for a given note id + vault context.
function noteUrlPath(id: string, vaultId: string | null, isJournal: boolean): string {
  if (id === DASHBOARD_ID) return "/dashboard";
  if (isJournal) return `/journal/${id}`;
  return `/note/${vaultId ?? ""}/${id}`;
}

// Push a new history entry for the active note (user navigation — back works).
function pushNoteUrl(id: string, vaultId: string | null, isJournal: boolean) {
  if (typeof window === "undefined") return;
  const path = noteUrlPath(id, vaultId, isJournal);
  if (window.location.pathname === path) return;
  window.history.pushState({ nexoteId: id }, "", path);
}

// Replace the current history entry (used by closeTab so back doesn't re-open
// the closed note).
function replaceNoteUrl(id: string, vaultId: string | null, isJournal: boolean) {
  if (typeof window === "undefined") return;
  const path = noteUrlPath(id, vaultId, isJournal);
  if (window.location.pathname === path) return;
  window.history.replaceState({ nexoteId: id }, "", path);
}

export function NotesProvider({ children }: { children: React.ReactNode }) {
  // Every vault the user can open, across all their spaces. The UI works on
  // the active space's vaults (`vaults`); data stays loaded for all of them
  // so links and tabs into another space still resolve.
  const [allVaults, setAllVaults] = useState<VaultMeta[]>([]);
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  // The last applied list, for telling which spaces a refresh removed.
  const spacesRef = useRef<SpaceInfo[]>(spaces);
  useEffect(() => {
    spacesRef.current = spaces;
  }, [spaces]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const vaults = useMemo(
    () => allVaults.filter((v) => v.spaceId === activeSpaceId),
    [allVaults, activeSpaceId],
  );
  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) ?? null,
    [spaces, activeSpaceId],
  );
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [folders, setFolders] = useState<FolderMeta[]>([]);
  // Bookmark/shortcut sets are aggregated across the active space's vaults so
  // the Recent, Shortcuts, and Bookmarks sections work as one list. Per-vault
  // lists (every vault) are kept so toggles write to the correct vault's store.
  const [marksByVault, setMarksByVault] = useState<
    Record<string, { bookmarks: string[]; shortcuts: string[] }>
  >({});
  const bookmarks = useMemo(
    () => new Set(vaults.flatMap((v) => marksByVault[v.id]?.bookmarks ?? [])),
    [marksByVault, vaults],
  );
  const shortcuts = useMemo(
    () => new Set(vaults.flatMap((v) => marksByVault[v.id]?.shortcuts ?? [])),
    [marksByVault, vaults],
  );
  const [openTabs, setOpenTabs] = useState<string[]>([DASHBOARD_ID]);
  const [activeId, setActiveId] = useState<string | null>(DASHBOARD_ID);
  const [notesById, setNotesById] = useState<Record<string, Note>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoredTabs, setRestoredTabs] = useState(false);
  const [allVaultData, setAllVaultData] = useState<
    Record<string, { notes: NoteMeta[]; folders: FolderMeta[] }>
  >({});
  const [journalNotes, setJournalNotes] = useState<NoteMeta[]>([]);
  const [tagsByVault, setTagsByVault] = useState<Record<string, TagCount[]>>({});
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const journalIdsRef = useRef<Set<string>>(new Set());
  // Mirrors of state for use inside the mount-once SSE effect (avoids stale
  // closures over notesById / activeId / activeVaultId).
  const notesByIdRef = useRef<Record<string, Note>>(notesById);
  const activeIdRef = useRef<string | null>(activeId);
  const activeVaultIdRef = useRef<string | null>(activeVaultId);

  useEffect(() => {
    notesByIdRef.current = notesById;
  }, [notesById]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    activeVaultIdRef.current = activeVaultId;
  }, [activeVaultId]);

  const allVaultsRef = useRef<VaultMeta[]>(allVaults);
  const activeSpaceIdRef = useRef<string | null>(activeSpaceId);
  const openTabsRef = useRef<string[]>(openTabs);
  // Assigned once the functions exist (mount-once effects call them).
  const switchSpaceRef = useRef<(id: string) => void>(() => {});
  const refreshSpacesRef = useRef<() => Promise<void>>(async () => {});
  const refreshVaultTreeRef = useRef<(vaultId: string) => Promise<void>>(async () => {});
  const closeTabRef = useRef<(id: string) => void>(() => {});
  // Re-keys announced by the engine and not yet applied by refreshSpaces.
  const rekeyRef = useRef<Rekey>({ spaces: new Map(), vaults: new Map() });

  useEffect(() => {
    allVaultsRef.current = allVaults;
  }, [allVaults]);

  useEffect(() => {
    activeSpaceIdRef.current = activeSpaceId;
  }, [activeSpaceId]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  // Persist open tabs + active note across refreshes.
  useEffect(() => {
    if (!restoredTabs) return;
    try {
      localStorage.setItem("nexote:open-tabs", JSON.stringify(openTabs));
    } catch {
      // ignore
    }
  }, [openTabs, restoredTabs]);

  useEffect(() => {
    if (!restoredTabs) return;
    try {
      localStorage.setItem("nexote:active-id", activeId ?? "");
    } catch {
      // ignore
    }
  }, [activeId, restoredTabs]);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [gitConfig, setGitConfig] = useState<GitConfig | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("nexote:settings");
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, unknown>;
        // Keep known keys only, so options that were removed (autosave,
        // defaultTitle) don't linger in storage.
        const known = Object.fromEntries(
          Object.entries(parsed).filter(([key]) => key in DEFAULT_SETTINGS),
        ) as Partial<AppSettings>;
        // The dashboard's on/off switches of earlier versions become layouts.
        const legacy = "dashboardDesktop" in parsed || "dashboardTouch" in parsed ? null : migrateLegacyDashboard(parsed);
        setSettings({
          ...DEFAULT_SETTINGS,
          ...known,
          ...(legacy ? { dashboardDesktop: legacy.desktop, dashboardTouch: legacy.touch } : {}),
        });
      }
    } catch {
      // ignore malformed settings
    }
  }, []);

  // Read-only mirror for callbacks that need fresh settings value without
  // re-creating (e.g. the tab-restore logic below, which runs once).
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    // The account's settings are written to the server as well, so every
    // device reads the same values. Booleans travel as "true"/"false".
    const prefs: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!isAccountSetting(k)) continue;
      if (typeof v === "string") prefs[k] = v;
      else if (typeof v === "boolean" || typeof v === "number") prefs[k] = String(v);
    }
    if (Object.keys(prefs).length > 0) void api.updatePrefs(prefs).catch(() => {});
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem("nexote:settings", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Pull the account's preferences over this device's settings: the server
  // wins, so every device points at the same Notepad. When the account has
  // none yet (first use) and `upload` is set, this device's choice is
  // uploaded.
  const { user, local } = useAuth();
  const pullPrefs = useCallback(async (upload: boolean) => {
    const { prefs } = await api.getPrefs();
    if (Object.keys(prefs).length === 0) {
      if (!upload) return;
      const local: Record<string, string> = {};
      for (const k of ACCOUNT_SETTINGS) {
        const v = settingsRef.current[k];
        local[k] = typeof v === "boolean" ? String(v) : v;
      }
      void api.updatePrefs(local).catch(() => {});
      return;
    }
    const patch: Partial<AppSettings> = {};
    for (const [k, v] of Object.entries(prefs)) {
      if (!isAccountSetting(k)) continue;
      if (k === "notepadInTree") patch.notepadInTree = v === "true";
      else {
        const key = k as "notepadVault" | "notepadFolder" | "memoNoteVault" | "memoNoteFolder";
        patch[key] = v;
      }
    }
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem("nexote:settings", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  useEffect(() => {
    // Offline or old backend: the device's own settings stay.
    void pullPrefs(true).catch(() => {});
  }, [user?.id, pullPrefs]);

  const activeVault = useMemo(
    () => vaults.find((v) => v.id === activeVaultId) ?? null,
    [vaults, activeVaultId],
  );

  // noteId → vaultId, used to route bookmark/shortcut toggles (and any
  // vault-scoped op) to the vault that actually owns the note.
  const noteVaultMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [vid, data] of Object.entries(allVaultData)) {
      for (const n of data.notes ?? []) map[n.id] = vid;
    }
    return map;
  }, [allVaultData]);
  const noteVaultMapRef = useRef<Record<string, string>>(noteVaultMap);
  useEffect(() => {
    noteVaultMapRef.current = noteVaultMap;
  }, [noteVaultMap]);

  // Load bookmarks+shortcuts for every vault, replacing the merged state.
  const refreshAllMarks = useCallback(async () => {
    const next: Record<string, { bookmarks: string[]; shortcuts: string[] }> = {};
    await Promise.all(
      allVaults.map(async (v) => {
        try {
          const [bm, sc] = await Promise.all([
            api.listBookmarks(v.id),
            api.listShortcuts(v.id),
          ]);
          next[v.id] = {
            bookmarks: bm.bookmarks ?? [],
            shortcuts: sc.shortcuts ?? [],
          };
        } catch {
          next[v.id] = { bookmarks: [], shortcuts: [] };
        }
      }),
    );
    setMarksByVault(next);
  }, [allVaults]);

  // Restore the open tabs + active note from localStorage as early as possible,
  // so the note the user had open reappears without waiting on the heavier
  // per-vault loads. activeId is set immediately (the mobile shell shows a
  // skeleton instead of the dashboard while the body loads) and the active
  // note's body is fetched right away using the last active vault (or journal).
  const restoreTabs = useCallback(async () => {
    // If the URL named a specific note, the URL-nav effect already restored it.
    if (urlNavRef.current) return;
    try {
      const validTabs = readStoredTabs();
      if (!validTabs) {
        setRestoredTabs(true);
        return;
      }
      const storedActive = localStorage.getItem("nexote:active-id");
      // Trust the persisted tabs (they were saved with valid membership).
      // Body loads below skip failures.
      setOpenTabs(validTabs);
      const activeToRestore =
        storedActive && validTabs.includes(storedActive)
          ? storedActive
          : DASHBOARD_ID;
      setActiveId(activeToRestore);
      setRestoredTabs(true);
      // Load the ACTIVE note's body first — the tab the user is looking at.
      if (activeToRestore !== DASHBOARD_ID) {
        const journalIds = journalIdsRef.current;
        try {
          const note = journalIds.has(activeToRestore)
            ? await api.journalGet(activeToRestore)
            : await api.get(activeVaultId ?? "", activeToRestore);
          setNotesById((prev) => ({ ...prev, [activeToRestore]: note }));
        } catch {
          // note may live in another vault; will be resolved once vault data
          // loads via the membership effect below
        }
      }
    } catch {
      // ignore malformed stored state
      setRestoredTabs(true);
    }
  }, [activeVaultId]);

  // Every vault-list change goes through here so mount-once callbacks (via
  // allVaultsRef) see it immediately, not one render later.
  const applyVaults = useCallback((list: VaultMeta[]) => {
    allVaultsRef.current = list;
    setAllVaults(list);
  }, []);

  // Fetch notes/folders, then bookmarks/shortcuts, of the given vaults and
  // merge them into the per-vault state (multi-vault tree, noteVaultMap, the
  // aggregated Recent/Shortcuts/Bookmarks sections).
  const loadVaultData = useCallback(async (list: VaultMeta[]) => {
    const data: Record<string, { notes: NoteMeta[]; folders: FolderMeta[] }> = {};
    await Promise.all(
      list.map(async (v) => {
        try {
          const res = await api.list(v.id);
          data[v.id] = { notes: res.notes ?? [], folders: res.folders ?? [] };
        } catch {
          data[v.id] = { notes: [], folders: [] };
        }
      }),
    );
    setAllVaultData((prev) => ({ ...prev, ...data }));
    const marks: Record<string, { bookmarks: string[]; shortcuts: string[] }> = {};
    await Promise.all(
      list.map(async (v) => {
        try {
          const [bm, sc] = await Promise.all([
            api.listBookmarks(v.id),
            api.listShortcuts(v.id),
          ]);
          marks[v.id] = {
            bookmarks: bm.bookmarks ?? [],
            shortcuts: sc.shortcuts ?? [],
          };
        } catch {
          marks[v.id] = { bookmarks: [], shortcuts: [] };
        }
      }),
    );
    setMarksByVault((prev) => ({ ...prev, ...marks }));
    return data;
  }, []);

  // Load spaces + vaults on mount, then pick the space (the one a deep link
  // points into, else the last used, else the first) and its vault.
  useEffect(() => {
    (async () => {
      try {
        const [spaceRes, vaultRes] = await Promise.all([api.listSpaces(), api.listVaults()]);
        const spaceList = spaceRes.spaces ?? [];
        const list = vaultRes.vaults ?? [];
        setSpaces(spaceList);
        applyVaults(list);
        const urlVault = parseNoteUrl(window.location.pathname)?.vaultId;
        const storedSpace = localStorage.getItem("nexote:active-space");
        const spaceId =
          list.find((v) => v.id === urlVault)?.spaceId ??
          spaceList.find((s) => s.id === storedSpace)?.id ??
          spaceList[0]?.id ??
          null;
        activeSpaceIdRef.current = spaceId;
        setActiveSpaceId(spaceId);
        if (spaceId) localStorage.setItem("nexote:active-space", spaceId);
        const inSpace = list.filter((v) => v.spaceId === spaceId);
        const stored = localStorage.getItem("nexote:active-vault");
        // Never restore the system Collections vault as the active vault —
        // it is hidden from the tree, so a stale stored id would leave the
        // app focused on a vault with no visible section.
        const startVault = settingsRef.current.startVaultId;
        const pick =
          (startVault
            ? inSpace.find((v) => v.id === startVault && !isCollectionsVault(v))?.id
            : undefined) ??
          inSpace.find((v) => v.id === stored && !isCollectionsVault(v))?.id ??
          inSpace.find((v) => !isCollectionsVault(v))?.id ??
          inSpace[0]?.id ??
          null;
        if (pick) {
          setActiveVaultId(pick);
          if (!inSpace.some((v) => v.id === stored)) localStorage.setItem("nexote:active-vault", pick);
          // Restore the open tabs + active note body as early as possible, in
          // parallel with the heavier all-vault loads below, so the note the
          // user had open appears without first waiting on every vault's tree.
          void restoreTabs();
        }
        // Load notes/folders/marks for ALL vaults (multi-vault tree, links
        // and tabs into other spaces).
        await loadVaultData(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load vaults");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL-driven navigation: on mount, if the URL names a note (/note/<vaultId>/
  // <noteId> or /journal/<id>), open it directly — this takes priority over
  // localStorage restore. Also listen for popstate (browser back/forward).
  const urlNavRef = useRef(false);
  useEffect(() => {
    const fromUrl = parseNoteUrl(window.location.pathname);
    if (fromUrl && fromUrl.kind === "note" && fromUrl.vaultId && fromUrl.noteId) {
      urlNavRef.current = true;
      // Switch to the URL's vault, then open the note once the vault is ready.
      setActiveVaultId(fromUrl.vaultId);
      void (async () => {
        try {
          const note = await api.get(fromUrl.vaultId!, fromUrl.noteId!);
          setNotesById((prev) => ({ ...prev, [note.id]: note }));
          // A refresh lands here (the URL names the active note): keep the
          // rest of the saved tab strip instead of collapsing to this tab.
          setOpenTabs(appendOpenTab(readStoredTabs() ?? [DASHBOARD_ID], note.id));
          setActiveId(note.id);
        } catch {
          // note not found via deep link — fall back to restoreTabs
          urlNavRef.current = false;
        }
        setRestoredTabs(true);
      })();
    } else if (fromUrl && fromUrl.kind === "journal" && fromUrl.noteId) {
      urlNavRef.current = true;
      void (async () => {
        try {
          journalIdsRef.current.add(fromUrl.noteId!);
          const note = await api.journalGet(fromUrl.noteId!);
          setNotesById((prev) => ({ ...prev, [note.id]: note }));
          setOpenTabs(appendOpenTab(readStoredTabs() ?? [DASHBOARD_ID], note.id));
          setActiveId(note.id);
        } catch {
          urlNavRef.current = false;
        }
        setRestoredTabs(true);
      })();
    }
    // popstate: browser back/forward — open the note the URL names without
    // pushing a new history entry.
    const onPopState = () => {
      const parsed = parseNoteUrl(window.location.pathname);
      if (!parsed) return;
      if (parsed.kind === "dashboard") {
        setActiveId(DASHBOARD_ID);
        return;
      }
      if (parsed.kind === "journal" && parsed.noteId) {
        const nid = parsed.noteId;
        journalIdsRef.current.add(nid);
        void (async () => {
          try {
            if (!notesByIdRef.current[nid]) {
              const note = await api.journalGet(nid);
              setNotesById((prev) => ({ ...prev, [note.id]: note }));
            }
            setOpenTabs((prev) => appendOpenTab(prev, nid));
            setActiveId(nid);
          } catch {}
        })();
        return;
      }
      if (parsed.kind === "note" && parsed.vaultId && parsed.noteId) {
        const vid = parsed.vaultId;
        const nid = parsed.noteId;
        // History can lead into another space: switch the workspace too.
        const vaultSpace = allVaultsRef.current.find((v) => v.id === vid)?.spaceId;
        if (vaultSpace && vaultSpace !== activeSpaceIdRef.current) switchSpaceRef.current(vaultSpace);
        if (vid !== activeVaultIdRef.current) {
          setActiveVaultId(vid);
        }
        void (async () => {
          try {
            if (!notesByIdRef.current[nid]) {
              const note = await api.get(vid, nid);
              setNotesById((prev) => ({ ...prev, [note.id]: note }));
            }
            setOpenTabs((prev) => appendOpenTab(prev, nid));
            setActiveId(nid);
          } catch {}
        })();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Offline copy: request every list and the notes most likely to be opened
  // (open tabs, bookmarks, the Notepad, the most recently edited) once while
  // online; the service worker stores each response. Only with an active
  // worker (production; on a first visit it takes control after load), and
  // the bodies at most every 10 minutes. The Android app has no worker.
  useEffect(() => {
    const sw = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (isAndroidApp || !allVaults.length || !sw) return;
    let cancelled = false;
    const precache = async () => {
      const ok = <T,>(p: Promise<T>) => p.catch(() => undefined);
      await ok(api.listSpaces());
      await ok(api.listVaults());
      for (const s of spaces) await ok(api.listCollections(s.id));
      const wanted: Array<[string, string]> = [];
      const recent: Array<[string, NoteMeta]> = [];
      // The personal store (Notepad, quick notes) is in no vault list.
      for (const vid of [HOME_VAULT, ...allVaults.map((v) => v.id)]) {
        if (cancelled) return;
        const [list, bm] = await Promise.all([
          ok(api.list(vid)),
          ok(api.listBookmarks(vid)),
          ok(api.listShortcuts(vid)),
          ok(api.listTags(vid)),
        ]);
        for (const n of list?.notes ?? []) {
          recent.push([vid, n]);
          if (n.title === NOTEPAD_TITLE) wanted.push([vid, n.id]);
        }
        for (const id of bm?.bookmarks ?? []) wanted.push([vid, id]);
      }
      await ok(api.journalList());
      if (Date.now() - lastBodyPrecache < 10 * 60_000) return;
      lastBodyPrecache = Date.now();
      for (const id of openTabsRef.current) {
        const vid = noteVaultMapRef.current[id];
        if (vid) wanted.push([vid, id]);
      }
      recent.sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
      for (const [vid, n] of recent.slice(0, 50)) wanted.push([vid, n.id]);
      const queue = [...new Map(wanted.map(([vid, id]) => [`${vid}/${id}`, [vid, id] as const])).values()];
      // A few at a time: don't flood the server on a big vault.
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let next = queue.shift(); next && !cancelled; next = queue.shift()) {
            await ok(api.get(next[0], next[1]));
          }
        }),
      );
    };
    const onControl = () => void precache();
    if (sw.controller) void precache();
    else sw.addEventListener("controllerchange", onControl, { once: true });
    return () => {
      cancelled = true;
      sw.removeEventListener("controllerchange", onControl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVaults, spaces]);

  // Once every vault's membership is known, fetch the bodies of any open tabs
  // that aren't cached yet (the active note was fetched immediately; these are
  // the other, non-active tabs). Resolves each tab's owning vault via the map.
  useEffect(() => {
    if (!restoredTabs || !activeVaultId) return;
    const missing = openTabs.filter(
      (id) => id !== DASHBOARD_ID && !notesById[id],
    );
    if (missing.length === 0) return;
    (async () => {
      const loaded: Record<string, Note> = {};
      await Promise.all(
        missing.map(async (id) => {
          try {
            const vaultId = noteVaultMap[id];
            loaded[id] = vaultId
              ? await api.get(vaultId, id)
              : await api.journalGet(id);
          } catch {
            // skip notes that fail to load
          }
        }),
      );
      if (Object.keys(loaded).length > 0) {
        setNotesById((prev) => ({ ...prev, ...loaded }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVaultData, restoredTabs]);

  const switchVault = useCallback((id: string) => {
    setActiveVaultId(id);
    localStorage.setItem("nexote:active-vault", id);
    // Each space remembers its last vault for switching back.
    const spaceId = allVaultsRef.current.find((v) => v.id === id)?.spaceId;
    if (spaceId) localStorage.setItem(spaceVaultKey(spaceId), id);
    // Switching vaults only changes the tree's focus vault. Keep the stale
    // notes/folders visible until refresh() completes — blanking here made
    // the tree flicker/disappear on slow backends, so a note clicked in
    // another vault appeared unselected until the second click.
    // Open tabs and the note-body cache are shared across the space's
    // vaults (one tab list per space), so they stay intact. Bookmarks/
    // shortcuts are already aggregated.
  }, []);

  const createVault = useCallback(async (name: string, icon?: string) => {
    const spaceId = activeSpaceIdRef.current;
    if (!spaceId) return;
    try {
      const vault = await api.createVault(name, spaceId, icon);
      applyVaults([...allVaultsRef.current, vault]);
      setAllVaultData((prev) => ({ ...prev, [vault.id]: { notes: [], folders: [] } }));
      setMarksByVault((prev) => ({ ...prev, [vault.id]: { bookmarks: [], shortcuts: [] } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create vault");
    }
  }, [applyVaults]);

  const renameVault = useCallback(async (id: string, name: string) => {
    try {
      const vault = await api.renameVault(id, name);
      applyVaults(allVaultsRef.current.map((v) => (v.id === id ? vault : v)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename vault");
    }
  }, [applyVaults]);

  const deleteVault = useCallback(
    async (id: string) => {
      try {
        await api.deleteVault(id);
        setMarksByVault((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAllVaultData((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setTagsByVault((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        const next = allVaultsRef.current.filter((v) => v.id !== id);
        applyVaults(next);
        if (activeVaultId === id) {
          const fallback = next.find(
            (v) => v.spaceId === activeSpaceIdRef.current && !isCollectionsVault(v),
          );
          if (fallback) switchVault(fallback.id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete vault");
      }
    },
    [activeVaultId, switchVault, applyVaults],
  );

  const setVaultIcon = useCallback(async (id: string, icon: string) => {
    try {
      const vault = await api.setVaultIcon(id, icon);
      applyVaults(allVaultsRef.current.map((v) => (v.id === id ? vault : v)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set vault icon");
    }
  }, [applyVaults]);

  // --- Spaces ---

  // Switch the whole workspace to another space: its vaults and its own tab
  // strip. The current strip is stashed for switching back.
  const switchSpace = useCallback((id: string) => {
    const current = activeSpaceIdRef.current;
    if (id === current) return;
    try {
      if (current) {
        localStorage.setItem(
          spaceTabsKey(current),
          JSON.stringify({ openTabs: openTabsRef.current, activeId: activeIdRef.current }),
        );
      }
      localStorage.setItem("nexote:active-space", id);
    } catch {
      // ignore
    }
    const saved = readSpaceTabs(id);
    const tabs = saved?.openTabs ?? [DASHBOARD_ID];
    const active = saved?.activeId && tabs.includes(saved.activeId) ? saved.activeId : DASHBOARD_ID;
    activeSpaceIdRef.current = id;
    setActiveSpaceId(id);
    setOpenTabs(tabs);
    setActiveId(active);
    const inSpace = allVaultsRef.current.filter((v) => v.spaceId === id && !isCollectionsVault(v));
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(spaceVaultKey(id));
    } catch {
      // ignore
    }
    const vault = inSpace.find((v) => v.id === remembered) ?? inSpace[0];
    if (vault) {
      setActiveVaultId(vault.id);
      try {
        localStorage.setItem("nexote:active-vault", vault.id);
      } catch {
        // ignore
      }
    }
    if (active === DASHBOARD_ID) {
      replaceNoteUrl(DASHBOARD_ID, null, false);
      return;
    }
    const noteVault = noteVaultMapRef.current[active] ?? null;
    replaceNoteUrl(active, noteVault, journalIdsRef.current.has(active));
    if (!notesByIdRef.current[active]) {
      void (noteVault ? api.get(noteVault, active) : api.journalGet(active))
        .then((note) => setNotesById((prev) => ({ ...prev, [note.id]: note })))
        .catch(() => {});
    }
  }, []);

  // After vaults vanished: open notes that lived in them are re-read from
  // where they are now (a re-keyed vault; bodies may have changed, e.g. image
  // URLs), and tabs of notes that are gone close instead of showing a note
  // whose saves would fail. Journal tabs are checked too: the first sync
  // merges a daily note made on the phone into the server's, and the phone's
  // id disappears.
  const reconcileOpenNotes = useCallback(
    async (
      goneVaults: Set<string>,
      oldNoteVaults: Record<string, string>,
      addedData: Record<string, { notes: NoteMeta[] }>,
    ) => {
      const where: Record<string, string> = {};
      for (const [vid, data] of Object.entries(addedData)) for (const n of data.notes) where[n.id] = vid;
      const ids = new Set([...openTabsRef.current, ...Object.keys(notesByIdRef.current)]);
      ids.delete(DASHBOARD_ID);
      await Promise.all(
        [...ids].map(async (id) => {
          const before = oldNoteVaults[id];
          const journal = !before && journalIdsRef.current.has(id);
          // Notes in vaults that are still there are untouched.
          if (!journal && (!before || !goneVaults.has(before))) return;
          const vid = journal ? null : where[id];
          if (!journal && !vid) {
            closeTabRef.current(id);
            return;
          }
          try {
            const fresh = vid ? await api.get(vid, id) : await api.journalGet(id);
            if (vid && id === activeIdRef.current) replaceNoteUrl(id, vid, false);
            // Never swap the body under someone typing; the next live update will.
            if (id === activeIdRef.current && Date.now() - lastEditAtRef.current < 1500) return;
            setNotesById((prev) => (prev[id] && prev[id].body !== fresh.body ? { ...prev, [id]: fresh } : prev));
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) closeTabRef.current(id);
          }
        }),
      );
    },
    [],
  );

  // Reload spaces and vaults: after creating, leaving or deleting a space,
  // and when the server says membership or vaults changed (SSE). Loads data
  // for new vaults, drops data of vaults no longer reachable, and leaves a
  // space that is gone — for its re-keyed counterpart when the engine named
  // one (`rekey` event), carrying the tab strip and stored choices along.
  const refreshSpaces = useCallback(async () => {
    const [spaceRes, vaultRes] = await Promise.all([api.listSpaces(), api.listVaults()]);
    const spaceList = spaceRes.spaces ?? [];
    const list = vaultRes.vaults ?? [];
    const oldVaults = allVaultsRef.current;
    const rekeyed = rekeyRef.current;
    const known = new Set(oldVaults.map((v) => v.id));
    const reachable = new Set(list.map((v) => v.id));
    const goneSpaces = spacesRef.current.filter((s) => !spaceList.some((n) => n.id === s.id));
    const goneVaults = new Set(oldVaults.filter((v) => !reachable.has(v.id)).map((v) => v.id));
    // Where open notes lived before this refresh (the map follows state).
    const oldNoteVaults = noteVaultMapRef.current;
    spacesRef.current = spaceList;
    setSpaces(spaceList);
    applyVaults(list);
    const keep = <T,>(prev: Record<string, T>) =>
      Object.fromEntries(Object.entries(prev).filter(([id]) => reachable.has(id)));
    setAllVaultData(keep);
    setMarksByVault(keep);
    const current = activeSpaceIdRef.current;
    const activeVault = activeVaultIdRef.current;
    const movedVault = activeVault ? rekeyed.vaults.get(activeVault) : undefined;
    if (current && !spaceList.some((s) => s.id === current)) {
      const target = rekeyed.spaces.get(current);
      if (target) {
        // Re-keyed: the same space under a new id keeps its tabs and vault.
        try {
          if (!readSpaceTabs(target)) {
            localStorage.setItem(
              spaceTabsKey(target),
              JSON.stringify({ openTabs: openTabsRef.current, activeId: activeIdRef.current }),
            );
          }
          const vault = movedVault ?? activeVault;
          if (vault && list.some((v) => v.id === vault && v.spaceId === target)) {
            localStorage.setItem(spaceVaultKey(target), vault);
          }
        } catch {
          // ignore
        }
        switchSpace(target);
      } else if (spaceList[0]) {
        switchSpace(spaceList[0].id);
      }
    } else if (!list.some((v) => v.id === activeVault)) {
      const next = movedVault ?? list.find((v) => v.spaceId === current && !isCollectionsVault(v))?.id;
      if (next) switchVault(next);
    }
    // Stashed strips of spaces that are gone would never be read again.
    try {
      for (const s of goneSpaces) {
        localStorage.removeItem(spaceTabsKey(s.id));
        localStorage.removeItem(spaceVaultKey(s.id));
      }
    } catch {
      // ignore
    }
    // This device's own choice follows a re-key or falls back to the default.
    // The account's (Notepad, memo notes) are never written from here: they
    // reach every device, and the engine re-keys them itself — read them
    // again instead.
    const s = settingsRef.current;
    if (goneVaults.has(s.startVaultId)) updateSettings({ startVaultId: rekeyed.vaults.get(s.startVaultId) ?? "" });
    if (goneVaults.has(s.notepadVault) || goneVaults.has(s.memoNoteVault)) void pullPrefs(false).catch(() => {});
    // Applied now; the rest of a re-key (if any) waits for its own refresh.
    for (const g of goneSpaces) rekeyed.spaces.delete(g.id);
    for (const id of goneVaults) rekeyed.vaults.delete(id);
    const added = list.filter((v) => !known.has(v.id));
    const addedData = added.length ? await loadVaultData(added) : {};
    if (goneVaults.size > 0) await reconcileOpenNotes(goneVaults, oldNoteVaults, addedData);
  }, [applyVaults, loadVaultData, pullPrefs, reconcileOpenNotes, switchSpace, switchVault, updateSettings]);

  const createSpace = useCallback(
    async (name: string, icon?: string) => {
      const space = await api.createSpace({ name, icon });
      await refreshSpaces();
      switchSpace(space.id);
      return space;
    },
    [refreshSpaces, switchSpace],
  );

  const updateSpace = useCallback(async (id: string, patch: { name?: string; icon?: string }) => {
    const space = await api.updateSpace(id, patch);
    setSpaces((prev) => prev.map((s) => (s.id === id ? space : s)));
    return space;
  }, []);

  // After deleting or leaving a space: move off it and forget its tabs.
  const dropSpace = useCallback(
    async (id: string) => {
      if (activeSpaceIdRef.current === id) {
        const other = spaces.find((s) => s.id !== id);
        if (other) switchSpace(other.id);
      }
      try {
        localStorage.removeItem(spaceTabsKey(id));
        localStorage.removeItem(spaceVaultKey(id));
      } catch {
        // ignore
      }
      await refreshSpaces();
    },
    [spaces, switchSpace, refreshSpaces],
  );

  const deleteSpace = useCallback(
    async (id: string) => {
      await api.deleteSpace(id);
      await dropSpace(id);
    },
    [dropSpace],
  );

  const leaveSpace = useCallback(
    async (id: string) => {
      await api.leaveSpace(id);
      await dropSpace(id);
    },
    [dropSpace],
  );

  useEffect(() => {
    switchSpaceRef.current = switchSpace;
    refreshSpacesRef.current = refreshSpaces;
  }, [switchSpace, refreshSpaces]);

  const listCollections = useCallback(async () => {
    const spaceId = activeSpaceIdRef.current;
    if (!spaceId) return [];
    const res = await api.listCollections(spaceId);
    return res.collections ?? [];
  }, []);

  const refresh = useCallback(async () => {
    if (!activeVaultId) return;
    try {
      const result = await api.list(activeVaultId);
      result.notes?.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setNotes(result.notes ?? []);
      setFolders(result.folders ?? []);
      const [bm, sc] = await Promise.all([
        api.listBookmarks(activeVaultId),
        api.listShortcuts(activeVaultId),
      ]);
      setMarksByVault((prev) => ({
        ...prev,
        [activeVaultId]: {
          bookmarks: bm.bookmarks ?? [],
          shortcuts: sc.shortcuts ?? [],
        },
      }));
      // Also update all-vault data for the active vault
      setAllVaultData((prev) => ({
        ...prev,
        [activeVaultId]: { notes: result.notes ?? [], folders: result.folders ?? [] },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notes");
    }
  }, [activeVaultId]);

  // Load notes when the active vault changes.
  useEffect(() => {    if (!activeVaultId) return;
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [activeVaultId, refresh]);

  const openTab = useCallback(
    async (id: string) => {
      if (id === DASHBOARD_ID) {
        setActiveId(DASHBOARD_ID);
        pushNoteUrl(DASHBOARD_ID, null, false);
        return;
      }
      // Route to the note's owning vault (tabs are shared across all vaults).
      const vaultId = noteVaultMap[id] ?? activeVaultId;
      if (openTabs.includes(id)) {
        setActiveId(id);
        pushNoteUrl(id, vaultId, journalIdsRef.current.has(id));
        if (vaultId && !notesById[id]) {
          try {
            const note = await api.get(vaultId, id);
            setNotesById((prev) => ({ ...prev, [id]: note }));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load note");
          }
        }
        return;
      }
      if (!vaultId) return;
      setActiveId(id);
      setOpenTabs((prev) => appendOpenTab(prev, id));
      pushNoteUrl(id, vaultId, journalIdsRef.current.has(id));
      if (!notesById[id]) {
        try {
          const note = await api.get(vaultId, id);
          setNotesById((prev) => ({ ...prev, [id]: note }));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to load note");
        }
      }
    },
    [openTabs, notesById, activeVaultId, noteVaultMap, setNotes],
  );

  // Open a journal note (vault-independent). Loads from /api/journal.
  // Declared before openNoteInVault: the vault-open router below dispatches
  // journal ids here (deps array-wise it must exist at definition time).
  const openJournalNote = useCallback(
    async (id: string) => {
      journalIdsRef.current.add(id);
      setActiveId(id);
      setOpenTabs((prev) => appendOpenTab(prev, id));
      pushNoteUrl(id, null, true);
      if (!notesById[id]) {
        try {
          const note = await api.journalGet(id);
          setNotesById((prev) => ({ ...prev, [id]: note }));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to load journal note");
        }
      }
    },
    [notesById],
  );

  // Open a note from any vault. Switches vault if needed, then opens the note.
  // The journal pseudo vault routes through the journal APIs instead.
  const openNoteInVault = useCallback(
    async (vaultId: string, noteId: string) => {
      if (vaultId === "journal") {
        openJournalNote(noteId);
        return;
      }
      // A note in another space switches the workspace first.
      const vaultSpace = allVaultsRef.current.find((v) => v.id === vaultId)?.spaceId;
      if (vaultSpace && vaultSpace !== activeSpaceIdRef.current) switchSpace(vaultSpace);
      // Focus the owning vault so the tree/context is consistent, then open the
      // shared tab. Tabs are cross-vault, so this adds/focuses one space tab.
      if (vaultId !== activeVaultId) switchVault(vaultId);
      await openTab(noteId);
    },
    [activeVaultId, switchVault, switchSpace, openTab, openJournalNote],
  );

  const closeTab = useCallback((id: string) => {
    if (id === DASHBOARD_ID) return;
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const idx = prev.indexOf(id);
        const newActive = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
        // Replace the URL so back doesn't re-open the closed tab.
        if (newActive === DASHBOARD_ID || newActive === null) {
          replaceNoteUrl(DASHBOARD_ID, null, false);
        } else {
          const vid = noteVaultMap[newActive] ?? activeVaultIdRef.current;
          replaceNoteUrl(newActive, vid, journalIdsRef.current.has(newActive));
        }
        return newActive;
      });
      return next;
    });
    setNotesById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [noteVaultMap]);
  useEffect(() => {
    closeTabRef.current = closeTab;
  }, [closeTab]);

  const create = useCallback(
    async (input?: { title?: string; path?: string; vaultId?: string; rename?: boolean }) => {
      if (!activeVaultId) return;
      setCreating(true);
      try {
        // Vault targeted from the tree (right-click context) wins if given;
        // those vaults come from the visible tree, so no redirect applies.
        // Never create regular notes inside the system Collections vault —
        // it can become the active vault when a collection item is open.
        // Redirect untargeted creates into the Collections vault to the
        // first regular vault instead.
        const vaultId = input?.vaultId
          ? input.vaultId
          : activeVaultId && vaults.find((v) => v.id === activeVaultId)?.type === "collections"
            ? vaults.find((v) => v.type !== "collections" && v.name !== "Collections")?.id ??
              activeVaultId
            : activeVaultId;
        const title =
          input?.title ?? (formatTitle(settings.titleTemplate).trim() || "Untitled");
        // When no explicit path is given, create the note in the same folder
        // as the currently active note. Journal notes are skipped: they live
        // in a separate store (one note per day) and create targets the
        // vault — that proximity rule only makes sense without an explicit
        // path/vault target, otherwise the note must land in the vault root.
        const targetPath =
          input?.path !== undefined
            ? input.path
            : input?.vaultId
              ? undefined
              : activeId && activeId !== DASHBOARD_ID &&
                !journalIdsRef.current.has(activeId)
                ? (notesById[activeId]?.path || undefined)
                : undefined;
        const note = await api.create(vaultId, {
          title,
          path: targetPath,
          // With the heading toggle off the note starts as a plain blank
          // paragraph (classic Obsidian look) — no `## title` seed.
          body: settings.headingOnNewNote ? undefined : "\n",
        });
        await refresh();
        setNotesById((prev) => ({ ...prev, [note.id]: note }));
        setOpenTabs((prev) => appendOpenTab(prev, note.id));
        // Focus the owning vault (tree context) so the new note is visible
        // in the vault it was created for.
        if (vaultId !== activeVaultId) switchVault(vaultId);
        setActiveId(note.id);
        pushNoteUrl(note.id, vaultId, false);
        if (input?.rename !== false) window.dispatchEvent(new CustomEvent("nexote:rename-new-note"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create note");
      } finally {
        setCreating(false);
      }
    },
    [activeVaultId, vaults, switchVault, refresh, settings.titleTemplate, settings.headingOnNewNote, activeId, notesById],
  );

  const copyNote = useCallback(
    async (id: string) => {
      // Copy within the note's owning vault so aggregated sections work
      // across all vaults.
      const vaultId = noteVaultMap[id] ?? activeVaultId;
      if (!vaultId) return;
      try {
        const note = await api.copy(vaultId, id);
        if (vaultId === activeVaultId) {
          await refresh();
        } else {
          try {
            const res = await api.list(vaultId);
            setAllVaultData((prev) => ({
              ...prev,
              [vaultId]: { notes: res.notes ?? [], folders: res.folders ?? [] },
            }));
          } catch {
            // ignore
          }
        }
        setNotesById((prev) => ({ ...prev, [note.id]: note }));
        setOpenTabs((prev) => appendOpenTab(prev, note.id));
        setActiveId(note.id);
        pushNoteUrl(note.id, vaultId, false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to copy note");
      }
    },
    [activeVaultId, noteVaultMap, refresh],
  );

  const moveNoteToVault = useCallback(
    async (noteId: string, dstVaultId: string, dstPath?: string) => {
      // Resolve the SOURCE vault from the note actually being moved — the
      // note may live in any vault (drag from another vault's section or
      // the Move-to dialog), while `activeVaultId` may point somewhere
      // else entirely. Using the active vault here made every cross-vault
      // move fail with "note not found" for notes not in the active vault.
      const srcVaultId = noteVaultMap[noteId] ?? activeVaultId;
      if (!srcVaultId || srcVaultId === dstVaultId) return;
      try {
        await api.move(srcVaultId, noteId, dstVaultId, dstPath);
        // Remove from open tabs if present
        closeTab(noteId);
        // Refresh both vaults' data (source may differ from the active one).
        try {
          const [dstResult, srcResult] = await Promise.all([
            api.list(dstVaultId),
            api.list(srcVaultId),
          ]);
          setAllVaultData((prev) => ({
            ...prev,
            [dstVaultId]: {
              notes: dstResult.notes ?? [],
              folders: dstResult.folders ?? [],
            },
            [srcVaultId]: {
              notes: srcResult.notes ?? [],
              folders: srcResult.folders ?? [],
            },
          }));
        } catch {
          // ignore
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to move note");
      }
    },
    [activeVaultId, noteVaultMap, closeTab, refresh],
  );

  const toggleBookmark = useCallback(
    async (id: string) => {
      // The note may live in another vault; route the toggle there so the
      // aggregated Bookmarks section works across all vaults.
      const vaultId = noteVaultMap[id] ?? activeVaultId;
      if (!vaultId) return;
      const isBookmarked = bookmarks.has(id);
      setMarksByVault((prev) => ({
        ...prev,
        [vaultId]: {
          bookmarks: isBookmarked
            ? (prev[vaultId]?.bookmarks ?? []).filter((x) => x !== id)
            : [...(prev[vaultId]?.bookmarks ?? []), id],
          shortcuts: prev[vaultId]?.shortcuts ?? [],
        },
      }));
      try {
        if (isBookmarked) await api.removeBookmark(vaultId, id);
        else await api.addBookmark(vaultId, id);
      } catch (e) {
        setMarksByVault((prev) => ({
          ...prev,
          [vaultId]: {
            bookmarks: (prev[vaultId]?.bookmarks ?? []).filter((x) => x !== id),
            shortcuts: prev[vaultId]?.shortcuts ?? [],
          },
        }));
        setError(e instanceof Error ? e.message : "Failed to toggle bookmark");
      }
    },
    [bookmarks, activeVaultId, noteVaultMap],
  );

  const toggleShortcut = useCallback(
    async (id: string) => {
      const vaultId = noteVaultMap[id] ?? activeVaultId;
      if (!vaultId) return;
      const isShortcut = shortcuts.has(id);
      setMarksByVault((prev) => ({
        ...prev,
        [vaultId]: {
          bookmarks: prev[vaultId]?.bookmarks ?? [],
          shortcuts: isShortcut
            ? (prev[vaultId]?.shortcuts ?? []).filter((x) => x !== id)
            : [...(prev[vaultId]?.shortcuts ?? []), id],
        },
      }));
      try {
        if (isShortcut) await api.removeShortcut(vaultId, id);
        else await api.addShortcut(vaultId, id);
      } catch (e) {
        setMarksByVault((prev) => ({
          ...prev,
          [vaultId]: {
            bookmarks: prev[vaultId]?.bookmarks ?? [],
            shortcuts: (prev[vaultId]?.shortcuts ?? []).filter((x) => x !== id),
          },
        }));
        setError(e instanceof Error ? e.message : "Failed to toggle shortcut");
      }
    },
    [shortcuts, activeVaultId, noteVaultMap],
  );

  const createFolder = useCallback(
    async (path: string) => {
      if (!activeVaultId) return;
      try {
        await api.createFolder(activeVaultId, path);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create folder");
      }
    },
    [activeVaultId, refresh],
  );

  const removeFolder = useCallback(
    async (path: string) => {
      if (!activeVaultId) return;
      try {
        await api.removeFolder(activeVaultId, path);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete folder");
      }
    },
    [activeVaultId, refresh],
  );

  const setFolderLabel = useCallback(
    async (vaultId: string, path: string, color: string) => {
      try {
        await api.setFolderLabel(vaultId, path, color);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to label folder");
      }
    },
    [refresh],
  );

  const renameFolder = useCallback(
    async (oldPath: string, newPath: string) => {
      if (!activeVaultId) return;
      try {
        await api.renameFolder(activeVaultId, oldPath, newPath);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to rename folder");
      }
    },
    [activeVaultId, refresh],
  );

  const moveNote = useCallback(
    async (id: string, path: string) => {
      // The note's own vault: the tree lists every vault of the space, and a
      // note moved from another vault's section isn't in the active one.
      const vaultId = noteVaultMapRef.current[id] ?? activeVaultId;
      if (!vaultId) return;
      try {
        // Send ONLY the path. The backend persists title/body when the
        // request omits them, so a move that races the editor's debounced
        // save can neither overwrite a fresh draft with the cached body nor
        // revert the path (previously the stale cached body was sent
        // explicitly and could clobber recent edits).
        await api.update(vaultId, id, { path });
        if (vaultId === activeVaultId) await refresh();
        else await refreshVaultTreeRef.current(vaultId);
        setNotesById((prev) => {
          const cached = prev[id];
          if (!cached) return prev;
          return { ...prev, [id]: { ...cached, path } };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to move note");
      }
    },
    [activeVaultId, refresh],
  );

  const refreshJournal = useCallback(async () => {
    try {
      const list = await api.journalList();
      // Older backends marshal an empty journal list as `null` — never store
      // a null into context, or sort() calls in the sidebar crash the tree.
      const notes = list.notes ?? [];
      setJournalNotes(notes);
      for (const n of notes) journalIdsRef.current.add(n.id);
    } catch {
      // Journal store may not be available yet — ignore.
    }
  }, []);

  useEffect(() => {
    void refreshJournal();
  }, [refreshJournal]);

  // [[Link]] chips in the editor open the note with that title: the active
  // space first, then any space, then the journal. A missing note is created
  // next to the current one (like Obsidian). "[[Note#Heading]]" opens Note.
  const openWikilinkRef = useRef<(target: string) => void>(() => {});
  openWikilinkRef.current = (target: string) => {
    const title = target.split("#")[0].trim();
    if (!title) return;
    const key = title.toLowerCase();
    const find = (list: VaultMeta[]) => {
      for (const v of list) {
        const note = allVaultData[v.id]?.notes.find((n) => !n.collection && n.title.toLowerCase() === key);
        if (note) return { vaultId: v.id, id: note.id };
      }
      return null;
    };
    const hit = find(vaults) ?? find(allVaults);
    if (hit) {
      void openNoteInVault(hit.vaultId, hit.id);
      return;
    }
    const journal = journalNotes.find((n) => n.title.toLowerCase() === key);
    if (journal) {
      void openJournalNote(journal.id);
      return;
    }
    void create({ title, rename: false });
  };
  useEffect(() => {
    const onOpen = (e: Event) => {
      if (e instanceof CustomEvent && typeof e.detail === "string") openWikilinkRef.current(e.detail);
    };
    window.addEventListener(OPEN_WIKILINK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WIKILINK_EVENT, onOpen);
  }, []);

  // Offline sync finished (or the live connection came back): reload every
  // vault tree, marks and the journal.
  useEffect(() => {
    const onRefresh = () => {
      void refresh();
      for (const v of allVaultsRef.current) void refreshVaultTreeRef.current(v.id);
      void refreshAllMarks();
      void refreshJournal();
    };
    window.addEventListener("nexote:refresh-data", onRefresh);
    return () => window.removeEventListener("nexote:refresh-data", onRefresh);
  }, [refresh, refreshAllMarks, refreshJournal]);

  // Live sync: subscribe to the backend's Server-Sent Events stream and, when
  // another client saves an open note, refetch its body and swap it in (the
  // editor remounts through the existing bodyChanged path when not actively
  // edited). Guardrails:
  //   - skip notes that aren't open in a tab (no cached copy),
  //   - skip if this client is actively typing on the active note (<1.5s since
  //     the last keystroke), so the editor is never yanked mid-typing,
  //   - skip events no newer than the cached copy (e.g. our own save echo),
  //   - EventSource errors auto-reconnect after a few seconds.
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let disconnected = false;
    // Bulk operations send a burst of tree-change events; refetch once per vault.
    const treeTimers = new Map<string, number>();

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/events");
      es.addEventListener("note-change", (event) => {
        let data: { vaultId?: string; id?: string; updatedAt?: string };
        try {
          data = JSON.parse((event as MessageEvent).data);
        } catch {
          return;
        }
        const { vaultId, id, updatedAt } = data;
        if (!vaultId || !id || !updatedAt) return;
        // For views holding notes outside the provider's cache (threads).
        window.dispatchEvent(new CustomEvent(NOTE_CHANGE_EVENT, { detail: { vaultId, id, updatedAt } }));
        const cached = notesByIdRef.current[id];
        if (!cached) return;
        // The user is typing on this note right now — don't yank the editor.
        if (
          id === activeIdRef.current &&
          Date.now() - lastEditAtRef.current < 1500
        ) {
          return;
        }
        // Any other version replaces the cached one, older ones too: a sync
        // writes the other side's note with that side's timestamps (and
        // the phone's clock may lag the server's), so "newer" isn't a test.
        if (Date.parse(cached.updatedAt) === Date.parse(updatedAt)) return;
        void (async () => {
          try {
            const fresh =
              vaultId === "journal"
                ? await api.journalGet(id)
                : await api.get(vaultId, id);
            setNotesById((prev) => {
              const cur = prev[id];
              if (!cur || Date.parse(cur.updatedAt) === Date.parse(fresh.updatedAt)) {
                return prev;
              }
              return { ...prev, [id]: fresh };
            });
          } catch {
            // Transient (backend briefly down); the next event will retry.
          }
        })();
      });
      // Another client created, moved, renamed or deleted notes or folders.
      es.addEventListener("tree-change", (event) => {
        let vaultId: unknown;
        try {
          const data: unknown = JSON.parse(event instanceof MessageEvent ? String(event.data) : "");
          vaultId = data && typeof data === "object" && "vaultId" in data ? data.vaultId : undefined;
        } catch {
          return;
        }
        if (typeof vaultId !== "string") return;
        // For views that hold notes of a vault outside the provider's cache
        // (quick notes: its Notepad may have been replaced).
        window.dispatchEvent(new CustomEvent(TREE_CHANGE_EVENT, { detail: { vaultId } }));
        const id = vaultId;
        window.clearTimeout(treeTimers.get(id));
        treeTimers.set(
          id,
          window.setTimeout(() => {
            treeTimers.delete(id);
            void refreshVaultTreeRef.current(id);
          }, 300),
        );
      });
      // The Android app's engine renamed spaces/vaults to a server's ids
      // (first sync); sent just before the spaces-change that applies it.
      es.addEventListener("rekey", (event) => {
        let data: unknown;
        try {
          data = JSON.parse(event instanceof MessageEvent ? String(event.data) : "");
        } catch {
          return;
        }
        if (typeof data !== "object" || data === null) return;
        const { spaces, vaults } = rekeyRef.current;
        for (const [from, to] of idMap("spaces" in data ? data.spaces : null)) spaces.set(from, to);
        for (const [from, to] of idMap("vaults" in data ? data.vaults : null)) vaults.set(from, to);
      });
      // The user's spaces, a space's members, vaults or collections changed.
      // The data reload waits for the new lists: run alongside, it would
      // reload (and replace the marks of) vaults that may have just vanished.
      es.addEventListener("spaces-change", () => {
        void refreshSpacesRef.current()
          .catch(() => {})
          .finally(() => window.dispatchEvent(new Event("nexote:refresh-data")));
      });
      // Reconnected after a drop: events sent meanwhile are lost, so reload
      // the trees and the open notes that changed.
      es.onopen = () => {
        if (!disconnected) return;
        disconnected = false;
        window.dispatchEvent(new Event("nexote:refresh-data"));
        void refreshSpacesRef.current().catch(() => {});
        for (const [id, cached] of Object.entries(notesByIdRef.current)) {
          const vaultId = journalIdsRef.current.has(id) ? "journal" : noteVaultMapRef.current[id];
          if (!vaultId || id === activeIdRef.current && Date.now() - lastEditAtRef.current < 1500) continue;
          void (vaultId === "journal" ? api.journalGet(id) : api.get(vaultId, id))
            .then((fresh) => {
              if (Date.parse(fresh.updatedAt) === Date.parse(cached.updatedAt)) return;
              setNotesById((prev) => {
                const cur = prev[id];
                if (!cur || Date.parse(cur.updatedAt) === Date.parse(fresh.updatedAt)) return prev;
                return { ...prev, [id]: fresh };
              });
            })
            .catch(() => {});
        }
      };
      es.onerror = () => {
        disconnected = true;
        es?.close();
        if (retry) clearTimeout(retry);
        retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      for (const t of treeTimers.values()) window.clearTimeout(t);
      es?.close();
    };
  }, []);

  // --- Tags ---

  const refreshTags = useCallback(async (vaultId: string) => {
    try {
      const res = await api.listTags(vaultId);
      setTagsByVault((prev) => ({ ...prev, [vaultId]: res.tags ?? [] }));
    } catch {
      // ignore
    }
  }, []);

  // Refetch one vault's tree after it changed elsewhere (SSE "tree-change";
  // our own changes echo back too, which is harmless).
  const refreshVaultTree = useCallback(
    async (vaultId: string) => {
      if (vaultId === "journal") {
        await refreshJournal();
        return;
      }
      const vault = allVaultsRef.current.find((v) => v.id === vaultId);
      if (!vault) return;
      try {
        const res = await api.list(vaultId);
        const data = { notes: res.notes ?? [], folders: res.folders ?? [] };
        setAllVaultData((prev) => ({ ...prev, [vaultId]: data }));
        if (vaultId === activeVaultIdRef.current) {
          setNotes([...data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
          setFolders(data.folders);
        }
        if (vault.spaceId === activeSpaceIdRef.current) void refreshTags(vaultId);
      } catch {
        // Transient; the next change or refresh catches up.
      }
    },
    [refreshJournal, refreshTags],
  );

  useEffect(() => {
    refreshVaultTreeRef.current = refreshVaultTree;
  }, [refreshVaultTree]);

  // Refetch a single note's full body and swap it into the cache. Used after
  // restoring a history version so the editor reflects the restored content.
  const refreshNoteBody = useCallback(
    async (id: string) => {
      const vaultId = noteVaultMap[id] ?? activeVaultId;
      if (!vaultId) return;
      try {
        const note = await api.get(vaultId, id);
        setNotesById((prev) => ({ ...prev, [id]: note }));
      } catch {
        // ignore transient failures
      }
    },
    [noteVaultMap, activeVaultId],
  );

  const removeTagFromNote = useCallback(async (vaultId: string, noteId: string, tag: string) => {
    const doc = await api.removeTag(vaultId, noteId, tag);
    setNotesById((prev) => ({ ...prev, [noteId]: doc }));
    await refreshTags(vaultId);
    await refresh();
  }, [refresh, refreshTags]);

  const renameTagInVault = useCallback(async (vaultId: string, from: string, to: string) => {
    await api.renameTag(vaultId, from, to);
    await refreshTags(vaultId);
    await refresh();
  }, [refresh, refreshTags]);

  const deleteTagInVault = useCallback(async (vaultId: string, tag: string) => {
    await api.deleteTag(vaultId, tag);
    await refreshTags(vaultId);
    await refresh();
  }, [refresh, refreshTags]);

  // --- Tasks ---

  // Tasks of the active space's vaults plus the personal journal.
  const refreshTasks = useCallback(async () => {
    if (!activeSpaceId) return;
    try {
      const res = await api.listTasks(activeSpaceId);
      setTasks(res.tasks ?? []);
    } catch {
      // ignore
    }
  }, [activeSpaceId]);

  const toggleTaskItem = useCallback(async (vaultId: string, noteId: string, line: number, checked: boolean) => {
    const doc = await api.toggleTask(vaultId, noteId, line, checked);
    setNotesById((prev) => ({ ...prev, [noteId]: doc }));
    if (vaultId === "journal") {
      journalIdsRef.current.add(noteId);
      void refreshJournal();
    }
    await refreshTasks();
  }, [refreshTasks, refreshJournal]);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  const openDaily = useCallback(async (date?: string) => {
    try {
      const note = await api.journalDaily(date ?? localDateKey());
      journalIdsRef.current.add(note.id);
      setNotesById((prev) => ({ ...prev, [note.id]: note }));
      void refreshJournal();
      setOpenTabs((prev) => appendOpenTab(prev, note.id));
      setActiveId(note.id);
      pushNoteUrl(note.id, null, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open daily journal");
    }
  }, [refreshJournal]);

  const remove = useCallback(
    async (id: string) => {
      // Delete from the vault that owns the note (it may not be the active
      // vault when deleting from an aggregated section).
      const vaultId = noteVaultMap[id] ?? activeVaultId;
      if (!vaultId) return;
      try {
        await api.remove(vaultId, id);
        closeTab(id);
        if (vaultId === activeVaultId) {
          await refresh();
        } else {
          // Refresh that vault's per-vault data directly.
          try {
            const res = await api.list(vaultId);
            setAllVaultData((prev) => ({
              ...prev,
              [vaultId]: { notes: res.notes ?? [], folders: res.folders ?? [] },
            }));
          } catch {
            // ignore
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete note");
      }
    },
    [activeVaultId, noteVaultMap, closeTab, refresh],
  );

  // Delete a journal note (vault-independent).
  const removeJournal = useCallback(
    async (id: string) => {
      try {
        await api.journalDelete(id);
        closeTab(id);
        await refreshJournal();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete journal note");
      }
    },
    [closeTab, refreshJournal],
  );

  const inflight = useRef<Promise<void> | null>(null);
  const draftRef = useRef<Draft>({ title: "", body: "" });
  // Timestamp of the last local edit (armed by setDraft). The live-sync SSE
  // handler uses it to avoid overwriting the user while they are typing.
  const lastEditAtRef = useRef(0);

  const setDraft = useCallback((draft: Draft) => {
    draftRef.current = draft;
    lastEditAtRef.current = Date.now();
  }, []);

  const save = useCallback(
    async (id: string, input: Draft) => {
      const isJournal = journalIdsRef.current.has(id);
      // The note's own vault: an open tab can belong to another vault.
      const vaultId = noteVaultMapRef.current[id] ?? activeVaultId;
      if (!vaultId && !isJournal) return;
      // Never let a blank body wipe a note that has content. A save that
      // sends an empty body (e.g. a race or transient editor state) must not
      // destroy the existing text.
      const cached = notesByIdRef.current[id];
      if (
        (!input.body || input.body.trim() === "") &&
        cached &&
        cached.body &&
        cached.body.trim() !== ""
      ) {
        return;
      }
      const prev = inflight.current ?? Promise.resolve();
      const run = prev.then(async () => {
        setSaving(true);
        try {
          if (isJournal) {
            const doc = await api.journalUpdate(id, input);
            setNotesById((prev) => {
              const n = prev[id];
              if (!n) return prev;
              return {
                ...prev,
                [id]: {
                  ...n,
                  title: input.title || n.title,
                  body: input.body ?? n.body,
                  updatedAt: doc.updatedAt,
                },
              };
            });
            // Refresh tasks since the body may have changed checkbox states.
            void refreshTasks();
          } else {
            const updated = await api.update(vaultId!, id, input);
            if (vaultId === activeVaultId) await refresh();
            else await refreshVaultTreeRef.current(vaultId!);
            void refreshTags(vaultId!);
            setNotesById((prev) => {
              const n = prev[id];
              if (!n) return prev;
              return {
                ...prev,
                [id]: {
                  ...n,
                  title: input.title || n.title,
                  body: input.body ?? n.body,
                  tags: updated.tags ?? n.tags,
                  updatedAt: updated.updatedAt,
                },
              };
            });
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to save note");
        } finally {
          setSaving(false);
        }
      });
      inflight.current = run.catch(() => {});
      return run;
    },
    [activeVaultId, refresh, refreshTasks, refreshTags],
  );

  // Renames a note: title and title heading. A note that was never opened
  // has no body in the cache; it is loaded first, so renaming from the tree
  // or a menu always works (it used to do nothing for those).
  const renameNote = useCallback(
    async (id: string, title: string) => {
      let note: Note | undefined = notesByIdRef.current[id];
      if (!note) {
        try {
          if (journalIdsRef.current.has(id)) note = await api.journalGet(id);
          else {
            const vaultId = noteVaultMapRef.current[id] ?? activeVaultId;
            if (!vaultId) return;
            note = await api.get(vaultId, id);
          }
          const loaded = note;
          setNotesById((prev) => (prev[id] ? prev : { ...prev, [id]: loaded }));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to rename note");
          return;
        }
      }
      await save(id, { title, body: replaceOrAddTitleHeading(note.body, title) });
    },
    [activeVaultId, save],
  );

  const forceSave = useCallback(async () => {
    if (!activeId || activeId === DASHBOARD_ID) return;
    await save(activeId, draftRef.current);
  }, [save, activeId]);

  // Set (or clear, with null) a note's frontmatter icon. Routes to the
  // journal store for journal notes, otherwise to the owning vault. The
  // backend preserves title/body on icon-only updates, so no draft is needed.
  const setNoteIcon = useCallback(
    async (id: string, icon: string | null) => {
      try {
        if (journalIdsRef.current.has(id)) {
          const doc = await api.journalUpdate(id, { icon });
          setJournalNotes((prev) =>
            prev.map((n) =>
              n.id === id ? { ...n, icon: icon ?? undefined, updatedAt: doc.updatedAt } : n,
            ),
          );
        } else {
          const vaultId = noteVaultMap[id] ?? activeVaultIdRef.current;
          if (!vaultId) return;
          await api.update(vaultId, id, { icon });
          await refresh();
        }
        setNotesById((prev) => {
          const n = prev[id];
          if (!n) return prev;
          return { ...prev, [id]: { ...n, icon: icon ?? undefined } };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to set note icon");
      }
    },
    [noteVaultMap, refresh],
  );

  const activeNote =
    activeId && activeId !== DASHBOARD_ID
      ? (notesById[activeId] ?? null)
      : null;
  const isDashboardActive = activeId === DASHBOARD_ID;

  // --- Git sync actions ---
  const refreshGitConfig = useCallback(async () => {
    try {
      setGitConfig(await api.gitGetConfig());
    } catch {
      setGitConfig(null);
    }
  }, []);

  // Several refreshes can overlap (mount, config save, after push/pull);
  // only the newest response may land, or a stale one regresses the panel.
  const gitStatusSeqRef = useRef(0);
  const refreshGitStatus = useCallback(async () => {
    const seq = ++gitStatusSeqRef.current;
    let next: GitStatusInfo | null;
    try {
      next = await api.gitStatus();
    } catch {
      next = null;
    }
    if (seq === gitStatusSeqRef.current) setGitStatus(next);
  }, []);

  // Settings fields persist on blur, and clicking Push/Pull is what blurs
  // them — so a freshly typed remote/token is still in flight when the git
  // action starts. Git actions await the latest save first.
  const pendingGitSaveRef = useRef<Promise<void>>(Promise.resolve());
  const saveGitConfig = useCallback(async (config: GitConfig) => {
    const save = (async () => {
      try {
        await api.gitSetConfig(config);
        setGitConfig(config);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save git config");
        throw e;
      }
    })();
    pendingGitSaveRef.current = save.catch(() => {});
    await save;
    void refreshGitStatus();
  }, [refreshGitStatus]);

  const gitInit = useCallback(async () => {
    try {
      await api.gitInit();
      await refreshGitStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to init git repo");
      throw e;
    }
  }, [refreshGitStatus]);

  const gitPush = useCallback(async (creds?: { username?: string; password?: string }) => {
    try {
      await pendingGitSaveRef.current;
      await api.gitPush(creds);
      await refreshGitStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Git push failed");
      throw e;
    }
  }, [refreshGitStatus]);

  const gitPull = useCallback(async (creds?: { username?: string; password?: string }) => {
    try {
      await pendingGitSaveRef.current;
      await api.gitPull(creds);
      await refresh();
      await refreshAllMarks();
      await refreshJournal();
      await refreshGitStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Git pull failed");
      throw e;
    }
  }, [refresh, refreshAllMarks, refreshJournal, refreshGitStatus]);

  // Git sync needs a server; local mode has none.
  useEffect(() => {
    if (local) return;
    void refreshGitConfig();
    void refreshGitStatus();
  }, [local, refreshGitConfig, refreshGitStatus]);

  // Settings › Features can keep the quick-capture Notepad out of the tree
  // (when it lives in a vault). Everything listing notes reads these.
  const hideNotepad = !settings.notepadInTree && settings.notepadVault !== "";
  const isNotepad = useCallback(
    (vaultId: string, n: NoteMeta) =>
      vaultId === settings.notepadVault &&
      n.title === NOTEPAD_TITLE &&
      !n.collection &&
      (n.path ?? "") === settings.notepadFolder,
    [settings.notepadVault, settings.notepadFolder],
  );
  const shownVaultData = useMemo(() => {
    if (!hideNotepad) return allVaultData;
    const data = allVaultData[settings.notepadVault];
    if (!data) return allVaultData;
    return {
      ...allVaultData,
      [settings.notepadVault]: { ...data, notes: data.notes.filter((n) => !isNotepad(settings.notepadVault, n)) },
    };
  }, [allVaultData, hideNotepad, isNotepad, settings.notepadVault]);
  const shownNotes = useMemo(
    () => (hideNotepad && activeVaultId ? notes.filter((n) => !isNotepad(activeVaultId, n)) : notes),
    [notes, hideNotepad, isNotepad, activeVaultId],
  );

  const value = useMemo<NotesContextValue>(
    () => ({
      vaults,
      activeVault,
      switchVault,
      createVault,
      renameVault,
      deleteVault,
      setVaultIcon,
      allVaults,
      spaces,
      activeSpace,
      activeSpaceId,
      switchSpace,
      refreshSpaces,
      createSpace,
      updateSpace,
      deleteSpace,
      leaveSpace,
      listCollections,
      notes: shownNotes,
      folders,
      bookmarks,
      shortcuts,
      openTabs,
      activeId,
      activeNote,
      isDashboardActive,
      notesById,
      loading,
      error,
      creating,
      saving,
      openTab,
      closeTab,
      create,
      copyNote,
      moveNoteToVault,
      createFolder,
      removeFolder,
      setFolderLabel,
      renameFolder,
      moveNote,
      openDaily,
      remove,
      removeJournal,
      save,
      toggleBookmark,
      toggleShortcut,
      setNoteIcon,
      forceSave,
      setDraft,
      refresh,
      refreshVaultTree,
      refreshNoteBody,
      renameNote,
      allVaultData: shownVaultData,
      journalNotes,
      tagsByVault,
      refreshTags,
      removeTagFromNote,
      renameTagInVault,
      deleteTagInVault,
      tasks,
      refreshTasks,
      toggleTaskItem,
      openNoteInVault,
      openJournalNote,
      isJournalNote: (id: string) => journalIdsRef.current.has(id),
      noteVaultMap,
      refreshAllMarks,
      settings,
      updateSettings,
      gitConfig,
      gitStatus,
      refreshGitConfig,
      saveGitConfig,
      gitInit,
      refreshGitStatus,
      gitPush,
      gitPull,
    }),
    [
      vaults,
      activeVault,
      switchVault,
      createVault,
      renameVault,
      deleteVault,
      setVaultIcon,
      allVaults,
      spaces,
      activeSpace,
      activeSpaceId,
      switchSpace,
      refreshSpaces,
      createSpace,
      updateSpace,
      deleteSpace,
      leaveSpace,
      listCollections,
      shownNotes,
      folders,
      bookmarks,
      shortcuts,
      openTabs,
      activeId,
      activeNote,
      isDashboardActive,
      notesById,
      loading,
      error,
      creating,
      saving,
      openTab,
      closeTab,
      create,
      copyNote,
      moveNoteToVault,
      createFolder,
      removeFolder,
      setFolderLabel,
      renameFolder,
      moveNote,
      openDaily,
      remove,
      removeJournal,
      save,
      toggleBookmark,
      toggleShortcut,
      setNoteIcon,
      forceSave,
      setDraft,
      refresh,
      refreshVaultTree,
      refreshNoteBody,
      renameNote,
      shownVaultData,
      journalNotes,
      tagsByVault,
      refreshTags,
      removeTagFromNote,
      renameTagInVault,
      deleteTagInVault,
      tasks,
      refreshTasks,
      toggleTaskItem,
      openNoteInVault,
      openJournalNote,
      setNoteIcon,
      noteVaultMap,
      refreshAllMarks,
      settings,
      updateSettings,
    ],
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}
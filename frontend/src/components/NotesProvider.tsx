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

import { api, isCollectionsVault, type FolderMeta, type GitConfig, type GitStatusInfo, type Note, type NoteMeta, type TagCount, type TaskItem, type VaultMeta } from "@/lib/api";
import { offlinePrecache } from "@/lib/offline-db";
import { localDateKey } from "@/lib/note-utils";

type Draft = { title: string; body: string };

export type AppSettings = {
  autosave: boolean;
  defaultTitle: string;
  titleTemplate: string;
  editorFontSize: number;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  // General — start-up behaviour
  openDashboardOnStart: boolean;
  startVaultId: string; // "" = last active vault
  // Editor
  editorFontFamily: string; // "" = default theme font
  // Features — section visibility
  showTagsSection: boolean;
  showTasksSection: boolean;
  showTagsOnPalette: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  autosave: true,
  defaultTitle: "Untitled",
  titleTemplate: "DAY DD-MM-YYYY HH:mm",
  editorFontSize: 16,
  aiBaseUrl: "",
  aiApiKey: "",
  aiModel: "",
  openDashboardOnStart: false,
  startVaultId: "",
  editorFontFamily: "",
  showTagsSection: true,
  showTasksSection: true,
  showTagsOnPalette: true,
};

type NotesContextValue = {
  // Vaults
  vaults: VaultMeta[];
  activeVault: VaultMeta | null;
  switchVault: (id: string) => void;
  createVault: (name: string, icon?: string) => Promise<void>;
  renameVault: (id: string, name: string) => Promise<void>;
  deleteVault: (id: string) => Promise<void>;
  setVaultIcon: (id: string, icon: string) => Promise<void>;

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
  create: (input?: { title?: string; path?: string; vaultId?: string }) => Promise<void>;
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
  refreshNoteBody: (id: string) => Promise<void>;
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
  // Strip a leading /m (mobile prefix) — routing logic is identical.
  const p = pathname.replace(/^\/m(\/|$)/, "/");
  if (p === "/" || p === "/dashboard") return { kind: "dashboard" };
  const noteM = p.match(/^\/note\/([^/]+)\/([^/]+)\/?$/);
  if (noteM) return { kind: "note", vaultId: noteM[1], noteId: noteM[2] };
  const journalM = p.match(/^\/journal\/([^/]+)\/?$/);
  if (journalM) return { kind: "journal", noteId: journalM[1] };
  return null;
}

// Build the URL path for a given note id + vault context.
function noteUrlPath(id: string, vaultId: string | null, isJournal: boolean, mobile: boolean): string {
  const prefix = mobile ? "/m" : "";
  if (id === DASHBOARD_ID) return `${prefix}/dashboard`;
  if (isJournal) return `${prefix}/journal/${id}`;
  return `${prefix}/note/${vaultId ?? ""}/${id}`;
}

// Push a new history entry for the active note (user navigation — back works).
function pushNoteUrl(id: string, vaultId: string | null, isJournal: boolean) {
  if (typeof window === "undefined") return;
  const mobile = window.location.pathname.startsWith("/m");
  const path = noteUrlPath(id, vaultId, isJournal, mobile);
  if (window.location.pathname === path) return;
  window.history.pushState({ nexoteId: id }, "", path);
}

// Replace the current history entry (used by closeTab so back doesn't re-open
// the closed note).
function replaceNoteUrl(id: string, vaultId: string | null, isJournal: boolean) {
  if (typeof window === "undefined") return;
  const mobile = window.location.pathname.startsWith("/m");
  const path = noteUrlPath(id, vaultId, isJournal, mobile);
  if (window.location.pathname === path) return;
  window.history.replaceState({ nexoteId: id }, "", path);
}

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [vaults, setVaults] = useState<VaultMeta[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [folders, setFolders] = useState<FolderMeta[]>([]);
  // Bookmark/shortcut sets are aggregated across all vaults so the Recent,
  // Shortcuts, and Bookmarks sections work as one list for every vault.
  // Per-vault lists are kept so toggles write to the correct vault's store.
  const [marksByVault, setMarksByVault] = useState<
    Record<string, { bookmarks: string[]; shortcuts: string[] }>
  >({});
  const bookmarks = useMemo(
    () => new Set(Object.values(marksByVault).flatMap((m) => m.bookmarks)),
    [marksByVault],
  );
  const shortcuts = useMemo(
    () => new Set(Object.values(marksByVault).flatMap((m) => m.shortcuts)),
    [marksByVault],
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
        const parsed = JSON.parse(stored) as Partial<AppSettings>;
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
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

  // Load bookmarks+shortcuts for every vault, replacing the merged state.
  const refreshAllMarks = useCallback(async () => {
    const next: Record<string, { bookmarks: string[]; shortcuts: string[] }> = {};
    await Promise.all(
      vaults.map(async (v) => {
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
  }, [vaults]);

  // Restore the open tabs + active note from localStorage as early as possible,
  // so the note the user had open reappears without waiting on the heavier
  // per-vault loads. activeId is set immediately (the mobile shell shows a
  // skeleton instead of the dashboard while the body loads) and the active
  // note's body is fetched right away using the last active vault (or journal).
  const restoreTabs = useCallback(async () => {
    // If the URL named a specific note, the URL-nav effect already restored it.
    if (urlNavRef.current) return;
    try {
      const storedTabs = localStorage.getItem("nexote:open-tabs");
      const storedActive = localStorage.getItem("nexote:active-id");
      // "Show dashboard at start-up": skip tab restore entirely — the shell
      // boots with its single dashboard tab (initial state).
      if (settingsRef.current.openDashboardOnStart) {
        setRestoredTabs(true);
        return;
      }
      if (!storedTabs) {
        setRestoredTabs(true);
        return;
      }
      const tabs = JSON.parse(storedTabs) as string[];
      // Trust the persisted tabs (they were saved with valid membership); keep
      // the dashboard, and drop nothing here. Body loads below skip failures.
      const validTabs = tabs.includes(DASHBOARD_ID)
        ? tabs
        : [DASHBOARD_ID, ...tabs];
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

  // Load vault list on mount, then select the last active vault (or first).
  useEffect(() => {
    (async () => {
      try {
        const result = await api.listVaults();
        const list = result.vaults ?? [];
        setVaults(list);
        const stored = localStorage.getItem("nexote:active-vault");
        // Never restore the system Collections vault as the active vault —
        // it is hidden from the tree, so a stale stored id would leave the
        // app focused on a vault with no visible section.
        const startVault = settingsRef.current.startVaultId;
        const pick =
          (startVault
            ? list.find((v) => v.id === startVault && !isCollectionsVault(v))?.id
            : undefined) ??
          list.find((v) => v.id === stored && !isCollectionsVault(v))?.id ??
          list.find((v) => !isCollectionsVault(v))?.id ??
          list[0]?.id ??
          null;
        if (pick) {
          setActiveVaultId(pick);
          if (!stored) localStorage.setItem("nexote:active-vault", pick);
          // Restore the open tabs + active note body as early as possible, in
          // parallel with the heavier all-vault loads below, so the note the
          // user had open appears without first waiting on every vault's tree.
          void restoreTabs();
        }
        // Load notes/folders for ALL vaults (for the multi-vault tree view).
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
        setAllVaultData(data);
        // Load bookmarks/shortcuts for ALL vaults so the Recent/Shortcuts/
        // Bookmarks sections are one list across every vault.
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
        setMarksByVault(marks);
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
          setOpenTabs((prev) => appendOpenTab(prev, note.id));
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
          setOpenTabs((prev) => appendOpenTab(prev, note.id));
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

  // Precache the full dataset into IndexedDB (offline mirror) and react to
  // sync events from the service worker / offline indicator.
  useEffect(() => {
    let cancelled = false;
    const precache = async () => {
      try {
        if (!vaults.length) return;
        // Build the lists payload: vaults + per-vault note/folder lists +
        // marks + tags + images + collections + journal list.
        const lists: Record<string, unknown> = {
          "/api/vaults": { vaults },
          "/api/collections": await api.listCollections(),
        };
        for (const v of vaults) {
          try {
            const res = await api.list(v.id);
            lists[`/api/vaults/${v.id}/notes`] = res;
          } catch {}
          try {
            const [bm, sc] = await Promise.all([
              api.listBookmarks(v.id),
              api.listShortcuts(v.id),
            ]);
            lists[`/api/vaults/${v.id}/bookmarks`] = bm;
            lists[`/api/vaults/${v.id}/shortcuts`] = sc;
          } catch {}
          try {
            lists[`/api/vaults/${v.id}/tags`] = await api.listTags(v.id);
          } catch {}
        }
        try {
          lists["/api/journal/notes"] = await api.journalList();
        } catch {}
        if (cancelled) return;
        await offlinePrecache({ lists, notes: {} });
      } catch {
        // Best-effort; the SW also caches GETs as they happen.
      }
    };
    void precache();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaults]);

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
    // Switching vaults only changes the tree's focus vault. Keep the stale
    // notes/folders visible until refresh() completes — blanking here made
    // the tree flicker/disappear on slow backends, so a note clicked in
    // another vault appeared unselected until the second click.
    // Open tabs and the note-body cache are shared across ALL vaults (one
    // tab list for every vault), so they stay intact. Bookmarks/shortcuts
    // are already aggregated.
  }, []);

  const createVault = useCallback(async (name: string, icon?: string) => {
    try {
      const vault = await api.createVault(name, icon);
      setVaults((prev) => [...prev, vault]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create vault");
    }
  }, []);

  const renameVault = useCallback(async (id: string, name: string) => {
    try {
      const vault = await api.renameVault(id, name);
      setVaults((prev) => prev.map((v) => (v.id === id ? vault : v)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename vault");
    }
  }, []);

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
        setVaults((prev) => {
          const next = prev.filter((v) => v.id !== id);
          if (activeVaultId === id && next.length > 0) {
            switchVault(next[0].id);
          }
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete vault");
      }
    },
    [activeVaultId, switchVault],
  );

  const setVaultIcon = useCallback(async (id: string, icon: string) => {
    try {
      const vault = await api.setVaultIcon(id, icon);
      setVaults((prev) => prev.map((v) => (v.id === id ? vault : v)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set vault icon");
    }
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
      // Focus the owning vault so the tree/context is consistent, then open the
      // shared tab. Tabs are cross-vault, so this adds/focuses one global tab.
      if (vaultId !== activeVaultId) switchVault(vaultId);
      await openTab(noteId);
    },
    [activeVaultId, switchVault, openTab, openJournalNote],
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

  const create = useCallback(
    async (input?: { title?: string; path?: string; vaultId?: string }) => {
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
          input?.title ??
          formatTitle(settings.titleTemplate) ??
          settings.defaultTitle;
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
        });
        await refresh();
        setNotesById((prev) => ({ ...prev, [note.id]: note }));
        setOpenTabs((prev) => appendOpenTab(prev, note.id));
        // Focus the owning vault (tree context) so the new note is visible
        // in the vault it was created for.
        if (vaultId !== activeVaultId) switchVault(vaultId);
        setActiveId(note.id);
        pushNoteUrl(note.id, vaultId, false);
        window.dispatchEvent(new CustomEvent("nexote:rename-new-note"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create note");
      } finally {
        setCreating(false);
      }
    },
    [activeVaultId, vaults, switchVault, refresh, settings.defaultTitle, settings.titleTemplate, activeId, notesById],
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
      if (!activeVaultId) return;
      try {
        // Send ONLY the path. The backend persists title/body when the
        // request omits them, so a move that races the editor's debounced
        // save can neither overwrite a fresh draft with the cached body nor
        // revert the path (previously the stale cached body was sent
        // explicitly and could clobber recent edits).
        await api.update(activeVaultId, id, { path });
        await refresh();
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

  // React to offline-sync completions and conflicts from the service worker.
  useEffect(() => {
    const onRefresh = () => {
      void refresh();
      void refreshAllMarks();
      void refreshJournal();
    };
    const onConflicts = (e: Event) => {
      const urls = (e as CustomEvent).detail as string[] | undefined;
      if (!urls || urls.length === 0) return;
      setError(
        "Some offline changes were not applied because those notes were edited elsewhere.",
      );
    };
    window.addEventListener("nexote:refresh-data", onRefresh);
    window.addEventListener("nexote:sync-conflicts", onConflicts as EventListener);
    return () => {
      window.removeEventListener("nexote:refresh-data", onRefresh);
      window.removeEventListener("nexote:sync-conflicts", onConflicts as EventListener);
    };
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
        const cached = notesByIdRef.current[id];
        if (!cached) return;
        // The user is typing on this note right now — don't yank the editor.
        if (
          id === activeIdRef.current &&
          Date.now() - lastEditAtRef.current < 1500
        ) {
          return;
        }
        if (Date.parse(cached.updatedAt) >= Date.parse(updatedAt)) return;
        void (async () => {
          try {
            const fresh =
              vaultId === "journal"
                ? await api.journalGet(id)
                : await api.get(vaultId, id);
            setNotesById((prev) => {
              const cur = prev[id];
              if (!cur || Date.parse(cur.updatedAt) >= Date.parse(fresh.updatedAt)) {
                return prev;
              }
              return { ...prev, [id]: fresh };
            });
          } catch {
            // Transient (backend briefly down); the next event will retry.
          }
        })();
      });
      es.onerror = () => {
        es?.close();
        if (retry) clearTimeout(retry);
        retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
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

  const refreshTasks = useCallback(async () => {
    try {
      const res = await api.listTasks();
      setTasks(res.tasks ?? []);
    } catch {
      // ignore
    }
  }, []);

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
      if (!activeVaultId && !isJournal) return;
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
            const updated = await api.update(activeVaultId!, id, input);
            await refresh();
            void refreshTags(activeVaultId!);
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

  useEffect(() => {
    void refreshGitConfig();
    void refreshGitStatus();
  }, [refreshGitConfig, refreshGitStatus]);

  const value = useMemo<NotesContextValue>(
    () => ({
      vaults,
      activeVault,
      switchVault,
      createVault,
      renameVault,
      deleteVault,
      setVaultIcon,
      notes,
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
      refreshNoteBody,
      allVaultData,
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
      notes,
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
      refreshNoteBody,
      allVaultData,
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
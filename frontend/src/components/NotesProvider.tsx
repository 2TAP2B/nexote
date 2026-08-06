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

import { api, type FolderMeta, type Note, type NoteMeta, type TagCount, type TaskItem, type VaultMeta } from "@/lib/api";

type Draft = { title: string; body: string };

export type AppSettings = {
  autosave: boolean;
  defaultTitle: string;
  editorFontSize: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  autosave: true,
  defaultTitle: "Untitled",
  editorFontSize: 16,
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
  create: (input?: { title?: string; path?: string }) => Promise<void>;
  copyNote: (id: string) => Promise<void>;
  moveNoteToVault: (noteId: string, dstVaultId: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  moveNote: (id: string, path: string) => Promise<void>;
  openDaily: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeJournal: (id: string) => Promise<void>;
  save: (id: string, input: Draft) => Promise<void>;
  toggleBookmark: (id: string) => Promise<void>;
  toggleShortcut: (id: string) => Promise<void>;
  forceSave: () => Promise<void>;
  setDraft: (draft: Draft) => void;
  refresh: () => Promise<void>;
  // Multi-vault data for the advanced tree
  allVaultData: Record<string, { notes: NoteMeta[]; folders: FolderMeta[] }>;
  journalNotes: NoteMeta[];
  // Tags
  tagsByVault: Record<string, TagCount[]>;
  refreshTags: (vaultId: string) => Promise<void>;
  addTagToNote: (vaultId: string, noteId: string, tag: string) => Promise<void>;
  removeTagFromNote: (vaultId: string, noteId: string, tag: string) => Promise<void>;
  renameTagInVault: (vaultId: string, from: string, to: string) => Promise<void>;
  deleteTagInVault: (vaultId: string, tag: string) => Promise<void>;
  // Tasks
  tasks: TaskItem[];
  refreshTasks: () => Promise<void>;
  toggleTaskItem: (vaultId: string, noteId: string, line: number, checked: boolean) => Promise<void>;
  openNoteInVault: (vaultId: string, noteId: string) => Promise<void>;
  openJournalNote: (id: string) => Promise<void>;
  treeMode: "simple" | "advanced";
  setTreeMode: (mode: "simple" | "advanced") => void;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
};

export const DASHBOARD_ID = "__dashboard__";

const NotesContext = createContext<NotesContextValue | null>(null);

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used within NotesProvider");
  return ctx;
}

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [vaults, setVaults] = useState<VaultMeta[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [folders, setFolders] = useState<FolderMeta[]>([]);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [shortcuts, setShortcuts] = useState<Set<string>>(new Set());
  const [openTabs, setOpenTabs] = useState<string[]>([DASHBOARD_ID]);
  const [activeId, setActiveId] = useState<string | null>(DASHBOARD_ID);
  const [notesById, setNotesById] = useState<Record<string, Note>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allVaultData, setAllVaultData] = useState<
    Record<string, { notes: NoteMeta[]; folders: FolderMeta[] }>
  >({});
  const [journalNotes, setJournalNotes] = useState<NoteMeta[]>([]);
  const [tagsByVault, setTagsByVault] = useState<Record<string, TagCount[]>>({});
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [treeMode, setTreeModeState] = useState<"simple" | "advanced">("advanced");
  const journalIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const stored = localStorage.getItem("nexote:tree-mode");
    if (stored === "simple" || stored === "advanced") {
      setTreeModeState(stored);
    }
  }, []);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

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

  const setTreeMode = useCallback((mode: "simple" | "advanced") => {
    setTreeModeState(mode);
    localStorage.setItem("nexote:tree-mode", mode);
  }, []);

  const activeVault = useMemo(
    () => vaults.find((v) => v.id === activeVaultId) ?? null,
    [vaults, activeVaultId],
  );

  // Load vault list on mount, then select the last active vault (or first).
  useEffect(() => {
    (async () => {
      try {
        const result = await api.listVaults();
        const list = result.vaults ?? [];
        setVaults(list);
        const stored = localStorage.getItem("nexote:active-vault");
        const pick =
          list.find((v) => v.id === stored)?.id ?? list[0]?.id ?? null;
        if (pick) setActiveVaultId(pick);
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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load vaults");
      }
    })();
  }, []);

  const switchVault = useCallback((id: string) => {
    setActiveVaultId(id);
    localStorage.setItem("nexote:active-vault", id);
    // Reset note state when switching vaults.
    setNotes([]);
    setFolders([]);
    setBookmarks(new Set());
    setShortcuts(new Set());
    setNotesById({});
    setOpenTabs([DASHBOARD_ID]);
    setActiveId(DASHBOARD_ID);
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
      const bm = await api.listBookmarks(activeVaultId);
      setBookmarks(new Set(bm.bookmarks ?? []));
      const sc = await api.listShortcuts(activeVaultId);
      setShortcuts(new Set(sc.shortcuts ?? []));
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
  useEffect(() => {
    if (!activeVaultId) return;
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
        return;
      }
      if (openTabs.includes(id)) {
        setActiveId(id);
        return;
      }
      if (!activeVaultId) return;
      setActiveId(id);
      setOpenTabs((prev) =>
        prev[0] === DASHBOARD_ID
          ? [prev[0], id, ...prev.slice(1)]
          : [...prev, id],
      );
      if (!notesById[id]) {
        try {
          const note = await api.get(activeVaultId, id);
          setNotesById((prev) => ({ ...prev, [id]: note }));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to load note");
        }
      }
    },
    [openTabs, notesById, activeVaultId, setNotes],
  );

  // Open a note from any vault. Switches vault if needed, then opens the note.
  const openNoteInVault = useCallback(
    async (vaultId: string, noteId: string) => {
      if (vaultId !== activeVaultId) {
        switchVault(vaultId);
        try {
          const note = await api.get(vaultId, noteId);
          requestAnimationFrame(() => {
            setNotesById((prev) => ({ ...prev, [noteId]: note }));
            setOpenTabs((prev) =>
              prev.includes(noteId)
                ? prev
                : prev[0] === DASHBOARD_ID
                  ? [prev[0], noteId, ...prev.slice(1)]
                  : [...prev, noteId],
            );
            setActiveId(noteId);
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to load note");
        }
      } else {
        await openTab(noteId);
      }
    },
    [activeVaultId, switchVault, openTab],
  );

  // Open a journal note (vault-independent). Loads from /api/journal.
  const openJournalNote = useCallback(
    async (id: string) => {
      journalIdsRef.current.add(id);
      setActiveId(id);
      setOpenTabs((prev) =>
        prev[0] === DASHBOARD_ID
          ? [prev[0], id, ...prev.slice(1)]
          : prev.includes(id) ? prev : [...prev, id],
      );
      if (!notesById[id]) {
        try {
          const note = await api.journalGet(id);
          setNotesById((prev) => ({ ...prev, [id]: note }));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to load journal note");
        }
      }
    },
    [openTabs, notesById, setJournalNotes],
  );

  const closeTab = useCallback((id: string) => {
    if (id === DASHBOARD_ID) return;
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const idx = prev.indexOf(id);
        return next[idx] ?? next[idx - 1] ?? next[0] ?? null;
      });
      return next;
    });
    setNotesById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const create = useCallback(
    async (input?: { title?: string; path?: string }) => {
      if (!activeVaultId) return;
      setCreating(true);
      try {
        const note = await api.create(activeVaultId, {
          title: input?.title ?? settings.defaultTitle,
          path: input?.path,
        });
        await refresh();
        setNotesById((prev) => ({ ...prev, [note.id]: note }));
        setOpenTabs((prev) =>
          prev[0] === DASHBOARD_ID
            ? [prev[0], note.id, ...prev.slice(1)]
            : [...prev, note.id],
        );
        setActiveId(note.id);
        window.dispatchEvent(new CustomEvent("nexote:rename-new-note"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create note");
      } finally {
        setCreating(false);
      }
    },
    [activeVaultId, refresh, settings.defaultTitle],
  );

  const copyNote = useCallback(
    async (id: string) => {
      if (!activeVaultId) return;
      try {
        const note = await api.copy(activeVaultId, id);
        await refresh();
        setNotesById((prev) => ({ ...prev, [note.id]: note }));
        setOpenTabs((prev) =>
          prev[0] === DASHBOARD_ID
            ? [prev[0], note.id, ...prev.slice(1)]
            : [...prev, note.id],
        );
        setActiveId(note.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to copy note");
      }
    },
    [activeVaultId, refresh],
  );

  const moveNoteToVault = useCallback(
    async (noteId: string, dstVaultId: string) => {
      if (!activeVaultId || activeVaultId === dstVaultId) return;
      try {
        await api.move(activeVaultId, noteId, dstVaultId);
        // Remove from open tabs if present
        closeTab(noteId);
        // Refresh both vaults' data
        await refresh();
        // Reload the destination vault's data in allVaultData
        try {
          const dstResult = await api.list(dstVaultId);
          setAllVaultData((prev) => ({
            ...prev,
            [dstVaultId]: {
              notes: dstResult.notes ?? [],
              folders: dstResult.folders ?? [],
            },
          }));
        } catch {
          // ignore
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to move note");
      }
    },
    [activeVaultId, closeTab, refresh],
  );

  const toggleBookmark = useCallback(
    async (id: string) => {
      if (!activeVaultId) return;
      const isBookmarked = bookmarks.has(id);
      setBookmarks((prev) => {
        const next = new Set(prev);
        if (isBookmarked) next.delete(id);
        else next.add(id);
        return next;
      });
      try {
        if (isBookmarked) await api.removeBookmark(activeVaultId, id);
        else await api.addBookmark(activeVaultId, id);
      } catch (e) {
        setBookmarks(bookmarks);
        setError(e instanceof Error ? e.message : "Failed to toggle bookmark");
      }
    },
    [bookmarks, activeVaultId],
  );

  const toggleShortcut = useCallback(
    async (id: string) => {
      if (!activeVaultId) return;
      const isShortcut = shortcuts.has(id);
      setShortcuts((prev) => {
        const next = new Set(prev);
        if (isShortcut) next.delete(id);
        else next.add(id);
        return next;
      });
      try {
        if (isShortcut) await api.removeShortcut(activeVaultId, id);
        else await api.addShortcut(activeVaultId, id);
      } catch (e) {
        setShortcuts(shortcuts);
        setError(e instanceof Error ? e.message : "Failed to toggle shortcut");
      }
    },
    [shortcuts, activeVaultId],
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

  const moveNote = useCallback(
    async (id: string, path: string) => {
      if (!activeVaultId) return;
      try {
        const cached = notesById[id];
        await api.update(activeVaultId, id, {
          title: cached?.title,
          body: cached?.body,
          path,
        });
        await refresh();
        if (cached) {
          setNotesById((prev) => ({
            ...prev,
            [id]: { ...cached, path },
          }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to move note");
      }
    },
    [notesById, activeVaultId, refresh],
  );

  const refreshJournal = useCallback(async () => {
    try {
      const list = await api.journalList();
      setJournalNotes(list.notes);
      for (const n of list.notes) journalIdsRef.current.add(n.id);
    } catch {
      // Journal store may not be available yet — ignore.
    }
  }, []);

  useEffect(() => {
    void refreshJournal();
  }, [refreshJournal]);

  // --- Tags ---

  const refreshTags = useCallback(async (vaultId: string) => {
    try {
      const res = await api.listTags(vaultId);
      setTagsByVault((prev) => ({ ...prev, [vaultId]: res.tags ?? [] }));
    } catch {
      // ignore
    }
  }, []);

  const addTagToNote = useCallback(async (vaultId: string, noteId: string, tag: string) => {
    const doc = await api.addTag(vaultId, noteId, tag);
    setNotesById((prev) => ({ ...prev, [noteId]: doc }));
    await refreshTags(vaultId);
    await refresh();
  }, [refresh, refreshTags]);

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
    await refreshTasks();
  }, [refreshTasks]);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  const openDaily = useCallback(async () => {
    try {
      const note = await api.journalDaily();
      journalIdsRef.current.add(note.id);
      setNotesById((prev) => ({ ...prev, [note.id]: note }));
      void refreshJournal();
      if (!openTabs.includes(note.id)) {
        setOpenTabs((prev) =>
          prev[0] === DASHBOARD_ID
            ? [prev[0], note.id, ...prev.slice(1)]
            : [...prev, note.id],
        );
      }
      setActiveId(note.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open daily journal");
    }
  }, [openTabs]);

  const remove = useCallback(
    async (id: string) => {
      if (!activeVaultId) return;
      try {
        await api.remove(activeVaultId, id);
        closeTab(id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete note");
      }
    },
    [activeVaultId, closeTab, refresh],
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

  const setDraft = useCallback((draft: Draft) => {
    draftRef.current = draft;
  }, []);

  const save = useCallback(
    async (id: string, input: Draft) => {
      const isJournal = journalIdsRef.current.has(id);
      if (!activeVaultId && !isJournal) return;
      const prev = inflight.current ?? Promise.resolve();
      const run = prev.then(async () => {
        setSaving(true);
        try {
          if (isJournal) {
            await api.journalUpdate(id, input);
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
                },
              };
            });
            return;
          }
          setNotesById((prev) => {
            const n = prev[id];
            if (!n) return prev;
            return {
              ...prev,
              [id]: {
                ...n,
                title: input.title || n.title,
                body: input.body ?? n.body,
              },
            };
          });
          // Refresh tasks since the body may have changed checkbox states.
          void refreshTasks();
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

  const activeNote =
    activeId && activeId !== DASHBOARD_ID
      ? (notesById[activeId] ?? null)
      : null;
  const isDashboardActive = activeId === DASHBOARD_ID;

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
      moveNote,
      openDaily,
      remove,
      removeJournal,
      save,
      toggleBookmark,
      toggleShortcut,
      forceSave,
      setDraft,
      refresh,
      allVaultData,
      journalNotes,
      tagsByVault,
      refreshTags,
      addTagToNote,
      removeTagFromNote,
      renameTagInVault,
      deleteTagInVault,
      tasks,
      refreshTasks,
      toggleTaskItem,
      openNoteInVault,
      openJournalNote,
      treeMode,
      setTreeMode,
      settings,
      updateSettings,
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
      moveNote,
      openDaily,
      remove,
      removeJournal,
      save,
      toggleBookmark,
      toggleShortcut,
      forceSave,
      setDraft,
      refresh,
      allVaultData,
      journalNotes,
      tagsByVault,
      refreshTags,
      addTagToNote,
      removeTagFromNote,
      renameTagInVault,
      deleteTagInVault,
      tasks,
      refreshTasks,
      toggleTaskItem,
      openNoteInVault,
      openJournalNote,
      treeMode,
      setTreeMode,
      settings,
      updateSettings,
    ],
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}
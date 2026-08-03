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

import { api, type FolderMeta, type Note, type NoteMeta } from "@/lib/api";

type Draft = { title: string; body: string };

type NotesContextValue = {
  notes: NoteMeta[];
  folders: FolderMeta[];
  // Tabs: ordered list of open note ids, with the active one focused.
  // The dashboard tab (DASHBOARD_ID) is always at index 0 and pinned.
  openTabs: string[];
  activeId: string | null;
  // The full note for the active tab (null if none/while loading).
  activeNote: Note | null;
  // Whether the active tab is the dashboard (pseudo-tab).
  isDashboardActive: boolean;
  // Cache of full notes by id, so the tab bar can render titles without an
  // extra fetch.
  notesById: Record<string, Note>;
  loading: boolean;
  error: string | null;
  creating: boolean;
  saving: boolean;
  // openTab loads a note (if not cached), adds it to the tab bar, and focuses
  // it. No-op if already open (just focuses).
  openTab: (id: string) => Promise<void>;
  closeTab: (id: string) => void;
  create: (input?: { title?: string; path?: string }) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  // moveNote moves a note to a new folder path ("" = root) by calling update
  // with path set. The note's title/body are preserved.
  moveNote: (id: string, path: string) => Promise<void>;
  openDaily: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  save: (id: string, input: Draft) => Promise<void>;
  // forceSave persists the current draft (kept in sync by EditorPane) for the
  // active note immediately, bypassing the EditorPane debounce. Used by the
  // Cmd/Ctrl+S shortcut.
  forceSave: () => Promise<void>;
  // setDraft is called by EditorPane on every title/body change so shortcuts
  // can save the latest values without prop-drilling.
  setDraft: (draft: Draft) => void;
  refresh: () => Promise<void>;
};

export const DASHBOARD_ID = "__dashboard__";

const NotesContext = createContext<NotesContextValue | null>(null);

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used within NotesProvider");
  return ctx;
}

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [folders, setFolders] = useState<FolderMeta[]>([]);
  // Dashboard tab is always pinned at index 0.
  const [openTabs, setOpenTabs] = useState<string[]>([DASHBOARD_ID]);
  const [activeId, setActiveId] = useState<string | null>(DASHBOARD_ID);
  // Cache of full notes by id, so switching tabs is instant after first load.
  const [notesById, setNotesById] = useState<Record<string, Note>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await api.list();
      // newest updatedAt first
      result.notes?.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setNotes(result.notes ?? []);
      setFolders(result.folders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notes");
    }
  }, []);

  // initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const openTab = useCallback(
    async (id: string) => {
      // Dashboard tab: just focus, never fetch.
      if (id === DASHBOARD_ID) {
        setActiveId(DASHBOARD_ID);
        return;
      }
      // Focus if already open.
      if (openTabs.includes(id)) {
        setActiveId(id);
        return;
      }
      setActiveId(id);
      // Insert after the dashboard tab (if present at index 0).
      setOpenTabs((prev) =>
        prev[0] === DASHBOARD_ID
          ? [prev[0], id, ...prev.slice(1)]
          : [...prev, id],
      );
      // Load full body if not cached.
      if (!notesById[id]) {
        try {
          const note = await api.get(id);
          setNotesById((prev) => ({ ...prev, [id]: note }));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to load note");
        }
      }
    },
    [openTabs, notesById],
  );

  const closeTab = useCallback(
    (id: string) => {
      // Never close the dashboard tab.
      if (id === DASHBOARD_ID) return;
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t !== id);
        // If we closed the active tab, focus a neighbor (prefer dashboard,
        // then the tab that takes its position).
        setActiveId((cur) => {
          if (cur !== id) return cur;
          const idx = prev.indexOf(id);
          return next[idx] ?? next[idx - 1] ?? next[0] ?? null;
        });
        return next;
      });
      // Drop from cache so a re-open refetches fresh content.
      setNotesById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [],
  );

  const create = useCallback(
    async (input?: { title?: string; path?: string }) => {
      setCreating(true);
      try {
        const note = await api.create({
          title: input?.title ?? "Untitled",
          path: input?.path,
        });
        await refresh();
        setNotesById((prev) => ({ ...prev, [note.id]: note }));
        // Insert after the dashboard tab (if present at index 0).
        setOpenTabs((prev) =>
          prev[0] === DASHBOARD_ID
            ? [prev[0], note.id, ...prev.slice(1)]
            : [...prev, note.id],
        );
        setActiveId(note.id);
        // Signal the editor to auto-focus the title for inline renaming.
        window.dispatchEvent(new CustomEvent("nexote:rename-new-note"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create note");
      } finally {
        setCreating(false);
      }
    },
    [refresh],
  );

  const createFolder = useCallback(
    async (path: string) => {
      try {
        await api.createFolder(path);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create folder");
      }
    },
    [refresh],
  );

  const moveNote = useCallback(
    async (id: string, path: string) => {
      try {
        // Preserve the note's current title/body while changing the path.
        const cached = notesById[id];
        await api.update(id, {
          title: cached?.title,
          body: cached?.body,
          path,
        });
        await refresh();
        // Update cache with the new path.
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
    [notesById, refresh],
  );

  const openDaily = useCallback(async () => {
    try {
      const note = await api.daily();
      await refresh();
      setNotesById((prev) => ({ ...prev, [note.id]: note }));
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
  }, [openTabs, refresh]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.remove(id);
        closeTab(id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete note");
      }
    },
    [closeTab, refresh],
  );

  // Save tracks in-flight requests so a later save for the same id waits for
  // the previous one to finish, keeping updates ordered.
  const inflight = useRef<Promise<void> | null>(null);

  // Latest draft for the active note, kept in sync by EditorPane. Kept in a
  // ref (not state) so shortcut saves read the freshest value without
  // re-rendering on every keystroke.
  const draftRef = useRef<Draft>({ title: "", body: "" });

  const setDraft = useCallback((draft: Draft) => {
    draftRef.current = draft;
  }, []);

  const save = useCallback(
    async (id: string, input: Draft) => {
      const prev = inflight.current ?? Promise.resolve();
      const run = prev.then(async () => {
        setSaving(true);
        try {
          await api.update(id, input);
          await refresh();
          // Update the cached note's title/body so the tab + tree reflect the
          // change without a refetch.
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
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to save note");
        } finally {
          setSaving(false);
        }
      });
      inflight.current = run.catch(() => {});
      return run;
    },
    [refresh],
  );

  const forceSave = useCallback(async () => {
    if (!activeId) return;
    await save(activeId, draftRef.current);
  }, [save, activeId]);

  const activeNote = activeId && activeId !== DASHBOARD_ID ? (notesById[activeId] ?? null) : null;
  const isDashboardActive = activeId === DASHBOARD_ID;

  const value = useMemo<NotesContextValue>(
    () => ({
      notes,
      folders,
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
      createFolder,
      moveNote,
      openDaily,
      remove,
      save,
      forceSave,
      setDraft,
      refresh,
    }),
    [
      notes,
      folders,
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
      createFolder,
      moveNote,
      openDaily,
      remove,
      save,
      forceSave,
      setDraft,
      refresh,
    ],
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}
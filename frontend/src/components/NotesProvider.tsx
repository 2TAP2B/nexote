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

import { api, type Note, type NoteMeta } from "@/lib/api";

type Draft = { title: string; body: string };

type NotesContextValue = {
  notes: NoteMeta[];
  // Tabs: ordered list of open note ids, with the active one focused.
  openTabs: string[];
  activeId: string | null;
  // The full note for the active tab (null if none/while loading).
  activeNote: Note | null;
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

const NotesContext = createContext<NotesContextValue | null>(null);

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used within NotesProvider");
  return ctx;
}

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Cache of full notes by id, so switching tabs is instant after first load.
  const [notesById, setNotesById] = useState<Record<string, Note>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.list();
      // newest updatedAt first
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setNotes(list);
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
      // Focus if already open.
      if (openTabs.includes(id)) {
        setActiveId(id);
        return;
      }
      setActiveId(id);
      setOpenTabs((prev) => [...prev, id]);
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
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t !== id);
        // If we closed the active tab, focus a neighbor.
        setActiveId((cur) => {
          if (cur !== id) return cur;
          const idx = prev.indexOf(id);
          return next[idx] ?? next[idx - 1] ?? next[next.length - 1] ?? null;
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
        setOpenTabs((prev) => [...prev, note.id]);
        setActiveId(note.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create note");
      } finally {
        setCreating(false);
      }
    },
    [refresh],
  );

  const openDaily = useCallback(async () => {
    try {
      const note = await api.daily();
      await refresh();
      setNotesById((prev) => ({ ...prev, [note.id]: note }));
      if (!openTabs.includes(note.id)) {
        setOpenTabs((prev) => [...prev, note.id]);
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

  const activeNote = activeId ? (notesById[activeId] ?? null) : null;

  const value = useMemo<NotesContextValue>(
    () => ({
      notes,
      openTabs,
      activeId,
      activeNote,
      notesById,
      loading,
      error,
      creating,
      saving,
      openTab,
      closeTab,
      create,
      openDaily,
      remove,
      save,
      forceSave,
      setDraft,
      refresh,
    }),
    [
      notes,
      openTabs,
      activeId,
      activeNote,
      notesById,
      loading,
      error,
      creating,
      saving,
      openTab,
      closeTab,
      create,
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
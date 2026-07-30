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
  selectedId: string | null;
  selected: Note | null;
  loading: boolean;
  error: string | null;
  creating: boolean;
  saving: boolean;
  select: (id: string | null) => void;
  create: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  save: (id: string, input: Draft) => Promise<void>;
  // forceSave persists the current draft (kept in sync by EditorPane) for the
  // selected note immediately, bypassing the EditorPane debounce. Used by the
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Note | null>(null);
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

  // load the selected note's full body whenever the id changes
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const note = await api.get(selectedId);
        if (!cancelled) setSelected(note);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load note");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const create = useCallback(async () => {
    setCreating(true);
    try {
      const note = await api.create({ title: "Untitled" });
      await refresh();
      setSelectedId(note.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create note");
    } finally {
      setCreating(false);
    }
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.remove(id);
        if (selectedId === id) setSelectedId(null);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete note");
      }
    },
    [refresh, selectedId],
  );

  // Save tracks in-flight requests so a later save for the same id waits for
  // the previous one to finish, keeping updates ordered.
  const inflight = useRef<Promise<void> | null>(null);

  // Latest draft for the selected note, kept in sync by EditorPane. Kept in a
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
    if (!selectedId) return;
    await save(selectedId, draftRef.current);
  }, [save, selectedId]);

  const value = useMemo<NotesContextValue>(
    () => ({
      notes,
      selectedId,
      selected,
      loading,
      error,
      creating,
      saving,
      select,
      create,
      remove,
      save,
      forceSave,
      setDraft,
      refresh,
    }),
    [
      notes,
      selectedId,
      selected,
      loading,
      error,
      creating,
      saving,
      select,
      create,
      remove,
      save,
      forceSave,
      setDraft,
      refresh,
    ],
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}
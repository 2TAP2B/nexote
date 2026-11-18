"use client";

import { ChevronRight, HelpCircle, Lock } from "lucide-react";
import { useState } from "react";

import { NotebookSheet } from "@/components/mobile/NotebookPicker";
import { api } from "@/lib/api";
import { listNotebooks, notebookKey, type Notebook } from "@/lib/notebooks";
import { findNotepad, notepadLocation, type NotepadLocation } from "@/lib/notepad";
import { useNotes } from "@/lib/notes-context";
import { SettingGroup, SettingItem, SettingsPage, StatusText, ToggleSetting, errorText, useIsMobileSettings, type Status } from "./ui";

const PRIVATE = "private";
const ASK = "ask";

export function FeatureSettings() {
  const { settings, updateSettings, allVaults, allVaultData, spaces } = useNotes();
  // Quick notes only exist in the mobile app.
  const mobile = useIsMobileSettings();
  const notebooks = listNotebooks(allVaults, allVaultData, spaces);
  const [sheet, setSheet] = useState<"notepad" | "memo" | null>(null);
  const [moving, setMoving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const find = (vaultId: string, folder: string) =>
    notebooks.find((n) => n.vaultId === vaultId && n.folder === folder);
  const memoNotebook = find(settings.memoNoteVault, settings.memoNoteFolder);
  const notepadNotebook = settings.notepadVault ? find(settings.notepadVault, settings.notepadFolder) : undefined;

  // Moves the existing Notepad (if any) to the new place, then remembers it.
  const moveNotepad = async (to: NotepadLocation, toSettings: { notepadVault: string; notepadFolder: string }) => {
    setSheet(null);
    const from = notepadLocation(settings);
    if (from.vaultId === to.vaultId && from.folder === to.folder) return;
    setMoving(true);
    setStatus(null);
    try {
      const id = await findNotepad(from);
      if (id) await api.move(from.vaultId, id, to.vaultId, to.folder);
      updateSettings(toSettings);
      window.dispatchEvent(new CustomEvent("nexote:refresh-data"));
      setStatus({ tone: "ok", text: id ? "Notepad moved" : "Saved" });
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't move the notepad") });
    } finally {
      setMoving(false);
    }
  };

  const value = (label: string, onClick?: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex max-w-[45vw] items-center gap-1 text-[13px] text-muted-foreground"
    >
      <span className="truncate">{label}</span>
      <ChevronRight size={16} className="shrink-0" />
    </button>
  );

  return (
    <SettingsPage title="Features">
      <SettingGroup heading="Sidebar">
        <ToggleSetting
          name="Tags"
          description="Tags view in the sidebar."
          checked={settings.showTagsSection}
          onChange={(v) => updateSettings({ showTagsSection: v })}
        />
        <ToggleSetting
          name="Tasks"
          description="Tasks view in the sidebar."
          checked={settings.showTasksSection}
          onChange={(v) => updateSettings({ showTasksSection: v })}
        />
        <ToggleSetting
          name="Threads"
          description="Threads view in the sidebar."
          checked={settings.showThreadsSection}
          onChange={(v) => updateSettings({ showThreadsSection: v })}
        />
      </SettingGroup>
      <SettingGroup heading="Command palette">
        <ToggleSetting
          name="Tag search"
          description="Type # in the command palette to find notes by tag."
          checked={settings.showTagsOnPalette}
          onChange={(v) => updateSettings({ showTagsOnPalette: v })}
        />
      </SettingGroup>
      {mobile && (
        <SettingGroup heading="Quick notes" description={status ? <StatusText status={status} /> : undefined}>
          <SettingItem
            name="Notepad location"
            description="Where your memos are saved. Changing it moves the Notepad."
            onClick={moving ? undefined : () => setSheet("notepad")}
          >
            {value(
              moving ? "Moving…" : settings.notepadVault ? (notepadNotebook?.label ?? "Unavailable vault") : "Private",
              moving ? undefined : () => setSheet("notepad"),
            )}
          </SettingItem>
          {settings.notepadVault !== "" && (
            <ToggleSetting
              name="Show in note tree"
              description="Off keeps the Notepad out of the tree and lists; quick notes still open it."
              checked={settings.notepadInTree}
              onChange={(v) => updateSettings({ notepadInTree: v })}
            />
          )}
          <SettingItem
            name="Notebook for memo notes"
            description="Where “Make note” (long-press a memo) saves the memo."
            onClick={() => setSheet("memo")}
          >
            {value(memoNotebook?.label ?? "Ask the first time", () => setSheet("memo"))}
          </SettingItem>
        </SettingGroup>
      )}

      {sheet === "notepad" && (
        <NotebookSheet
          title="Where should the Notepad live?"
          description="Private keeps it out of every vault: only you see it, in every space."
          options={[{ key: PRIVATE, label: "Private — only you", hint: "Not in any vault or space", icon: <Lock size={18} className="shrink-0 text-primary" /> }]}
          selected={settings.notepadVault ? (notepadNotebook ? notebookKey(notepadNotebook) : undefined) : PRIVATE}
          onPickOption={() => void moveNotepad({ vaultId: "home", folder: "" }, { notepadVault: "", notepadFolder: "" })}
          onPick={(n: Notebook) =>
            void moveNotepad({ vaultId: n.vaultId, folder: n.folder }, { notepadVault: n.vaultId, notepadFolder: n.folder })
          }
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "memo" && (
        <NotebookSheet
          title="Where should memo notes go?"
          description="“Make note” saves the memo as a note here."
          options={[{ key: ASK, label: "Ask the first time", icon: <HelpCircle size={18} className="shrink-0 text-muted-foreground" /> }]}
          selected={memoNotebook ? notebookKey(memoNotebook) : ASK}
          onPickOption={() => {
            updateSettings({ memoNoteVault: "", memoNoteFolder: "" });
            setSheet(null);
          }}
          onPick={(n) => {
            updateSettings({ memoNoteVault: n.vaultId, memoNoteFolder: n.folder });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </SettingsPage>
  );
}

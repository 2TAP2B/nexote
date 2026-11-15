"use client";

import { listNotebooks, notebookKey } from "@/lib/notebooks";
import { useNotes } from "@/lib/notes-context";
import { DropdownSetting, SettingGroup, SettingsPage, ToggleSetting, useIsMobileSettings } from "./ui";

export function FeatureSettings() {
  const { settings, updateSettings, allVaults, allVaultData, spaces } = useNotes();
  // Quick notes only exist in the mobile app.
  const mobile = useIsMobileSettings();
  const notebooks = listNotebooks(allVaults, allVaultData, spaces);
  const memoNotebook = notebooks.find((n) => n.vaultId === settings.memoNoteVault && n.folder === settings.memoNoteFolder);
  return (
    <SettingsPage title="Features">
      <SettingGroup heading="Sidebar and dashboard">
        <ToggleSetting
          name="Tags"
          description="Tags view in the sidebar and the tag list on the dashboard."
          checked={settings.showTagsSection}
          onChange={(v) => updateSettings({ showTagsSection: v })}
        />
        <ToggleSetting
          name="Tasks"
          description="Tasks view in the sidebar and open tasks on the dashboard."
          checked={settings.showTasksSection}
          onChange={(v) => updateSettings({ showTasksSection: v })}
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
        <SettingGroup heading="Quick notes">
          <DropdownSetting
            name="Notebook for memo notes"
            description="Where “Make note” (long-press a memo) saves the memo."
            value={memoNotebook ? notebookKey(memoNotebook) : ""}
            options={[
              { value: "", label: "Ask the first time" },
              ...notebooks.map((n) => ({ value: notebookKey(n), label: n.label })),
            ]}
            onChange={(key) => {
              const n = notebooks.find((x) => notebookKey(x) === key);
              updateSettings({ memoNoteVault: n?.vaultId ?? "", memoNoteFolder: n?.folder ?? "" });
            }}
          />
        </SettingGroup>
      )}
    </SettingsPage>
  );
}

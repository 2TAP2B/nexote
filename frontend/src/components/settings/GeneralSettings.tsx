"use client";

import { isCollectionsVault } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import { DropdownSetting, SettingGroup, SettingsPage, ToggleSetting } from "./ui";

export function GeneralSettings() {
  const { vaults, settings, updateSettings } = useNotes();
  return (
    <SettingsPage title="General">
      <SettingGroup heading="Start-up">
        <ToggleSetting
          name="Open the dashboard"
          description="Start on the dashboard instead of reopening the notes you had open."
          checked={settings.openDashboardOnStart}
          onChange={(v) => updateSettings({ openDashboardOnStart: v })}
        />
        <DropdownSetting
          name="Vault"
          description="The vault that is active when the app starts."
          value={settings.startVaultId}
          options={[
            { value: "", label: "Last used" },
            ...vaults.filter((v) => !isCollectionsVault(v)).map((v) => ({ value: v.id, label: v.name })),
          ]}
          onChange={(v) => updateSettings({ startVaultId: v })}
        />
      </SettingGroup>
    </SettingsPage>
  );
}

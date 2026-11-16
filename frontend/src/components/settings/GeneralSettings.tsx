"use client";

import { isCollectionsVault } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import { INTERFACE_MODES, type InterfaceMode } from "@/lib/shell";
import { DropdownSetting, SettingGroup, SettingsPage, ToggleSetting } from "./ui";

function isInterfaceMode(v: string): v is InterfaceMode {
  return v in INTERFACE_MODES;
}

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
      <SettingGroup heading="Interface">
        <DropdownSetting
          name="Interface on this device"
          description="Automatic uses the touch interface on phones, tablets and narrow windows, and the desktop interface with a mouse or trackpad."
          value={settings.interface}
          options={Object.entries(INTERFACE_MODES).map(([value, label]) => ({ value, label }))}
          onChange={(v) => {
            if (isInterfaceMode(v)) updateSettings({ interface: v });
          }}
        />
      </SettingGroup>
    </SettingsPage>
  );
}

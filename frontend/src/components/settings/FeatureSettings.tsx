"use client";

import { useNotes } from "@/lib/notes-context";
import { SettingGroup, SettingsPage, ToggleSetting } from "./ui";

export function FeatureSettings() {
  const { settings, updateSettings } = useNotes();
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
    </SettingsPage>
  );
}

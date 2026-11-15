"use client";

import type { AppSettings } from "@/components/NotesProvider";
import { useNotes } from "@/lib/notes-context";
import { SettingGroup, SettingsPage, ToggleSetting } from "./ui";

type DashKey = "dashActions" | "dashShortcuts" | "dashRecents" | "dashCollections" | "dashBookmarks" | "dashTasks" | "dashTags";

const SECTIONS: { key: DashKey; name: string; description: string }[] = [
  { key: "dashActions", name: "Quick actions", description: "New note, today's journal and search." },
  { key: "dashShortcuts", name: "Shortcuts", description: "Notes you added to shortcuts." },
  { key: "dashRecents", name: "Continue where you left off", description: "Your most recently edited notes." },
  { key: "dashCollections", name: "Collections", description: "Pinned collections." },
  { key: "dashBookmarks", name: "Bookmarks", description: "Bookmarked notes." },
  { key: "dashTasks", name: "Todo", description: "Open tasks from all notes." },
  { key: "dashTags", name: "Tags", description: "Tags with their note counts." },
];

export function DashboardSettings() {
  const { settings, updateSettings } = useNotes();
  return (
    <SettingsPage title="Dashboard">
      <SettingGroup heading="Show on the dashboard">
        {SECTIONS.map((s) => (
          <ToggleSetting
            key={s.key}
            name={s.name}
            description={s.description}
            checked={settings[s.key]}
            onChange={(v) => updateSettings({ [s.key]: v } satisfies Partial<AppSettings>)}
          />
        ))}
      </SettingGroup>
    </SettingsPage>
  );
}

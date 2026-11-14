"use client";

import { Fragment } from "react";

import { SettingGroup, SettingItem, SettingsPage } from "./ui";

// Mirrors the handlers in Shortcuts.tsx ("Mod" = Ctrl, or ⌘ on macOS).
const GROUPS: { heading: string; shortcuts: { action: string; keys: string[][] }[] }[] = [
  {
    heading: "Notes",
    shortcuts: [
      { action: "New note", keys: [["Mod", "Shift", "N"]] },
      { action: "Save the current note now", keys: [["Mod", "S"]] },
      { action: "Open today's journal note", keys: [["Mod", "D"]] },
      { action: "Open the dashboard", keys: [["Mod", "Shift", "D"]] },
      { action: "Command palette and search", keys: [["Mod", "P"], ["Mod", "Shift", "F"]] },
    ],
  },
  {
    heading: "Tabs and layout",
    shortcuts: [
      { action: "Next tab", keys: [["Mod", "Tab"]] },
      { action: "Previous tab", keys: [["Mod", "Shift", "Tab"]] },
      { action: "Close the active tab", keys: [["Mod", "W"]] },
      { action: "Toggle the sidebar", keys: [["Mod", "B"], ["Mod", "\\"]] },
    ],
  },
];

export function ShortcutSettings() {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const label = (key: string) => (key === "Mod" ? (mac ? "⌘" : "Ctrl") : key === "Shift" && mac ? "⇧" : key);
  return (
    <SettingsPage title="Shortcuts">
      {GROUPS.map((group) => (
        <SettingGroup key={group.heading} heading={group.heading}>
          {group.shortcuts.map((s) => (
            <SettingItem key={s.action} name={s.action}>
              {s.keys.map((combo, i) => (
                <Fragment key={combo.join("+")}>
                  {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
                  <span className="flex items-center gap-1">
                    {combo.map((key) => (
                      <kbd
                        key={key}
                        className="min-w-[1.6rem] rounded border border-border bg-background px-1.5 py-0.5 text-center font-sans text-[11px] text-muted-foreground shadow-[0_1px_0_var(--border)]"
                      >
                        {label(key)}
                      </kbd>
                    ))}
                  </span>
                </Fragment>
              ))}
            </SettingItem>
          ))}
        </SettingGroup>
      ))}
    </SettingsPage>
  );
}

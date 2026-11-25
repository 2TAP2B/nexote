"use client";

import { FolderOpen } from "lucide-react";

import { chooseAndroidFolder, useAndroidInfo } from "@/lib/android-bridge";
import { Button, SettingGroup, SettingItem, SettingsPage } from "./ui";

/** Android app: the data folder the on-device engine uses. Changing it
 *  restarts the engine on the new folder and reloads the app. */
export function StorageSettings() {
  const info = useAndroidInfo();
  return (
    <SettingsPage title="Storage">
      <SettingGroup
        heading="Data folder"
        description="Everything lives in this folder as plain files: notes as Markdown, images and settings next to them. Another folder starts a separate set of notes."
      >
        <SettingItem
          stacked
          name="Folder on this device"
          description={
            <span className="select-all break-all font-mono text-[11px]">{info?.folder || "Unknown"}</span>
          }
        >
          <Button onClick={chooseAndroidFolder} disabled={!info}>
            <FolderOpen size={14} />
            Change folder
          </Button>
        </SettingItem>
      </SettingGroup>
    </SettingsPage>
  );
}

"use client";

import { Fragment } from "react";

import { isCollectionsVault } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import { cx, SettingGroup, SettingItem, SettingsPage, useIsMobileSettings } from "./ui";

export function AboutSettings() {
  const { vaults } = useNotes();
  const mobile = useIsMobileSettings();
  // Regular vaults first; the system Collections vault last.
  const ordered = [...vaults.filter((v) => !isCollectionsVault(v)), ...vaults.filter(isCollectionsVault)];

  return (
    <SettingsPage title="About">
      <div className={cx("mt-6 flex items-center gap-4", mobile ? "px-4" : "px-1")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static PWA icon */}
        <img src="/icon-192.png" alt="" className="h-14 w-14 shrink-0 rounded-2xl" />
        <div className="min-w-0">
          <div className="text-base font-semibold text-foreground">Nexote</div>
          <div className="text-[13px] text-muted-foreground">Self-hosted Markdown notes</div>
        </div>
      </div>

      <SettingGroup
        heading="Where your notes live"
        description="Every note is a plain Markdown file named after its title, so any editor can open it."
      >
        {ordered.map((v) => (
          <SettingItem
            key={v.id}
            name={isCollectionsVault(v) ? "Collections" : v.name}
            description={<span className="select-all break-words font-mono text-[11px]">{breakAtSlashes(v.path)}</span>}
          />
        ))}
      </SettingGroup>
    </SettingsPage>
  );
}

// Long paths wrap after a "/" rather than mid-name.
function breakAtSlashes(path: string) {
  return path.split("/").map((part, i) => (
    <Fragment key={i}>
      {i > 0 && (
        <>
          /<wbr />
        </>
      )}
      {part}
    </Fragment>
  ));
}

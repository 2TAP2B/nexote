"use client";

import { Bug, Check, Copy, ScrollText, ShieldCheck } from "lucide-react";
import { Fragment, useState } from "react";

import { useAndroidInfo } from "@/lib/android-bridge";
import { isCollectionsVault } from "@/lib/api";
import { APP, isAndroidApp } from "@/lib/app-info";
import { copyText } from "@/lib/clipboard";
import { useNotes } from "@/lib/notes-context";
import { Button, cx, LinkItem, SettingGroup, SettingItem, SettingsPage, useIsMobileSettings } from "./ui";

export function AboutSettings() {
  const { allVaults, spaces, gitConfig } = useNotes();
  // The app's own version (versionName) once it answered; the web part's
  // version is APP.version.
  const android = useAndroidInfo();
  const mobile = useIsMobileSettings();
  const [copied, setCopied] = useState(false);
  // Folders on the server are only sent to admins (they run the server).
  // Per space: regular vaults first, the system Collections vault last.
  const located = allVaults.filter((v): v is typeof v & { path: string } => Boolean(v.path));
  const ordered = spaces.flatMap((s) => {
    const inSpace = located.filter((v) => v.spaceId === s.id);
    return [...inSpace.filter((v) => !isCollectionsVault(v)), ...inSpace.filter(isCollectionsVault)];
  });
  const spaceName = (id: string) => (spaces.length > 1 ? spaces.find((s) => s.id === id)?.name : undefined);
  const builtOn = APP.builtAt
    ? new Date(APP.builtAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";

  // What a bug report needs, without note content or folder paths.
  const copyDebugInfo = async () => {
    const info = [
      `${APP.name} ${APP.version}` +
        (APP.commit ? ` (${APP.commit})` : "") +
        (APP.commitsAhead > 0 ? `, ${APP.commitsAhead} commits after the release` : ""),
      APP.builtAt && `Built: ${APP.builtAt}`,
      isAndroidApp ? `App: Android${android?.version ? ` ${android.version}` : ""}` : `App: ${mobile ? "mobile" : "desktop"}`,
      `Browser: ${navigator.userAgent}`,
      `Window: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
      `Spaces: ${spaces.length}, vaults: ${allVaults.filter((v) => !isCollectionsVault(v)).length}`,
      !isAndroidApp &&
        `Git sync: ${gitConfig?.enabled ? (gitConfig.remote ? "on, with a remote" : "on, local only") : "off"}`,
    ]
      .filter(Boolean)
      .join("\n");
    if (await copyText(info)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <SettingsPage title="About">
      <div className={cx("mt-6 flex items-center gap-4", mobile ? "px-4" : "px-1")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static PWA icon */}
        <img src="/icon-192.png" alt="" className="h-16 w-16 shrink-0 rounded-[18px] shadow-sm" />
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight text-foreground">{APP.name}</div>
          <div className="text-[13px] text-muted-foreground">{APP.tagline}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {isAndroidApp && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">
                Android app{android?.version ? ` ${android.version}` : ""}
              </span>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">Version {APP.version}</span>
            {APP.commitsAhead > 0 && (
              <span
                title={`${APP.commitsAhead} commits after ${APP.version}`}
                className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300"
              >
                Development build
              </span>
            )}
            {APP.commit && <span className="font-mono">{APP.commit}</span>}
            {builtOn && <span>Built {builtOn}</span>}
          </div>
        </div>
      </div>

      <SettingGroup heading="Resources">
        <LinkItem
          icon={<GitHubMark />}
          name="Source code"
          description={APP.links.source.replace(/^https:\/\//, "")}
          href={APP.links.source}
        />
        <LinkItem
          icon={<ScrollText size={18} />}
          name="Release notes"
          description="What changed in each version"
          href={APP.links.releases}
        />
        <LinkItem
          icon={<Bug size={18} />}
          name="Report a problem"
          description="Bugs and feature requests"
          href={APP.links.issues}
        />
      </SettingGroup>

      <SettingGroup heading="Privacy">
        <SettingItem
          leading={
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
              <ShieldCheck size={18} />
            </span>
          }
          name="No tracking"
          description={
            isAndroidApp
              ? "Nexote has no analytics or telemetry. Your notes stay on this device; only AI and metadata lookups send something out."
              : "Nexote has no analytics or telemetry. Your notes only leave this server when you use AI, metadata lookups, or git sync with a remote."
          }
        />
      </SettingGroup>

      {ordered.length > 0 && (
        <SettingGroup
          heading="Where your notes live"
          description="Every note is a plain Markdown file named after its title, so any editor can open it."
        >
          {ordered.map((v) => {
            const label = isCollectionsVault(v) ? "Collections" : v.name;
            const space = spaceName(v.spaceId);
            return (
              <SettingItem
                key={v.id}
                name={space ? `${space} › ${label}` : label}
                description={<span className="select-all break-words font-mono text-[11px]">{breakAtSlashes(v.path)}</span>}
              />
            );
          })}
        </SettingGroup>
      )}

      <SettingGroup heading="Support">
        <SettingItem name="Debug info" description="Version, build, browser and device, ready to paste into a bug report.">
          <Button onClick={() => void copyDebugInfo()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </SettingItem>
      </SettingGroup>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {APP.name}
      </p>
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

// GitHub's mark (lucide no longer ships brand icons).
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className="h-[18px] w-[18px]">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

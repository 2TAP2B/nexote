"use client";

import { useEffect, useState } from "react";

import type { GitConfig } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import {
  Button,
  DropdownSetting,
  errorText,
  InfoItem,
  SettingGroup,
  SettingItem,
  SettingRow,
  SettingsPage,
  StatusText,
  TextSetting,
  ToggleSetting,
  type Status,
} from "./ui";

const SYNC_INTERVALS = [
  { value: 0, label: "Off" },
  { value: 1, label: "Every minute" },
  { value: 3, label: "Every 3 minutes" },
  { value: 5, label: "Every 5 minutes" },
  { value: 10, label: "Every 10 minutes" },
];

type TextField = "remote" | "branch" | "authorName" | "authorEmail" | "username" | "password";

export function SyncSettings() {
  const { gitConfig, gitStatus, saveGitConfig, gitInit, refreshGitStatus, gitPush, gitPull } = useNotes();
  // Text fields type into a local draft and save on blur; toggles and the
  // interval save immediately. Push/Pull wait for a save still in flight
  // (NotesProvider), and clicking them is what blurs a field.
  const [draft, setDraft] = useState<GitConfig | null>(gitConfig);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    setDraft(gitConfig);
  }, [gitConfig]);

  if (!draft) {
    return (
      <SettingsPage title="Git sync">
        <p className="mt-6 px-1 text-sm text-muted-foreground">Loading…</p>
      </SettingsPage>
    );
  }

  const persist = async (next: GitConfig) => {
    setDraft(next);
    try {
      await saveGitConfig(next);
    } catch (err) {
      setStatus({ tone: "error", text: errorText(err, "Could not save the git settings.") });
    }
  };
  const commit = () => {
    if (draft !== gitConfig) void persist(draft);
  };
  const setField = (key: TextField) => (value: string) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const creds = draft.username ? { username: draft.username, password: draft.password ?? "" } : undefined;

  const run = async (action: () => Promise<void>, pending: string, done: string) => {
    setBusy(true);
    setStatus({ tone: "info", text: pending });
    try {
      await action();
      setStatus({ tone: "ok", text: done });
    } catch (err) {
      setStatus({ tone: "error", text: errorText(err, "Git failed.") });
    }
    setBusy(false);
  };

  const hasRemote = Boolean(draft.remote.trim() || gitStatus?.remote);

  return (
    <SettingsPage title="Git sync">
      <SettingGroup description="Keep the data folder in a git repository: every change becomes a commit, optionally pushed to a remote.">
        <ToggleSetting
          name="Git sync"
          description="Commit changes automatically."
          checked={draft.enabled}
          onChange={(v) => void persist({ ...draft, enabled: v })}
        />
      </SettingGroup>

      {draft.enabled && (
        <>
          <SettingGroup heading="Repository">
            <TextSetting
              name="Remote URL"
              description="Leave empty to only commit locally."
              technical
              value={draft.remote}
              onChange={setField("remote")}
              onCommit={commit}
              placeholder="https://github.com/user/repo.git"
            />
            <TextSetting
              name="Branch"
              technical
              value={draft.branch}
              onChange={setField("branch")}
              onCommit={commit}
              placeholder="main"
            />
            <TextSetting
              name="Author name"
              value={draft.authorName}
              onChange={setField("authorName")}
              onCommit={commit}
              placeholder="Nexote"
            />
            <TextSetting
              name="Author email"
              technical
              value={draft.authorEmail}
              onChange={setField("authorEmail")}
              onCommit={commit}
              placeholder="nexote@localhost"
            />
          </SettingGroup>

          <SettingGroup heading="Syncing">
            <ToggleSetting
              name="Push after every commit"
              description="Needs a remote URL."
              checked={draft.autoPush}
              onChange={(v) => void persist({ ...draft, autoPush: v })}
            />
            <DropdownSetting
              name="Sync on a timer"
              description="Also commit and push at a fixed interval."
              value={draft.autoSyncMinutes ?? 0}
              options={SYNC_INTERVALS}
              onChange={(v) => void persist({ ...draft, autoSyncMinutes: v })}
            />
            <ToggleSetting
              name="Include images"
              description="Commit uploaded images along with the notes."
              checked={draft.includeImages}
              onChange={(v) => void persist({ ...draft, includeImages: v })}
            />
          </SettingGroup>

          <SettingGroup
            heading="Credentials"
            description="For HTTPS remotes. Stored on the server in git.json (readable only by the server's user) so timed syncs can sign in."
          >
            <TextSetting
              name="Username"
              technical
              value={draft.username ?? ""}
              onChange={setField("username")}
              onCommit={commit}
              placeholder="Username or token name"
            />
            <TextSetting
              name="Password or token"
              type="password"
              technical
              value={draft.password ?? ""}
              onChange={setField("password")}
              onCommit={commit}
            />
          </SettingGroup>

          <SettingGroup heading="Status">
            {gitStatus?.hasRepo ? (
              <>
                <InfoItem
                  name="Changes"
                  value={
                    gitStatus.clean
                      ? "Everything committed"
                      : `${gitStatus.dirtyFiles} uncommitted change${gitStatus.dirtyFiles === 1 ? "" : "s"}`
                  }
                />
                <InfoItem name="Branch" value={gitStatus.branch || "—"} />
                <InfoItem name="Remote" value={gitStatus.remote || "None"} mono={Boolean(gitStatus.remote)} />
                {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                  <InfoItem
                    name="Compared to remote"
                    value={[
                      gitStatus.ahead > 0 && `${gitStatus.ahead} ahead`,
                      gitStatus.behind > 0 && `${gitStatus.behind} behind`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                )}
                <SettingRow className="flex-wrap justify-end">
                  <span className="min-w-0 flex-1 basis-40 text-xs">
                    {status && <StatusText status={status} />}
                  </span>
                  <span className="flex gap-2">
                    <Button onClick={() => void refreshGitStatus()} disabled={busy}>
                      Refresh
                    </Button>
                    <Button
                      onClick={() => void run(() => gitPull(creds), "Pulling…", "Pulled.")}
                      disabled={busy || !hasRemote}
                      title={hasRemote ? undefined : "Add a remote URL first"}
                    >
                      Pull
                    </Button>
                    <Button
                      variant="cta"
                      onClick={() => void run(() => gitPush(creds), "Pushing…", "Pushed.")}
                      disabled={busy || !hasRemote}
                      title={hasRemote ? undefined : "Add a remote URL first"}
                    >
                      Push
                    </Button>
                  </span>
                </SettingRow>
              </>
            ) : (
              <SettingItem
                name="No repository yet"
                description={status ? <StatusText status={status} /> : "Create one in the data folder to start committing."}
              >
                <Button
                  variant="cta"
                  disabled={busy}
                  onClick={() => void run(gitInit, "Creating the repository…", "Repository created.")}
                >
                  Create repository
                </Button>
              </SettingItem>
            )}
          </SettingGroup>
        </>
      )}
    </SettingsPage>
  );
}

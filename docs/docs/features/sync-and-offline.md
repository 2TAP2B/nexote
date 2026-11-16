# Sync and offline

The server holds the only copy of the notes that counts. Browsers stay in sync with it through a live event stream, keep a local copy for offline use, and queue changes made without a connection. Separately, an admin can back up the whole data directory to a git repository.

## Live updates

Every open Nexote tab keeps a server-sent event connection to `/api/events`. The server sends three kinds of events:

| Event | Sent when | What the browser does |
| --- | --- | --- |
| `note-change` | A note was saved | Reloads the note if it is open and the server copy is newer. A note you typed in during the last 1.5 seconds is left alone. |
| `tree-change` | Notes or folders were created, moved or deleted | Reloads the note list of that vault. |
| `spaces-change` | Spaces, members or vaults changed | Reloads spaces and vaults. |

Events only go to people who can see the vault or space; changes to your journal and personal Notepad go only to you. If the connection drops, the browser reconnects after a few seconds.

A reverse proxy in front of Nexote must not buffer this stream. See [Reverse proxy and https](../guide/getting-started#reverse-proxy-and-https).

## Offline use

Nexote installs as an app (PWA) and keeps working without a connection. "Offline" includes the case where the network is fine but the Nexote server can't be reached. Production builds register a service worker; data is kept in the browser's IndexedDB.

**What is available offline:**

- The whole app (desktop `/` and mobile `/m`, including the editor), cached when the service worker installs. Each new version replaces the cache.
- Spaces, the vault list, each vault's note list and folders, bookmarks, shortcuts, tags, collections and the journal list, saved in the background while you're online.
- Note contents: notes you've opened, plus open tabs, bookmarked notes, the Notepad and the 50 most recently edited notes, which are downloaded in advance.
- Today's journal, if you opened it once while online.
- Images you've viewed or uploaded on that device.

If the server can't be reached when the app starts, it opens for the account that was last signed in on that device.

**What you can change offline:**

| Works offline (queued) | Needs a connection |
| --- | --- |
| Edit notes and journal entries, Notepad and quick notes | Move or copy notes, rename or delete folders |
| Create and delete notes | Image uploads and attachments |
| Bookmarks and shortcuts | Restoring a note from history, task changes from the task list |
| Create folders | Vault, space, collection and tag management, settings |

An action that needs a connection fails with "You're offline. This change needs a connection to the server." A note that isn't saved on the device shows "You're offline and this isn't saved on this device yet."

**How syncing works:**

- Queued changes are shown right away in the app, also after a reload, and survive closing the browser.
- Several edits of the same note are combined into one change.
- The indicator at the top shows "Offline" with the number of waiting changes, then "Syncing…".
- The app checks every 15 seconds whether the server is back, and also when the browser reports a connection or the app comes to the front. On Android, Chrome also syncs after the app was closed.
- Changes are sent in the order they were made. Notes created offline keep their id, so a change sent twice never creates a duplicate.
- If the session has expired, sending stops and the queue is kept until you sign in again.

**Conflicts never lose text.** Each queued edit remembers which version of the note it started from. If the note was changed on another device in the meantime, the server version stays and your offline text is saved as a new note "*Title* (offline copy)" next to it. The same happens if the note was deleted meanwhile. A notice tells you which notes this affected. Edits made while online are saved directly; the last save wins.

Requests to the AI, git, account and admin endpoints are never cached or queued.

Signing out warns about changes that haven't been sent yet, then clears the cached data and the queue on that device (the app itself stays cached). Signing in as a different account warns the same way.

**Limits:** a daily journal for a day you haven't opened online can't be created offline.

## Git sync

Admins can enable git sync in **Settings › Git sync**. It turns the data directory (`NEXOTE_HOME`) into a git repository and commits changes automatically, which gives a full version history of all notes and an off-site backup when pushed to a remote.

**What is committed:** the whole data directory, with notes named after their titles, so the repository reads like the vaults themselves. Excluded are the `.history` snapshot folders, `git.json` (it holds the remote credentials), and everything in `auth/` except `users.json`, which contains only public passkey data. Images can be excluded with **Include images**.

**Settings:**

| Setting | Effect |
| --- | --- |
| Git sync | Turns it on. The repository is created when needed. |
| Remote URL, Branch | Where to push and pull. The branch defaults to `main`. |
| Author name, Author email | Commit author. Defaults: `Nexote`, `nexote@localhost`. |
| Push after every commit | Push automatically after each commit. |
| Sync on a timer | Commit and push every 1 to 60 minutes. |
| Include images | Commit image files (on by default). |
| Username, Password or token | Credentials for HTTPS remotes. A token alone works for GitHub, GitLab and Gitea. |

Saves are committed shortly after they happen; a burst of edits produces one commit. The settings page shows the repository status (uncommitted changes, branch, remote, how far ahead or behind the remote it is) and has **Pull** and **Push** buttons.

For SSH remotes, the server uses its SSH agent (`SSH_AUTH_SOCK`) or a key in `~/.ssh` (`id_ed25519`, `id_ecdsa` or `id_rsa`) of the user running the backend. In the Docker container neither exists by default, so an HTTPS remote with a token is the simpler choice.

The settings, including the credentials, are stored in `NEXOTE_HOME/git.json` with file mode 0600.

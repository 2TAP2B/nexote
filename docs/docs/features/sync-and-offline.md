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

Saves are protected against overwriting: each save carries the time the note was last loaded, and the server rejects it if the note has changed since.

A reverse proxy in front of Nexote must not buffer this stream. See [Reverse proxy and https](../guide/getting-started#reverse-proxy-and-https).

## Offline use

Production builds register a service worker and store data in the browser's IndexedDB.

**What is available offline:**

- The app itself (`/` and `/m`), its icons and manifest.
- The vault list, each vault's note list, bookmarks, shortcuts, tags, collections and the journal list. These are saved in the background after the app loads.
- Notes you have opened at least once while online. Note contents are not downloaded in advance.
- Images you have viewed or uploaded on that device.

If the server cannot be reached when the app starts, it opens for the account that was last signed in on that device.

**Changes made offline:**

- Edits and other changes that fail because there is no connection are queued in IndexedDB, and the app continues as if they had been saved.
- A status indicator shows "Offline — changes will sync when back online", the number of pending changes, and "Syncing..." while the queue is sent.
- When the server is reachable again, the queue is sent in order.
- If the session has expired, sending stops and the queue is kept until you sign in again.
- A queued change that conflicts with a newer version on the server is dropped, and the app reports that some offline changes were not applied.

Requests to the AI, git, account and admin endpoints are never cached or queued.

Signing out warns about changes that have not been sent yet, then clears the cached data and the queue on that device.

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

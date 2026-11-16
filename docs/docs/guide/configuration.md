# Configuration

Nexote has three kinds of configuration: environment variables read at start-up, server-wide settings that admins change in the app, and per-device settings stored in the browser.

## Environment variables

| Variable | Read by | Default | Purpose |
| --- | --- | --- | --- |
| `NEXOTE_PUBLIC_URL` | backend | `http://localhost:3000` | The address people open in the browser, for example `https://notes.example.com`. Passkeys are bound to its host name, and changing requests from any other origin are refused. Links printed by the `recover` command use it. |
| `NEXOTE_HOME` | backend | `~/.nexote` (`/data/nexote` in the Docker image) | Data directory: vaults, accounts, spaces and settings files. See [Data format](../reference/data-format). |
| `NEXOTE_PORT` | backend | `8080` | Port the Go API listens on. |
| `NEXOTE_BACKEND_URL` | frontend | `http://localhost:8080` (`http://127.0.0.1:8080` in the Docker image) | Where the Next.js server forwards `/api/*` requests. |
| `PORT` | frontend | `3000` | Port of the Next.js server. |
| `GOOGLE_BOOKS_API_KEY` | backend | unset | Optional Google Books API key for book lookups in [Collections](../features/collections). Takes precedence over the key saved in **Settings › Metadata lookup**. Without a key, Google Books applies a low anonymous rate limit. |

The Docker image sets `NEXOTE_HOME`, `NEXOTE_PORT`, `NEXOTE_BACKEND_URL` and `PORT` already. In a Docker Compose setup you normally only set `NEXOTE_PUBLIC_URL` in `.env`.

### Docker Compose and build variables

| Variable | Used in | Purpose |
| --- | --- | --- |
| `NEXOTE_TAG` | `docker-compose.yml` | Image tag to run, `latest` by default. Set a release version such as `0.1.0` to pin it. |
| `NEXOTE_VERSION` | image build argument | Version shown in **Settings › About** when building from source (for example the output of `git describe --tags --abbrev=0`). |
| `NEXOTE_COMMIT` | image build argument | Commit shown in **Settings › About** when building from source. |

Released images have the version and commit built in.

## Command line

The backend binary has one maintenance command:

```bash
nexote-backend recover <username>
```

It prints a single-use link, valid for 24 hours, that adds a passkey to the account. In the Docker container run it with `docker exec nexote nexote-backend recover <username>`. See [Account recovery](./getting-started#account-recovery).

## Server-wide settings

These are changed by admins in the app and stored as files in `NEXOTE_HOME`:

| Settings page | File | Contents |
| --- | --- | --- |
| **Settings › Git sync** | `git.json` (mode 0600) | Remote URL, branch, author, push and timer options, and the remote credentials. See [Git sync](../features/sync-and-offline#git-sync). |
| **Settings › Metadata lookup** | `metadata.json` | Discogs token and optional Google Books API key. |
| **Settings › Users** | `auth/` | Accounts, invite and recovery links. |

## Per-device settings

Everything else in Settings (editor, appearance, dashboard, features, AI) is stored in the browser's local storage under `nexote:settings`. Each device has its own values; on a phone you set them again. Display and editor options belong to the device and survive signing out. The personal ones (the AI connection and choices that point at the account's vaults, such as the Notepad location) are dropped when a different account signs in on that device.

The AI connection (base URL, API key and model) is therefore saved per device. See [AI](../features/ai).

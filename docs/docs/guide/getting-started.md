# Getting started

Nexote ships as a single container that runs both the Go backend and the Next.js server. A prebuilt image for `linux/amd64` and `linux/arm64` is published on the GitHub Container Registry as `ghcr.io/2tap2b/nexote`.

## Requirements

- Docker with the Compose plugin.
- For use from other devices: a domain name and a reverse proxy that serves it over https. Passkeys, the only way to sign in, need a secure origin. See [Reverse proxy and https](#reverse-proxy-and-https).

## Run with Docker Compose

1. Get the repository, which contains `docker-compose.yml`:

   ```bash
   git clone https://github.com/2TAP2B/nexote.git
   cd nexote
   ```

2. Create a `.env` file next to `docker-compose.yml` with the address people will open Nexote at:

   ```bash
   NEXOTE_PUBLIC_URL=https://notes.example.com
   # Optional: pin a release instead of following "latest"
   # NEXOTE_TAG=0.1.0
   ```

   Without a `.env` file, `NEXOTE_PUBLIC_URL` defaults to `http://localhost:3000`. That is enough to try Nexote on the same machine, because browsers allow passkeys on `localhost`.

3. Pull the image and start the container:

   ```bash
   docker compose pull
   docker compose up -d
   ```

   The container listens on port 3000. The Next.js server forwards `/api/*` to the backend inside the container, so no other port needs to be published.

   If port 3000 is already taken on the host, don't edit `docker-compose.yml` (the next `git pull` would collide with your change). Put the port in a `docker-compose.override.yml` next to it instead. Compose reads it automatically, and git ignores it:

   ```yaml
   services:
     nexote:
       ports: !override
         - "3001:3000"
   ```

   `!override` replaces the port list instead of adding to it (Docker Compose 2.24 or later). Point your reverse proxy at the new port.

4. Read the setup code from the log:

   ```bash
   docker compose logs nexote
   ```

   As long as no account exists, the backend prints a line like:

   ```text
   No account exists yet. Open https://notes.example.com and create the admin account with the setup code: K7QM-XR4D
   ```

## Create the first account

Open the public URL. Nexote shows a "Set up Nexote" screen that asks for:

- the setup code from the log,
- a username (3 to 32 characters: letters, digits, dot, dash, underscore),
- an optional display name.

Then create a passkey with your device (fingerprint, face unlock, security key or password manager). This first account is the administrator. It also takes over any notes that existed before accounts were introduced.

To add more people, open **Settings › Users** and create an invite link. See [Spaces and accounts](../features/spaces-and-accounts).

## Reverse proxy and https

`NEXOTE_PUBLIC_URL` must be exactly the address people type into the browser, because:

- Passkeys are bound to its host name. Browsers only offer passkeys on https origins or on `localhost`, and not on bare IP addresses. The backend logs a warning at start-up if the URL uses an IP address or plain http on a host other than `localhost`.
- The backend refuses changing requests (anything other than reads) whose `Origin` header differs from this URL.
- Voice memos in [Quick notes](../features/quick-notes) need microphone access, which browsers also restrict to secure origins.

Put any reverse proxy with TLS in front of port 3000. A minimal Caddy configuration, which obtains a certificate automatically:

```text
notes.example.com {
	reverse_proxy localhost:3000
}
```

Live updates use a server-sent event stream at `/api/events`. If your proxy buffers responses (nginx does by default), turn buffering off for that path, for example with `proxy_buffering off;`, or updates from other devices arrive late. The backend sends a keep-alive comment every 20 seconds so idle connections are not closed.

## Updating

Each release (`v0.6.0`, `v0.6.1`, ...) publishes the image with two tags: `latest` and the version without the `v` prefix (for example `0.6.0`). New features come as minor releases, bugfixes as patch releases. The version and commit are shown in **Settings › About**.

To update to the newest release:

```bash
docker compose pull
docker compose up -d
```

To stay on a specific release, set `NEXOTE_TAG` in `.env` (for example `NEXOTE_TAG=0.1.0`) and run the same two commands when you change it.

### Building from source

The Compose file also has a `build` section. To build the image from your checkout instead of pulling it:

```bash
docker compose up -d --build
```

The build context contains no `.git` directory, so pass the version for the About page explicitly if you want it shown:

```bash
NEXOTE_VERSION=$(git describe --tags --abbrev=0) \
NEXOTE_COMMIT=$(git rev-parse --short HEAD) \
docker compose up -d --build
```

Without them, the About page falls back to the version in `frontend/package.json`.

## Data and backups

All data lives in the named volume `nexote-data`, mounted at `/data/nexote` (`NEXOTE_HOME`). Back up that volume. The admin can also enable [git sync](../features/sync-and-offline#git-sync), which commits the data directory to a git repository and can push it to a remote.

## Account recovery

Someone who lost every device with their passkey can get a recovery link. The link adds a new passkey to the existing account, works once and is valid for 24 hours.

- An admin can create one in **Settings › Users** (the recovery button on the account row).
- If no admin can sign in, run the `recover` command on the server:

  ```bash
  docker exec nexote nexote-backend recover <username>
  ```

  It prints the link, built from `NEXOTE_PUBLIC_URL`. If the account is deactivated, the command says so; an admin has to reactivate it before it can sign in.

Outside Docker the same command is `nexote-backend recover <username>` for a built binary, or `go run . recover <username>` from `backend/`. It reads the same `NEXOTE_HOME` as the server and can run while the server is up.

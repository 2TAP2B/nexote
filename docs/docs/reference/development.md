# Development

Nexote is a Go backend and a Next.js frontend in one repository. In development they run as two processes; the Next.js dev server forwards `/api/*` to the backend, so the browser talks to a single origin.

## Development shell

The repository has a Nix flake with a development shell that provides Go 1.25, gopls, gotools, Node.js 22, pnpm, typescript-language-server, ripgrep and the GitHub CLI.

With [direnv](https://direnv.net/) the shell loads when you enter the directory (`.envrc` contains `use flake`):

```bash
direnv allow
```

Without direnv:

```bash
nix develop
```

Without Nix, install Go 1.25, Node.js 22 and pnpm yourself.

## Commands

Backend, from `backend/`:

```bash
go build ./... && go vet ./... && go test ./...
go run .                       # serves :8080 (NEXOTE_PORT); prints the setup code while no account exists
go run . recover <username>    # one-time link that adds a passkey to an account
```

Frontend, from `frontend/`:

```bash
pnpm install                   # first time
pnpm typecheck                 # tsc --noEmit (there is no lint script)
pnpm dev                       # Next.js on :3000, proxies /api/* to the backend
```

Both at once, from the repository root:

```bash
(cd backend && go run .) & (cd frontend && pnpm dev) & wait
```

Then open `http://localhost:3000`. The default `NEXOTE_PUBLIC_URL` is `http://localhost:3000`, so passkeys work locally without further setup. Point `NEXOTE_HOME` at a scratch directory (for example `.notes-dev/`, which is gitignored) to keep development data apart from `~/.nexote`.

Docker image from source:

```bash
NEXOTE_VERSION=$(git describe --tags --abbrev=0) \
NEXOTE_COMMIT=$(git rev-parse --short HEAD) \
docker compose up -d --build
```

This documentation site lives in `docs/` and is built with [Rspress](https://rspress.rs/):

```bash
cd docs
pnpm install
pnpm dev       # local preview
pnpm build     # static site in docs/doc_build
```

## Project layout

| Path | Contents |
| --- | --- |
| `backend/main.go` | Entry point: reads the environment, opens the registries and accounts, starts git sync, adopts legacy data, normalizes file names, serves HTTP. Also the `recover` command. |
| `backend/api/` | HTTP layer. `handler.go` holds every route; `access.go` authorization; `auth.go`, `account.go`, `admin.go` accounts; `spaces.go` spaces and collections; `events.go` the SSE hub; `ai.go` the AI proxy; `metadata.go` and `dnb.go` collection lookups. |
| `backend/notes/` | Storage. `store.go` the note store; `frontmatter.go` the file format; `filenames.go` title-based file names; `vaults.go`, `spaces.go`, `collections.go` registries; `history.go` snapshots; `images.go` images; `bookmarks.go`; `gitsync.go`. |
| `backend/accounts/` | Users, sessions and invites (`store.go`), WebAuthn configuration and ceremonies (`passkeys.go`). |
| `frontend/src/app/` | Next.js app router: the desktop shell (`page.tsx`), the mobile app (`m/`), the invite page (`invite/[token]/`). |
| `frontend/src/components/` | UI. `NotesProvider.tsx` holds the app state; `MilkdownEditor.tsx` and `editor/` the editor; `mobile/` the mobile app; `settings/` the settings pages shared by both shells; `auth/` and `spaces/`. |
| `frontend/src/lib/` | `api.ts` (API client and shared types), `ai.ts`, `offline-db.ts`, `notepad.ts`, `note-utils.ts` and other helpers. |
| `frontend/public/sw.js` | Service worker for offline use. |
| `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh` | Single-container build that runs both servers. |
| `docs/` | This site. |

`AGENTS.md` in the repository root is a detailed file index with a "task to files" table, written for coding agents and useful for people too.

## Architecture

### Backend

The backend uses only the Go standard library for HTTP, with method-pattern routing (`mux.HandleFunc("GET /api/vaults/{vaultId}/notes/{id}", ...)`). Its dependencies are `gopkg.in/yaml.v3` for frontmatter, `go-webauthn/webauthn` for passkeys and `go-git` for git sync.

- **Store.** Each vault is served by one `Store`, which reads and writes the note files and keeps an in-memory index from note id to file path. A store has two locks: one guards the index, the other serializes every read-modify-write change. Stores are cached per vault in the `VaultRegistry`, so all requests for a vault share the same locks.
- **Safe writes.** A changed note is first written under its new, title-based file name; the old file is removed afterwards, and only if it still holds the same id.
- **Conflicts.** An update carries the `updatedAt` the client last saw. If the note changed in the meantime, the store returns a conflict instead of overwriting it.
- **History.** Before each update the old version is copied to `.history/` (best effort; a failed snapshot never blocks a save).
- **Authorization.** Every request passes through `authenticate` (session cookie, origin check on changes). Handlers obtain stores only through `resolveStore`/`storeFor`, which check the caller's space role per request: viewers read, editors write, owners manage. A vault without access answers 404. The pseudo vault ids `journal` and `home` map to the caller's personal stores.
- **Events.** `events.go` fans out `note-change`, `tree-change` and `spaces-change` events over SSE to the users who can see them. A keep-alive comment every 20 seconds keeps proxies from closing idle streams, and slow clients are dropped rather than blocking writers.
- **AI and lookups.** The backend proxies AI requests to OpenAI-compatible services and queries Google Books, Open Library, the Deutsche Nationalbibliothek and Discogs for collections.

### Frontend

- **Two shells, one state.** The desktop shell (`app/page.tsx`) and the mobile app (`app/m/`) both wrap their UI in `AuthGate` and `NotesProvider`. `NotesProvider` holds all application state (spaces, vaults, notes, tabs, collections, tasks, bookmarks) and every create, update and delete action; components use it through `useNotes()`.
- **Editor.** `MilkdownEditor.tsx` configures Milkdown Crepe and adds Nexote's plugins from `editor/`: wikilink chips, the `@`/`[[` picker, block selection and inline code handling. Saves are debounced and serialized per note.
- **API client.** `lib/api.ts` mirrors the Go routes and holds the shared types. A route change touches both `backend/api/handler.go` and `frontend/src/lib/api.ts`.
- **Live updates.** `NotesProvider` listens on `/api/events` and reloads what changed.
- **Offline.** `public/sw.js` is the sync engine: it caches the app (every build file, listed by the `/sw-assets` route) and mirrors data GETs into IndexedDB, queues allowed writes in an outbox, applies them to the local copies, and replays them in order with `expectedUpdatedAt` (a conflict becomes an "(offline copy)" note). Notes get client-chosen ids (`newNoteId` in `lib/api.ts`), so a replayed create is idempotent. `lib/offline-status.tsx` detects the server and shows queue and sync reports; `lib/offline-db.ts` only counts and clears the outbox. AI, git, account and admin requests are never cached or queued.
- **Settings.** The pages in `components/settings/` are shared by the desktop dialog and the mobile settings screen. Options live in `AppSettings` in `NotesProvider.tsx` and are stored per device. A new option should only be added if it visibly changes something on every platform that shows it.
- **Production build.** `next.config.mjs` builds a standalone server and turns off response compression, which would otherwise break the SSE stream through the `/api` rewrite.

## Releases

Every push to `main` creates the next patch release (`v0.1.0`, `v0.1.1`, ...) and publishes the Docker image `ghcr.io/2tap2b/nexote` for `linux/amd64` and `linux/arm64`, tagged `latest` and with the version number.

## License

Nexote is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). If you run a modified version as a network service, you must offer its source code to its users.

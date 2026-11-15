# Nexote — agent orientation

A self-hosted markdown note-taking app: **Go** stdlib backend (notes are plain
`.md` files, no database) + **Next.js 16 / React 19 / Milkdown Crepe** frontend.
This file is the map. Read it once, then open **only the files your task
touches**. Do not re-read the whole repo per session.

## Context strategy (read first)
- This file replaces "explore everything." Use the **file index** and **task →
  files** tables below to jump straight to a target.
- If a task spans **>3 unrelated files**, delegate the read to an `explore`
  sub-agent and work from its summary instead of loading all of it into context.
- The backend is dense (`notes/store.go` ~1200 lines). Open the specific function
  you need, not the whole file.

## Stack & layout
| Path | What it is |
| --- | --- |
| `backend/` | Go 1.25 REST API. Module name `nexote`. Deps: `gopkg.in/yaml.v3`, `github.com/go-webauthn/webauthn` (passkeys; v0.17 is the newest release that builds with Go 1.25). |
| `frontend/` | Next.js 16 (app router), React 19, Tailwind v4, Milkdown Crepe (`@milkdown/react`), `next-themes`. |
| `flake.nix` / `.envrc` | Nix devshell (`go_1_25`, `nodejs_22`, `pnpm`, gopls, tsserver). `.envrc` = `use flake`. |
| `Dockerfile`, `docker-compose.yml` | Single-container prod build (Next `output:"standalone"` + Go binary). |
| `.notes-dev/` | Dev data dir (gitignored). Real default is `$NEXOTE_HOME` → `~/.nexote`. |

## Data model
- A **note** = one markdown file named after its title (`My Note.md`; a second
  note with that title in the folder is `My Note 1.md`). Frontmatter (YAML)
  holds `Meta`; the rest is markdown body. See `notes/frontmatter.go`,
  `notes/filenames.go`. The frontmatter `id` is the note's identity — every
  lookup, URL, tab and history dir uses it; never derive ids from file names.
  - `Meta`: `id, title, path, createdAt, updatedAt, tags[], type, artist, year,
    genre, wantlist, cover, collection, fields{}`. (`path` = folder relative to
    vault root; `""` = root.)
- **ID** = 16-char base64url random string → `notes/id.go` `NewID()` (some
  older notes carry 12-char ids).
- Storage under `$NEXOTE_HOME` (default `~/.nexote`, dev `.envrc`/local may set
  `.notes-dev`):
  - `vaults/<vault name>/…` — note files, nested folders. Registry:
    `vaults.json`, which stores **absolute** vault paths (a copied
    `$NEXOTE_HOME` still reads and writes the original vaults until those
    paths are rewritten) and each vault's `spaceId`. Vault names are unique
    per space; a folder name taken by another space gets a number suffix.
  - `spaces.json` — spaces + members (`owner|editor|viewer`). A space with only
    its owner is private. Each space has its own **Collections** vault
    (`type:"collections"`) and definitions in `spaces/<spaceId>/collections.json`.
  - `auth/` — `users.json` (accounts, passkeys, reserved OIDC identities),
    `sessions.json` and `invites.json` (only SHA-256 hashes of tokens). Files
    are 0600, re-read when they change on disk (the `recover` CLI writes them
    next to a live server). Git sync ignores everything in `auth/` except
    `users.json` (public keys only).
  - `users/<userId>/journal/` and `users/<userId>/home/` — each user's journal
    and quick-capture store (pseudo vault ids `"journal"` and `"home"`; the
    "Notepad" note lives in `home`).
  - Bookmarks/shortcuts are per user: `<vault>/.bookmarks-<userId>.json`,
    `.shortcuts-<userId>.json`.
  - Data from before accounts (space-less vaults, `collections/collections.json`,
    `journal/`, the Notepad, `.bookmarks.json`) is adopted by the first admin
    (`api/adopt.go`, idempotent, runs at setup and every start).
- **Vault** = a directory of notes. **Collection** = a typed set with custom
  fields (`text|number|boolean|date`) rendered as a gallery. Vinyl records are a
  `type:"vinyl"` note migrated into a "Vinyls" collection.
- **Accounts**: passkey-only login (no passwords). The first account (setup code
  printed in the server log) is the admin; admins create single-use invite links
  (7 days) and recovery links (24 h, add a passkey). Users are separate from login
  methods (`Passkeys`, `Identities`), so OIDC can be added without migration.

## File index — backend
| File | Responsibility |
| --- | --- |
| `backend/main.go` | Entrypoint: `$NEXOTE_HOME`, port, `NEXOTE_PUBLIC_URL`, accounts + spaces + registry, legacy collections until adopted, git sync, `AdoptLegacyData`, file-name normalization; `recover <username>` CLI. |
| `api/handler.go` | `Handler` (registries, accounts, events, git sync, per-user stores, per-space collections) + **all** REST routes (table in `Routes()`) + CORS. Vault/collection/note/folder/image/bookmark/tag/task/journal/git handlers. |
| `api/access.go` | Who is asking and what they may do: session cookie → `currentUser(r)`, `authenticate` middleware (401 outside `/api/auth/`, Origin check on writes), `spaceAccess`/`vaultAccess`/`storeFor`/`resolveStore` (viewer reads, editor writes, owner manages; no access = 404), personal stores. |
| `api/auth.go` | Public auth routes: status, first-admin setup (setup code), passkey login, logout, invite/recovery redemption. |
| `api/account.go` · `api/admin.go` | `/api/me` (profile, passkeys), `/api/users` directory · admin users (role, deactivate), invites, recovery links. |
| `api/spaces.go` | Spaces + members routes, `createSpace` (first "Notes" vault + Collections vault), per-space collections (`collections`, `spaceCollections`). |
| `api/adopt.go` | `AdoptLegacyData`: pre-account data → first admin. |
| `accounts/store.go` · `accounts/passkeys.go` | Users/sessions/invites JSON store (hashed tokens, sliding 30-day sessions, last-admin and last-passkey guards) · WebAuthn config from the public origin + in-memory ceremonies (5 min, single use). |
| `notes/spaces.go` | `Space`, `SpaceMember`, `SpaceRole`, `SpaceRegistry` (`spaces.json`, last-owner guard). |
| `notes/store.go` | Core `Store`: filesystem notes, in-memory id→path index (verified on every hit), two locks, create/update/delete/daily/copy/move, path sanitization. |
| `notes/filenames.go` | Title → file name (`fileNameBase`), numbered duplicates (`noteFileTarget`), id-by-frontmatter lookups, startup `NormalizeFileNames` (renames legacy `<id>.md` files). |
| `notes/frontmatter.go` | `Meta` + `Document` types; encode/parse markdown+YAML frontmatter. |
| `notes/id.go` | `NewID()` 16-char base64url generator. |
| `notes/vaults.go` | `VaultMeta` + `VaultRegistry` (`vaults.json`, ensures default "Default" vault, caches **one shared `Store` per vault**). |
| `notes/collections.go` | `CollectionMeta`/`CollectionField`/`CollectionFieldType` + `CollectionRegistry`. |
| `notes/history.go` | Per-note full snapshots under `<store>/.history/<noteId>/<unix-ms>.md`. |
| `notes/snippet.go` | Plain-text note previews (`makeSnippet`, `contentSnippet`) for lists/history/search. Mirrored by `makeSnippet` in `src/lib/note-utils.ts` — keep both in sync. |
| `notes/images.go` | Image upload/list/read/delete + cross-folder & cross-vault migration on note move. Traversal-guarded. |
| `notes/bookmarks.go` | `idList` (order-preserving ID set) backing per-user `Bookmarks` and `Shortcuts`; legacy-file adoption. |
| `api/events.go` | SSE hub: `note-change`, `tree-change`, `spaces-change`, each delivered only to users who can see the vault/space (personal stores: only their owner). |
| `api/ai.go` | AI proxy: forwards chat/test to an OpenAI-compatible endpoint, relays upstream SSE; `POST /api/ai/transcribe` sends a voice memo to the endpoint's `/v1/audio/transcriptions` (multipart, ≤25 MB, file name keeps the format extension). Tests: `api/ai_test.go`. |

## File index — frontend (key files)
| Path | Responsibility |
| --- | --- |
| `src/lib/api.ts` | API client + all shared types (`Note`, `VaultMeta` with `spaceId`/`role`, `SpaceInfo`, `AuthUser`, …). Mirror of the Go routes. Any 401 (outside `/api/auth/`) fires `AUTH_REQUIRED_EVENT`. |
| `src/components/NotesProvider.tsx` | **Central context.** All app state + every CRUD action, SSE refetch, offline queue. Use `useNotes()`. Spaces: `vaults` = the active space's vaults, `allVaults` = every accessible one; `switchSpace` swaps vaults and the per-space tab strip; `listCollections()` reads the active space. |
| `src/components/auth/*` · `src/lib/webauthn.ts` · `src/app/invite/[token]/page.tsx` | `AuthGate` (wraps `NotesProvider` in both shells: setup / login / app, login overlay on session loss, offline start with the cached last user) + `useAuth()`; `session.ts` wipes per-account data on sign-out or account switch; passkey ceremony helpers; public invite/recovery page. |
| `src/components/spaces/*` · `src/components/useCanEdit.ts` | Desktop `SpacesRail` (far left, collapsible), `MobileSpacesPane` (pager pane left of the sidebar), `SpaceDialog` (new space), `SpaceSettingsDialog` (name, icon, members, leave/delete) · read-only checks for viewers. |
| `src/lib/offline-db.ts` / `offline-status.tsx` / `ServiceWorkerRegister.tsx` / `public/sw.js` | Offline/PWA layer: IndexedDB queue replayed on reconnect (stops on 401, keeps the queue); SW never caches/queues `/api/ai/`, `/api/auth/`, `/api/admin/`, `/api/me`, `/api/users`. |
| `src/components/MilkdownEditor.tsx` | The editor (Milkdown Crepe). |
| `src/components/{FileTree,EditorPane,Ribbon,TopBar}.tsx` | Desktop shell panes. |
| `src/components/{CollectionGallery,VinylGallery,NoteHistoryPanel,AICommandPanel,CommandPalette}.tsx` | Feature panels. |
| `src/components/settings/*` | Settings pages shared by desktop and mobile: `ui.tsx` (Obsidian-style groups/rows/controls; a platform context only changes sizes), one `*Settings.tsx` per page (`AccountSettings`: name, passkeys, sign out; `UsersSettings`: admins' users, invites, recovery links), `categories.tsx` (nav registry; `settingsNav(role, platform)` hides admin-only pages; `nexote:open-settings` with a category in `detail` opens that page). Shells: `SettingsPanel.tsx` (desktop dialog) and `mobile/MobileSettings.tsx` (list → page). Options live in `AppSettings` (`NotesProvider.tsx`, localStorage). |
| `src/lib/ai.ts` / `note-utils.ts` / `notepad.ts` | AI client (streams via `/api/ai/chat`) + note helpers (title heading, `makeSnippet` preview) + the quick-capture "Notepad" format (`- HH:MM text` items under `### YYYY-MM-DD`; links are `[[Title]]`, images are `![](url)` continuation lines; edits replace an entry found by content in the latest body). |
| `src/lib/app-info.ts` / `clipboard.ts` / `notebooks.ts` | About-page metadata (repo links; version/commit/build time inlined by `next.config.mjs` from the latest `v*` git tag, or the `NEXOTE_VERSION`/`NEXOTE_COMMIT` Docker build args) + copy-to-clipboard with a fallback for plain-http origins + vault/folder choices ("notebooks") for quick notes' "Make note". |
| `src/app/page.tsx` · `layout.tsx` | Desktop shell composition. |
| `src/app/m/*` + `src/components/mobile/*` | Separate mobile app (`/m`): 4-pane pager (spaces · sidebar · note · right pane = TOC, or quick notes on the dashboard: `QuickCapturePane` (Notepad in the personal `home` store) + `MemoBubble` (long-press menu: copy, edit, make note; `@` chips, images) + `MemoComposer` (`@` suggestions, attachments, full screen, mic) + `useVoiceRecorder` (MediaRecorder; needs https) + `NotebookPicker` (first-time target for "Make note", writable vaults of every space)). Never focus a field in a pane that's off screen without `preventScroll`: the browser scrolls the pager to it. |

## Task → open these files
| You want to… | Open |
| --- | --- |
| Edit the note editor / toolbar | `MilkdownEditor.tsx`, `NotesProvider.tsx` |
| Add/change a REST route | `api/handler.go` **and** `src/lib/api.ts` (keep in sync) |
| Change note metadata / frontmatter | `notes/frontmatter.go` (+ `store.go` if persistence changes) |
| Vault or collection management | `notes/vaults.go`, `notes/collections.go`, `handler.go`, `NotesProvider.tsx` |
| Note history / restore | `notes/history.go`, `NoteHistoryPanel.tsx` |
| Image upload / migration | `notes/images.go`, `handler.go` image routes |
| AI features | `api/ai.go`, `src/lib/ai.ts`, `AICommandPanel.tsx`; voice memos: `api.transcribeAudio` (`src/lib/api.ts`) + `mobile/useVoiceRecorder.ts`. AI settings are per device (localStorage). |
| Accounts, login, invites | `backend/accounts/*`, `api/{auth,account,admin,access}.go`, `src/lib/api.ts` |
| Spaces, members, permissions | `notes/spaces.go`, `api/{spaces,access}.go`, `NotesProvider.tsx` (spaces state) |
| Offline / sync | `offline-db.ts`, `public/sw.js`, `NotesProvider.tsx` queue logic |
| Mobile UI | `src/app/m/*`, `src/components/mobile/*` |
| Add or change a setting | `AppSettings` + `DEFAULT_SETTINGS` in `NotesProvider.tsx`, the page in `src/components/settings/`, and the code that reads it (only add options that visibly do something) |
| Real-time updates | `api/events.go`, SSE handling in `NotesProvider.tsx` |

## Do-not-break invariants
These are the things that silently corrupt data or hang clients if changed
carelessly. Comments already live next to each one — read them before editing.
- **Two locks in `Store`** (`store.go` struct): `mu` guards only the in-memory
  id→path index; `writeMu` serializes every read-modify-write mutation. Keep
  mutations under `writeMu`. Don't merge them or reads stop being concurrent /
  writes race (duplicate daily notes, clobbered edits, two notes picking one
  file name). Vault stores must come from `VaultRegistry.Store` (one cached
  instance per vault) — a fresh `NewStore` per request has its own `writeMu`
  and serializes nothing.
- **Note files are written write-then-delete** (`Store.write`): the new
  title-named file is renamed into place first; the previous file is removed
  only if it still holds the same id and isn't the same file (case-only rename
  on macOS/Windows). Keep that order on any new write path.
- **Optimistic concurrency** (`store.go:18-21`, check at `~361`): `Update`
  returns `ErrConflict` if the note's `updatedAt` changed since read. Preserve
  this guard on any new mutation path.
- **History snapshots** (`notes/history.go`): full-file copies under `.history/`,
  best-effort, nanosecond + counter suffix on collision. Don't delete on update.
- **SSE heartbeat** (`api/events.go:57-95`): a `: keepalive` comment every 20s
  keeps the Next.js `/api` proxy from timing out; slow readers are dropped, never
  block a writer. Requires `compress:false` in `frontend/next.config.mjs`.
- **Image path-traversal guard** (`notes/images.go` `safeImagePath`): all image
  reads/writes must stay under the vault root. Keep the guard on any new image route.
- **Every route is authorized** (`api/access.go`): handlers get stores only via
  `resolveStore`/`storeFor` (role check per request; no access → 404, read-only
  → 403). Never call `Registry.Store` from a handler without a role check, and
  route the pseudo vaults `journal`/`home` to the caller's own stores.
- **Sessions and invites store only token hashes**; changing requests must come
  from `NEXOTE_PUBLIC_URL`'s origin. SSE events go only to their audience.

## Commands
```bash
# backend (from backend/)
go build ./... && go vet ./... && go test ./...
go run .                       # serves :8080 (NEXOTE_PORT); prints the setup code while no account exists
go run . recover <username>    # one-time link that adds a passkey to an account

# frontend (from frontend/)
pnpm install                   # first time
pnpm typecheck                 # tsc --noEmit (there is no lint script)
pnpm dev                       # Next on :3000, proxies /api/* -> Go

# run both locally:
(cd backend && go run .) & (cd frontend && pnpm dev) & wait

# Docker: the build context has no .git, so pass the version for Settings › About
NEXOTE_VERSION=$(git describe --tags --abbrev=0) NEXOTE_COMMIT=$(git rev-parse --short HEAD) docker compose build
```
Dev proxy: `frontend/next.config.mjs` rewrites `/api/* → NEXOTE_BACKEND_URL ||
http://localhost:8080`. Prod = reverse proxy in front of both, or the Docker build.
`NEXOTE_PUBLIC_URL` (default `http://localhost:3000`) must be the address people
open: passkeys are bound to its host (https + a domain, or localhost) and the
backend refuses changing requests from other origins. In Docker set it in a
`.env` next to `docker-compose.yml`; recovery: `docker exec nexote nexote-backend recover <username>`.

## Roadmap
Current backlog (trash, new-note location, templates, wikilinks, editor
behavior, …) and the settings rules: `wip-features.md`. Older feature plan
(tags, previews, multi-select, search filters, properties, dual-pane, calendar,
settings toggles): `.opencode/plans/notebook-navigator-features.md`.

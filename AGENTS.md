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
| `backend/` | Go 1.25 REST API. Module name `nexote`. Deps: only `gopkg.in/yaml.v3`. |
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
    `vaults.json`, which stores **absolute** vault paths: a copied
    `$NEXOTE_HOME` (e.g. for a test backend) still reads and writes the
    original vaults until those paths are rewritten.
  - A dedicated **"Collections"** vault is auto-created to hold collection notes.
  - `journal/` — daily journal notes (pseudo id `"journal"`).
  - `collections.json` — collection registry (`CollectionMeta` + custom fields).
- **Vault** = a directory of notes. **Collection** = a typed set with custom
  fields (`text|number|boolean|date`) rendered as a gallery. Vinyl records are a
  `type:"vinyl"` note migrated into a "Vinyls" collection.

## File index — backend
| File | Responsibility |
| --- | --- |
| `backend/main.go` | Entrypoint: `$NEXOTE_HOME`, port, init registry + collections vault + journal store, `migrateVinyls`. |
| `api/handler.go` | `Handler{Registry,Collections,CollectionsStore,JournalStore,Events}` + **all** REST routes + CORS/preflight. Route table lives here (lines 51–126). |
| `notes/store.go` | Core `Store`: filesystem notes, in-memory id→path index (verified on every hit), two locks, create/update/delete/daily/copy/move, path sanitization. |
| `notes/filenames.go` | Title → file name (`fileNameBase`), numbered duplicates (`noteFileTarget`), id-by-frontmatter lookups, startup `NormalizeFileNames` (renames legacy `<id>.md` files). |
| `notes/frontmatter.go` | `Meta` + `Document` types; encode/parse markdown+YAML frontmatter. |
| `notes/id.go` | `NewID()` 16-char base64url generator. |
| `notes/vaults.go` | `VaultMeta` + `VaultRegistry` (`vaults.json`, ensures default "Default" vault, caches **one shared `Store` per vault**). |
| `notes/collections.go` | `CollectionMeta`/`CollectionField`/`CollectionFieldType` + `CollectionRegistry`. |
| `notes/history.go` | Per-note full snapshots under `<store>/.history/<noteId>/<unix-ms>.md`. |
| `notes/snippet.go` | Plain-text note previews (`makeSnippet`, `contentSnippet`) for lists/history/search. Mirrored by `makeSnippet` in `src/lib/note-utils.ts` — keep both in sync. |
| `notes/images.go` | Image upload/list/read/delete + cross-folder & cross-vault migration on note move. Traversal-guarded. |
| `notes/bookmarks.go` | `idList` (order-preserving ID set) backing `Bookmarks` and `Shortcuts`. |
| `api/events.go` | SSE hub (`NoteEvent`) — real-time note-change broadcast. |
| `api/ai.go` | AI proxy: forwards chat/test to an OpenAI-compatible endpoint, relays upstream SSE. |

## File index — frontend (key files)
| Path | Responsibility |
| --- | --- |
| `src/lib/api.ts` | API client + all shared types (`Note`, `NoteMeta`, `NoteInput`, `Vault`, `Collection`, …). Mirror of the Go routes. |
| `src/components/NotesProvider.tsx` | **Central context.** All app state + every CRUD action, SSE refetch, offline queue. Use `useNotes()`. |
| `src/lib/offline-db.ts` / `offline-status.tsx` / `ServiceWorkerRegister.tsx` / `public/sw.js` | Offline/PWA layer: IndexedDB queue replayed on reconnect; SW never queues `/api/ai/`. |
| `src/components/MilkdownEditor.tsx` | The editor (Milkdown Crepe). |
| `src/components/{FileTree,EditorPane,Ribbon,TopBar}.tsx` | Desktop shell panes. |
| `src/components/{CollectionGallery,VinylGallery,NoteHistoryPanel,AICommandPanel,CommandPalette}.tsx` | Feature panels. |
| `src/components/settings/*` | Settings pages shared by desktop and mobile: `ui.tsx` (Obsidian-style groups/rows/controls; a platform context only changes sizes), one `*Settings.tsx` per page, `categories.tsx` (nav registry). Shells: `SettingsPanel.tsx` (desktop dialog) and `mobile/MobileSettings.tsx` (list → page). Options live in `AppSettings` (`NotesProvider.tsx`, localStorage). |
| `src/lib/ai.ts` / `note-utils.ts` / `notepad.ts` | AI client (streams via `/api/ai/chat`) + note helpers (title heading, `makeSnippet` preview) + the quick-capture "Notepad" format (`- HH:MM text` items under `### YYYY-MM-DD`; links are `[[Title]]`, images are `![](url)` continuation lines; edits replace an entry found by content in the latest body). |
| `src/lib/app-info.ts` / `clipboard.ts` | About-page metadata (repo links; version/commit/build time inlined by `next.config.mjs` from the latest `v*` git tag, or the `NEXOTE_VERSION`/`NEXOTE_COMMIT` Docker build args) + copy-to-clipboard with a fallback for plain-http origins. |
| `src/app/page.tsx` · `layout.tsx` | Desktop shell composition. |
| `src/app/m/*` + `src/components/mobile/*` | Separate mobile app (`/m`): 3-pane pager (sidebar · note · right pane = TOC, or quick notes on the dashboard: `QuickCapturePane` + `MemoBubble` (long-press menu, `@` chips, images) + `MemoComposer` (`@` suggestions, attachments, full screen)). Never focus a field in a pane that's off screen without `preventScroll`: the browser scrolls the pager to it. |

## Task → open these files
| You want to… | Open |
| --- | --- |
| Edit the note editor / toolbar | `MilkdownEditor.tsx`, `NotesProvider.tsx` |
| Add/change a REST route | `api/handler.go` **and** `src/lib/api.ts` (keep in sync) |
| Change note metadata / frontmatter | `notes/frontmatter.go` (+ `store.go` if persistence changes) |
| Vault or collection management | `notes/vaults.go`, `notes/collections.go`, `handler.go`, `NotesProvider.tsx` |
| Note history / restore | `notes/history.go`, `NoteHistoryPanel.tsx` |
| Image upload / migration | `notes/images.go`, `handler.go` image routes |
| AI features | `api/ai.go`, `src/lib/ai.ts`, `AICommandPanel.tsx` |
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

## Commands
```bash
# backend (from backend/)
go build ./... && go vet ./... && go test ./...
go run .                       # serves :8080 (NEXOTE_PORT)

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

## Roadmap
Current backlog (trash, new-note location, templates, wikilinks, editor
behavior, …) and the settings rules: `wip-features.md`. Older feature plan
(tags, previews, multi-select, search filters, properties, dual-pane, calendar,
settings toggles): `.opencode/plans/notebook-navigator-features.md`.

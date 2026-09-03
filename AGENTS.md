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
- The backend is dense (`notes/store.go` ~985 lines). Open the specific function
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
- A **note** = one file `<id>.md`. Frontmatter (YAML) holds `Meta`; the rest is
  markdown body. See `notes/frontmatter.go`.
  - `Meta`: `id, title, path, createdAt, updatedAt, tags[], type, artist, year,
    genre, wantlist, cover, collection, fields{}`. (`path` = folder relative to
    vault root; `""` = root.)
- **ID** = 16-char base64url random string → `notes/id.go` `NewID()`.
- Storage under `$NEXOTE_HOME` (default `~/.nexote`, dev `.envrc`/local may set
  `.notes-dev`):
  - `vaults/<vaultId>/…` — note files, nested folders. Registry: `vaults.json`.
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
| `notes/store.go` | Core `Store`: filesystem notes, in-memory id→path index, two locks, create/update/delete/daily/copy/move, path sanitization. |
| `notes/frontmatter.go` | `Meta` + `Document` types; encode/parse markdown+YAML frontmatter. |
| `notes/id.go` | `NewID()` 16-char base64url generator. |
| `notes/vaults.go` | `VaultMeta` + `VaultRegistry` (`vaults.json`, ensures default "Default" vault). |
| `notes/collections.go` | `CollectionMeta`/`CollectionField`/`CollectionFieldType` + `CollectionRegistry`. |
| `notes/history.go` | Per-note full snapshots under `<store>/.history/<noteId>/<unix-ms>.md`. |
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
| `src/components/{CollectionGallery,VinylGallery,NoteHistoryPanel,AICommandPanel,SettingsPanel,CommandPalette}.tsx` | Feature panels. |
| `src/lib/ai.ts` / `note-utils.ts` | AI client (streams via `/api/ai/chat`) + note helpers. |
| `src/app/page.tsx` · `layout.tsx` | Desktop shell composition. |
| `src/app/m/*` + `src/components/mobile/*` | Separate mobile app (`/m`). |

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
| Real-time updates | `api/events.go`, SSE handling in `NotesProvider.tsx` |

## Do-not-break invariants
These are the things that silently corrupt data or hang clients if changed
carelessly. Comments already live next to each one — read them before editing.
- **Two locks in `Store`** (`store.go:32-44`): `mu` guards only the in-memory
  id→path index; `writeMu` serializes every read-modify-write mutation. Keep
  mutations under `writeMu`. Don't merge them or reads stop being concurrent /
  writes race (duplicate daily notes, clobbered edits).
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
pnpm typecheck                 # tsc --noEmit
pnpm lint                      # next lint
pnpm dev                       # Next on :3000, proxies /api/* -> Go

# run both locally:
(cd backend && go run .) & (cd frontend && pnpm dev) & wait
```
Dev proxy: `frontend/next.config.mjs` rewrites `/api/* → NEXOTE_BACKEND_URL ||
http://localhost:8080`. Prod = reverse proxy in front of both, or the Docker build.

## Roadmap
Feature plan (tags, previews, multi-select, search filters, properties, dual-pane,
calendar, settings toggles) lives at `.opencode/plans/notebook-navigator-features.md`.

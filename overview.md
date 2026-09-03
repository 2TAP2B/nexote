# Nexote — Project Overview

A self-hosted markdown note-taking web app. WYSIWYG editing via Milkdown (Crepe),
a small Go backend that stores notes as plain `.md` files with YAML frontmatter,
and a Nix flake devshell. Built on NixOS.

> **Agent orientation:** see [`AGENTS.md`](./AGENTS.md) for the file index,
> task→file cheat sheet, and do-not-break invariants. This document is the human
> architecture overview.

## Feature set (current)
- **Multi-vault** — many isolated note directories, managed via the API/UI.
- **Nested folders** — notes live in `<id>.md` files under nested paths per vault.
- **Collections** — typed sets with custom fields (`text|number|boolean|date`),
  rendered as a gallery; includes the built-in "Vinyls" collection.
- **Per-note history** — full-file snapshots on every save, browsable + restorable.
- **Tasks** — lightweight task list across notes.
- **Daily journal** — one-click today's note (pseudo vault id `"journal"`).
- **AI assistant** — streaming chat through a Go proxy to any OpenAI-compatible
  endpoint; the browser never sees the API key.
- **Images** — upload into a note's folder, referenced from markdown, migrated on
  note move (cross-folder and cross-vault).
- **Bookmarks & shortcuts** — pinned note ID lists per vault.
- **Tags** — stored in frontmatter; listable/filterable.
- **Real-time sync** — Server-Sent Events broadcast note changes to open clients.
- **Offline / PWA** — IndexedDB outbox + service worker replay queued writes on
  reconnect (AI requests are never queued).
- **Mobile app** — a separate, touch-first UI at `/m`.

## Architecture

```
nexote/
├── flake.nix                # nix devshell: go_1_25, nodejs_22, pnpm, gopls, tsserver
├── .envrc                   # use flake (direnv)
├── backend/                 # Go 1.25, module "nexote", stdlib + gopkg.in/yaml.v3
│   ├── main.go              # bootstrap: NEXOTE_HOME, port, registry + collections vault + journal
│   ├── api/
│   │   ├── handler.go       # Handler + ALL REST routes + CORS/preflight (route table ~L51–126)
│   │   ├── events.go        # SSE hub: real-time note-change broadcast
│   │   └── ai.go            # AI proxy (chat/test → OpenAI-compatible, relays upstream SSE)
│   └── notes/
│       ├── store.go         # core Store: filesystem CRUD, id→path index, two locks
│       ├── frontmatter.go   # Meta + Document; YAML frontmatter encode/decode
│       ├── id.go            # NewID(): 16-char base64url
│       ├── vaults.go        # VaultMeta + VaultRegistry (vaults.json)
│       ├── collections.go   # CollectionMeta/Field + CollectionRegistry
│       ├── history.go       # per-note snapshots under .history/<id>/<ms>.md
│       ├── images.go        # image upload/list/read/delete + move migration
│       └── bookmarks.go     # idList backing Bookmarks + Shortcuts
└── frontend/                # Next.js 16 app router, React 19, Tailwind v4, Milkdown Crepe
    ├── next.config.mjs      # rewrites /api/* → Go; compress:false (SSE); output:"standalone"
    ├── public/sw.js         # service worker: offline outbox replay (never queues /api/ai/)
    └── src/
        ├── app/             # desktop shell (page.tsx, layout.tsx) + /m mobile app
        ├── components/      # NotesProvider, MilkdownEditor, FileTree, galleries, panels, mobile/*
        └── lib/             # api.ts (client+types), ai.ts, offline-db.ts, note-utils.ts
```

## Data model

Notes are files under `$NEXOTE_HOME` (default `~/.nexote`; dev may use `.notes-dev`),
one per note:

```markdown
---
id: <16-char base64url>
title: <title>
path: <optional folder, e.g. "Journal/2026">   # "" = vault root
createdAt: <RFC3339>
updatedAt: <RFC3339>
tags: [ ... ]
type: <e.g. "vinyl">
# collection-specific fields (artist, year, genre, wantlist, cover, collection, fields{})
---
<markdown body>
```

- `id`: 12 random bytes → base64url, no padding = 16 chars (`notes/id.go`).
- `path`: folder relative to the vault root; the file lives at
  `<vaultDir>/<path>/<id>.md`.
- **Storage tree** (under `$NEXOTE_HOME`):
  - `vaults/<vaultId>/…` — note files + nested folders. Registry: `vaults.json`.
  - A dedicated **"Collections"** vault is auto-created to hold collection notes.
  - `journal/` — daily journal notes (pseudo id `"journal"`).
  - `collections.json` — collection registry (`CollectionMeta` + custom fields).

## API (Go, `:8080`)

All note/bookmark/folder routes are scoped under a vault. Full table in
`backend/api/handler.go` (~L51–126); the frontend mirror is `frontend/src/lib/api.ts`.

| Group | Routes |
| --- | --- |
| Vaults | `GET/POST /api/vaults`, `PUT/PATCH/DELETE /api/vaults/{id}` (rename/icon/delete) |
| Collections | `GET/POST /api/collections`, `PUT/PATCH(pin)/DELETE /api/collections/{id}` |
| Notes | `GET/POST /api/vaults/{vaultId}/notes` (+`/copy`,`/move`), `GET/PUT/DELETE …/notes/{id}` |
| History | `GET …/notes/{id}/history`, `GET …/history/{ts}`, `POST …/history/{ts}/restore` |
| Folders | `POST /api/vaults/{vaultId}/folders`, `DELETE …/folders/{path...}` |
| Images | `POST …/notes/{id}/images`, `GET …/images`, `GET/DELETE …/images/{path...}` |
| Bookmarks | `GET/POST …/bookmarks`, `DELETE …/bookmarks/{id}` |
| Shortcuts | `GET/POST …/shortcuts`, `DELETE …/shortcuts/{id}` |
| Tags | `GET …/tags`, `POST/DELETE …/notes/{id}/tags…`, `POST …/tags/rename`, `DELETE …/tags/{tag...}` |
| Journal | `GET /api/journal/daily`, `GET /api/journal/notes`, `GET/PUT/DELETE …/notes/{id}`, history routes |
| Tasks | `GET/PUT /api/tasks` |
| AI | `POST /api/ai/chat` (streaming), `POST /api/ai/test` |
| Events | `GET /api/events` (SSE) |

Errors: `{ "error": "<msg>" }` with the appropriate status; missing id → 404. CORS
open for dev. Next.js proxies `/api/*` → Go in dev so the app is same-origin.

## Frontend behavior

- `NotesProvider` (`src/components/NotesProvider.tsx`) is the single source of
  truth: all app state (vaults, notes/tabs, active note, collections, tasks,
  bookmarks, shortcuts) plus every CRUD action. Components consume it via
  `useNotes()`.
- The editor (`MilkdownEditor.tsx`) is keyed by note id; swapping notes remounts
  Crepe with the new markdown. Saves are debounced and serialized per id.
- **Real-time:** an `EventSource` on `/api/events` refetches a note when it
  changes elsewhere (the SSE stream needs `compress:false` in Next config).
- **Offline:** writes that fail while offline go into an IndexedDB outbox
  (`lib/offline-db.ts`) and are replayed by the service worker on reconnect.
  `/api/ai/*` is deliberately never queued.
- **Mobile** (`/m`, `src/components/mobile/*`) is a separate, touch-first app
  sharing the same provider + API client.

## Theming

`globals.css` defines a neutral frame palette with a mauve/purple accent as CSS
variables, exposed to Tailwind v4 via `@theme` and mapped onto Crepe's `frame`
theme on `.milkdown`. Crepe theme CSS is imported before the overrides so they win
the cascade; dark overrides are scoped under `.dark .milkdown`. `next-themes`
drives light/dark/system.

## Tooling / checks

```bash
direnv allow                       # enter devshell (or: nix develop)
# backend
cd backend && go build ./... && go vet ./... && go test ./...
# frontend
cd frontend && pnpm install && pnpm typecheck && pnpm lint
# run both
(cd backend && go run .) & (cd frontend && pnpm dev) & wait
```

Nix flake: `nix develop .#devShells.x86_64-linux.default -c <cmd>` works without
direnv. We use `go_1_25` (`go_1_23` is EOL on nixos-unstable).

## Conventions

- Go: stdlib `net/http` with method-pattern routing
  (`mux.HandleFunc("GET /api/vaults/{vaultId}/notes/{id}", ...)`), `r.PathValue(...)`.
- Frontend: app router, `"use client"` where hooks/DOM are needed, dynamic import
  for Milkdown (`ssr: false`), `@/*` path alias to `src/*`.
- No comments in code unless asked.
- `.notes-dev/`, `.next/`, and note data are gitignored / not committed.

## Roadmap

The forward-looking feature plan (tags, previews, multi-select, search filters,
properties, dual-pane, calendar, settings toggles) lives at
`.opencode/plans/notebook-navigator-features.md`.

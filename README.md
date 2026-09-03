# Nexote

A self-hosted markdown note-taking web app: a small **Go** backend that stores
notes as plain `.md` files with YAML frontmatter, and a **Next.js 16 / React 19 /
Milkdown Crepe** frontend. No database — your notes are just files on disk.

> **Deeper docs:** [`overview.md`](./overview.md) for the full architecture & API,
> and [`AGENTS.md`](./AGENTS.md) for AI agents (file index + invariants).

## Features
Multi-vault · nested folders · typed collections with custom fields · per-note
history + restore · tasks · daily journal · streaming AI assistant (key stays on
the server) · image upload/migration · bookmarks & shortcuts · tags · real-time
sync (SSE) · offline/PWA queueing · a separate mobile app at `/m`.

## Stack
- **Frontend**: Next.js 16 (app router), React 19, Tailwind CSS v4, Milkdown
  (Crepe via `@milkdown/react`), `next-themes` for light/dark/system.
- **Backend**: Go 1.25, stdlib `net/http`, `gopkg.in/yaml.v3`. Notes are files on
  disk — no database.
- **Devshell**: Nix flake providing Go, Node, pnpm, gopls, typescript-language-server.

## Notes format
Each note is one file (`<id>.md`) with YAML frontmatter holding its metadata
(`id`, `title`, `path`, timestamps, `tags`, and collection fields) plus a markdown
body. The data directory is `$NEXOTE_HOME` (default `~/.nexote`; dev may use
`.notes-dev/`). Notes live in nested folders under `vaults/<vaultId>/`.

## Getting started
Enter the devshell (requires [direnv](https://direnv.net) + Nix with flakes):

```bash
direnv allow
```

First-time frontend install:

```bash
cd frontend && pnpm install
```

Run both servers (from the repo root):

```bash
(cd backend && go run .) & (cd frontend && pnpm dev) & wait
```

Then open <http://localhost:3000>. The Go API listens on `:8080`
(`NEXOTE_PORT`); in dev Next.js proxies `/api/*` to it (see
`frontend/next.config.mjs`), so the app uses same-origin URLs. For production, run
a reverse proxy in front of both, or use the single-container Docker build
(`Dockerfile`, `docker-compose.yml`).

## Checks
```bash
# backend
cd backend && go build ./... && go vet ./... && go test ./...

# frontend
cd frontend && pnpm typecheck && pnpm lint
```

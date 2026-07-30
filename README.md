# Nexote

A markdown note-taking web app built with [Milkdown](https://milkdown.dev) on the
frontend and a small Go backend that stores notes as plain `.md` files with YAML
frontmatter.

## Stack

- **Frontend**: Next.js 16 (app router), React 19, Tailwind CSS v4, Milkdown
  (Crepe editor via `@milkdown/react`), `next-themes` for light/dark/system.
- **Backend**: Go 1.25, stdlib `net/http`, `gopkg.in/yaml.v3`. Notes are files
  on disk — no database.
- **Devshell**: Nix flake providing Go, Node, pnpm, gopls, typescript-language-server.

## Notes format

Each note is a single file in the notes directory (`.notes-dev/` by default):

```markdown
---
id: <id>
title: <title>
createdAt: <RFC3339>
updatedAt: <RFC3339>
---
<markdown body>
```

The directory is configurable via `NEXOTE_NOTES_DIR`; the backend listens on
`NEXOTE_PORT` (default `8080`).

## API

| Method | Path              | Body                     | Description            |
| ------ | ----------------- | ------------------------ | ---------------------- |
| GET    | `/api/notes`      | —                        | List note metadata     |
| GET    | `/api/notes/{id}` | —                        | Get a note with body   |
| POST   | `/api/notes`      | `{ "title"?: string }`   | Create a note          |
| PUT    | `/api/notes/{id}` | `{ "title"?, "body"? }`  | Update a note          |
| DELETE | `/api/notes/{id}` | —                        | Delete a note (204)    |

During development the Next.js dev server proxies `/api/*` to the Go backend
(see `frontend/next.config.mjs`), so the app uses same-origin URLs.

## Theming

v0.0.1 uses a neutral frame palette with a mauve/purple accent, defined as CSS
variables in `frontend/src/app/globals.css`. The same variables feed Milkdown's
Crepe `frame` theme via `.milkdown` overrides, so the editor and the app shell
share one palette. A light/dark/system toggle lives in the sidebar
(`next-themes`).

## Getting started

Enter the devshell (requires [direnv](https://direnv.net) + Nix with flakes):

```bash
direnv allow
```

Run both servers (from the repo root):

```bash
trap 'kill 0' EXIT; (cd backend && go run .) & (cd frontend && pnpm dev) & wait
```

Then open <http://localhost:3000>.

First-time frontend install:

```bash
cd frontend && pnpm install
```

## Checks

```bash
# backend
cd backend && go vet ./... && go build ./...

# frontend
cd frontend && pnpm typecheck && pnpm build
```

## Project layout

```
nexote/
├── flake.nix                # nix devshell
├── backend/                 # Go REST API
│   ├── main.go
│   ├── api/handler.go
│   └── notes/{store,frontmatter,id}.go
└── frontend/                # Next.js + Milkdown
    └── src/
        ├── app/             # layout, page, globals.css
        ├── components/      # MilkdownEditor, Sidebar, EditorPane, ThemeToggle, NotesProvider
        └── lib/             # api client, notes context
```
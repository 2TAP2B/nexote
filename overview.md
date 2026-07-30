# Nexote — Project Overview

A markdown note-taking web app. WYSIWYG editing via Milkdown (Crepe), a small
Go backend that stores notes as plain `.md` files with YAML frontmatter, and a
Nix flake devshell. Built on NixOS.

## Status

- **v0.0.1** (tagged `v0.0.1`, commit `6502566`): working end-to-end.
  - Go REST API (list/get/create/update/delete) over filesystem notes.
  - Next.js 16 + React 19 + Tailwind v4 + Milkdown Crepe editor.
  - Neutral frame palette with mauve/purple accent; next-themes
    light/dark/system toggle.
  - Debounced autosave; sidebar list; title input.
- **v0.0.2** (tagged `v0.0.2`): dark-mode editor fix, full-width + responsive,
  search, keyboard shortcuts, delete confirmation, Go unit tests, foldable
  sidebar, nicer fonts (Inter/Lora/JetBrains Mono).
- **v0.0.3** (in progress): lucide icons everywhere (no emojis), modern
  rounded UI, responsive editor container with proper padding/margin, mobile
  swipe gestures to open/close the sidebar.
  - Icons: `lucide-react` replaces all emoji/text glyphs (Menu, Plus, Search,
    Trash2, FileText, PanelLeftClose/Open, Sun/Moon/Monitor, Check, Loader2,
    AlertTriangle).
  - Modern UI: rounded-xl/2xl shapes, subtle shadows, backdrop-blur on
    sidebar/topbar/overlays, smoother hover transitions.
  - Editor container: outer responsive padding (px-4/py-6 mobile, px-10/py-10
    desktop) + max-w-3xl centered inner container; symmetric ProseMirror
    padding so the block handle never overlaps the sidebar.
  - Mobile swipe: `useSwipeSidebar` hook listens for horizontal touch gestures
    — edge-swipe-right opens, swipe-left closes (vertical-dominant gestures
    ignored to preserve scroll).

## Architecture

```
nexote/
├── flake.nix                # nix devshell: go_1_25, nodejs_22, pnpm, gopls, ...
├── .envrc                   # use flake (direnv)
├── backend/                 # Go 1.25, module "nexote"
│   ├── main.go              # server bootstrap, env config
│   ├── api/handler.go       # REST handlers + CORS, JSON via stdlib
│   └── notes/
│       ├── store.go         # filesystem CRUD: <id>.md files
│       ├── frontmatter.go   # YAML frontmatter encode/decode (gopkg.in/yaml.v3)
│       └── id.go            # base64url random id (~16 chars)
└── frontend/                # Next.js 16 app router
    ├── next.config.mjs      # rewrites /api/* -> http://localhost:8080
    ├── postcss.config.mjs   # @tailwindcss/postcss
    └── src/
        ├── app/
        │   ├── layout.tsx   # ThemeProvider (next-themes, attribute=class)
        │   ├── page.tsx     # NotesProvider + Sidebar + EditorPane
        │   └── globals.css  # Tailwind v4 theme tokens + .milkdown overrides
        ├── components/
        │   ├── MilkdownEditor.tsx  # Crepe via @milkdown/react, dynamic ssr:false
        │   ├── NotesProvider.tsx   # context: list/load/create/save/delete + draft
        │   ├── Sidebar.tsx         # note list + search + new + theme toggle + collapse
        │   ├── EditorPane.tsx      # title input + editor, debounced autosave
        │   ├── ThemeToggle.tsx     # light/dark/system cycle (lucide icons)
        │   ├── DeleteConfirm.tsx   # accessible confirm dialog (lucide icons)
        │   ├── Shortcuts.tsx       # Cmd/Ctrl+N, Cmd/Ctrl+S
        │   └── useSwipeSidebar.ts  # mobile swipe-to-open/close hook
        └── lib/
            ├── api.ts             # fetch wrapper, types (Note, NoteMeta, NoteInput)
            └── notes-context.ts   # re-export NotesProvider/useNotes + types
```

## Data model

Notes are files in `NEXOTE_NOTES_DIR` (default `.notes-dev/`), one per note:

```markdown
---
id: <id>
title: <title>
createdAt: <RFC3339>
updatedAt: <RFC3339>
---
<markdown body>
```

- `id`: 12 random bytes, base64url, no padding (e.g. `b3xiI9Ya2mQh`).
- Timestamps are UTC, serialized as RFC3339-with-millis in the API JSON.

## API (Go, `:8080`)

| Method | Path              | Body                    | Returns          |
| ------ | ----------------- | ----------------------- | ---------------- |
| GET    | `/api/notes`      | —                       | `NoteMeta[]`     |
| GET    | `/api/notes/{id}` | —                       | `Note`           |
| POST   | `/api/notes`      | `{ "title"?: string }`  | `Note` (201)     |
| PUT    | `/api/notes/{id}` | `{ "title"?, "body"? }` | `Note`           |
| DELETE | `/api/notes/{id}` | —                       | 204              |

Errors: `{ "error": "<msg>" }` with appropriate status. `GET/PUT` on missing
id → 404. CORS open (`*`) for dev. Next.js proxies `/api/*` → Go in dev so the
app is same-origin.

## Frontend behavior

- `NotesProvider` holds the list + selected note; `useNotes()` consumes it.
- Selecting a note fetches its full body; the editor is keyed by note id so
  swapping notes remounts the Crepe instance with the new `defaultValue`.
- Editor emits markdown via `crepe.on(listener => listener.markdownUpdated(...))`;
  `EditorPane` debounces saves (800ms) and serializes in-flight saves per id
  to keep updates ordered.
- Theme: `next-themes` with `attribute="class"`, `defaultTheme="system"`. The
  sidebar toggle cycles light → dark → system.

## Theming details

`globals.css` defines a neutral frame palette with a mauve/purple accent as
CSS variables (`--background`, `--foreground`, `--muted`, `--border`,
`--primary` = violet-600/400, `--accent`, `--ring`, ...), exposed to Tailwind v4
via `@theme`. The same vars are mapped onto Crepe's `frame` theme variables on
`.milkdown` (`--crepe-color-*`) so the editor and shell share one palette.

**Known issue (v0.0.2 to fix):** the editor stays light in dark mode because
Crepe's `frame.css` sets hardcoded light values on `.milkdown` and the override
order is not guaranteed when CSS is imported from separate modules. Fix: import
the Crepe theme CSS in `globals.css` before the override block so the overrides
win the cascade; also scope dark overrides under `.dark .milkdown` for safety.

**Fixed in v0.0.2:** Crepe's `common/style.css` and `frame.css` are now imported
at the top of `globals.css` (before our overrides), and dark overrides live
under `.dark .milkdown` (specificity 0,2,0 vs Crepe's 0,1,0) so the editor
follows the app theme in both light and dark. The component no longer imports
the theme CSS itself, removing the nondeterministic ordering.

## Tooling / checks

```bash
direnv allow                       # enter devshell
# backend
cd backend && go vet ./... && go build ./...
# frontend
cd frontend && pnpm typecheck && pnpm build
# run both
trap 'kill 0' EXIT; (cd backend && go run .) & (cd frontend && pnpm dev) & wait
```

Nix flake: `nix develop .#devShells.x86_64-linux.default -c <cmd>` works
without direnv. Note: `go_1_23` is EOL on nixos-unstable; we use `go_1_25`.

## Conventions

- Go: stdlib `net/http` with Go 1.22+ method-pattern routing
  (`mux.HandleFunc("GET /api/notes/{id}", ...)`), `r.PathValue("id")`.
- Frontend: app router, `"use client"` where hooks/DOM are needed, dynamic
  import for Milkdown (`ssr: false`), `@/*` path alias to `src/*`.
- No comments in code unless asked.
- Notes dir and `.next/` are gitignored; `.notes-dev/` is dev data, not
  committed.

## Next versions (rough ideas)

- v0.0.3: tags/folders, full-text search index, note count badges.
- v0.0.4: auth, multi-user, sync.
- later: collaboration (Y.js), image upload, export, single-binary Go serve
  of built Next.js static export.
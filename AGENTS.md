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
| `flake.nix` / `.envrc` | Nix devshell (`go_1_25`, `nodejs_22`, `pnpm`, gopls, tsserver, `gh`). `.envrc` = `use flake`. |
| `Dockerfile`, `docker-compose.yml` | Single-container prod build (Next `output:"standalone"` + Go binary); compose pulls `ghcr.io/2tap2b/nexote` and keeps a `build:` for source builds. |
| `docs/` | User documentation (Rspress 2, own pnpm package; `docs/docs/` content, `docs/public/` logo + screenshots). Published to GitHub Pages. |
| `.github/workflows/` | `release.yml` (tag + release + GHCR image per push to main), `docs.yml` (Pages). |
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
| `notes/collections.go` | `CollectionMeta`/`CollectionField`/`CollectionFieldType` + `CollectionRegistry`. A collection's name is also the folder of its items in the Collections vault, so `Update` refuses a name another collection has; the handlers move the folder on rename, delete it (the items) with the collection, and refuse to delete built-ins (they come back on start — hide them instead). Tests: `api/collections_test.go`. |
| `notes/history.go` | Per-note full snapshots under `<store>/.history/<noteId>/<unix-nanos>.md`. |
| `notes/snippet.go` | Plain-text note previews (`makeSnippet`, `contentSnippet`) for lists/history/search. Mirrored by `makeSnippet` in `src/lib/note-utils.ts` — keep both in sync. |
| `notes/images.go` | Image + PDF upload/list/read/delete + cross-folder & cross-vault migration on note move (`IsAttachmentName` = image or PDF; `ListImages`/Images view stay images-only). `SavePDF` checks the `%PDF-` signature and names the file `<slug of original>-<6 chars>.pdf` (no spaces/parens: the URL regexes stop there). Traversal-guarded. |
| `notes/bookmarks.go` | `idList` (order-preserving ID set) backing per-user `Bookmarks` and `Shortcuts`; legacy-file adoption. |
| `api/events.go` | SSE hub: `note-change`, `tree-change`, `spaces-change`, each delivered only to users who can see the vault/space (personal stores: only their owner). |
| `api/ai.go` | AI proxy: forwards chat/test to an OpenAI-compatible endpoint, relays upstream SSE; `POST /api/ai/transcribe` sends a voice memo to the endpoint's `/v1/audio/transcriptions` (multipart, ≤25 MB, file name keeps the format extension). Tests: `api/ai_test.go`. |

## File index — frontend (key files)
| Path | Responsibility |
| --- | --- |
| `src/lib/api.ts` | API client + all shared types (`Note`, `VaultMeta` with `spaceId`/`role`, `SpaceInfo`, `AuthUser`, …). Mirror of the Go routes. Any 401 (outside `/api/auth/`) fires `AUTH_REQUIRED_EVENT`. |
| `src/components/NotesProvider.tsx` | **Central context.** All app state + every CRUD action, SSE refetch, offline queue. Use `useNotes()`. Spaces: `vaults` = the active space's vaults, `allVaults` = every accessible one; `switchSpace` swaps vaults and the per-space tab strip; `listCollections()` reads the active space; `refreshVaultTree(vaultId)` refetches one vault's tree now (instead of waiting for the SSE echo). |
| `src/components/auth/*` · `src/lib/webauthn.ts` · `src/app/invite/[token]/page.tsx` | `AuthGate` (wraps `NotesProvider` in both shells: setup / login / app, login overlay on session loss, offline start with the cached last user) + `useAuth()`; `session.ts` wipes per-account data on sign-out or account switch; passkey ceremony helpers; public invite/recovery page. |
| `src/components/spaces/*` · `src/components/useCanEdit.ts` | Desktop `RibbonSpaces` (bottom of the Ribbon: `SpaceSwitcher` = active space avatar → upward panel to switch/create/manage spaces, right above `AccountButton`), `MobileSpacesPane` (pager pane left of the sidebar), `SpaceDialog` (new space), `SpaceSettingsDialog` (name, icon, members, leave/delete) · read-only checks for viewers. |
| `public/sw.js` / `src/app/sw-assets/route.ts` / `src/lib/offline-status.tsx` / `offline-db.ts` / `ServiceWorkerRegister.tsx` | Offline/PWA layer. The SW is the only sync engine: caches every build file at install (`/sw-assets`), mirrors data GETs to IndexedDB, queues an allowlist of writes (note create/update/delete, journal, bookmarks, shortcuts, folder create; the rest → 503 offline), applies them locally, replays in order (one at a time, stops on 401/network, `expectedUpdatedAt` → conflict copy). Client note ids (`newNoteId`) make replayed creates idempotent. Never caches/queues `/api/{auth,admin,me,users,ai,git,events}`. |
| `src/components/MilkdownEditor.tsx` + `editor/*` | The editor (Milkdown Crepe). `editor/wikilink.ts`: `[[Title]]`/`[[Title\|label]]` chips (parsed and written back unescaped; in the editor a node view without text, label via CSS — phone keyboards duplicated chip text; a click fires `nexote:open-wikilink`, NotesProvider opens or creates the note). `editor/callout.ts`: `> [!type]± title` callouts (remark transform blockquote→callout + stringify handler: written back verbatim, never `\[!`; node `callout` = `callout_title` + blocks; icon node view with a native type picker; input rule `[!type] ` in a quote; `InsertCallout` command; `CALLOUT_TYPES` = all 13 built-in types). `editor/highlight.ts`: `==text==` mark (`ToggleHighlight`). Both are ALWAYS registered — `settings.calloutsAndHighlights` only switches the look (`html.nexote-plain-markup`) and the menu/toolbar entries, so files round-trip unchanged either way. `editor/toolbarActions.ts`: the button list shared by `mobile/MobileEditorToolbar.tsx` and the desktop `EditorToolbar.tsx` (bar below the note, `settings.formattingToolbar`; the desktop new-note FAB moves up while it shows); a button with `menu` (callout → every type) opens `editor/ToolbarMenu.tsx` upward. `editor/mention.ts`: "@"/"[[" note picker. `editor/blockSelect.ts`: block selection mode (taps pick blocks, list items one by one; copy/cut/delete). `editor/inlineCode.ts`: "Code" at a bare caret starts a typing session (the inline code mark isn't inclusive). Date button format: `settings.dateFormat` (Settings › Editor, `formatTitle` codes). Shell-facing event names: `lib/editor-events.ts`. Mobile sheet rows act on a tap (pointerup near pointerdown), never on pointerdown. |
| `src/components/{FileTree,EditorPane,Ribbon,TopBar}.tsx` | Desktop shell panes. `FileTree` (also inside `mobile/MobileSidebar.tsx` with `touch`): vault sections → folders → notes; folder open state per vault (`nexote:folders-open`, keys `<vaultId>:<path>`); note order and card view from `settings.treeSort`/`treeCards`; `TreeControls` (`allExpanded`, `toggleExpandCollapse` = folders + sections, `revealActive`) feed the desktop header (`page.tsx` `SidebarHeader`) and the phone bottom bar; the tree follows the open note (reveal scrolls only the tree's own box, never the phone pager); `touch` = 44 px rows, long press → `MobileActionSheet` instead of `ContextMenu`. |
| `src/components/{NoteHistoryPanel,AICommandPanel,CommandPalette}.tsx` | Feature panels. |
| `src/components/DailyNotesView.tsx` · `JournalCalendar.tsx` | The Daily-notes sidebar view (FileTree `journal`, desktop and phone): the shared calendar (also on the desktop dashboard), then the shown month's entries — date tile, Today/Yesterday/weekday/date, two-line server snippet; "Write today's entry" while today has none. A journal note's day is its `YYYY-MM-DD` title, else its creation day. |
| `src/components/collections/*` | Collections UI, built like threads. `useCollections()` (one shared store of the active space's definitions; `upsertCollection`/`dropCollection` after API calls), `items.ts` (`useCollectionItems()` across the space's vaults, subtitle/facts/search/sort), `actions.ts` (`openCollection(id)` / `newCollection()` events — the hosts show the gallery in the desktop main view (`MainView` kind `collection`) or the phone overlay (swipe right closes); `useCollectionActions()` pin/delete items, pin/hide/delete collections), `menus.tsx` (the one collection / item menu + confirmation texts), `CollectionArt.tsx` (icon tile, cover), `formParts.tsx`. Views: `CollectionsList` (sidebar), `CollectionView` (gallery: search, sort, grid/list, Yes/No chips; sort + view per collection in localStorage), `ItemEditor` / `CollectionEditor` (lookup, scanner, covers; field keys are camelCase from the label and never change), `ItemHero` + `useItemActions` (item header and ⋯ menu in `EditorPane` / `MobileNoteView`). |
| `src/components/ActionMenu.tsx` · `ResponsiveDialog.tsx` · `mobile/mobileTheme.ts` | Shared chrome: one menu from `SheetAction` groups (desktop `ContextMenu` for right-click/buttons, `MobileActionSheet` for touch) · forms and confirmations as a bottom sheet (touch) or a centered card (desktop; Escape closes the top one) · `SHELL_PALETTE` maps `--mob-*` to the theme for views shown outside the touch shell. |
| `src/components/settings/*` | Settings pages shared by desktop and mobile: `ui.tsx` (Obsidian-style groups/rows/controls; a platform context only changes sizes), one `*Settings.tsx` per page (`AccountSettings`: name, passkeys, sign out; `UsersSettings`: admins' users, invites, recovery links), `categories.tsx` (nav registry; `settingsNav(role, platform)` hides admin-only pages; `nexote:open-settings` with a category in `detail` opens that page). Shells: `SettingsPanel.tsx` (desktop dialog) and `mobile/MobileSettings.tsx` (list → page). Options live in `AppSettings` (`NotesProvider.tsx`, localStorage). |
| `src/lib/ai.ts` / `note-utils.ts` / `notepad.ts` | AI client (streams via `/api/ai/chat`) + note helpers (title heading, `makeSnippet` preview) + the quick-capture "Notepad" format (`- HH:MM text` items under `### YYYY-MM-DD`; links are `[[Title]]`, images are `![](url)` continuation lines; edits replace an entry found by content in the latest body). |
| `src/lib/app-info.ts` / `clipboard.ts` / `notebooks.ts` | About-page metadata (repo links; version/commit/build time inlined by `next.config.mjs` from the latest `v*` git tag, or the `NEXOTE_VERSION`/`NEXOTE_COMMIT` Docker build args) + copy-to-clipboard with a fallback for plain-http origins + vault/folder choices ("notebooks") for quick notes' "Make note". |
| `src/lib/threads.ts` + `src/components/threads/*` | Quick-notes threads: each thread is a note `type: "thread"` in `<Notepad folder>/Threads` of the Notepad's vault (default personal `home`, which the editor can't open — `ThreadView` is the only UI). New threads go to the account's Notepad location (server-side prefs; the location is per account, so every device uses the same note — `useAllThreads()` (`threads/useAllThreads.ts`) reads `home` + every vault whose `allVaultData` metas hold a `type: "thread"` note anyway, via `useThreadsIn(vaultIds)` and `syncThreads` (reloads a vault when its metas disagree with the cache)). Used by `ThreadsList`, the quick-notes stream and "Add to thread", `CommandPalette`, `useNoteRefs`, the Tags view; `useSharedTags(vaults)` = note + thread tags as one namespace (Tags view, dashboards, palette `#`). Thread notes are left out of Recent, dashboards' recent lists and note counts. Body: `## title` + one `### YYYY-MM-DD HH:MM` section per post; posts are found by content in the latest body (`mutateThread` always re-reads). Shared per-vault cache `useThreads(vaultId)` (ThreadView; fed by `NOTE_CHANGE_EVENT`, which NotesProvider re-fires from SSE; a change while nobody listens marks the vault stale). Events: `OPEN_THREAD_EVENT` → hosts (desktop `<aside data-thread-panel>` in `page.tsx`, mobile portal overlay in `MobileApp`, closed by a right swipe: `useSwipeToClose`); a #tag in a thread fires `nexote:select-tag` like the editor (Tags view with notes + threads). `useMemoDraft` = composer state shared by `QuickCapturePane` and `ThreadView`; `useSwipeAction` = touch swipe-left that claims only leftward drags (stops propagation so the pager doesn't move). Stream merges memos + `ThreadCard`s by `lastActivity` (newest post time). |
| Marks (pin / priority / done) | Threads: frontmatter `pinned`, `priority` (1–5, 0 none; backend clamps), `status: "done"` — `notes.Meta` + `UpdateInput` pointers, `setThreadMeta`. Posts: tokens after the time in the heading `### 2026-11-19 09:14 📌 P2 ✅` (`setPostFlags`; editing keeps them). Memos: `- 09:14 📌 text` (`setNotepadEntryPinned`; `NotepadEntry.text` excludes the mark). UI: `threads/priority.tsx` (colors/icons), `threadActions.tsx` (`markSections` → the same menu everywhere), `PinnedBar.tsx`, `JumpButton.tsx` (`useScrolledAway`; also back-to-top in `EditorPane`/`MobileNoteView`), `useLongPress.ts`. |
| Account preferences (v0.11) | `accounts/prefs.go`: whitelisted keys on `User.Prefs` (users.json), `GET/PATCH /api/me/prefs` (`api/account.go`). `NotesProvider` applies them over the local settings on sign-in (server wins; first use uploads this device's) and `updateSettings` pushes them — covers `notepadVault/Folder`, `notepadInTree`, `memoNoteVault/Folder`, so the Notepad is one note per account. Booleans travel as `"true"/"false"`. Offline or old backend: the device's own values stay. Not merged: existing Notepads at different locations stay separate. |
| Comments, menus, desktop main view (v0.10) | Post comments: `#### YYYY-MM-DD HH:MM` sub-sections under a post (`ThreadPost.comments`; `addThreadComment`/`replaceThreadComment`/`removeThreadComment`; `post.text` excludes them; they don't count for `lastActivity` and never show in the quick-notes stream), rendered by `threads/PostComments.tsx`; swiping a post left / the desktop hover button / the post sheet's Comment write a comment — on the phone under that post behind a count chip (`ThreadView` `detailPostKey` opens the topic page, whose composer sends to `detailPost`); on desktop inline (no page). Spinning a post off into a new thread is gone. Long press / right-click on a memo, post or comment opens a `MobileActionSheet` (the ⋮-menu look; `MemoBubble onLongPress`); multi-select only via the header select button. Desktop: no side panel — `page.tsx` `mainView` (`quick` | `thread`) replaces the editor in `<main>` (still `data-thread-panel` for FileTree's key handling); `QuickCapturePane`/`ThreadView` `variant="desktop"` center a `max-w-3xl` column; TopBar has a quick-notes tab next to the dashboard tab; palette command fires `OPEN_QUICK_NOTES_EVENT` (`threads/threadEvents.ts`, MobileApp handles it too). Opening a note/tab, a tab click or Escape leaves the view; closing a thread opened from quick notes returns there. |
| `src/app/page.tsx` · `layout.tsx` · `src/lib/shell.ts` | The only app page (`/`, `/note/…`, `/journal/…`; old `/m/…` redirects): picks the touch shell (`MobileApp`) or the desktop shell once at start — `pickShell`: touch screen without mouse (phones, tablets) or < 768 px → touch; Settings › General › Interface overrides (`settings.interface`, read from localStorage before `NotesProvider`). Desktop shell composition lives here too. |
| `src/components/mobile/*` | Touch shell (`MobileApp`, phones and tablets): 4-pane pager (spaces · sidebar · note · right pane = TOC, or quick notes on the dashboard: `QuickCapturePane` (Notepad in the personal `home` store or a chosen notebook, optionally hidden from the tree — Settings › Features, `lib/notepad.ts` `notepadLocation`; selection mode (header button or long press) shows circles, the header then copies, edits, makes one note of or deletes memos with Undo) + `MemoBubble` (`@` chips, images) + `MemoComposer` (messenger-style pill: images, text, full screen, mic; round send button; full screen has a Markdown toolbar and continues lists on Enter — `lib/markdown-edit.ts` returns span edits, applied via `execCommand("insertText")` so native undo works; no headings: `###` lines are Notepad days / thread posts) + `useVoiceRecorder` (MediaRecorder; needs https) + `NotebookSheet`/`NotebookPicker` (bottom sheet of writable notebooks across spaces: memo-note target, Notepad location, "Move to…")). Menus (⋮ note menu, pill hamburger) are `MobileActionSheet` (Obsidian-style grouped bottom sheet); `CommandPalette` and `NoteHistoryPanel` use the same look (grab handle, rounded groups). `useScrollHideChrome` hides the note top bar, pill and floating buttons on scroll-down. Never focus a field in a pane that's off screen without `preventScroll`: the browser scrolls the pager to it. |

## Task → open these files
| You want to… | Open |
| --- | --- |
| Edit the note editor / toolbar | `MilkdownEditor.tsx`, `editor/toolbarActions.ts`, `NotesProvider.tsx` |
| Add/change a REST route | `api/handler.go` **and** `src/lib/api.ts` (keep in sync) |
| Change note metadata / frontmatter | `notes/frontmatter.go` (+ `store.go` if persistence changes) |
| Vault or collection management | `notes/vaults.go`, `notes/collections.go`, `handler.go`, `src/components/collections/*` |
| Collection item lookup (records, books) | `api/metadata.go` (Discogs; books: Google Books → Open Library → `api/dnb.go` Deutsche Nationalbibliothek, which goes first after Google for 978-3 ISBNs; search hits without an ISBN carry `gb:`/`ol:` ids), `collections/ItemEditor.tsx` |
| Note history / restore | `notes/history.go`, `NoteHistoryPanel.tsx` |
| Image / PDF upload / migration | `notes/images.go`, `handler.go` image routes (`uploadImage`: images 20MB, PDFs 50MB; `getImage`: PDFs served inline without the `sandbox` CSP, which breaks the browser's PDF viewer), `editor/pdfEmbed.ts` (`![name.pdf](url)` alone in a paragraph ↔ `pdf_embed` node; desktop: `<iframe>` viewer; touch: card + first page drawn by lazily imported pdf.js legacy build, worker via `new URL(…, import.meta.url)`; PDF file paste/drop lives in `MilkdownEditor.tsx` `handlePaste`/`handleDrop` because Crepe's upload plugin swallows every file; picking: `pickFile` there, `showOpenFilePicker` when available, else hidden input) |
| AI features | `api/ai.go`, `src/lib/ai.ts`, `AICommandPanel.tsx`; voice memos: `api.transcribeAudio` (`src/lib/api.ts`) + `mobile/useVoiceRecorder.ts`. AI settings are per device (localStorage). |
| Accounts, login, invites | `backend/accounts/*`, `api/{auth,account,admin,access}.go`, `src/lib/api.ts` |
| Spaces, members, permissions | `notes/spaces.go`, `api/{spaces,access}.go`, `NotesProvider.tsx` (spaces state) |
| Offline / sync | `public/sw.js`, `offline-status.tsx`, `NotesProvider.tsx` (precache, refresh after sync/SSE reconnect) |
| Mobile / tablet UI | `src/components/mobile/*`, shell choice in `src/lib/shell.ts` |
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

# Docker: CI publishes ghcr.io/2tap2b/nexote (docker-compose.yml pulls it). Local
# builds have no .git, so pass the version for Settings › About:
NEXOTE_VERSION=$(git describe --tags --abbrev=0) NEXOTE_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build

# docs site (from docs/): Rspress, published to GitHub Pages by .github/workflows/docs.yml
pnpm install && pnpm dev
```
Dev proxy: `frontend/next.config.mjs` rewrites `/api/* → NEXOTE_BACKEND_URL ||
http://localhost:8080`. Prod = reverse proxy in front of both, or the Docker build.
`NEXOTE_PUBLIC_URL` (default `http://localhost:3000`) must be the address people
open: passkeys are bound to its host (https + a domain, or localhost) and the
backend refuses changing requests from other origins. In Docker set it in a
`.env` next to `docker-compose.yml`; recovery: `docker exec nexote nexote-backend recover <username>`.

Releases: pushing a `v*` tag runs `.github/workflows/release.yml`, which creates the
GitHub release with the commits since the previous tag and pushes the multi-arch
image to GHCR; pushes to `main` alone release nothing. One minor release per
change request (`v0.6.0`), a patch for bugfixes (`v0.6.1`): annotated tag, push the
tag after `main`. User docs live
in `docs/` (https://2tap2b.github.io/nexote/) — update them with user-visible changes.

## Roadmap
Current backlog (trash, new-note location, templates, wikilinks, editor
behavior, …) and the settings rules: `wip-features.md`. Older feature plan
(tags, previews, multi-select, search filters, properties, dual-pane, calendar,
settings toggles): `.opencode/plans/notebook-navigator-features.md`.

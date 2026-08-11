# Plan: Notebook Navigator-style features for Nexote

Implement the following features as OPTIONAL toggles in Settings (existing
features untouched). Tags stored in YAML frontmatter.

## Phase 1 — Backend foundation
- `backend/notes/frontmatter.go`: add `Tags []string`, `Aliases []string`,
  `Properties map[string]string` to `Meta`. Rewrite `Encode`/`Decode` to
  round-trip arbitrary frontmatter keys (unknown scalar keys → `Properties`,
  known keys stay in stable order, free-form props sorted by key).
- `backend/notes/store.go`: add `Preview(body, maxLines)` + `WordCount(body)`
  helpers; extend `Entry` with `Tags`, `Aliases`, `Properties`, `Preview`,
  `WordCount`; populate in `List`.
- Store methods: `AddTag`, `RemoveTag`, `RenameTag`, `DeleteTag`, `TagIndex`,
  `PropertyIndex`. `normalizeTag` = trim, strip `#`, lowercase.
- `backend/api/handler.go`: extend `Payload` + `toPayload`; new routes:
  - `GET  /api/vaults/{vaultId}/tags`
  - `POST /api/vaults/{vaultId}/tags/rename`
  - `DELETE /api/vaults/{vaultId}/tags/{tag...}`
  - `GET  /api/vaults/{vaultId}/properties`
  - `POST /api/vaults/{vaultId}/notes/{id}/tags`
  - `DELETE /api/vaults/{vaultId}/notes/{id}/tags/{tag...}`
- NOTE: backend must be restarted after this phase.

## Phase 2 — Tags sidebar section + operations
- "Tags" collapsible section in notetree (Settings toggle `enableTags`).
- Hierarchical tag tree (`#work/project` nests under `#work`), sort alpha or by
  count. Click → filter note list; context menu: rename/delete tag, create note
  in tag. Note context menu: "Add tag…", "Remove tag".
- Ctrl+Click on tags = AND filtering.

## Phase 3 — Note previews + metadata display
- NoteItem / RecentFilesList / FolderDetailView render 1-3 line preview under
  title. Optional metadata line: modified date, tags, word count.
- Settings toggles: `previewLines` (0-5), `showNoteMetadata`.

## Phase 4 — Multi-select
- `selectedIds: Set<string>` in FileTree. Cmd/Ctrl+Click toggle, Shift+Click
  range, Shift+arrows, Cmd/Ctrl+A. Selection toolbar: delete, move to folder,
  add tag, bookmark, shortcut. Multi-note delete/move confirmation.

## Phase 5 — Search with filters
- CommandPalette/search parses: `word`, `-word`, `#tag`, `#tag1 #tag2`,
  `.key=value`, `folder:/x`, `@today`/`@last7d`, `ext:md`. Scope to active
  vault/folder. Results show preview excerpts.

## Phase 6 — Properties browser
- Properties section in notetree (toggle `enableProperties`): keys → values
  with counts. Property grouping option in FolderDetailView (trailing "None"
  group). Settings: enable browser, default grouping property.

## Phase 7 — Dual-pane layout
- Optional layout mode: left navigation (folders/tags) + right list pane
  (files with previews). Settings toggle `dualPane`. Reuses FolderDetailView
  content as list pane; resizable split.

## Phase 8 — Calendar view
- Calendar widget section (toggle `enableCalendar`): month grid, day dots for
  journal notes. Click day → open daily note; prev/next month. Built on
  existing journal endpoints.

## Phase 9 — Settings Features tab
- New "Features" tab in SettingsPanel with one toggle per feature.
- Persist in `AppSettings` (localStorage) via NotesProvider.

## Ordering
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9, then typecheck + backend build + restart +
end-to-end test.

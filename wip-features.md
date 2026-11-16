# WIP: settings, quick notes and feature backlog

Working notes, 2026-11-14. The first part records what changed and why; the
backlog is what we want to build next, in rough priority order. Pick items from
the top unless there is a reason not to.

## Done

### Redesign

- Desktop dialog and mobile screen render the **same pages** from
  `frontend/src/components/settings/`: `ui.tsx` (groups, rows, controls), one
  `*Settings.tsx` per page, `categories.tsx` (navigation registry). A platform
  context only changes sizes (touch targets, type). Shells: `SettingsPanel.tsx`
  (desktop dialog, sidebar) and `mobile/MobileSettings.tsx` (list → page).
- Obsidian 1.11 style: a page holds groups (sentence-case heading + one rounded
  card); a row has name and description on the left, the control on the right
  (text fields go below the text on phones); changes apply immediately, no save
  button.
- Navigation groups: **Options** (General, Editor, Appearance, Vaults,
  Features, Shortcuts on desktop only), **Integrations** (AI, Metadata lookup,
  Git sync), **About**. The desktop dialog opens on General and remembers the
  last page.

### Options that did nothing

| Option | Problem | Resolution |
| --- | --- | --- |
| Editor font | "Geist Sans" was never loaded (rendered like System UI); "Inter" rendered like Default | Only fonts the app loads via `next/font`: Inter (default), System font, Lora (serif), JetBrains Mono |
| Default note title | Never used: `formatTitle(...) ?? defaultTitle` can't fall back, `formatTitle` always returns a string | Removed. An empty title template gives "Untitled" |
| Readable line length | No effect in the mobile app (CSS forced full width) | Applied on tablets via `--editor-max-width`; hidden on phones (< 800px), which are narrower than the column anyway |
| Autosave | Off on mobile meant edits were never saved: no Ctrl+S on a touchscreen | Removed. Notes always save (Obsidian behavior); Ctrl+S saves immediately |
| Features page | "Coming in a later release" placeholder text | Removed |
| About | Hard-coded `~/.nexote` | Real vault folders from `/api/vaults` |

Settings are stored per device in localStorage (`nexote:settings`). On load
only known keys are kept, so removed options (`autosave`, `defaultTitle`)
disappear from storage.

### Smaller fixes

- Mobile git credentials were saved on every keystroke; they now save on blur,
  like every other server-backed field.
- Escape in the vault rename field or the icon picker no longer closes the
  whole settings dialog.
- Push and Pull are disabled until a remote URL is set.
- Color scheme names no longer truncate on phones; vault paths wrap after "/".

### Round 2 (same day)

- **Editor wording:** Font size only affects raw markdown (the rendered view
  keeps the theme's sizes) and now sits under a "Raw markdown" heading; Font
  only affects the rendered view (raw markdown is always monospace).
- **Default view fixed:** mobile ignored it on every note switch, and neither
  platform reacted to a change while a note was open. Notes now open in it, and
  changing it switches the open note at once (without focusing it, so no
  keyboard pops up behind the settings). `switchView` in `EditorPane.tsx` /
  `MobileNoteView.tsx`.
- **About page:** version from the latest `v*` git tag + commit + build date
  (`next.config.mjs` → `src/lib/app-info.ts`; Docker builds take
  `NEXOTE_VERSION`/`NEXOTE_COMMIT` build args, else `package.json`, now synced
  to 0.0.6), a "Development build" badge when commits follow the tag, links
  (source, release notes, report a problem), a no-tracking statement, vault
  folders, and "Copy debug info".
- **Quick notes (mobile dashboard, swipe left):**
  - Long-press (or right-click) a memo: Copy / Edit. Edit keeps the memo's time
    and replaces exactly that entry in the latest version of the note.
  - `@` suggests notes (prefix matches, then recently edited) and inserts an
    Obsidian link `[[Title]]`; bubbles show it as a tappable `@Title` chip that
    opens the note.
  - Images: image button or paste; uploaded right away into the Notepad note's
    folder, stored as `![](url)` lines in the memo; removing an unsent image
    deletes the file again; tap an image to view it full screen.
  - Full-screen composer for longer memos: Enter adds a line, Post (or
    Ctrl/⌘+Enter) sends. In the compact bar Enter still sends.

### Round 3: voice memos and "Make note"

- **Voice memos:** the mic sits where the send button is while the composer is
  empty (and in the full-screen toolbar). Tap ✓ to stop; the backend sends the
  clip to the AI endpoint's `/v1/audio/transcriptions`
  (`POST /api/ai/transcribe`) and the transcript lands in the composer to check
  before posting. Model: Settings › AI › Transcription model (mobile, default
  `whisper-1`). Max 10 minutes per recording; a failed transcription keeps the
  clip for Retry. The audio itself isn't stored, only the text.
- **Make note:** long-press a memo › Make note. The first time a bottom sheet
  asks for the notebook (a vault or one of its folders); the choice is kept and
  can be changed in Settings › Features › Quick notes (mobile). The memo's first
  line becomes the title, the note is created, then the memo is removed from
  the Notepad (moved, not copied); the toast offers "Open".

### Rules for new settings

- Only add an option that visibly changes something, on every platform that
  shows it. Hide it where it can't have an effect (see readable line length).
- Touch points: `AppSettings` + `DEFAULT_SETTINGS` in `NotesProvider.tsx`, the
  page in `components/settings/`, and the code that reads the value.
- Check it on desktop and in the mobile app before calling it done.

## Backlog: Obsidian essentials

1. **Trash instead of permanent delete.** Obsidian: Files & links › Deleted
   files (system trash / `.trash` folder / permanently) and "Confirm file
   deletion". Today `Store.Delete` calls `os.Remove` and `Store.DeleteFolder`
   calls `os.RemoveAll` (`backend/notes/store.go`): a deleted note or folder is
   gone for good. Move to `<vault>/.trash/` instead, add a view to restore or
   empty it, and the two settings.
2. **Default location for new notes.** Obsidian: vault root / same folder as
   the current file / a chosen folder. Today `create` in `NotesProvider.tsx`
   always uses the current note's folder. Add the choice plus a folder picker
   (e.g. an "Inbox" folder).
3. **Start-up page.** Obsidian 1.11: Files & links › Default file to open. Today
   there is only the "Open the dashboard" toggle (`openDashboardOnStart`, read
   in `readStoredTabs`). Replace it with a dropdown: last open notes /
   dashboard / today's journal note.
4. **Journal settings.** Obsidian Daily notes: date format, folder, template,
   open on start-up. Today journal notes are fixed `YYYY-MM-DD.md` files in
   `$NEXOTE_HOME/journal/` with no options.
5. **Templates.** Obsidian Templates: template folder, insert-template command,
   date/time placeholders. Today only the new-note title is configurable
   (`titleTemplate`, codes handled by `formatTitle`). Add a template folder, a
   template for new notes and one for journal notes, reusing the same codes.
6. **Internal links and backlinks.** Obsidian: `[[wikilinks]]`, "Automatically
   update internal links" on rename, Backlinks pane. Done: the editor renders
   `[[Title]]` as clickable chips, writes them back unescaped, opens or creates
   the note on click, and "@"/"[[" picks a note (`components/editor/`). Open:
   updating links on rename and a Backlinks pane. Previews strip them
   (`snippet.go`, `note-utils.ts`).
7. **Editor behavior.** Obsidian Editor › Behavior: spellcheck (+ languages),
   auto-pair brackets, auto-pair markdown syntax, smart lists (continue a list
   on Enter), indent with Tab / tab size, strict line breaks. Today none are
   configurable; the raw textarea has `spellCheck={false}`.
8. **Note history retention.** Obsidian File recovery: snapshot interval and
   history length. Today `backend/notes/history.go` keeps every snapshot under
   `.history/` forever. Add "keep snapshots for N days" (and maybe a per-note
   cap).
9. **Editable shortcuts.** Obsidian Hotkeys. Today the handlers are hard-coded in
   `Shortcuts.tsx` and Settings › Shortcuts is a read-only list that mirrors
   them.

### Later / smaller ideas

- Inline title on/off and how frontmatter properties show in a note
  (visible / hidden / source).
- Default folder for pasted images (Obsidian: default location for new
  attachments).
- Folder notes (a note that represents its folder).
- Appearance: accent color picker, interface font size / zoom.
- Line numbers in raw markdown mode.
- Font size for the rendered view too (today it only applies to raw markdown).
- Quick notes: keep the audio of a voice memo as an attachment next to the
  transcript (needs non-image uploads in the backend).

## Open items

- `github.com/2tap2b/nexote` (Source code / Release notes / Report a problem on
  the About page) currently returns 404 to the public — publish the repo, or
  point `APP.links` in `frontend/src/lib/app-info.ts` elsewhere.
- No LICENSE file yet, so the About page shows no license row.
- Docker images show the right version only when built with `NEXOTE_VERSION`
  (see AGENTS.md › Commands); otherwise they fall back to `package.json`.
- `[[Title]]` links resolve by title; with several notes of the same title the
  quick-notes chip opens the one in the Notepad's vault first.
- Only tested in device emulation, not on a real iPhone/Android: the mobile
  keyboard caret fix, the settings, the quick-notes long press, photo picker
  and voice recording (tested with a synthetic microphone and a fake
  transcription endpoint).
- Voice memos need https: browsers only allow the microphone on secure origins
  (or localhost); over plain http the mic explains that instead of recording.
- The transcription endpoint must offer `/v1/audio/transcriptions` (OpenAI,
  Groq, LocalAI, …). AI settings are per device, so the phone needs its own
  base URL and key in Settings › AI.
- "Make note" leaves a memo's images in the Notepad's folder; the new note
  links to them there (they keep working).
- Not exercised yet: the AI "Test" and Discogs "Test" buttons, Push/Pull against
  a real remote (same provider calls as before, new UI wiring).
- Possibly left over from early smoke tests that wrote to the real vault (not
  certain): empty notes "Wed 11-11-2026 22:35" (×3, ids `ibRPvxvpfrBKTSmf`,
  `994Rb8o7uV8eCUIr`, `3_82FHe-afgIxJnG`) and "Wed 11-11-2026 22:43"
  (`u0DpMC5gwULtIs12`). Delete them if they aren't yours.

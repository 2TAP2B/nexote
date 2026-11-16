# Introduction

Nexote is a self-hosted, mobile-first markdown editor, heavily influenced by Obsidian. It runs on your own server as a small Go backend and a Next.js frontend. You use it in a browser: a desktop interface on larger screens, and a separate touch-first app at `/m` on phones.

![The desktop editor](/screenshots/desktop-editor.png)

## Why Nexote

Obsidian keeps notes as plain markdown files in a folder, which makes them easy to read, back up and move. It is also a desktop and mobile app that syncs files between devices. Nexote keeps the file-based model but moves it onto a server:

- The notes live in one place, on a machine you control, and every browser sees the same state. Changes made elsewhere appear in open tabs right away.
- Several people can use one server. Accounts sign in with passkeys, and notes can be shared in spaces.
- The phone interface is its own app, built for one-handed use, not a scaled-down desktop page. It can be installed as a progressive web app and keeps working offline.

## Influence of Obsidian

Much of the vocabulary and behavior comes from Obsidian:

- Notes are grouped in **vaults**, which are directories of markdown files with nested folders.
- Notes link to each other with `[[Title]]` wikilinks.
- Tags are written inline as `#tag`, tasks as `- [ ]` checklist lines.
- There is a command palette, a daily note (the journal), bookmarks and a table of contents.
- The settings follow the Obsidian 1.11 layout: pages of grouped rows, each change applies immediately, there is no save button.
- Notes always save automatically.

Nexote is not compatible with Obsidian plugins or its `.obsidian` configuration folder. Because a note is an ordinary markdown file, the files themselves can be opened in other editors.

## Data model

Nexote stores everything under one data directory (`NEXOTE_HOME`, by default `~/.nexote`). Each vault is a folder of note files. A note is a single `.md` file named after its title; a YAML frontmatter block holds its metadata (a stable random `id`, the title, the folder path, timestamps, tags and collection fields) and the rest of the file is the markdown body. Accounts, spaces and vault registrations are small JSON files next to the vaults. Every save keeps a full copy of the previous version in a hidden `.history` folder. See [Data format](../reference/data-format) for the details.

![The desktop dashboard](/screenshots/desktop-dashboard.png)

## Planned

The following are not implemented yet and are tracked as planned work:

- A trash folder instead of permanent deletion.
- Updating `[[links]]` when a note is renamed, and a backlinks pane.
- Note templates and journal settings (date format, folder, template).
- A choice of default location for new notes.
- Retention limits for note history.
- Editable keyboard shortcuts.

## Next steps

- [Getting started](./getting-started): run Nexote with Docker Compose.
- [Configuration](./configuration): environment variables and where settings are stored.
- [Editor](../features/editor) and [Mobile app](../features/mobile-app): what the interface can do.

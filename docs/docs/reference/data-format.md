# Data format

Nexote keeps all data as plain files in one directory, `NEXOTE_HOME` (default `~/.nexote`, `/data/nexote` in the Docker image). There is no database. Notes are markdown files that any editor can open; everything else is small JSON files.

## Folder layout

```text
$NEXOTE_HOME/
├── vaults.json                  # vault registry
├── spaces.json                  # spaces and their members
├── git.json                     # git sync settings (only when configured)
├── metadata.json                # Discogs token, Google Books key (only when configured)
├── auth/
│   ├── users.json               # accounts and their passkeys (public keys)
│   ├── sessions.json            # login sessions (token hashes)
│   ├── invites.json             # invite and recovery links (token hashes)
│   └── avatars/<userId>         # profile pictures
├── spaces/
│   └── <spaceId>/
│       └── collections.json     # collection definitions of the space
├── users/
│   └── <userId>/
│       ├── journal/             # the user's daily notes
│       └── home/                # the user's personal store (Notepad)
└── vaults/
    └── <vault name>/
        ├── Ideas.md
        ├── img-3fK9x2Lq.png
        ├── Projects/
        │   └── Garden plan.md
        ├── folders.json         # folder color labels
        ├── .bookmarks-<userId>.json
        ├── .shortcuts-<userId>.json
        └── .history/
            └── <noteId>/
                └── <timestamp>.md
```

Notes on the layout:

- **Vaults** are directories under `vaults/`, named after the vault. Vault names are unique within a space; a folder name already taken by a vault of another space gets a number suffix. `vaults.json` records each vault's id, name, icon, space and its **absolute** path. A copied data directory therefore keeps pointing at the original vault folders until those paths are changed.
- Each space has a vault of type `collections` that holds its [collection](../features/collections) items, one folder per collection.
- The files in `auth/` are written with mode 0600. Sessions and invites store only SHA-256 hashes of their tokens. The server notices when these files change on disk, which is how the `recover` command works next to a running server.
- **Personal stores** in `users/<userId>/` are the user's journal and the `home` store that holds the Notepad by default. They are not part of any space.
- **Bookmarks** and **shortcuts** are lists of note ids per user and vault.

## Notes

A note is one file named after its title, for example `Garden plan.md`. Characters that are not allowed in file names (`/ \ : * ? " < > |`) are replaced with `-`. If a folder already has a note with that title, the next one is `Garden plan 1.md`. Renaming a note renames its file.

The file starts with a YAML frontmatter block, followed by the markdown body:

```markdown
---
id: q2X8vN0bLk4mR7tA
title: Garden plan
path: Projects
createdAt: 2026-11-02T08:14:03Z
updatedAt: 2026-11-16T13:40:12Z
tags:
    - garden
    - todo
---
## Garden plan

- [ ] Order seeds before March #todo
See also [[Ideas]].
```

### Frontmatter fields

| Field | Description |
| --- | --- |
| `id` | Stable identifier, 16 random URL-safe characters (some older notes have 12). Links, tabs, bookmarks and history all use the id, never the file name. |
| `title` | The note's title. The file name is derived from it. |
| `path` | Folder relative to the vault root, for example `Projects/2026`. Omitted for notes in the root. |
| `createdAt`, `updatedAt` | Timestamps in RFC 3339 format. `updatedAt` is used to detect conflicting saves. |
| `tags` | Lowercase tags, kept in sync with the `#tags` in the body. |
| `type` | Kind of note, for example `collection-item` for collection items. |
| `collection` | Id of the collection an item belongs to. |
| `cover` | Cover image of a collection item. |
| `fields` | Map of a collection item's field values, keyed by field. |
| `icon` | Optional icon of the note. |
| `artist`, `year`, `genre`, `wantlist` | Legacy fields of the early record feature (`type: vinyl`). Such notes are converted into items of the Vinyls collection, with the values moved into `fields`. |

Apart from `id`, `title`, `createdAt` and `updatedAt`, fields that are empty are left out of the file.

### Files changed outside Nexote

Nexote identifies notes by the `id` in the frontmatter, not by the file name. At start-up it renames note files whose name does not match their title, so files renamed by hand get their title-based name back. Notes from early versions, stored as `<id>.md`, are renamed the same way.

## Images

Uploaded images are stored next to the note, in the note's folder, as `img-<random id>.<ext>`. The note references them with a markdown image link. When a note moves to another folder or vault, its images move with it.

## History snapshots

Before each save, the previous version of the note is copied to `.history/<noteId>/<timestamp>.md` inside the vault (or personal store). The timestamp is the Unix time in nanoseconds; if two snapshots collide, a counter suffix is added. Each snapshot is a complete note file with frontmatter and body, so any version can be restored from the app or copied back by hand.

Snapshots are kept indefinitely. Git sync does not commit them.

## Journal

Daily notes live in the user's personal journal store, in a `Journal` folder, one note per day titled `YYYY-MM-DD`.

## Data from before accounts

Older installations had no accounts: vaults without a space, a global `collections/collections.json`, a global `journal/` folder, the Notepad and `.bookmarks.json` files. When the first admin account exists, all of this is assigned to it on start-up. The process can run repeatedly without effect once done.

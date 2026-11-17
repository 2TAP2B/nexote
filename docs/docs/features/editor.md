# Editor

The editor is built on [Milkdown Crepe](https://milkdown.dev/). Notes are stored as markdown; the editor only changes how they are displayed while you write.

## Rendered and raw view

Each note can be edited in two views:

| View | What you see |
| --- | --- |
| Rendered | Formatted text with headings, lists, tables, images and link chips. |
| Raw markdown | The markdown source in a plain monospace text field. |

The toggle button in the note header (on mobile, the round floating button at the bottom right) switches the current note. Both views save the same way.

The view a note opens in is set in **Settings › Editor › Editing › Default view** ("Rendered view" or "Raw markdown"). Changing it also switches the note that is open.

Related display options in **Settings › Editor**:

- **Font**: Inter (default), System font, Lora or JetBrains Mono. Applies to the rendered view.
- **Readable line length**: limits the rendered text to a narrow column. On phones narrower than 800 px the option is hidden.
- **Raw markdown › Font size**: 12 to 24 px, default 16. Applies to the raw view.

## Wikilinks

Notes link to each other with Obsidian-style wikilinks:

```markdown
See [[Project plan]] and [[Meeting notes|yesterday's meeting]].
```

In the rendered view a link appears as a chip showing the title or the label after `|`. The file keeps the plain `[[...]]` text, without escaping, so other markdown tools read it unchanged.

Clicking a chip opens the note with that title. Nexote looks in the active space first, then in your other spaces, then in your journal. If no note has that title, it creates one. A link to a heading, such as `[[Note#Heading]]`, opens the note.

## Linking with @ and [[

Typing `@` (at the start of a line or after a space or an opening parenthesis) or `[[` opens a note picker:

- It lists up to eight matching titles from the vaults of the active space, prefix matches first. Collection items and the current note are left out.
- If no title matches exactly, the last entry creates a new note with the typed text.
- Use the arrow keys to move, Enter or Tab to pick, Escape to close.

The picked note is inserted as a wikilink chip.

## Slash menu

On desktop, typing `/` at the start of an empty line opens a block menu with the usual Crepe blocks (headings, lists, quotes, code, tables, images and more). Nexote adds an **Insert** group with **Today's date** and **Link to note**, and a **Callouts** group (Info, Tip, Warning, Danger, Note).

On mobile, the **+** button of the editor toolbar opens an insert sheet: Today's date, Link to note, Heading 1 to 3, bullet, ordered and task list, quote, the five callouts, highlight, inline code, code block, table and image.

## Inserting the date

**Today's date** in the slash menu (desktop) and the date button in the mobile editor toolbar insert the current date. Its format is set in **Settings › Editor › Insert date › Date format**. The presets are `YYYY-MM-DD` (default), `DD.MM.YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY`, `DDD, DD MMM YYYY` and `DAY, DD.MM.YYYY`; **Custom...** allows your own pattern.

The same codes are used for the title template of new notes (**Settings › Editor › New notes › Title**, default `DAY DD-MM-YYYY HH:mm`):

| Code | Meaning | Example |
| --- | --- | --- |
| `YYYY` | Year, four digits | 2026 |
| `YY` | Year, two digits | 26 |
| `MMM` | Month, short name | Nov |
| `MM` | Month, number | 11 |
| `DD` | Day of the month | 16 |
| `DDD` | Weekday, short name | Mon |
| `DAY` | Weekday, full name | Monday |
| `HH` | Hour, 24-hour clock | 14 |
| `mm` | Minutes | 30 |
| `ss` | Seconds | 05 |

Any other text is kept as typed. An empty title template gives "Untitled". With **Title as heading** (on by default) a new note starts with its title as a heading.

## Block selection mode

Block selection is for copying, cutting or deleting whole blocks, which is easier than dragging a text selection on a touchscreen.

- Turn it on with **Select blocks** in the note header (desktop) or in the mobile editor toolbar. It is available in the rendered view.
- While it is on, the note is read-only. Each tap or click selects or deselects one block; list items are selected one by one. Blocks do not have to be next to each other.
- A floating bar offers **Copy**, **Cut** and **Delete**.

## Callouts and highlights

Callouts are colored boxes for notes, tips and warnings, written in the syntax Obsidian and GitHub use, so the files stay readable everywhere:

```markdown
> [!info] Optional title
> Text of the box, any blocks.

Some ==highlighted== text.
```

- **Insert a callout** with the callout button of the toolbar, which lists every type (wraps the current paragraph, or the selected blocks), from the `/` menu (the five common types), or by typing `[!type] ` at the start of a quote (`> `).
- **Change the type** by clicking the icon of the box. The types are Obsidian's: Note, Abstract, Info, Todo, Tip, Success, Question, Warning, Failure, Danger, Bug, Example and Quote, including their aliases (GitHub's `NOTE`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION` too). Any other type such as `[!recipe]` is kept and shown like a note.
- An empty title shows the type name. A fold marker (`[!tip]-`, `[!tip]+`) is kept in the file; Nexote shows the box open.
- **Highlight** text with the highlight button, or type `==text==`.

Other tools show a callout as an ordinary quote starting with `[!info]`, and a highlight as `==text==`.

**Settings › Editor › Callouts and highlights** turns the styled display and the buttons off: the same notes then show the plain markdown. Switching never changes a file.

## Formatting toolbar

On desktop, a formatting bar below the note offers the insert menu (**+**), Link to note, Insert date, bold, italic, strikethrough, highlight, headings 1 to 3, lists, task list, quote, callout (a menu with all callout types), code block, table, image and Ask AI (when configured). It works at the caret, without selecting text first. Turn it off in **Settings › Editor › Formatting toolbar**.

Selecting text also shows a floating toolbar with Crepe's formatting buttons plus highlight, headings 1 to 3, bullet and ordered lists, quote and code block.

On mobile, a toolbar sits above the keyboard with the same buttons. See [Mobile app](./mobile-app#editor-toolbar).

## Images

Paste an image from the clipboard, use the image block's upload button, or the image button on mobile. The file is stored next to the note, in the note's folder (the vault root for notes without a folder), and the note references it with a markdown image link. When a note moves to another folder or vault, its images move with it.

## Tags

Write tags inline as `#tag`. A tag starts with a lowercase letter or a digit; tags inside code blocks are ignored. When the note is saved, its tags become exactly the hashtags in its text, stored in lowercase in the frontmatter. Removing `#tag` from the text removes the tag.

Tags are highlighted in the editor; clicking one opens the Tags view in the sidebar. There, right-click a tag to rename it or delete it from all notes. Typing `#` in the command palette lists tags.

## Tasks

Checklist lines are tasks:

```markdown
- [ ] Buy milk
- [x] Call the bank
```

Nexote collects open and done tasks from every vault you can access in the active space and from your journal. They appear in the sidebar's **Tasks** view and in the dashboard's tasks section, where ticking the checkbox completes the task in its note.

## Note history

Before every save, Nexote stores a full copy of the previous version of the note. **Note history** in the note header (or the note menu on mobile) lists the saved versions with their time and a short preview. Editors can restore a version, which writes it back as the current note. Journal notes have a history too.

History is kept indefinitely; there is no retention limit yet.

## Journal

Each account has a personal journal with one note per day, titled `YYYY-MM-DD`. Open today's note with Ctrl/Cmd+D, the dashboard's **Today's journal** action or **Daily notes** in the ribbon. A calendar on the desktop dashboard and in the Daily notes view marks days that have a note; clicking another day creates its note.

## Navigation

- **Command palette** (Ctrl/Cmd+P or Ctrl/Cmd+Shift+F): runs commands, switches spaces, and searches notes. Title matches in the active vault appear immediately; after two characters a full-text search over the active space and your journal is added. Editors can create a note from the typed text.
- **Tabs**: open notes as tabs. The dashboard is a pinned first tab.
- **Bookmarks** and **shortcuts**: per-user lists of notes in each vault, shown in the sidebar and on the dashboard.
- **Table of contents**: a panel listing the note's headings.

## Keyboard shortcuts

Ctrl on Windows and Linux, Cmd on macOS. **Settings › Shortcuts** on desktop shows the same list.

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+Shift+N | New note |
| Ctrl/Cmd+S | Save now |
| Ctrl/Cmd+D | Today's journal note |
| Ctrl/Cmd+Shift+D | Dashboard |
| Ctrl/Cmd+P, Ctrl/Cmd+Shift+F | Command palette |
| Ctrl/Cmd+Tab, Ctrl/Cmd+Shift+Tab | Next or previous tab |
| Ctrl/Cmd+W | Close tab |
| Ctrl/Cmd+B, Ctrl/Cmd+\ | Toggle sidebar |

## Appearance

**Settings › Appearance** offers a base color scheme (adapt to system, light or dark) and color schemes: Default, Nord, Catppuccin Frappé, Macchiato and Mocha, Dracula, Gruvbox, Pastel Dreams and Amethyst Haze.

# Mobile app

Nexote has a touch interface for phones and tablets. It uses the same server, account, notes and address as the desktop interface, but its layout is built for touch and one-handed use.

Which interface opens is decided when the app starts, per device:

- **Touch interface:** a touch screen without a mouse or trackpad (phones, tablets including the iPad), or a browser window narrower than 768 pixels.
- **Desktop interface:** everything else, for example a laptop, or a tablet with a trackpad attached.

**Settings › General › Interface on this device** overrides this with *Touch* or *Desktop*; the app reloads into the chosen interface. Links to notes (`/note/…`, `/journal/…`) open in either interface. Old links starting with `/m` still work and lead to the same page.

| Dashboard | Note | Quick notes | Menu |
| --- | --- | --- | --- |
| ![Mobile dashboard](/screenshots/mobile-dashboard.png) | ![A note in the mobile app](/screenshots/mobile-note.png) | ![Quick notes](/screenshots/mobile-quick-notes.png) | ![The menu sheet](/screenshots/mobile-menu.png) |

## Panes

The app is a horizontal pager with four panes, from left to right:

| Pane | Contents |
| --- | --- |
| Spaces | Your spaces, **New space**, and an account card with Account and Sign out. |
| Sidebar | The note tree of the active vault. |
| Note | The open note, or the dashboard. |
| Right pane | The table of contents of the open note, or [Quick notes](./quick-notes) when the dashboard is open. |

The app remembers the last pane across reloads.

## Gestures

- From the note pane, swipe right to open the note tree, and right again for the spaces. Swipe left for the table of contents, or for Quick notes on the dashboard.
- A swipe can start anywhere in the note content or on the bottom pill. It does not start on input fields, inside horizontally scrollable blocks such as code and tables, or while text is selected.
- In the side panes a swipe can start anywhere.
- A swipe completes after 30 percent of the screen width or with a quick flick. The outer ends stretch and spring back.
- Leaving the note pane closes the keyboard.
- In Quick notes, a long press on a memo selects it.

## Haptics

A short vibration confirms a pane change and a long press on a memo. Android browsers use the Vibration API. Safari on iOS has no Vibration API; there, Nexote uses a workaround that plays the system haptic on iOS 18 and later. There is no setting to turn haptics off.

## Bottom pill

A floating pill at the bottom holds the main navigation:

- **Back** and **Forward** step through the open tabs.
- **Search** opens the command palette.
- **Dashboard** in the center.
- **New note** (not available for viewers).
- A circle with the number of open tabs, which opens the tab switcher.
- **Menu**, a sheet with: Notes list, Table of contents, Today's note, Command palette, Toggle theme and Settings.

The tab switcher shows the open tabs as a two-column grid of cards, each with a close button, and has buttons for a new note and Done.

## Scroll-hiding chrome

When you scroll down in a note, the top bar, the bottom pill, the editor toolbar and the view toggle slide away to leave the screen to the text. Scrolling up, reaching the top, or opening another note brings them back. On the dashboard the pill stays visible.

## Note tree

The note tree works like on the desktop (see [Note tree](./editor#note-tree)), sized for fingers: rows are 44 px high. **Long press** a note or folder for its actions in a sheet (open, copy, move, bookmark, shortcut, icon, rename, delete; for folders also new note, subfolder and color label). The bar at the bottom has **Note** and **Folder** (editors only), **View** (sort order and compact rows or cards), **Collapse**/**Expand** and **Settings**.

## Sheets

Menus open as bottom sheets in the style of Obsidian's mobile app: a grab handle, an optional title and actions in rounded groups. A sheet closes when you tap outside it, press Escape or drag the handle down. The command palette and the note history use the same look.

The note menu (the three-dot button in the top bar) contains:

- Add or remove bookmark, add or remove shortcut.
- Select all, Open in new tab, Table of contents, Note history.
- For editors: Rename, Move to..., Make a copy, Generate AI title (when [AI](./ai) is set up) and Delete.

## Editor toolbar

While the keyboard is open, or after you tap into the text, a horizontally scrollable toolbar sits just above the keyboard (or above the pill when the keyboard is closed). It contains, in order:

1. **+**: the insert sheet (slash commands).
2. Link to note (`@`), Insert date, Select blocks.
3. Bold, Italic, Strikethrough, Highlight.
4. Heading 1, 2, 3.
5. Bullet list, ordered list, task list, quote, callout (a menu with all callout types), code block, table, image.
6. Ask AI, when an AI base URL is set.

Viewers, who can only read, do not get the toolbar. The editor features themselves are described on the [Editor](./editor) page.

## Keyboard handling

The app watches the visual viewport to detect the on-screen keyboard. While it is open, the editor area shrinks to the visible part of the screen and keeps the caret in view.

## Dashboard

The mobile dashboard has collapsible sections: quick actions (New note, Today, Search), Shortcuts, Continue where you left off (the ten most recently edited notes), pinned Collections, Bookmarks, Todo (open tasks, which can be ticked off) and Tags. Each section can be hidden in **Settings › Dashboard**. The same switches apply to the desktop dashboard.

## Installing

Nexote provides a web app manifest, so the browser's "Add to Home Screen" or "Install app" installs it as a standalone app that opens the interface that fits the device, also offline. See [Sync and offline](./sync-and-offline) for what works without a connection.

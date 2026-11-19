# Quick notes

Quick notes are for capturing a thought quickly. They look like a messenger chat: short memos appear as bubbles, newest at the bottom, and a composer sits at the bottom. On a phone, open the dashboard and swipe left. On desktop, click the quick notes icon next to the dashboard tab at the top left, or run **Quick notes** from the command palette; they open full size where notes are edited, and opening a note (or Escape) returns to the editor. A memo that keeps growing can become a [thread](#threads).

![Quick notes in the mobile app](/screenshots/mobile-quick-notes.png)

## The Notepad

All memos are stored in one ordinary note titled **Notepad**. Each day gets a heading and each memo is a list item with its time:

```markdown
### 2026-11-16

- 09:12 Call the plumber about the kitchen tap
- 13:40 Ideas for [[Garden plan]]
  Order seeds before March
```

Further lines of a memo are indented by two spaces. Links to notes are `[[Title]]` wikilinks, and images are `![](url)` lines. Because the Notepad is a regular note, it can also be opened and edited in the editor.

### Location

**Settings › Features › Quick notes › Notepad location** decides where the Notepad lives:

| Option | Behavior |
| --- | --- |
| Private — only you (default) | Stored in your personal store. Only you can see it, it is the same in every space, and it never appears in a note tree. |
| A vault or folder | Stored in any vault or folder you can write to, in any space. Members of that space can read it. |

Changing the location moves the existing Notepad. When it lives in a vault, **Show in note tree** (on by default) controls whether it appears in the tree and note lists. The location is a setting of each device, like the other settings; new threads go to a **Threads** folder at that location.

## Writing memos

- Type in the composer and press Enter or the send button to post.
- The expand button opens a full-screen composer for longer memos. There, Enter starts a new line and Ctrl/Cmd+Enter (or Post) sends.
- The image button adds one or more images; pasting images works too. Images are uploaded right away into the Notepad's folder, and removing an image before sending deletes the file again. Tapping an image in a bubble shows it full screen.
- Typing `@` suggests up to six notes and inserts a `[[Title]]` link. In the bubble the link shows as an `@Title` chip; tapping it opens the note.

New memos are written into the latest version of the Notepad on the server, so memos from several devices do not overwrite each other.

## Memo actions

**Long-press a memo** (right-click on desktop) for its actions in a sheet, the same kind of menu as a note's ⋮ menu:

| Action | Effect |
| --- | --- |
| Edit | Edit the memo. It keeps its time. |
| Copy | Copy the memo's text. |
| Pin / Unpin | Pin the memo to the bar at the top. In the Notepad a pinned memo is `- 09:14 📌 text`. |
| Start thread | Turn the memo into a [thread](#threads), like swiping it left. |
| Add to thread | Add the memo to an existing thread as a reply. It keeps its original time and leaves the Notepad. |
| Make note | Turn the memo into a new note. |
| Delete | Remove the memo. A toast offers Undo for five seconds, as long as the Notepad has not changed since. |

To act on several memos at once, tap **Select memos** in the header, tick the circles, and use the actions in the header (copy, make one note, add to a thread, pin, delete).

Memos show their Markdown formatted. When you have scrolled up, a small arrow at the bottom right jumps back to the latest memo.

### Pinned

A bar under the header shows the first pinned item and how many there are: pinned threads, then pinned memos. Tap it to see them all; picking a memo scrolls to it, picking a thread opens it.

### Make note

**Make note** creates a note from the selected memos. The first memo gives the title (up to 80 characters); with **Settings › Editor › New notes › Title as heading** on, the note starts with it as a heading. The memos are then removed from the Notepad, so they are moved rather than copied. A toast offers to open the new note.

The target is set in **Settings › Features › Quick notes › Notebook for memo notes**. The default, "Ask the first time", shows a sheet that asks for a vault or folder ("notebook") and remembers the answer. Read-only vaults and Collections vaults are not offered.

Images stay in the Notepad's folder; the new note links to them there.

## Voice memos

While the composer is empty, a microphone button takes the place of the send button. Record, then tap the check mark to stop. The recording is sent to your AI endpoint for transcription, and the text lands in the composer so you can correct it before posting. The audio itself is not stored, only the text.

- Requires an AI connection in **Settings › AI** on that device. The endpoint must offer `/v1/audio/transcriptions` (OpenAI and compatible services, including llama.cpp with an audio model). Recordings are sent as WAV. See [AI](./ai#voice-memos).
- The model is set in **Settings › AI › Voice memos › Transcription model** (default `whisper-1`).
- Browsers only allow microphone access on https origins or `localhost`. Over plain http the button explains this instead of recording.
- A recording stops automatically after 10 minutes. The server accepts audio files up to 25 MB.
- If the transcription fails, the recording is kept so you can retry or discard it.

## Threads

A thread is a memo that grew replies, for following a thought over days. **Swipe a memo to the left** to turn it into a thread; a toast offers Undo. The memo leaves the Notepad and stays in the stream as a thread card with its title, the latest post and the number of replies. A new reply moves the card down to the reply's time.

Tap a card to open the thread (on desktop it opens full size where notes are edited). On phones a thread is a timeline: every post shows its time on top (with the date when the day changes) and sits on a line of dots, the first one, marked **Started**, filled. On desktop the posts are bubbles like the quick notes. The composer adds replies (text, images, `@` links, voice memos). Tap the title to rename the thread; **More** also deletes it. On phones, **swipe right** anywhere outside the composer to close the thread and go back.

**Long-press a post** (right-click on desktop) for its sheet: Comment, Edit, Copy, pin, priority, done and Delete. **Select posts** in the header acts on several at once.

Posts are Markdown: **bold**, *italics*, ~~strikethrough~~, lists and task lists, quotes, headings, code, links, tables and `==highlights==` show formatted. `[[links]]` and `#tags` stay tappable. HTML in a post shows as text.

### Comments

Each post can have comments, for discussing one topic of a thread without starting a new thread. **Swipe a post to the left**, use **Comment** in its sheet, or on desktop the comment button next to the post; the composer then says which post you are commenting on. Comments appear indented under their post, with their time; long-press one to edit, copy or delete it.

Comments stay inside the thread: they don't show in the quick notes and don't move the thread's card. In the file a comment is a sub-section of its post:

```markdown
### 2026-11-19 09:14
Login page redesign

#### 2026-11-19 10:02
Mockups are in the shared folder
```

### Pin, priority and solved

Threads and their posts can carry marks for following up on work: **pinned**, a **priority** from P1 to P5, and **solved** (done).

| Priority | Color | Icon |
| --- | --- | --- |
| P1 Critical | red | flame |
| P2 High | orange | double chevron up |
| P3 Medium | yellow | equals |
| P4 Low | blue | chevron down |
| P5 Someday | gray | moon |

- **A thread:** long-press its card in the quick notes or its row in the Threads view (right-click on desktop), or use **More** inside the thread. A thread's card and row take the priority's color on the left; a solved thread is struck through and moves to the end of the Threads view.
- **A post:** long-press it; the sheet has the marks. The post's dot on the timeline takes the priority color, and a done post is struck through. Pinned posts appear in a bar at the top of the thread; tapping it jumps to them.

A thread's marks are properties in its frontmatter (`pinned: true`, `priority: 2`, `status: done`); a post's marks follow its time in the heading, so they read in any Markdown tool: `### 2026-11-19 09:14 📌 P2 ✅`.

In a thread, the arrow at the bottom right jumps to the latest post.

### Tags

Write `#tags` in memos and replies. A thread's tags are the tags of all its posts. Tapping a tag in the quick notes filters the stream to memos and threads with that tag. Notes and threads share their tags: the sidebar's **Tags** view counts both, and a tag lists its notes and then its threads (a thread opens in the thread view). Tapping a tag inside a thread opens the Tags view on that tag.

### Threads view

The sidebar's **Threads** view (ribbon icon on desktop, sidebar strip on phones) lists all threads: pinned ones first, then open threads by most recent activity, solved ones last. A search field, the tags of all threads, the priorities in use and a **Solved** chip (turn it off to hide solved threads) filter the list. It shows every thread you have, wherever it was written: in your personal store and in any vault, so threads started on your phone show on the desktop too, even if each device keeps its Notepad somewhere else. Clicking a thread opens it: on desktop in a panel beside the note, on phones full screen. Threads also show up in the quick notes stream and the command palette's search, but not in **Recent** or the dashboard's recently edited notes. **Settings › Features › Sidebar › Threads** hides the view.

### Storage

Each thread is a note of its own (type `thread`) in a **Threads** folder next to the Notepad, so with the default location only you can see it. Every post is a section with its date and time:

```markdown
## Garden ideas

### 2026-11-18 09:14
Order seeds before March #garden

### 2026-11-19 08:02
Tomatoes: start indoors in February
```

Images in replies are stored next to the thread. When the Notepad lives in a vault, threads are ordinary notes there and can also be opened in the editor; any text before the first post heading shows as a post without a time.

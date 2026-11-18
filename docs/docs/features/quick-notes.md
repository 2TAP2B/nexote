# Quick notes

Quick notes are for capturing a thought quickly on a phone. They look like a messenger chat: short memos appear as bubbles, newest at the bottom, and a composer sits at the bottom of the screen. Quick notes are part of the [mobile app](./mobile-app); open the dashboard and swipe left. A memo that keeps growing can become a [thread](#threads).

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

## Selecting memos

Tap **Select memos** in the header, or long-press a memo, to enter selection mode. Circles appear next to the memos; tap them to select. The header then offers:

| Action | Effect |
| --- | --- |
| Edit | Edit the memo (exactly one selected). The memo keeps its time. |
| Copy | Copy the text of the selected memos. |
| Make note | Turn the selected memos into one new note. |
| Delete | Remove the memos. A toast offers Undo for five seconds, as long as the Notepad has not changed since. |
| Add to thread | Add the selected memos to an existing [thread](#threads) as replies. They keep their original times and leave the Notepad. |

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

Tap a card to open the thread. On phones a thread is a timeline: every post shows its time on top (with the date when the day changes) and sits on a line of dots, the first one, marked **Started**, filled. On desktop the posts are bubbles like the quick notes. The composer adds replies (text, images, `@` links, voice memos). Long-press a post to edit, copy or delete it. Tap the title to rename the thread; **More** also deletes it. On phones, **swipe right** anywhere outside the composer to close the thread and go back.

Posts are Markdown: **bold**, *italics*, ~~strikethrough~~, lists and task lists, quotes, headings, code, links, tables and `==highlights==` show formatted. `[[links]]` and `#tags` stay tappable. HTML in a post shows as text.

**Swipe a reply to the left** to start a new thread from it. The reply is replaced by a link to the new thread, so the two stay connected. On desktop, the same is a button next to each reply.

### Tags

Write `#tags` in memos and replies. A thread's tags are the tags of all its posts. Tapping a tag in the quick notes filters the stream to memos and threads with that tag. Notes and threads share their tags: the sidebar's **Tags** view counts both, and a tag lists its notes and then its threads (a thread opens in the thread view). Tapping a tag inside a thread opens the Tags view on that tag.

### Threads view

The sidebar's **Threads** view (ribbon icon on desktop, sidebar strip on phones) lists all threads, most recent activity first, with a search field and the tags of all threads to filter by. It shows every thread you have, wherever it was written: in your personal store and in any vault, so threads started on your phone show on the desktop too, even if each device keeps its Notepad somewhere else. Clicking a thread opens it: on desktop in a panel beside the note, on phones full screen. Threads also show up in the quick notes stream and the command palette's search, but not in **Recent** or the dashboard's recently edited notes. **Settings › Features › Sidebar › Threads** hides the view.

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

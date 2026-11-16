// Window events between the rich editor and the app shell (kept free of
// editor imports so the shell doesn't load Milkdown for them).

/** Fired with a [[link]] target when its chip is clicked; NotesProvider opens the note. */
export const OPEN_WIKILINK_EVENT = "nexote:open-wikilink";

/** Fired with true/false when block selection mode starts/ends; the mobile nav pill hides meanwhile. */
export const BLOCK_SELECT_EVENT = "nexote:block-select";

/** Asks the open note's editor to select everything except the title heading. */
export const SELECT_ALL_NOTE_EVENT = "nexote:select-all-note";

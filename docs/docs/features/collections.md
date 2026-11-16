# Collections

A collection is a typed set of notes, such as books, records or films. Every item is an ordinary note with a cover and a set of fields, and the collection is shown as a gallery of covers.

## Where collections live

Each space has its own **Collections** vault. Every collection has a folder in it, and each item is a note in that folder. The collection definitions (name, icon, fields) are stored per space in `spaces/<spaceId>/collections.json`. Item fields are saved in the note's frontmatter, so they stay readable as plain text. See [Data format](../reference/data-format).

## Built-in collections

Two collections exist in every space:

| Collection | Fields |
| --- | --- |
| Vinyls | Discogs ID, Artist, Year, Genre, Label, Cat # |
| Books | ISBN, Author, Year, Publisher, Pages, Genre |

Built-in collections cannot be removed, but they can be hidden.

## Creating a collection

Use **New collection** in the dashboard's quick actions or the **+** in the sidebar's Collections view. A collection has a name, an icon name and any number of fields. Each field has a label and one of four types:

| Type | Input |
| --- | --- |
| Text | Free text |
| Number | A number |
| Yes/No | Two buttons |
| Date | A date |

## Gallery

The gallery shows the items as a grid of covers, sorted by title. Each card shows the title and the first two field values. Clicking a card opens the item's note; the pencil on a card edits the item. The gallery header has buttons for full screen (desktop), **Pin to dashboard**, **Edit collection** and **Add item**.

Pinned collections appear on the dashboard. **Settings › Vaults › Collections** lists all collections with a switch to hide or show each one. A hidden collection disappears from the app; its notes stay on disk.

An item note opens with a header that shows the cover and the field values above the note text, which can hold anything else you want to write about the item.

## Looking up items

Collections with an ISBN field or a Discogs ID field can fill in an item from online sources. The lookup runs on the server; the browser never contacts these services directly.

### Books

Enter an ISBN and press **Fetch**, or search by title or author. Sources:

| Source | Key needed | Notes |
| --- | --- | --- |
| [Google Books](https://books.google.com/) | Optional | Works without a key, but the anonymous rate limit is low. Set a key in **Settings › Metadata lookup** or with `GOOGLE_BOOKS_API_KEY`. |
| [Open Library](https://openlibrary.org/) | No | |
| [Deutsche Nationalbibliothek](https://www.dnb.de/) | No | The German national library's catalog. Lists nearly every book published in Germany. |

For an ISBN, Nexote tries Google Books, then Open Library, then the Deutsche Nationalbibliothek, and uses the first result. For German ISBNs (978-3, or ISBN-10 starting with 3) the Deutsche Nationalbibliothek is asked right after Google Books. A title search uses Google Books, falls back to Open Library, and merges in results from the Deutsche Nationalbibliothek.

When you add a new item to a book collection, a barcode scanner opens first. It uses the back camera to read the EAN or UPC barcode, with the browser's built-in barcode detection where available and a JavaScript decoder elsewhere, and runs the lookup on success. A link to type the ISBN by hand is always available. Camera access requires https.

### Records

Records are looked up on [Discogs](https://www.discogs.com/) by release ID or by searching for artist and title. Discogs requires a personal access token: an admin enters it in **Settings › Metadata lookup › Discogs token** and can check it with **Test Discogs token**.

### Covers

When you save an item with a cover found by a lookup, the server downloads the image (JPEG, PNG, GIF or WebP, up to 10 MB) into the item's folder, so the cover keeps working offline and if the source goes away. If the download fails, the item keeps the remote address. A cover chosen from a file is uploaded like any other image.

## Upgrading older data

Early versions of Nexote had a hard-coded record feature with `type: vinyl` notes. On start-up these are converted into items of the Vinyls collection.

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

Built-in collections cannot be deleted, but they can be hidden.

## Creating and editing a collection

Use **New collection** on the dashboard, at the end of the sidebar's Collections list, or the **+** in that list's header. A collection has a name, an icon and any number of fields. Each field has a label and one of four types:

| Type | Input |
| --- | --- |
| Text | Free text |
| Number | A number |
| Yes/No | Two buttons |
| Date | A date |

**Edit collection** changes the name, the icon and the fields. Fields can be moved up and down; the order is the order of the item form and the details. Renaming a collection also renames its folder in the Collections vault.

On the phone, forms and confirmations open as sheets from the bottom of the screen; on the desktop as small dialogs.

## The Collections list

The sidebar's Collections view lists every collection that isn't hidden, with its item count and the covers of its newest items. Collections shown on the dashboard come first and carry a pin. A long press (phone) or a right-click (desktop) opens the collection's menu:

| Entry | Effect |
| --- | --- |
| Open | Opens the gallery. |
| Add item | Opens the item form. |
| Edit collection | Opens the collection form. |
| Show on dashboard / Remove from dashboard | Adds the collection to the dashboard's Collections section, or removes it. |
| Hide collection | Hides the collection everywhere. **Settings › Vaults › Collections** shows it again; its items stay on disk. |
| Delete collection | Deletes the collection together with all its items, after a confirmation. Not offered for the built-in collections. |

## Gallery

On the desktop a collection opens in the main area, next to the sidebar; Escape or the **✕** goes back. On the phone it opens full screen; swipe right or tap the back arrow to leave it.

The gallery shows the items as a grid of covers, or as a list with small covers (the buttons next to the search field switch between them). Each item shows its title and its first filled fields; numbers and dates carry their label, for example "Rating 8". Above the items:

- **Search** matches the title and every field value.
- **Sort** orders by title, recently added, recently edited, or any text, number or date field. Items without a value for the chosen field come last.
- **Filter chips** appear for Yes/No fields that are set on some item; a chip shows only the items where that field is yes.

The sort and the grid or list choice are remembered per collection on each device. Pinned items always come first and show a pin on their cover.

Tapping an item opens its note. A long press or right-click on an item opens its menu: **Open**, **Edit details**, **Pin to top** / **Unpin** and **Delete item**. The **+** in the header adds an item; the **⋯** button opens the collection's menu (see above).

## Items

An item note opens with a header above the note text: the cover, the collection it belongs to (tap it to return to the gallery) and the filled fields. **Edit details** opens the item form with the title, the cover and the fields. The note text below can hold anything else you want to write about the item.

The item's **⋯** menu (top right) has **Edit details**, **Version history**, **Pin to top** / **Unpin** and **Delete item**. Deleting an item returns to its gallery.

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

When you add a new item to a book collection, a barcode scanner opens first. It uses the back camera to read the EAN or UPC barcode, with the browser's built-in barcode detection where available and a JavaScript decoder elsewhere, and runs the lookup on success. A link to type the ISBN by hand is always available, and the **Scan** button in the item form opens the scanner again. Camera access requires https.

### Records

Records are looked up on [Discogs](https://www.discogs.com/) by release ID or by searching for artist and title. Discogs requires a personal access token: an admin enters it in **Settings › Metadata lookup › Discogs token** and can check it with **Test Discogs token**.

### Covers

When you save an item with a cover found by a lookup, the server downloads the image (JPEG, PNG, GIF or WebP, up to 10 MB) into the item's folder, so the cover keeps working offline and if the source goes away. If the download fails, the item keeps the remote address. A cover chosen from a file is uploaded like any other image.

## Upgrading older data

Early versions of Nexote had a hard-coded record feature with `type: vinyl` notes. On start-up these are converted into items of the Vinyls collection.

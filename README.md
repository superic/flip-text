# Ox-Turn Reader

A small reading app built to test **boustrophedon** reading ("as the ox turns" when it plows a field). In this style, lines alternate direction: the first line reads left to right, the next right to left, and so on. The test question is whether this kind of reading is faster, because the eye no longer has to jump back to the left margin at the end of every line.

The app looks and behaves like a Kindle: a library of books, clean full-screen pages and paper-style page turns. It also measures reading speed quietly in the background.

Live: https://superic.github.io/flip-text/

## Flip styles

Choose one under **Aa → Flip style**. A style affects only the reversed lines (the 2nd, 4th, 6th and so on):

| Style | Reversed lines |
|---|---|
| Mirrored (default) | Mirrored letter by letter, like Leonardo's mirror writing |
| Reversed words | Words run right to left; the letters are normal |
| Upside down | The line is rotated 180° |
| Normal | Nothing is flipped (the control condition) |

With **Reversed words**, the **Flip punctuation** switch (on by default) also moves each reversed word's punctuation to the side the eye reaches first, and mirrors quotes and brackets so they still open toward the text: `position.` becomes `.position`, `“Fifteen` becomes `Fifteen”`. Words joined by an em dash are reversed too (`observer—excellent` becomes `excellent—observer`); hyphenated words, apostrophes inside a word (`don’t`) and a possessive `’` after an s (`soldiers’`) are left alone. The rules are in `js/punct.js`. Only characters within a word move, so line breaks and pages are the same with the switch on or off.

Every page starts with a left-to-right line. The alternation runs down the page without resetting at paragraph breaks or scene breaks (⁂).

## Fonts

Choose one under **Aa → Font**. "Book (built-in)" (the default) uses the device's own serif (Iowan Old Style on Apple devices). The others are served from this site, never from Google at run time, and are kept by the service worker for offline use:

| Font | Files |
|---|---|
| Literata | `fonts/literata/` |
| Source Serif 4 | `fonts/source-serif-4/` |
| EB Garamond | `fonts/eb-garamond/` |
| Merriweather | `fonts/merriweather/` |
| Atkinson Hyperlegible | `fonts/atkinson-hyperlegible/` |

All five are from [Google Fonts](https://fonts.google.com/) and licensed under the SIL Open Font License 1.1; each folder holds its `OFL.txt`. Only the Latin subset is included (it covers the books' text). The `@font-face` rules are at the top of `css/app.css`. Before lines are measured, the reader waits for the chosen font to load, so line breaks are always computed in the font that is actually drawn.

## Run locally

No build step is needed. Serve the folder with any static server:

```sh
python3 -m http.server 8765
# then open http://localhost:8765/
```

The app uses ES modules and a service worker, so opening `index.html` straight from disk with `file://` will not work.

## How it works

- **Line layout** (`js/layout.js`): CSS has no selector for "every other rendered line", so each chapter is laid out off-screen at the exact width and font of the reading column, with every word in its own `<span>`. Words are grouped into lines by their `offsetTop`, and each line is then rebuilt as its own element. That makes it possible to flip lines individually and to justify each one with `text-align-last: justify`. The last line of a paragraph is not stretched.
- **Pagination**: pages hold a whole number of lines. Layout runs again whenever the screen size, orientation, text size, line spacing or font changes. Your place is saved as a (chapter, paragraph, word) position, never as a page number.
- **Page turn** (`js/reader.js`, `js/curl.js`): three pages are kept rendered at all times (previous, current, next). A turn folds the page like paper: the point you grab follows your finger, the fold line runs halfway between where the paper started and where it is now, and the folded part shows the back of the sheet (with the text faintly showing through). Grabbing low on the page peels the bottom corner, grabbing high peels the top corner, and grabbing mid-height folds the edge straight over. Gradient bands along the fold shade the curve of the paper, the page beside it and the page underneath. Only `clip-path`, `transform` and `opacity` change while a page moves. When you let go, the page either finishes the turn or falls back, depending on how far and how fast you swiped, and it keeps the speed of your finger as it eases out. If the device has "reduce motion" turned on, pages crossfade instead.
- **Taps**: the right 30% of the page turns forward, the left 30% turns back. The middle 40%, and a band across the top of the page (where the top bar appears), show the menus. While the menus are open, a tap on the page only closes them.

## How reading speed is measured

The code is in `js/metrics.js`. None of this is shown while you are reading.

- A page's timer starts once the page is fully shown, after the turn animation ends. It stops at the next **forward** turn. WPM = words on the page ÷ minutes.
- The timer is paused while the app is in the background and while the menus or settings are open.
- A page is not recorded if any of these apply:
  - it was on screen for less than 3 seconds of active time (flipping past) or more than 5 minutes (the reader put it down)
  - it was already recorded once (rereading after going back)
  - the flip style, punctuation flipping, text size, font or layout changed while it was on screen
- Each record has the form `{ts, bookId, chapterIdx, words, ms, style, punct, font}` and is kept in `localStorage`. `punct` is whether punctuation was flipped (`null` for styles other than Reversed words). A new session starts after a gap of 30 minutes or more.
- The **Reading stats** screen shows the average WPM for each flip style (total words ÷ total time), a trend chart of each session's average, and overall totals. **Send my results** opens the share sheet with a plain-text summary (including which fonts the pages were read in, and whether Reversed words pages had punctuation flipped). If sharing isn't available, the summary is copied to the clipboard instead.

## Install / offline

- `manifest.webmanifest` and the icons in `icons/` let the app be added to the Home Screen. On iPhone and iPad a one-time card explains how; on Android and Chrome an Install button appears instead.
- `sw.js` stores the app shell, both books and the reading fonts so the app works offline. HTML, JS and CSS are fetched network-first, so each deploy reaches readers the next time they open the app online. **Bump `VERSION` in `sw.js` with every deploy** so old caches get cleared.

## Books

Both books are public-domain texts from [Project Gutenberg](https://www.gutenberg.org/):

- *The Adventures of Sherlock Holmes*, by Arthur Conan Doyle
- *Treasure Island*, by Robert Louis Stevenson

Book data is in `books/`. `books/index.json` lists the books, and `books/<id>.json` holds each book's chapters and paragraphs. A paragraph that is exactly `"§"` marks a scene break.

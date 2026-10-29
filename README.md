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

Choose one under **Aa → Font**. "Book (built-in)" uses the device's own serif (Iowan Old Style on Apple devices). New readers start in Literata; anyone who used the app before the redesign keeps the font they had. The others are served from this site, never from Google at run time, and are kept by the service worker for offline use:

| Font | Files |
|---|---|
| Literata | `fonts/literata/` |
| Source Serif 4 | `fonts/source-serif-4/` |
| EB Garamond | `fonts/eb-garamond/` |
| Merriweather | `fonts/merriweather/` |
| Atkinson Hyperlegible | `fonts/atkinson-hyperlegible/` |

The interface (labels, buttons, bars) is set in **Figtree** (`fonts/figtree/`); headings and book titles use Literata.

All six are from [Google Fonts](https://fonts.google.com/) and licensed under the SIL Open Font License 1.1; each folder holds its `OFL.txt`. Only the Latin subset is included (it covers the books' text). The `@font-face` rules are at the top of `css/app.css`. Before lines are measured, the reader waits for the chosen font to load, so line breaks are always computed in the font that is actually drawn.

## Run locally

No build step is needed. Serve the folder with any static server:

```sh
python3 -m http.server 8765
# then open http://localhost:8765/
```

The app uses ES modules and a service worker, so opening `index.html` straight from disk with `file://` will not work.

## How it works

- **Line layout** (`js/layout.js`): CSS has no selector for "every other rendered line", so the app breaks lines itself. Every word is measured once off-screen in the reading column's exact font, and a greedy line breaker fills each line; each line is then rendered as its own element. That makes it possible to flip lines individually and to justify each one with `text-align-last: justify`. The last line of a paragraph is not stretched.
- **Hyphenation** (`js/hyphenate.js`, always on): narrow phone columns gave justified lines big gaps between words. When the next word does not fit, the breaker tries the longest hyphenated start of it that does, using Liang's algorithm with the TeX American English patterns (`js/hyph/en-us.js`, see `js/hyph/LICENSE.txt`). At least 2 letters stay before the break and 3 after. Words shorter than 6 letters, capitalised words, numbers and words with apostrophes are never hyphenated; a word that already has a hyphen or a dash is only broken right after it. The last word of a paragraph is not split, no more than two lines in a row end in a break, and a line that is already well filled is left alone. A split word belongs to the line (and page) where it starts, for reading positions and for the word counts used to measure speed. With **Reversed words** and **Flip punctuation**, the line-end hyphen moves across like other trailing punctuation (`predomi-` becomes `-predomi`).
- **Pagination**: pages hold a whole number of lines. Layout runs again whenever the screen size, orientation, text size, line spacing or font changes. Your place is saved as a (chapter, paragraph, word) position, never as a page number.
- **Page turn** (`js/reader.js`, `js/curl.js`): three pages are kept rendered at all times (previous, current, next). A turn folds the page like paper: the point you grab follows your finger, the fold line runs halfway between where the paper started and where it is now, and the folded part shows the back of the sheet (with the text faintly showing through). Grabbing low on the page peels the bottom corner, grabbing high peels the top corner, and grabbing mid-height folds the edge straight over. Gradient bands along the fold shade the curve of the paper, the page beside it and the page underneath. Only `clip-path`, `transform` and `opacity` change while a page moves. When you let go, the page either finishes the turn or falls back, depending on how far and how fast you swiped, and it keeps the speed of your finger as it eases out. If the device has "reduce motion" turned on, pages crossfade instead.
- **Taps**: the right 30% of the page turns forward, the left 30% turns back. The middle 40%, and a band across the top of the page (where the top bar appears), show the menus. While the menus are open, a tap on the page only closes them. The bottom bar's slider shows the position in the chapter; drag it and let go to jump to another page of the chapter.

## How reading speed is measured

The code is in `js/metrics.js`. None of this is shown while you are reading.

- A page's timer starts once the page is fully shown, after the turn animation ends. It stops at the next **forward** turn. WPM = words on the page ÷ minutes.
- The timer is paused while the app is in the background and while the menus or settings are open.
- A page is not recorded if any of these apply:
  - it was on screen for less than 3 seconds of active time (flipping past) or more than 5 minutes (the reader put it down)
  - it was already recorded once (rereading after going back)
  - the flip style, punctuation flipping, text size, font or layout changed while it was on screen
- Each record has the form `{ts, bookId, chapterIdx, words, ms, style, punct, font}` and is kept in `localStorage`. `punct` is whether punctuation was flipped (`null` for styles other than Reversed words). A new session starts after a gap of 30 minutes or more.
- The **Reading stats** screen (the chart button on the Library) leads with Mirrored against Normal from the most recent session that has each, and one sentence comparing them (including the change since the first session that had both). Below are a chart of each session's average per style, the average WPM for each flip style (total words ÷ total time) and overall totals. **Send my results** opens the share sheet with a plain-text summary (including which fonts the pages were read in, and whether Reversed words pages had punctuation flipped). If sharing isn't available, the summary is copied to the clipboard instead.

## Install / offline

- `manifest.webmanifest` and the icons in `icons/` let the app be added to the Home Screen. On iPhone and iPad a one-time tip explains how; on Android and Chrome an Install button appears instead. "How to install" under the shelf shows it again.
- `sw.js` stores the app shell, both books and all fonts so the app works offline. HTML, JS and CSS are fetched network-first, so each deploy reaches readers the next time they open the app online. **Bump `VERSION` in `sw.js` with every deploy** so old caches get cleared.

## Books

Both books are public-domain texts from [Project Gutenberg](https://www.gutenberg.org/):

- *The Adventures of Sherlock Holmes*, by Arthur Conan Doyle
- *Treasure Island*, by Robert Louis Stevenson

Book data is in `books/`. `books/index.json` lists the books, and `books/<id>.json` holds each book's chapters and paragraphs. A paragraph that is exactly `"§"` marks a scene break.

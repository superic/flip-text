// Turning pasted or opened plain text into a book ("Add a story").
//
// Pure string -> data, no DOM and no storage, so it can be tested with plain
// node. parseStory() returns the same shape as books/<id>.json, so the reader,
// layout, hyphenation, punctuation flipping, page curl and stats all work on
// it unchanged.
//
// The rules, in order:
//  1. Clean up: drop a byte-order mark, unify line endings, turn tabs and
//     no-break spaces into spaces, collapse runs of spaces, trim each line.
//  2. Paragraphs are separated by blank lines. Inside one, hard-wrapped lines
//     are joined with a space; a line ending in letter + "-" is joined with
//     no space and the hyphen kept ("high-" + "power" -> "high-power"; a word
//     split by the wrap keeps its hyphen, which is the safe choice).
//     A text with no blank lines at all is read as one paragraph per line
//     when most lines end like sentences, or split at indented lines when it
//     uses first-line indents; otherwise the lines are one hard-wrapped block.
//  3. A line of only "* * *", "***", "#", "§" or "⁂" is a scene break ("§").
//  4. Two or more heading lines ("Chapter 3", "PART II: Home", "Book One",
//     or a lone roman numeral) split the text into chapters titled by them.
//     Otherwise the whole text is one chapter titled with the story's title.
//  5. A missing space after a sentence is put back: "lake.When" -> "lake.
//     When", "said."The" -> "said." The". Only a lowercase letter, then
//     . ! or ?, then a capital that is not itself an initial counts, so
//     "P.M.", "U.S.", "J.R.R.", "Ph.D.", "3.5" and web or email addresses
//     are left alone.
//  6. Typography as in the books: straight quotes curl (“ ” ‘ ’, apostrophes
//     become ’), "--" and a hyphen or dash with spaces round it become an
//     em dash with no spaces ("10 P.M. - two" -> "10 P.M.—two"), "..." -> "…".

export const SCENE_BREAK = '§';
export const MIN_WORDS = 20;

const TERMINAL = /[.!?…:;,"”’')\]]$/;      // a line that ends like a sentence (or a clause)
const SENTENCE_END = /[.!?…]["”’')\]]*$/;  // ends a sentence
const SCENE_LINE = /^(?:(?:\*\s*){3,}|#|§|⁂|~\s*~\s*~)$/;
const NUM_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';
// "Chapter 3", "PART II", "Book One", optionally followed by ". Title", ": Title"
// or a capitalised title with no sentence ending.
const HEADING = new RegExp(`^(chapter|part|book)\\s+(\\d+|[ivxlcdm]+|${NUM_WORDS})(?:\\s*[.:—–-]\\s*(.*)|\\s+([A-Z“"‘'].*))?$`, 'i');
const ROMAN = /^[IVXLCDM]+\.?$/;

/** Step 1: one clean line per source line (blank lines kept as ""). */
export function cleanLines(raw) {
  return String(raw || '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t   ]/g, ' ')
    .replace(/[​⁠]/g, '')
    .split('\n')
    .map((l) => l.replace(/(\S) {2,}/g, '$1 ').replace(/\s+$/, ''));
}

const isScene = (line) => SCENE_LINE.test(line.trim());

/** A chapter heading line? Returns its parts, or null. */
export function headingOf(line) {
  const t = line.trim();
  if (!t || t.length > 60) return null;
  if (ROMAN.test(t)) return { label: t.replace(/\.$/, ''), sub: '' };
  const m = t.match(HEADING);
  if (!m) return null;
  const sub = (m[3] || m[4] || '').trim();
  // "Chapter 1 The Lake" is a heading; "Book I read twice." is a sentence.
  if (m[4] && SENTENCE_END.test(sub)) return null;
  return { label: m[1] + ' ' + m[2], sub };
}

/**
 * Step 2-3: blocks of lines. Blank lines separate blocks; scene breaks and
 * heading lines always stand alone. Returns [{lines:[...]}].
 */
function blocksOf(lines) {
  const hasBlank = lines.some((l, i) => !l.trim() && i > 0 && i < lines.length - 1 && lines.slice(0, i).some((x) => x.trim()));
  const text = lines.filter((l) => l.trim());
  let groups = [];
  if (hasBlank || text.length <= 1) {
    let cur = [];
    for (const l of lines) {
      if (!l.trim()) { if (cur.length) groups.push(cur); cur = []; } else cur.push(l);
    }
    if (cur.length) groups.push(cur);
  } else {
    const ends = text.filter((l) => SENTENCE_END.test(l.trim()) || isScene(l) || headingOf(l)).length;
    const indented = text.slice(1).filter((l) => /^ {2,}\S/.test(l)).length;
    if (indented >= 2) {
      // First-line indents mark the paragraphs.
      let cur = [];
      text.forEach((l, i) => { if (i && /^ {2,}\S/.test(l) && cur.length) { groups.push(cur); cur = []; } cur.push(l); });
      if (cur.length) groups.push(cur);
    } else if (ends >= Math.ceil(text.length * 0.7)) {
      groups = text.map((l) => [l]);          // one paragraph per line
    } else {
      groups = [text];                        // one hard-wrapped block
    }
  }
  // Scene breaks and headings break a block wherever they appear (a heading
  // only as the first line of a block, so "Book I" inside prose stays put).
  const out = [];
  for (const g of groups) {
    let cur = [];
    g.forEach((l, i) => {
      if (isScene(l) || (i === 0 && headingOf(l) && (g.length === 1 || !TERMINAL.test(l.trim())))) {
        if (cur.length) out.push(cur);
        out.push([l]);
        cur = [];
      } else cur.push(l);
    });
    if (cur.length) out.push(cur);
  }
  return out.map((g) => g.map((l) => l.trim()));
}

/** Join hard-wrapped lines into one paragraph string. */
function joinLines(lines) {
  let s = '';
  for (const l of lines) {
    if (!s) s = l;
    else if (/\p{L}-$/u.test(s) && !/--$/.test(s)) s += l;   // "some-" + "thing": keep the hyphen
    else s += ' ' + l;
  }
  return s.replace(/ {2,}/g, ' ');
}

/** Step 5: "lake.When" -> "lake. When", skipping web and email addresses. */
export function fixSentenceSpacing(text) {
  return text.split(' ').map((tok) => {
    if (/:\/\/|www\.|@|\.(com|org|net|edu|gov|io)\b/i.test(tok)) return tok;
    return tok.replace(/(\p{Ll})([.!?]+)(["”’']?)(\p{Lu})(?![.\p{Lu}])/gu, '$1$2$3 $4');
  }).join(' ');
}

const ELISIONS = /^(?:em|tis|twas|til|cause|bout|round|n|s)\b/i;

/** Step 6: curly quotes, em dashes, ellipses. */
export function typography(text) {
  let s = text
    .replace(/\.\s?\.\s?\./g, '…')
    .replace(/\s*-{2,3}\s*/g, '—')
    .replace(/ [-–—] /g, '—')
    .replace(/ —|— (?=\S)/g, '—');
  // Quotes: decided by the characters on either side.
  const chars = [...s];
  const isOpenCtx = (p) => p === '' || /[\s([{—–\-/“‘]/.test(p);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c !== '"' && c !== "'") continue;
    const p = i ? chars[i - 1] : '';
    const n = chars[i + 1] || '';
    if (c === '"') {
      const open = isOpenCtx(p) ? !(n === '' || /\s/.test(n)) : (/[—–]/.test(p) && /[\p{L}\p{N}]/u.test(n));
      chars[i] = open ? '“' : '”';
    } else if (/[\p{L}\p{N}]/u.test(p)) {
      chars[i] = '’';                                   // don't, men's, 1990's
    } else if (isOpenCtx(p) && (/\d/.test(n) || ELISIONS.test(chars.slice(i + 1, i + 7).join('')))) {
      chars[i] = '’';                                   // 'em, 'tis, '90s
    } else {
      chars[i] = isOpenCtx(p) && n && !/\s/.test(n) ? '‘' : '’';
    }
  }
  return chars.join('');
}

/** Clean one paragraph's text: spacing, then typography. */
export const polish = (text) => typography(fixSentenceSpacing(text)).replace(/ {2,}/g, ' ').trim();

const countWords = (p) => (p === SCENE_BREAK ? 0 : p.split(/\s+/).filter(Boolean).length);

/**
 * A title in the first line: short (≤ 80 characters), no sentence ending, not
 * a heading or scene break, and followed by more text. Returns
 * { title, rest } (rest = the text without that line) or null.
 */
export function guessTitle(raw) {
  const lines = cleanLines(raw);
  const i = lines.findIndex((l) => l.trim());
  if (i < 0) return null;
  const first = lines[i].trim();
  if (first.length > 80 || /[.,;:!?…]$/.test(first) || isScene(first) || headingOf(first)) return null;
  if (/["“]$/.test(first) || !/\p{L}/u.test(first)) return null;
  const rest = lines.slice(i + 1);
  if (!rest.some((l) => l.trim())) return null;
  return { title: polish(first), rest: rest.join('\n') };
}

/**
 * A byline at the very end (a name, perhaps with a line about the author):
 * the last block is one or two short lines with no sentence ending, and its
 * first line looks like a name. Only ever offered as a suggestion.
 */
export function guessAuthor(raw) {
  const blocks = blocksOf(cleanLines(raw));
  if (blocks.length < 2) return null;
  const last = blocks[blocks.length - 1];
  if (last.length > 2 || last.some((l) => l.length > 60 || /[.!?…:;,"”]$/.test(l))) return null;
  const name = last[0].replace(/^(?:by|—|-)\s*/i, '').trim();
  const words = name.split(' ');
  if (words.length < 2 || words.length > 5 || name.length > 40) return null;
  if (!words.every((w) => /^[\p{Lu}][\p{L}.’'-]*\.?$/u.test(w) || /^(?:de|van|von|da|del|la|le)$/.test(w))) return null;
  return polish(name);
}

/** Paragraph strings of one block list (headings removed, scene breaks as "§"). */
function chaptersOf(blocks, title) {
  const heads = blocks.filter((b) => b.length === 1 && headingOf(b[0])).length;
  const chapters = [];
  let ch = null;
  const start = (t, number) => { ch = { number, title: t, part: null, paragraphs: [] }; chapters.push(ch); };
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const h = b.length === 1 && heads >= 2 ? headingOf(b[0]) : null;
    if (h) {
      let sub = h.sub;
      // "CHAPTER ONE" then "The Lake" on its own line: that line is the title.
      const nx = blocks[k + 1];
      if (!sub && nx && nx.length === 1 && nx[0].length <= 60 && !TERMINAL.test(nx[0]) && !isScene(nx[0]) && !headingOf(nx[0])) { sub = nx[0]; k++; }
      if (sub) start(polish(sub), polish(h.label));
      else start(polish(h.label), null);
      continue;
    }
    if (!ch) start(title, null); // text before the first heading (or no headings at all)
    if (b.length === 1 && isScene(b[0])) {
      // Never open a chapter with a break, and never two in a row.
      if (ch.paragraphs.length && ch.paragraphs[ch.paragraphs.length - 1] !== SCENE_BREAK) ch.paragraphs.push(SCENE_BREAK);
      continue;
    }
    const p = polish(joinLines(b));
    if (p) ch.paragraphs.push(p);
  }
  for (const c of chapters) {
    while (c.paragraphs[c.paragraphs.length - 1] === SCENE_BREAK) c.paragraphs.pop();
  }
  // A short preface before the first heading keeps its own (untitled) chapter
  // only if it has text; empty chapters are dropped.
  return chapters.filter((c) => c.paragraphs.length);
}

/** Counts for the live summary: { words, paragraphs, chapters }. */
export function summarize(raw) {
  const chapters = chaptersOf(blocksOf(cleanLines(raw)), '');
  let words = 0, paragraphs = 0;
  for (const c of chapters) for (const p of c.paragraphs) { if (p !== SCENE_BREAK) { paragraphs++; words += countWords(p); } }
  return { words, paragraphs, chapters: chapters.length };
}

/**
 * The book for `raw` (without any title line already taken out). Single-chapter
 * stories get the story title as their chapter title and no number.
 */
export function parseStory(raw, { id, title, author = '' }) {
  const t = polish(String(title || '').replace(/\s+/g, ' ')) || 'Untitled';
  let chapters = chaptersOf(blocksOf(cleanLines(raw)), t);
  if (chapters.length === 1) chapters[0] = { ...chapters[0], number: null, title: t };
  if (!chapters.length) chapters = [{ number: null, title: t, part: null, paragraphs: [] }];
  return {
    id,
    title: t,
    author: polish(String(author || '').replace(/\s+/g, ' ')),
    source: 'Added on this device',
    chapters,
  };
}

/** Total words in a parsed book. */
export const bookWords = (book) => book.chapters.reduce((n, c) => n + c.paragraphs.reduce((m, p) => m + countWords(p), 0), 0);

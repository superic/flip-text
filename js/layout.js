// Line breaking + pagination.
//
// CSS cannot style "every other rendered line", so we break lines ourselves:
// every word (and every way of hyphenating it) is measured once off-screen in
// exactly the reading column's font, then a greedy breaker fills each line
// and, when the next word does not fit, tries the longest hyphenated start of
// it that does (js/hyphenate.js). Those lines are then rendered as explicit,
// individually styleable line elements and packed into pages.
//
// A word split across two lines belongs to the line (and page) where it
// starts: that line's slot carries `post` (e.g. "predomi-") and counts the
// word; the next line carries `pre` ("nates") and starts at the word after.

import { flipPunctuation, flipFragment } from './punct.js';
import { breaksFor } from './hyphenate.js';

export const SCENE_BREAK = '§';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Split every paragraph into words once per book and cache counts. */
export function prepareBook(book) {
  let total = 0;
  book.chapters.forEach((ch) => {
    ch.words = ch.paragraphs.map((p) => (p === SCENE_BREAK ? null : String(p).split(/\s+/).filter(Boolean)));
    // paraStart[i] = number of words in the chapter before paragraph i
    ch.paraStart = [];
    let n = 0;
    ch.words.forEach((w, i) => { ch.paraStart[i] = n; n += w ? w.length : 0; });
    ch.wordCount = n;
    ch.bookStart = total;
    total += n;
  });
  book.totalWords = total;
  return book;
}

/** What the book calls its chapters: "story" (Sherlock Holmes) or "chapter". */
export const unitOf = (book) => (book && book.unit) || 'chapter';

/** "Story I", "Chapter 1": the small label above a chapter's title. */
export function chapterLabel(book, ci) {
  const ch = book.chapters[ci];
  const n = String(ch.number || ci + 1);
  const u = unitOf(book);
  return u[0].toUpperCase() + u.slice(1) + ' ' + n;
}

export function headingHTML(book, ci) {
  const ch = book.chapters[ci];
  const prev = book.chapters[ci - 1];
  let html = '';
  if (ch.part && (!prev || prev.part !== ch.part)) html += `<div class="ch-part">${esc(ch.part)}</div>`;
  html += `<div class="ch-num">${esc(chapterLabel(book, ci))}</div>`;
  if (ch.title) html += `<div class="ch-title">${esc(ch.title)}</div>`;
  html += '<div class="ch-orn" aria-hidden="true"><span></span><i></i><span></span></div>';
  return html;
}

/* ---- measuring */

// Text widths per font (family, size, weight): word widths do not depend on
// the column width, so a rotation or a new chapter re-measures only new words.
const widthCaches = new Map();
let hyphenation = true;
/** Tests compare line fill with and without hyphenation. */
export function _setHyphenation(on) { hyphenation = !!on; }

function widthTable(measureEl) {
  const cs = getComputedStyle(measureEl);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  // A face that is still loading would be measured in its fallback: keep
  // those widths apart so they are never reused once the real face arrives.
  let ready = true;
  try { ready = !document.fonts || document.fonts.check(font); } catch { /* keep true */ }
  const key = font + (ready ? '' : ' (fallback)');
  if (!widthCaches.has(key)) widthCaches.set(key, new Map());
  return widthCaches.get(key);
}

/** Measure every string in `need` not yet in `table`, in one layout pass. */
function measureAll(measureEl, table, need) {
  const todo = [...need].filter((s) => !table.has(s));
  if (!todo.length) return;
  measureEl.innerHTML = todo.map((s) => `<span>${esc(s)}</span>`).join('');
  const spans = measureEl.children;
  for (let i = 0; i < todo.length; i++) table.set(todo[i], spans[i].getBoundingClientRect().width);
  measureEl.innerHTML = '';
}

/**
 * Greedy line breaking of one paragraph. W(text, isHead) gives widths. A word that
 * does not fit is hyphenated (longest fitting start first) unless: it is the
 * paragraph's last word, the line is already well filled, or the two lines
 * before already end in a break.
 */
function breakParagraph(pi, words, W, sp, width, indent) {
  const lines = [];
  const n = words.length;
  let i = 0;
  let pre = null;
  let run = 0; // consecutive lines ending inside a word
  while (i < n || pre) {
    const first = lines.length === 0;
    const room = width - (first ? indent : 0);
    const line = { type: 'line', pi, start: i, end: i, first, last: false, pre, post: null, nat: 0, gaps: 0, room };
    let x = pre ? W(pre, true) : 0;
    let items = pre ? 1 : 0;
    pre = null;
    // The rest of a word too long even for a line of its own (a run of
    // dashed words at a large size) is split again; that line holds just
    // the middle part and counts no words.
    if (hyphenation && x > room) {
      const opts = breaksFor(line.pre);
      for (let k = opts.length - 1; k >= 0; k--) {
        if (W(opts[k].head, true) <= room) { line.pre = opts[k].head; pre = opts[k].tail; break; }
      }
      if (pre) {
        line.mid = true;
        line.nat = W(line.pre, true);
        lines.push(line);
        run++;
        continue;
      }
    }
    while (i < n) {
      const need = (items ? sp : 0) + W(words[i]);
      if (x + need <= room) { x += need; items++; i++; continue; }
      // Hyphenate only when the gaps would otherwise stretch noticeably. A
      // word wider than a whole line is always split if it can be.
      const loose = items <= 1 || (room - x) / (items - 1) > 0.6 * sp;
      if (hyphenation && ((loose && run < 2 && i < n - 1) || items === 0)) {
        const opts = breaksFor(words[i]);
        for (let k = opts.length - 1; k >= 0; k--) {
          const w = (items ? sp : 0) + W(opts[k].head, true);
          if (x + w <= room) {
            line.post = opts[k].head;
            pre = opts[k].tail;
            x += w; items++; i++;
            break;
          }
        }
      }
      // A word longer than a whole line goes on a line of its own.
      if (!line.post && items === 0) { x += W(words[i]); items++; i++; }
      break;
    }
    line.end = line.post ? i - 1 : i;
    line.nat = x;
    line.gaps = Math.max(0, items - 1);
    run = line.post ? run + 1 : 0;
    lines.push(line);
  }
  if (lines.length) lines[lines.length - 1].last = true;
  return lines;
}

/** Words a line slot counts: its whole words plus a split word that starts on it. */
export const slotWords = (s) => (s.type === 'line' ? s.end - s.start + (s.post ? 1 : 0) : 0);

/**
 * Lay out one chapter.
 * geom: { width, height, lh } of the reading column in CSS px.
 * Returns { pages, headingSlots, lh, space } where each page is
 *   { ci, index, heading, slots: [line|break], words, anchor: {pi, wi} }
 * and a line slot is { type:'line', pi, start, end, first, last, pre, post }
 * (`pre`/`post`: the end/start of a word split with the line before/after).
 */
export function layoutChapter(book, ci, geom, measureEl) {
  const ch = book.chapters[ci];
  const { width, height, lh } = geom;
  // A hair narrower than the real column so sub-pixel differences can never
  // make a measured line wrap when it is rendered on its own.
  const avail = Math.max(50, width - 2);
  measureEl.style.width = avail + 'px';

  // Chapter heading: occupies a whole number of line slots, never flipped.
  measureEl.innerHTML = `<div class="chapter-heading">${headingHTML(book, ci)}</div>`;
  const perPage = Math.max(3, Math.floor(height / lh));
  let headingSlots = Math.ceil((measureEl.firstElementChild.offsetHeight - 0.5) / lh);
  headingSlots = Math.min(Math.max(1, headingSlots), perPage - 2);
  measureEl.innerHTML = '';

  // Widths of every word, and of both halves of every way to split it, each
  // also as Flip punctuation draws it: the wider form counts, so a reversed
  // line fits with punctuation flipped or not and the setting never needs a
  // re-layout (",apply" is kerned differently from "apply,").
  const table = widthTable(measureEl);
  const need = new Set([' ']);
  const add = (t, head) => { need.add(t); need.add(head ? flipFragment(t) : flipPunctuation(t)); };
  const addBreaks = (t) => { for (const b of breaksFor(t)) { add(b.head, true); add(b.tail, false); addBreaks(b.tail); } };
  for (const words of ch.words) {
    if (!words) continue;
    for (const w of words) {
      add(w, false);
      if (hyphenation) addBreaks(w);
    }
  }
  measureAll(measureEl, table, need);
  const W = (t, head = false) => Math.max(table.get(t) || 0, table.get(head ? flipFragment(t) : flipPunctuation(t)) || 0);
  const sp = W(' ');
  const indent = 1.5 * parseFloat(getComputedStyle(measureEl).fontSize); // --indent

  const slots = [];
  for (let pi = 0; pi < ch.words.length; pi++) {
    const words = ch.words[pi];
    if (!words) { slots.push({ type: 'break', pi }); continue; }
    if (!words.length) continue;
    slots.push(...breakParagraph(pi, words, W, sp, avail, indent));
  }

  // Pack whole lines into pages. Paragraphs may split across pages.
  const pages = [];
  let i = 0;
  do {
    const cap = pages.length === 0 ? perPage - headingSlots : perPage;
    const pageSlots = slots.slice(i, i + cap);
    i += cap;
    const first = pageSlots[0];
    pages.push({
      ci,
      index: pages.length,
      heading: pages.length === 0,
      slots: pageSlots,
      words: pageSlots.reduce((n, s) => n + slotWords(s), 0),
      anchor: first ? { pi: first.pi, wi: first.type === 'line' ? first.start : 0 } : { pi: 0, wi: 0 },
    });
  } while (i < slots.length);
  if (pages[0]) pages[0].anchor = { pi: 0, wi: 0 };

  return { pages, headingSlots, lh, space: sp };
}

/**
 * HTML for one page. Slot k (0-based, counting scene breaks, not the heading)
 * is reversed when k is odd, so every page starts left-to-right and the
 * alternation runs continuously down the page across paragraph boundaries.
 * `punct` (Reversed words only) moves each reversed word's punctuation to the
 * side read first (a split word's line-end hyphen counts as punctuation).
 * It only reorders characters within a word, so the line breaks measured
 * above are unaffected and toggling it needs no re-layout.
 */
export function pageHTML(book, layout, page, style, punct = false) {
  const ch = book.chapters[page.ci];
  let html = '';
  if (page.heading) {
    html += `<div class="chapter-heading" style="height:${layout.headingSlots * layout.lh}px">${headingHTML(book, page.ci)}</div>`;
  }
  page.slots.forEach((s, k) => {
    const rev = k % 2 === 1 && style !== 'normal';
    if (s.type === 'break') { html += '<div class="ln brk" aria-label="scene break">⁂</div>'; return; }
    let words = ch.words[s.pi].slice(s.start, s.end);
    if (rev && style === 'words' && punct) {
      words = words.map(flipPunctuation);
      if (s.pre) words.unshift(flipFragment(s.pre));
      if (s.post) words.push(flipFragment(s.post));
    } else {
      if (s.pre) words.unshift(s.pre);
      if (s.post) words.push(s.post);
    }
    if (rev && style === 'words') words.reverse();
    let cls = 'ln';
    if (s.first) cls += ' first';
    if (s.last) cls += ' last';
    if (rev) cls += ' rev';
    html += `<div class="${cls}">${esc(words.join(' '))}</div>`;
  });
  return html;
}

/** Index of the page containing word (pi, wi). */
export function pageIndexFor(layout, pi, wi) {
  const pages = layout.pages;
  let found = 0;
  for (let i = 0; i < pages.length; i++) {
    const a = pages[i].anchor;
    if (a.pi < pi || (a.pi === pi && a.wi <= wi)) found = i; else break;
  }
  return found;
}

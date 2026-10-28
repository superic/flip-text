// Line breaking + pagination.
//
// CSS cannot style "every other rendered line", so we find the line breaks
// ourselves: each paragraph is rendered off-screen in a container with exactly
// the reading column's font and width, every word wrapped in a <span>, and
// words are grouped into lines by their offsetTop. Those lines are then rebuilt
// as explicit, individually styleable line elements and packed into pages.

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

export function headingHTML(book, ci) {
  const ch = book.chapters[ci];
  const prev = book.chapters[ci - 1];
  let html = '';
  if (ch.part && (!prev || prev.part !== ch.part)) html += `<div class="ch-part">${esc(ch.part)}</div>`;
  if (ch.number) {
    const n = String(ch.number);
    html += `<div class="ch-num">${esc(/^\d+$/.test(n) ? 'Chapter ' + n : n)}</div>`;
  }
  if (ch.title) html += `<div class="ch-title">${esc(ch.title)}</div>`;
  html += '<div class="ch-rule"></div>';
  return html;
}

/**
 * Lay out one chapter.
 * geom: { width, height, lh } of the reading column in CSS px.
 * Returns { pages, headingSlots } where each page is
 *   { ci, index, heading, slots: [line|break], words, anchor: {pi, wi} }
 * and a line slot is { type:'line', pi, start, end, first, last }.
 */
export function layoutChapter(book, ci, geom, measureEl) {
  const ch = book.chapters[ci];
  const { width, height, lh } = geom;
  // A hair narrower than the real column so sub-pixel differences can never
  // make a measured line wrap when it is re-rendered on its own.
  measureEl.style.width = Math.max(50, width - 2) + 'px';

  // Chapter heading: occupies a whole number of line slots, never flipped.
  measureEl.innerHTML = `<div class="chapter-heading">${headingHTML(book, ci)}</div>`;
  const perPage = Math.max(3, Math.floor(height / lh));
  let headingSlots = Math.ceil((measureEl.firstElementChild.offsetHeight - 0.5) / lh);
  headingSlots = Math.min(Math.max(1, headingSlots), perPage - 2);

  // Paragraphs, one <p> each, one <span> per word.
  let html = '';
  for (const words of ch.words) {
    if (!words) { html += '<p></p>'; continue; }
    html += '<p>' + words.map((w) => `<span>${esc(w)}</span>`).join(' ') + '</p>';
  }
  measureEl.innerHTML = html;

  const slots = [];
  const ps = measureEl.children;
  for (let pi = 0; pi < ch.words.length; pi++) {
    const words = ch.words[pi];
    if (!words) { slots.push({ type: 'break', pi }); continue; }
    if (!words.length) continue;
    const spans = ps[pi].children;
    let line = null;
    let lastTop = -Infinity;
    for (let wi = 0; wi < spans.length; wi++) {
      const top = spans[wi].offsetTop;
      if (top > lastTop + lh / 2) {
        line = { type: 'line', pi, start: wi, end: wi + 1, first: wi === 0, last: false };
        slots.push(line);
        lastTop = top;
      } else {
        line.end = wi + 1;
      }
    }
    line.last = true;
  }
  measureEl.innerHTML = '';

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
      words: pageSlots.reduce((n, s) => n + (s.type === 'line' ? s.end - s.start : 0), 0),
      anchor: first ? { pi: first.pi, wi: first.type === 'line' ? first.start : 0 } : { pi: 0, wi: 0 },
    });
  } while (i < slots.length);
  if (pages[0]) pages[0].anchor = { pi: 0, wi: 0 };

  return { pages, headingSlots, lh };
}

/**
 * HTML for one page. Slot k (0-based, counting scene breaks, not the heading)
 * is reversed when k is odd, so every page starts left-to-right and the
 * alternation runs continuously down the page across paragraph boundaries.
 */
export function pageHTML(book, layout, page, style) {
  const ch = book.chapters[page.ci];
  let html = '';
  if (page.heading) {
    html += `<div class="chapter-heading" style="height:${layout.headingSlots * layout.lh}px">${headingHTML(book, page.ci)}</div>`;
  }
  page.slots.forEach((s, k) => {
    const rev = k % 2 === 1 && style !== 'normal';
    if (s.type === 'break') { html += '<div class="ln brk" aria-label="scene break">⁂</div>'; return; }
    let words = ch.words[s.pi].slice(s.start, s.end);
    if (rev && style === 'words') words = words.reverse();
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

// Library screen: cloth covers on a shelf, progress, "Continue reading",
// and the "Add a story" tile after the books.
import { getPosition, lastBookId, loadBook } from './books.js';
import { STORY_CLOTHS } from './stories.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Small gilt ornaments, drawn on a 24px grid.
const ORN = {
  glass: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20"/>',              // magnifying glass
  trail: '<path d="M4 18c3-1 4-5 7-6s5 1 8-4" stroke-dasharray="2 2.5"/><path d="M16 4l4 4M20 4l-4 4"/>', // trail to X
  leaf: '<path d="M12 4c4 4 4 12 0 16c-4-4-4-12 0-16z"/><path d="M12 8v12"/>',
  quill: '<path d="M19.5 3.5C13 4.5 8.5 9 7.5 16.5c6-.5 11-5.5 12-13z"/><path d="M15.5 8.5L4.5 20.5"/><path d="M11 11.5h3.5M9.5 14h3"/>', // added stories
};

// Per-book cover design; any other book gets a cloth colour by position.
const COVERS = {
  sherlock: { cloth: '#24433B', orn: 'glass', kicker: 'The Adventures of', title: 'Sherlock Holmes', size: 19, short: 'Sherlock Holmes' },
  'treasure-island': { cloth: '#6E2B22', orn: 'trail', title: 'Treasure Island', size: 21, author: 'R. L. Stevenson' },
};
const CLOTHS = ['#24433B', '#6E2B22', '#22355F', '#4A2F55'];

/** Title size for an added story's cover: smaller for long titles or long words. */
function titleSize(t) {
  const longest = Math.max(...String(t).split(/\s+/).map((w) => w.length));
  if (t.length <= 14 && longest <= 9) return 19;
  if (t.length <= 26 && longest <= 10) return 17;
  if (t.length <= 44 && longest <= 12) return 15;
  return 13;
}

function design(book, i) {
  if (book.user) return { cloth: book.cloth || STORY_CLOTHS[0], orn: 'quill', title: book.title, size: titleSize(book.title), user: true };
  return { cloth: CLOTHS[i % CLOTHS.length], orn: 'leaf', title: book.title, size: 18, ...(COVERS[book.id] || {}) };
}

/** A cloth cover: gilt double frame, ornament, title, rule and author. `mini` = small, title only. */
export function coverHTML(book, i, mini = false) {
  const d = design(book, i);
  return `<div class="cover${mini ? ' mini' : ''}${d.user ? ' user' : ''}" style="--cloth:${d.cloth}" aria-hidden="true"><div class="cover-frame"><div class="cover-inner">` +
    `<svg class="cover-orn" viewBox="0 0 24 24">${ORN[d.orn] || ORN.leaf}</svg>` +
    (d.kicker ? `<span class="cover-kicker">${esc(d.kicker)}</span>` : '') +
    `<span class="cover-title" style="font-size:${d.size}px">${esc(d.title)}</span>` +
    '<span class="cover-rule"></span>' +
    (book.author ? `<span class="cover-author">${esc(book.author)}</span>` : '') + '</div></div></div>';
}

const pctText = (pct) => (pct >= 100 ? 'Finished' : pct > 0 ? `${Math.max(1, Math.floor(pct))}%` : 'New');

const progressHTML = (pct) =>
  `<div class="progress"><div class="track"><div class="fill" style="width:${Math.min(100, pct)}%"></div></div><span>${pctText(pct)}</span></div>`;

/** "I · A Scandal in Bohemia" for the Continue reading card. */
const chapterText = (book, ci) => {
  const ch = book.chapters[ci];
  return ch ? [ch.number, ch.title].filter(Boolean).join(' · ') : '';
};

const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

/**
 * index: built-in books then added stories. `note` (HTML) is shown above the
 * shelf, e.g. when the built-in books could not be loaded.
 */
export function renderLibrary(index, { onOpen, onAdd, note = '' }) {
  const shelf = document.getElementById('shelf');
  const cont = document.getElementById('continue');

  shelf.innerHTML = note + index.map((b, i) => {
    const pct = getPosition(b.id).pct || 0;
    const d = design(b, i);
    return `<button type="button" class="book-tile" data-id="${esc(b.id)}" aria-label="Open ${esc(b.title)}, ${pctText(pct)}">` +
      coverHTML(b, i) +
      `<div class="book-meta"><div class="t">${esc(d.short || b.title)}</div><div class="a">${esc(d.author || b.author || 'Added by you')}</div>` +
      progressHTML(pct) + '</div></button>';
  }).join('') +
    '<button type="button" class="book-tile add-tile" data-add aria-label="Add a story">' +
    `<div class="add-cover" aria-hidden="true"><span class="add-plus">${PLUS}</span><span class="add-label">Add a story</span></div>` +
    '<div class="book-meta"><div class="a">Paste text or open a file. It stays on this device.</div></div></button>';
  shelf.onclick = (e) => {
    if (e.target.closest('[data-add]')) { onAdd(); return; }
    const t = e.target.closest('[data-id]');
    if (t) onOpen(t.dataset.id);
  };

  const lastId = lastBookId();
  const li = index.findIndex((b) => b.id === lastId);
  if (li < 0) {
    cont.hidden = true;
    cont.innerHTML = '';
    return;
  }
  const b = index[li];
  const pos = getPosition(b.id);
  cont.hidden = false;
  cont.innerHTML =
    `<div class="continue" data-id="${esc(b.id)}">${coverHTML(b, li, true)}` +
    '<div class="continue-text"><span class="eyebrow">Continue reading</span>' +
    `<span class="continue-title">${esc(b.title)}</span>` +
    `<span class="continue-sub" id="continue-ch">${esc(pos.chapter && pos.chapter !== b.title ? pos.chapter : '')}</span>` +
    progressHTML(pos.pct || 0) +
    `<button type="button" class="btn btn-primary">${pos.pct >= 100 ? 'Read again' : 'Resume'}</button></div></div>`;
  cont.onclick = () => onOpen(b.id);
  // Positions saved before the chapter name was stored: look it up in the
  // book (cached by the service worker, and needed to open it anyway).
  if (!pos.chapter && !b.user) {
    loadBook(b).then((book) => {
      const el = document.getElementById('continue-ch');
      if (el) el.textContent = chapterText(book, pos.chapterIdx);
    }).catch(() => { /* the card works without it */ });
  }
}

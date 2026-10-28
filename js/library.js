// Library screen: CSS-drawn covers on a shelf, progress, "Continue reading".
import { getPosition, lastBookId } from './books.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PALETTES = [
  { c1: '#22355f', c2: '#141f3a', gold: '#e3c77f', orn: '❦' }, // deep navy
  { c1: '#7d2a22', c2: '#4b1611', gold: '#ecc987', orn: '✥' }, // oxblood
  { c1: '#25503f', c2: '#143226', gold: '#e0c27c', orn: '❧' }, // bottle green
  { c1: '#5a3a68', c2: '#33203d', gold: '#e9cf95', orn: '✦' }, // plum
];

export function coverHTML(book, i) {
  const p = PALETTES[i % PALETTES.length];
  return `<div class="cover" style="--c1:${p.c1};--c2:${p.c2};--gold:${p.gold}" aria-hidden="true">` +
    `<div class="cover-orn">${p.orn}</div>` +
    `<div class="cover-title">${esc(book.title)}</div>` +
    '<div class="cover-rule"></div>' +
    `<div class="cover-author">${esc(book.author)}</div></div>`;
}

const pctText = (pct) => (pct >= 100 ? 'Finished' : pct > 0 ? `${Math.max(1, Math.floor(pct))}%` : 'New');

export function renderLibrary(index, { onOpen }) {
  const shelf = document.getElementById('shelf');
  const cont = document.getElementById('continue');

  shelf.innerHTML = index.map((b, i) => {
    const pct = getPosition(b.id).pct || 0;
    return `<button type="button" class="book-tile" data-id="${esc(b.id)}" aria-label="Open ${esc(b.title)}, ${pctText(pct)}">` +
      coverHTML(b, i) +
      `<div class="book-meta"><div class="t">${esc(b.title)}</div><div class="a">${esc(b.author)}</div>` +
      `<div class="progress"><div class="track"><div class="fill" style="width:${Math.min(100, pct)}%"></div></div><span>${pctText(pct)}</span></div></div>` +
      '</button>';
  }).join('');
  shelf.onclick = (e) => {
    const t = e.target.closest('[data-id]');
    if (t) onOpen(t.dataset.id);
  };

  const lastId = lastBookId();
  const li = index.findIndex((b) => b.id === lastId);
  if (li >= 0) {
    const b = index[li];
    const pos = getPosition(b.id);
    cont.hidden = false;
    cont.innerHTML =
      `<div class="continue" role="button" tabindex="0" data-id="${esc(b.id)}">${coverHTML(b, li)}` +
      '<div class="continue-text"><div class="continue-label">Continue reading</div>' +
      `<div class="continue-title">${esc(b.title)}</div>` +
      `<div class="continue-sub">${esc(b.author)} · ${pctText(pos.pct || 0)}${pos.pct > 0 && pos.pct < 100 ? ' read' : ''}</div>` +
      '<span class="btn btn-primary">Continue</span></div></div>';
    cont.onclick = () => onOpen(b.id);
  } else {
    cont.hidden = true;
    cont.innerHTML = '';
  }
}

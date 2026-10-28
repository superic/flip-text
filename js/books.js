// Loading book data and remembering reading positions.
import { prepareBook } from './layout.js';
import { load, save, KEYS } from './storage.js';

let indexPromise = null;
const bookCache = new Map();

export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch('books/index.json')
      .then((r) => { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
      .catch((e) => { indexPromise = null; throw e; });
  }
  return indexPromise;
}

export function loadBook(entry) {
  if (!bookCache.has(entry.id)) {
    const p = fetch(entry.file)
      .then((r) => { if (!r.ok) throw new Error('book ' + r.status); return r.json(); })
      .then((b) => prepareBook(b))
      .catch((e) => { bookCache.delete(entry.id); throw e; });
    bookCache.set(entry.id, p);
  }
  return bookCache.get(entry.id);
}

/** Position is anchored to text (chapter, paragraph, word), never to page numbers. */
export function getPosition(id) {
  const p = load(KEYS.pos(id), null);
  if (!p || typeof p !== 'object') return { chapterIdx: 0, paraIdx: 0, wordIdx: 0, pct: 0 };
  return {
    chapterIdx: Number.isInteger(p.chapterIdx) ? p.chapterIdx : 0,
    paraIdx: Number.isInteger(p.paraIdx) ? p.paraIdx : 0,
    wordIdx: Number.isInteger(p.wordIdx) ? p.wordIdx : 0,
    pct: typeof p.pct === 'number' ? p.pct : 0,
    ts: p.ts || 0,
  };
}

export function savePosition(id, pos) {
  save(KEYS.pos(id), { ...pos, ts: Date.now() });
  save(KEYS.last, id);
}

export const lastBookId = () => load(KEYS.last, null);

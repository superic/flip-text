// Stories added on this device ("Add a story"). They are never sent anywhere
// and never go into the service worker's cache: the text lives only in this
// browser's IndexedDB (database "oxturn": store "meta" holds the shelf
// entries, store "texts" the books). Where IndexedDB is missing or broken it
// falls back to localStorage (~5 MB). Saving reports failure by throwing, so
// the add sheet can say so and keep the pasted text.
import { load, remove, KEYS } from './storage.js';

const DB_NAME = 'oxturn';
const LS_LIST = 'ox.stories';
const lsText = (id) => `ox.story.${id}`;

// Cloth colours for added stories: slate, plum, umber, moss (the built-in
// books are green and oxblood). Picked by story id, so a cover never changes.
export const STORY_CLOTHS = ['#3B4D5E', '#4D2C44', '#5A3F2B', '#3F4A2C'];

let dbPromise = null;
let list = null; // cached shelf entries, oldest first

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        if (!window.indexedDB) { resolve(null); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

/** Run one transaction; resolves with the last request's result. */
function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(stores, mode); } catch (e) { reject(e); return; }
    let result;
    const reqs = fn(t);
    const last = Array.isArray(reqs) ? reqs[reqs.length - 1] : reqs;
    if (last) last.onsuccess = () => { result = last.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('storage error'));
    t.onabort = () => reject(t.error || new Error('storage aborted'));
  });
}

const byAdded = (a, b) => (a.addedAt || 0) - (b.addedAt || 0);

/** Shelf entries for added stories. Never throws (an empty list on failure). */
export async function listStories() {
  if (list) return list;
  let out = [];
  const db = await openDB();
  if (db) {
    try { out = await tx(db, 'meta', 'readonly', (t) => t.objectStore('meta').getAll()) || []; } catch { out = []; }
  }
  // Stories saved by the localStorage fallback (or before IndexedDB worked).
  const ls = load(LS_LIST, []);
  if (Array.isArray(ls)) for (const m of ls) if (m && m.id && !out.some((x) => x.id === m.id)) out.push({ ...m, ls: true });
  list = out.map(entryOf).sort(byAdded);
  return list;
}

/** The index entry the library and reader use (same fields as books/index.json). */
function entryOf(m) {
  return {
    id: m.id, title: m.title, author: m.author || '', user: true,
    unit: m.chapterCount > 1 ? 'chapter' : 'story',
    chapterCount: m.chapterCount, wordCount: m.wordCount, cloth: m.cloth, addedAt: m.addedAt, ls: !!m.ls,
  };
}

/** The book JSON for an added story. */
export async function getStory(id) {
  const db = await openDB();
  if (db) {
    try {
      const rec = await tx(db, 'texts', 'readonly', (t) => t.objectStore('texts').get(id));
      if (rec && rec.book) return rec.book;
    } catch { /* try localStorage */ }
  }
  try {
    const raw = localStorage.getItem(lsText(id));
    if (raw) return JSON.parse(raw);
  } catch { /* fall through */ }
  throw new Error('story not found');
}

export function clothFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return STORY_CLOTHS[h % STORY_CLOTHS.length];
}

export const newId = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * Save a parsed book. Throws if neither IndexedDB nor localStorage could
 * keep it (storage full, blocked, or private browsing with no quota).
 */
export async function saveStory(book, { wordCount }) {
  const meta = {
    id: book.id, title: book.title, author: book.author, wordCount,
    chapterCount: book.chapters.length, cloth: clothFor(book.id), addedAt: Date.now(),
  };
  const first = !(await listStories()).length;
  const db = await openDB();
  let saved = false;
  if (db) {
    try {
      await tx(db, ['meta', 'texts'], 'readwrite', (t) => [
        t.objectStore('texts').put({ id: book.id, book }),
        t.objectStore('meta').put(meta),
      ]);
      saved = true;
    } catch { /* try localStorage */ }
  }
  if (!saved) {
    // Throws (QuotaExceededError / SecurityError) when this fails too.
    localStorage.setItem(lsText(book.id), JSON.stringify(book));
    try {
      const ls = load(LS_LIST, []);
      localStorage.setItem(LS_LIST, JSON.stringify([...(Array.isArray(ls) ? ls : []), meta]));
    } catch (e) {
      try { localStorage.removeItem(lsText(book.id)); } catch { /* ignore */ }
      throw e;
    }
  }
  list = null;
  // Ask the browser not to clear this site's storage when space runs low
  // (best effort; Safari and Chrome decide for themselves).
  if (first) {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* ignore */ }
  }
  return entryOf(meta);
}

/**
 * Delete a story's text, shelf entry and saved place. Reading-speed records
 * are kept (they only hold the story's id and word counts).
 */
export async function removeStory(id) {
  const db = await openDB();
  if (db) {
    try {
      await tx(db, ['meta', 'texts'], 'readwrite', (t) => [t.objectStore('texts').delete(id), t.objectStore('meta').delete(id)]);
    } catch { /* also clear the fallback below */ }
  }
  try { localStorage.removeItem(lsText(id)); } catch { /* ignore */ }
  const ls = load(LS_LIST, []);
  if (Array.isArray(ls) && ls.some((m) => m && m.id === id)) {
    try { localStorage.setItem(LS_LIST, JSON.stringify(ls.filter((m) => m && m.id !== id))); } catch { /* ignore */ }
  }
  remove(KEYS.pos(id));
  if (load(KEYS.last, null) === id) remove(KEYS.last);
  list = null;
}

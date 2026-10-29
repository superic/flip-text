// Silent reading-speed measurement. Nothing here is ever shown while reading.
//
// Rules:
//  - A page's timer starts once the page is fully shown (after the turn
//    animation) and stops on the next FORWARD turn. Backward turns, jumps and
//    leaving the book discard the timer.
//  - Time while the app is hidden (or while menus are open) does not count.
//  - Discard < 3 s (flipping past) and > 5 min (put it down) of active time.
//  - Never record the same page twice (rereading after going back).
//  - Never record if flip style, punctuation flipping, text size or font
//    changed while on the page.
import { load, save, remove, KEYS } from './storage.js';
import { getSettings, punctOf, STYLES } from './settings.js';

const MIN_MS = 3000;
const MAX_MS = 5 * 60 * 1000;
const SESSION_GAP = 30 * 60 * 1000;

let page = null;
const pauses = new Set();

export function startPage({ key, bookId, chapterIdx, words }) {
  const s = getSettings();
  page = {
    key, bookId, chapterIdx, words,
    style: s.style, punct: punctOf(s), fontSize: s.fontSize, spacing: s.spacing, font: s.font,
    activeMs: 0,
    since: pauses.size ? null : Date.now(),
    invalid: false,
  };
}

/** The current page no longer has a clean measurement (layout/style changed). */
export function invalidatePage() { if (page) page.invalid = true; }
export function discardPage() { page = null; }

export function pause(reason) {
  pauses.add(reason);
  if (page && page.since != null) { page.activeMs += Date.now() - page.since; page.since = null; }
}
export function resume(reason) {
  pauses.delete(reason);
  if (!pauses.size && page && page.since == null) page.since = Date.now();
}

/** Called when a forward turn is committed. Records the page if it qualifies. */
export function finishPageForward() {
  const p = page;
  page = null;
  if (!p) return null;
  if (p.since != null) p.activeMs += Date.now() - p.since;
  const s = getSettings();
  if (p.invalid || s.style !== p.style || punctOf(s) !== p.punct || s.fontSize !== p.fontSize || s.font !== p.font) return null;
  if (p.words <= 0 || p.activeMs < MIN_MS || p.activeMs > MAX_MS) return null;
  const recorded = load(KEYS.recorded, []);
  if (recorded.includes(p.key)) return null;
  recorded.push(p.key);
  save(KEYS.recorded, recorded);
  const rec = { ts: Date.now(), bookId: p.bookId, chapterIdx: p.chapterIdx, words: p.words, ms: Math.round(p.activeMs), style: p.style, punct: p.punct, font: p.font };
  const records = getRecords();
  records.push(rec);
  save(KEYS.records, records);
  return rec;
}

export function getRecords() {
  const r = load(KEYS.records, []);
  return Array.isArray(r) ? r.filter((x) => x && x.ms > 0 && x.words > 0) : [];
}

export function resetStats() {
  remove(KEYS.records);
  remove(KEYS.recorded);
}

/** Aggregate records: per-style averages, sessions, totals. WPM = words / minutes (time-weighted). */
export function summarize(records = getRecords()) {
  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  const blank = () => ({ pages: 0, words: 0, ms: 0, wpm: null });
  const byStyle = Object.fromEntries(STYLES.map((s) => [s.id, blank()]));
  const totals = blank();
  const sessions = [];
  let cur = null;
  let lastTs = -Infinity;
  for (const r of sorted) {
    if (!byStyle[r.style]) byStyle[r.style] = blank();
    for (const agg of [byStyle[r.style], totals]) { agg.pages++; agg.words += r.words; agg.ms += r.ms; }
    if (r.ts - lastTs >= SESSION_GAP) { cur = { start: r.ts, end: r.ts, styles: {} }; sessions.push(cur); }
    cur.end = r.ts;
    const st = cur.styles[r.style] || (cur.styles[r.style] = blank());
    st.pages++; st.words += r.words; st.ms += r.ms;
    lastTs = r.ts;
  }
  const wpm = (a) => { a.wpm = a.ms > 0 ? a.words / (a.ms / 60000) : null; };
  Object.values(byStyle).forEach(wpm);
  wpm(totals);
  sessions.forEach((s) => Object.values(s.styles).forEach(wpm));
  return {
    byStyle, totals, sessions,
    first: sorted.length ? sorted[0].ts : null,
    last: sorted.length ? sorted[sorted.length - 1].ts : null,
  };
}

function onHidden() { pause('hidden'); }
function onVisible() { if (!document.hidden) resume('hidden'); }
document.addEventListener('visibilitychange', () => (document.hidden ? onHidden() : onVisible()));
window.addEventListener('pagehide', onHidden);
window.addEventListener('pageshow', onVisible);
if (document.hidden) pauses.add('hidden');

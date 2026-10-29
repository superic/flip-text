// English hyphenation for the line breaker (js/layout.js).
//
// Liang's algorithm over the TeX en-us patterns in hyph/en-us.js: every
// pattern that matches part of ".word." votes a number between two letters;
// odd maxima are allowed breaks. At least 2 letters stay before a break and
// 3 after it (the patterns' own minimums).
//
// breaksFor() applies the app's rules on top: only plain lower-case words of
// 6+ letters are hyphenated (so no capitalised names, numbers or words with
// apostrophes), and a word that already contains a hyphen or a dash is only
// ever broken right after that hyphen or dash. Pure functions, no DOM.
import { PATTERNS, EXCEPTIONS, LEFTMIN, RIGHTMIN } from './hyph/en-us.js';

const MIN_WORD = 6;
let table = null;   // letters -> inter-letter values, e.g. "ach" -> [0,0,0,4] for ".ach4"
let maxLen = 0;
let exceptions = null;
const cache = new Map();

function build() {
  table = new Map();
  for (const p of PATTERNS.trim().split(/\s+/)) {
    const letters = p.replace(/\d/g, '');
    const vals = new Array(letters.length + 1).fill(0);
    let i = 0;
    for (const c of p) {
      if (c >= '0' && c <= '9') vals[i] = +c; else i++;
    }
    table.set(letters, vals);
    maxLen = Math.max(maxLen, letters.length);
  }
  exceptions = new Map();
  for (const e of EXCEPTIONS.trim().split(/\s+/)) {
    const pts = [];
    let n = 0;
    for (const c of e) { if (c === '-') pts.push(n); else n++; }
    exceptions.set(e.replace(/-/g, ''), pts);
  }
}

/** Allowed break positions in a lower-case a-z word: k means "word.slice(0, k) - word.slice(k)". */
export function hyphenPoints(word) {
  if (cache.has(word)) return cache.get(word);
  if (!table) build();
  let pts;
  if (exceptions.has(word)) {
    pts = exceptions.get(word);
  } else {
    const w = '.' + word + '.';
    const vals = new Array(w.length + 1).fill(0);
    for (let i = 0; i < w.length; i++) {
      for (let j = i + 1; j <= Math.min(w.length, i + maxLen); j++) {
        const v = table.get(w.slice(i, j));
        if (!v) continue;
        for (let k = 0; k < v.length; k++) if (v[k] > vals[i + k]) vals[i + k] = v[k];
      }
    }
    // vals[k + 1] sits between word[k - 1] and word[k] (the leading "." shifts by one)
    pts = [];
    for (let k = LEFTMIN; k <= word.length - RIGHTMIN; k++) if (vals[k + 1] % 2 === 1) pts.push(k);
  }
  cache.set(word, pts);
  return pts;
}

/** "predominates" -> "pre-dom-i-nates" (for tests and debugging). */
export const hyphenate = (word) => {
  const pts = hyphenPoints(word);
  let out = '', last = 0;
  for (const p of pts) { out += word.slice(last, p) + '-'; last = p; }
  return out + word.slice(last);
};

const LEAD = /^[“‘"'(\[]*/;
const TRAIL = /[.,;:!?…”’"')\]]*$/;
const DASH = /[-—–]/;

/**
 * Ways to split a text token across two lines, shortest head first. Each is
 * { head, tail }: `head` ends the first line (it ends in "-" or in the
 * token's own dash) and `tail` starts the next. [] when the token stays whole.
 */
export function breaksFor(token) {
  const out = [];
  if (DASH.test(token)) {
    // Already hyphenated or dashed: break only after an existing hyphen/dash.
    for (let i = 1; i < token.length - 1; i++) {
      if (!DASH.test(token[i]) || DASH.test(token[i + 1])) continue;
      const head = token.slice(0, i + 1), tail = token.slice(i + 1);
      if (/[A-Za-z]/.test(head) && /[A-Za-z]/.test(tail)) out.push({ head, tail });
    }
    return out;
  }
  const lead = token.match(LEAD)[0];
  const rest = token.slice(lead.length);
  const trail = rest.match(TRAIL)[0];
  const core = rest.slice(0, rest.length - trail.length);
  if (core.length < MIN_WORD || !/^[a-z]+$/.test(core)) return out;
  for (const k of hyphenPoints(core)) out.push({ head: lead + core.slice(0, k) + '-', tail: core.slice(k) + trail });
  return out;
}

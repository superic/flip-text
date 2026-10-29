// The reader: full-screen pages, paper page-turn animation, tap/swipe input,
// overlay chrome, contents and settings sheets.
//
// Three pre-rendered "leaves" are kept at all times: prev (folded away to the
// left and hidden), cur (on top) and next (underneath). A forward turn curls
// cur over toward the spine, revealing next; a backward turn unfolds prev back
// over cur. The curl geometry and shading live in curl.js. When a turn
// settles the leaves just swap roles and only one leaf has to be re-rendered.
import { layoutChapter, pageHTML, pageIndexFor, headingHTML, chapterLabel, unitOf } from './layout.js';
import { flipPunctuation } from './punct.js';
import { loadBook, getPosition, savePosition } from './books.js';
import {
  getSettings, updateSettings, onSettingsChange, lineHeightPx, fontReady, punctOf,
  STYLES, SIZES, SPACINGS, FONTS, THEMES,
} from './settings.js';
import * as metrics from './metrics.js';
import * as curl from './curl.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let els = null;
let entry = null;
let book = null;
let layouts = new Map();
let geom = null;
let anchor = { ci: 0, pi: 0, wi: 0 }; // reading position, in text coordinates
let leaves = null;
let anim = null;
let gesture = null;
let uiOpen = false;
let sheetOpen = null;
let active = false;
let exitHandler = () => {};
let pendingFont = null; // last font tapped in settings, while it loads

const TURN_MS = 520; // a full scripted turn (tap or key), corner to spine
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------ setup */

function init() {
  if (els) return;
  els = {
    reader: $('reader'), stage: $('stage'), ui: $('reader-ui'), measure: $('measure'),
    label: $('ui-label'), chapter: $('ui-chapter'), page: $('ui-page'), left: $('ui-left'), scrub: $('ui-scrub'),
    contents: $('contents-sheet'), toc: $('toc'), tocSub: $('toc-sub'), settings: $('settings-sheet'), settingsBody: $('settings-body'),
  };
  const mk = () => {
    const leaf = document.createElement('div');
    leaf.className = 'leaf';
    leaf.innerHTML = curl.LEAF_HTML;
    curl.attachLeaf(leaf);
    els.stage.appendChild(leaf);
    return leaf;
  };
  leaves = { next: mk(), cur: mk(), prev: mk() };
  setRoles();

  const st = els.stage;
  st.addEventListener('pointerdown', onDown);
  st.addEventListener('pointermove', onMove);
  st.addEventListener('pointerup', onUp);
  st.addEventListener('pointercancel', onCancel);
  st.addEventListener('contextmenu', (e) => e.preventDefault());
  // Block iOS rubber-banding / pinch on the page itself.
  st.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => { if (active) e.preventDefault(); });

  els.ui.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'library') exitHandler();
    else if (act === 'contents') openSheet('contents');
    else if (act === 'settings') openSheet('settings');
  });
  for (const sheet of [els.contents, els.settings]) {
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  }
  els.toc.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ci]');
    if (!b) return;
    closeSheet();
    showUI(false);
    jumpTo({ ci: +b.dataset.ci, pi: 0, wi: 0 });
  });
  els.settingsBody.addEventListener('click', onSettingsClick);
  els.settingsBody.addEventListener('input', onSettingsInput);
  els.settingsBody.addEventListener('change', onSettingsInput);

  // Position slider in the bottom bar: dragging previews "Page X of Y",
  // letting go jumps to that page of the chapter.
  els.scrub.addEventListener('input', () => scrubPreview(+els.scrub.value - 1));
  els.scrub.addEventListener('change', () => {
    const ref = leaves.cur.ref;
    if (!ref || ref.end) return;
    const page = getLayout(ref.ci).pages[+els.scrub.value - 1];
    if (page && page.index !== ref.pi) jumpTo({ ci: ref.ci, pi: page.anchor.pi, wi: page.anchor.wi });
  });

  document.addEventListener('keydown', (e) => {
    if (!active || sheetOpen) { if (e.key === 'Escape' && sheetOpen) closeSheet(); return; }
    if (e.target && e.target.tagName === 'INPUT') return; // arrow keys move the slider
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turnForward(); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); turnBackward(); }
    else if (e.key === 'Escape') showUI(!uiOpen);
  });

  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (active) relayoutIfNeeded(); }, 180); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  onSettingsChange(async (s, prev) => {
    if (!active || !book) return;
    if (sheetOpen === 'settings') renderSettings();
    if (s.font !== prev.font) {
      metrics.invalidatePage();
      // Lines must be measured in the font that will render them, never in a
      // fallback, so wait for the face before re-paginating. Only the latest
      // choice wins if the reader taps several fonts quickly.
      await fontReady(s.font, s.fontSize);
      if (!active || !book || getSettings().font !== s.font) return;
      relayout();
    } else if (s.fontSize !== prev.fontSize || s.spacing !== prev.spacing) {
      metrics.invalidatePage();
      relayout();
    } else if (s.style !== prev.style || punctOf(s) !== punctOf(prev)) {
      // Punctuation flipping only reorders characters within words, so the
      // pages keep their line breaks: re-render them, no re-layout.
      metrics.invalidatePage();
      for (const l of Object.values(leaves)) fill(l, l.ref);
    }
  });
}

function setRoles() {
  leaves.prev.dataset.role = 'prev';
  leaves.cur.dataset.role = 'cur';
  leaves.next.dataset.role = 'next';
}

/* ------------------------------------------------------------ open / close */

export async function openReader(bookEntry, { onExit }) {
  init();
  exitHandler = onExit;
  active = true;
  entry = bookEntry;
  showUI(false);
  closeSheet();
  if (!book || book.id !== entry.id) {
    book = null;
    layouts = new Map();
    leaves.cur.pageEl.innerHTML = '<p class="muted" style="text-align:center;margin-top:40%">Opening…</p>';
    try {
      book = await loadBook(entry);
    } catch (e) {
      leaves.cur.pageEl.innerHTML = '<p style="text-align:center;margin-top:40%">Sorry, this book could not be loaded. Check the internet connection and try again.</p>';
      return;
    }
    if (!active || entry.id !== bookEntry.id) return;
  }
  // A saved web font may not be loaded yet on a fresh launch; measuring before
  // it arrives would break lines for the fallback font.
  await fontReady();
  if (!active || entry.id !== bookEntry.id) return;
  const p = getPosition(entry.id);
  anchor = { ci: clamp(p.chapterIdx, 0, book.chapters.length - 1), pi: p.paraIdx, wi: p.wordIdx };
  geom = null;
  renderAll();
  pageShown();
}

export function closeReader() {
  if (!els) return;
  active = false;
  if (anim) anim.finish();
  metrics.discardPage();
  closeSheet();
  showUI(false);
  metrics.resume('ui');
}

/* ------------------------------------------------------------ layout */

function measureGeom() {
  const r = leaves.cur.pageEl.getBoundingClientRect();
  return {
    width: Math.floor(r.width),
    height: Math.floor(r.height),
    lh: lineHeightPx(),
    stageW: els.stage.clientWidth,
    stageH: els.stage.clientHeight,
    key: `${Math.floor(r.width)}x${Math.floor(r.height)}:${getSettings().font}:${getSettings().fontSize}:${lineHeightPx()}`,
  };
}

function ensureGeom() {
  const g = measureGeom();
  if (!geom || g.key !== geom.key) { layouts = new Map(); }
  geom = g;
}

function getLayout(ci) {
  if (!layouts.has(ci)) layouts.set(ci, layoutChapter(book, ci, geom, els.measure));
  return layouts.get(ci);
}

function refForAnchor(a) {
  const ci = clamp(a.ci, 0, book.chapters.length - 1);
  return { ci, pi: pageIndexFor(getLayout(ci), a.pi, a.wi) };
}

function nextRef(ref) {
  if (!ref || ref.end) return null;
  if (ref.pi + 1 < getLayout(ref.ci).pages.length) return { ci: ref.ci, pi: ref.pi + 1 };
  if (ref.ci + 1 < book.chapters.length) return { ci: ref.ci + 1, pi: 0 };
  return { end: true };
}

function prevRef(ref) {
  if (!ref) return null;
  if (ref.end) { const ci = book.chapters.length - 1; return { ci, pi: getLayout(ci).pages.length - 1 }; }
  if (ref.pi > 0) return { ci: ref.ci, pi: ref.pi - 1 };
  if (ref.ci > 0) { const ci = ref.ci - 1; return { ci, pi: getLayout(ci).pages.length - 1 }; }
  return null;
}

const pageOf = (ref) => getLayout(ref.ci).pages[ref.pi];

function fill(leaf, ref) {
  leaf.ref = ref;
  const { style, punct } = getSettings();
  leaf.pageEl.className = 'page text style-' + style;
  if (!ref) { leaf.pageEl.innerHTML = ''; return; }
  if (ref.end) {
    leaf.pageEl.innerHTML =
      `<div class="end-page"><div class="fin">The End</div><p>You have finished<br><em>${esc(book.title)}</em>.</p>` +
      '<button type="button" class="btn btn-primary" data-end="library">Back to Library</button></div>';
    return;
  }
  leaf.pageEl.innerHTML = pageHTML(book, getLayout(ref.ci), pageOf(ref), style, punct);
}

function resetLeaf(leaf) {
  leaf.classList.remove('turning');
  leaf.style.opacity = '';
  curl.clear(leaf);
}

/** Render cur/next/prev from the text anchor. Used on open, jumps and relayouts. */
function renderAll() {
  if (anim) anim.finish();
  resetLeaf(leaves.cur);
  ensureGeom();
  const ref = refForAnchor(anchor);
  fill(leaves.cur, ref);
  fill(leaves.next, nextRef(ref));
  fill(leaves.prev, prevRef(ref));
  resetLeaf(leaves.next);
  resetLeaf(leaves.prev);
  setRoles();
  updateUI();
}

function relayout() {
  geom = null;
  renderAll();
}

function relayoutIfNeeded() {
  if (!book) return;
  const g = measureGeom();
  if (geom && g.key === geom.key) return;
  metrics.invalidatePage();
  relayout();
}

function jumpTo(a) {
  metrics.discardPage();
  anchor = a;
  renderAll();
  pageShown();
}

/** A page is now fully visible: remember the position and start its timer. */
function pageShown() {
  const ref = leaves.cur.ref;
  if (!ref) return;
  if (ref.end) {
    savePosition(entry.id, { chapterIdx: anchor.ci, paraIdx: anchor.pi, wordIdx: anchor.wi, pct: 100 });
    metrics.discardPage();
    updateUI();
    return;
  }
  const page = pageOf(ref);
  anchor = { ci: ref.ci, pi: page.anchor.pi, wi: page.anchor.wi };
  const ch = book.chapters[ref.ci];
  savePosition(entry.id, {
    chapterIdx: anchor.ci, paraIdx: anchor.pi, wordIdx: anchor.wi, pct: progressPct(ref),
    chapter: [ch.number, ch.title].filter(Boolean).join(' · '),
  });
  metrics.startPage({
    key: `${book.id}|${ref.ci}|${page.anchor.pi}|${page.anchor.wi}`,
    bookId: book.id, chapterIdx: ref.ci, words: page.words,
  });
  updateUI();
}

/** Percent of the book read once this page is finished. */
function progressPct(ref) {
  if (ref.end) return 100;
  const page = pageOf(ref);
  const ch = book.chapters[ref.ci];
  const done = ch.bookStart + (ch.paraStart[page.anchor.pi] || 0) + page.anchor.wi + page.words;
  return Math.min(100, Math.round((done / Math.max(1, book.totalWords)) * 1000) / 10);
}

function updateUI() {
  if (!book || !leaves.cur.ref) return;
  const ref = leaves.cur.ref;
  if (ref.end) {
    els.label.textContent = '';
    els.chapter.textContent = 'The End';
    els.page.textContent = 'Finished';
    els.left.textContent = '';
    setScrub(1, 1, true);
    return;
  }
  const ch = book.chapters[ref.ci];
  els.label.textContent = chapterLabel(book, ref.ci);
  els.chapter.textContent = ch.title || '';
  const n = getLayout(ref.ci).pages.length;
  setScrub(ref.pi + 1, n, n < 2);
  scrubPreview(ref.pi);
}

function setScrub(value, max, disabled) {
  els.scrub.max = String(max);
  els.scrub.value = String(value);
  els.scrub.disabled = disabled;
}

/** Bottom-bar text and slider fill for page index i of the current chapter. */
function scrubPreview(i) {
  const ref = leaves.cur.ref;
  if (!ref || ref.end) return;
  const n = getLayout(ref.ci).pages.length;
  const left = n - 1 - i;
  const unit = unitOf(book);
  els.page.textContent = `Page ${i + 1} of ${n}`;
  els.left.textContent = left === 0 ? `Last page in ${unit}` : `${left} page${left === 1 ? '' : 's'} left in ${unit}`;
  els.scrub.style.setProperty('--pct', (n > 1 ? (i / (n - 1)) * 100 : 100) + '%');
  els.scrub.setAttribute('aria-valuetext', `Page ${i + 1} of ${n}`);
}

/* ------------------------------------------------------------ page turn */

// A turn is a curl (curl.js): a grab height plus `u`, how far the held point
// on the right edge has travelled toward the spine (0 = flat, 2w = folded
// over to the left) and `vy`, its vertical offset. Forward turns fold cur
// (u: 0 -> 2w); backward turns unfold prev (u: 2w -> 0).

function runAnim(from, to, dur, ease, frame, done) {
  const a = { done: false, raf: 0 };
  const t0 = performance.now();
  a.finish = () => {
    if (a.done) return;
    a.done = true;
    cancelAnimationFrame(a.raf);
    if (anim === a) anim = null;
    frame(to);
    done();
  };
  const step = (now) => {
    if (a.done) return;
    const t = Math.min(1, (now - t0) / Math.max(1, dur));
    frame(from + (to - from) * ease(t));
    if (t >= 1) a.finish(); else a.raf = requestAnimationFrame(step);
  };
  anim = a;
  frame(from);
  a.raf = requestAnimationFrame(step);
}

/**
 * Ease from 0 to 1 that starts with slope m0 (so a released page keeps the
 * finger's speed) and comes to rest smoothly. m0 = 3 is an ease-out cubic,
 * m0 = 0 a smoothstep.
 */
const hermite = (m0) => (t) => m0 * (t * t * t - 2 * t * t + t) + (3 * t * t - 2 * t * t * t);

/** Animate a curl from state `from` to `to` ({u, vy}); v0 = speed of u in px/ms. */
function animateCurl(turn, under, grab, from, to, dur, v0, done) {
  const du = to.u - from.u;
  const m0 = Math.abs(du) > 1 ? clamp((v0 * dur) / du, 0.8, 3) : 1;
  runAnim(0, 1, dur, hermite(m0), (t) => {
    curl.pose(turn, under, grab, from.u + du * t, from.vy + (to.vy - from.vy) * t);
  }, done);
}

const tapGrab = () => curl.makeGrab(geom.stageW, geom.stageH, null);

function settle(dir) {
  const { prev, cur, next } = leaves;
  leaves = dir === 'fwd' ? { prev: cur, cur: next, next: prev } : { prev: next, cur: prev, next: cur };
  resetLeaf(leaves.prev);
  resetLeaf(leaves.cur);
  resetLeaf(leaves.next);
  setRoles();
  if (dir === 'fwd') fill(leaves.next, nextRef(leaves.cur.ref));
  else fill(leaves.prev, prevRef(leaves.cur.ref));
  pageShown();
}

function canForward() { return !!(leaves.next.ref); }
function canBackward() { return !!(leaves.prev.ref); }

/** Forward turn. `st` ({grab, u, vy}) lets a drag hand over mid-turn. */
function turnForward(st = null, v0 = 0) {
  if (anim) anim.finish();
  if (!canForward()) { nudge(); return; }
  metrics.finishPageForward();
  const turn = leaves.cur;
  const under = leaves.next;
  if (reducedMotion()) {
    resetLeaf(turn);
    runAnim(1, 0, 200, (t) => t, (o) => { turn.style.opacity = String(o); }, () => settle('fwd'));
    return;
  }
  const w = geom.stageW;
  const s = st || { grab: tapGrab(), u: 0, vy: 0 };
  if (!st) curl.begin(turn);
  turn.classList.add('turning');
  const dur = 170 + (TURN_MS - 170) * ((2 * w - s.u) / (2 * w));
  animateCurl(turn, under, s.grab, s, { u: 2 * w, vy: 0 }, dur, v0, () => settle('fwd'));
}

function turnBackward(st = null, v0 = 0) {
  if (anim) anim.finish();
  if (!canBackward()) { nudge(); return; }
  metrics.discardPage();
  const turn = leaves.prev;
  const under = leaves.cur;
  if (reducedMotion()) {
    resetLeaf(turn);
    turn.classList.add('turning');
    runAnim(0, 1, 200, (t) => t, (o) => { turn.style.opacity = String(o); }, () => settle('back'));
    return;
  }
  const w = geom.stageW;
  const s = st || { grab: tapGrab(), u: 2 * w, vy: 0 };
  if (!st) { curl.begin(turn); curl.pose(turn, under, s.grab, s.u, s.vy); }
  turn.classList.add('turning');
  const dur = 170 + (TURN_MS - 170) * (s.u / (2 * w));
  animateCurl(turn, under, s.grab, s, { u: 0, vy: 0 }, dur, -v0, () => settle('back'));
}

/** Small lift-and-drop of the corner when there is no page to turn to. */
function nudge() {
  if (reducedMotion()) return;
  const leaf = leaves.cur;
  const under = leaves.next;
  if (!leaf.ref) return;
  const grab = tapGrab();
  const lift = geom.stageW * 0.09;
  curl.begin(leaf);
  runAnim(0, 1, 320, (t) => t, (t) => {
    curl.pose(leaf, under, grab, Math.sin(t * Math.PI) * lift, 0);
  }, () => { resetLeaf(leaf); curl.clearUnder(under); });
}

/* ------------------------------------------------------------ input */

function onDown(e) {
  if (!e.isPrimary || sheetOpen) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const r = els.stage.getBoundingClientRect();
  gesture = {
    id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), mode: null,
    top: r.top, left: r.left, st: null, raf: 0, samples: [[e.clientX, performance.now()]],
  };
  try { els.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
}

function onMove(e) {
  const g = gesture;
  if (!g || e.pointerId !== g.id) return;
  const dx = e.clientX - g.x0;
  const dy = e.clientY - g.y0;
  g.samples.push([e.clientX, performance.now()]);
  if (g.samples.length > 6) g.samples.shift();
  if (!g.mode) {
    // Mostly sideways (diagonal pulls from a corner count) starts a turn.
    if (Math.abs(dx) < 10 || Math.abs(dx) < 0.6 * Math.abs(dy)) return;
    if (anim) anim.finish();
    if (uiOpen) showUI(false);
    if (dx < 0 && canForward()) g.mode = 'fwd';
    else if (dx > 0 && canBackward()) g.mode = 'back';
    else g.mode = 'none';
    if (reducedMotion() && g.mode !== 'none') g.mode = 'rm-' + g.mode;
    if (g.mode === 'fwd' || g.mode === 'back') {
      // The grab height picks which corner peels (see curl.js).
      const grab = curl.makeGrab(geom.stageW, geom.stageH, g.y0 - g.top);
      const turn = g.mode === 'fwd' ? leaves.cur : leaves.prev;
      curl.begin(turn);
      g.st = { grab, u: 0, vy: 0 };
      g.turn = turn;
      g.under = g.mode === 'fwd' ? leaves.next : leaves.cur;
    }
  }
  if (!g.st) return;
  const w = geom.stageW;
  // Forward: the held corner follows the finger. Backward: the fold (the
  // edge of the returning page) stays under the finger.
  g.st.u = g.mode === 'fwd' ? clamp(-dx, 0, 2 * w) : clamp(2 * w - 2 * dx, 0, 2 * w);
  g.st.vy = dy;
  if (!g.raf) {
    g.raf = requestAnimationFrame(() => {
      g.raf = 0;
      if (gesture !== g) return;
      curl.pose(g.turn, g.under, g.st.grab, g.st.u, g.st.vy);
      g.turn.classList.add('turning');
    });
  }
}

function velocity(g) {
  const s = g.samples;
  if (s.length < 2) return 0;
  const [x1, t1] = s[0];
  const [x2, t2] = s[s.length - 1];
  return (x2 - x1) / Math.max(1, t2 - t1); // px per ms; negative = leftward
}

function onUp(e) {
  const g = gesture;
  if (!g || e.pointerId !== g.id) return;
  gesture = null;
  if (g.raf) cancelAnimationFrame(g.raf);
  const dx = e.clientX - g.x0;
  const dy = e.clientY - g.y0;
  const v = velocity(g);
  const w = geom ? geom.stageW : 1;
  if (g.mode === 'fwd') {
    // Same thresholds as the old rotating turn: past ~53% of the width
    // (62 degrees), or a leftward flick.
    const go = g.st.u > 0.53 * w || (v < -0.3 && g.st.u > 0.01 * w);
    if (go) turnForward(g.st, -v);
    else snapBack(g, -v);
    return;
  }
  if (g.mode === 'back') {
    const edge = (2 * w - g.st.u) / 2; // where the returning page's edge is
    const go = edge > 0.47 * w || (v > 0.3 && edge > 0.07 * w);
    if (go) turnBackward(g.st, 2 * v);
    else snapBack(g, -2 * v);
    return;
  }
  if (g.mode === 'rm-fwd') { if (dx < -40) turnForward(); return; }
  if (g.mode === 'rm-back') { if (dx > 40) turnBackward(); return; }
  if (g.mode === 'none') return;
  // A tap.
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && performance.now() - g.t0 < 700) onTap(e.clientX - g.left, e.clientY - g.top, e.clientX, e.clientY);
}

function onCancel(e) {
  const g = gesture;
  if (!g || e.pointerId !== g.id) return;
  gesture = null;
  if (g.raf) cancelAnimationFrame(g.raf);
  if (g.mode === 'fwd' || g.mode === 'back') snapBack(g, 0);
}

/** Let go without turning: the page settles back where it was. Records nothing. */
function snapBack(g, v0) {
  const w = geom.stageW;
  const { turn, under, st } = g;
  const to = { u: g.mode === 'fwd' ? 0 : 2 * w, vy: 0 };
  const dur = 160 + 280 * (Math.abs(to.u - st.u) / (2 * w));
  turn.classList.add('turning');
  animateCurl(turn, under, st.grab, st, to, dur, v0, () => {
    resetLeaf(turn); curl.clearUnder(under);
  });
}

/**
 * Taps. A band across the top of the page (where the top bar appears) and
 * the middle 40% below it open the menus; the outer sides turn pages. While
 * the menus are open any tap on the page just closes them.
 */
function onTap(x, y, cx, cy) {
  const hit = document.elementFromPoint(cx, cy);
  if (hit && hit.closest('[data-end="library"]')) { exitHandler(); return; }
  if (uiOpen) { showUI(false); return; }
  const w = els.stage.clientWidth;
  const h = els.stage.clientHeight;
  // Safe-area top = where the reading column starts, minus its 30px margin.
  const safeTop = Math.max(0, leaves.cur.pageEl.getBoundingClientRect().top - els.stage.getBoundingClientRect().top - 30);
  const topBand = safeTop + Math.max(88, h * 0.12);
  if (y < topBand) showUI(true);
  else if (x > w * 0.7) turnForward();
  else if (x < w * 0.3) turnBackward();
  else showUI(true);
}

/* ------------------------------------------------------------ chrome */

function showUI(show) {
  uiOpen = show;
  if (els) els.ui.classList.toggle('show', show);
  if (show) updateUI();
  syncPause();
}

function syncPause() {
  if (uiOpen || sheetOpen) metrics.pause('ui'); else metrics.resume('ui');
}

function openSheet(name) {
  sheetOpen = name;
  if (name === 'contents') { renderToc(); els.contents.hidden = false; }
  else { renderSettings(); els.settings.hidden = false; }
  syncPause();
  if (name === 'contents') {
    const cur = els.toc.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }
}

function closeSheet() {
  if (!els) return;
  sheetOpen = null;
  els.contents.hidden = true;
  els.settings.hidden = true;
  syncPause();
}

function renderToc() {
  const curRef = leaves.cur.ref && !leaves.cur.ref.end ? leaves.cur.ref : null;
  const n = book.chapters.length;
  const unit = unitOf(book);
  const count = `${n} ${unit === 'story' ? (n === 1 ? 'story' : 'stories') : unit + (n === 1 ? '' : 's')}`;
  els.tocSub.innerHTML = `${esc(entry.title)} <span style="white-space:nowrap">· ${count}</span>`;
  let html = '';
  let part = null;
  book.chapters.forEach((ch, ci) => {
    if (ch.part && ch.part !== part) html += `<li class="part">${esc(ch.part)}</li>`;
    part = ch.part;
    const cur = curRef && curRef.ci === ci;
    // How far into the current chapter, by pages.
    const pill = cur ? `<span class="pill">${Math.round((curRef.pi / Math.max(1, getLayout(ci).pages.length)) * 100)}%</span>` : '';
    html += `<li><button type="button" data-ci="${ci}" class="${cur ? 'current' : ''}"${cur ? ' aria-current="true"' : ''}>` +
      `<span class="n">${esc(ch.number || ci + 1)}</span><span class="tt">${esc(ch.title || 'Chapter ' + (ci + 1))}</span>${pill}</button></li>`;
  });
  els.toc.innerHTML = html;
}

function stylePreview(id, punct) {
  const l1 = 'The ox plows one furrow,';
  const l2 = 'turns, then comes back';
  const l3 = 'and plows the next one';
  const t2 = id === 'words' ? l2.split(' ').reverse().map((w) => (punct ? flipPunctuation(w) : w)).join(' ') : l2;
  const rev = id === 'normal' ? '' : ' rev';
  return `<div class="preview text style-${id}" aria-hidden="true">` +
    `<div class="ln">${l1}</div><div class="ln${rev}">${t2}</div><div class="ln">${l3}</div></div>`;
}

const LINE_ICONS = {
  1.3: 'M2 5h14M2 9h14M2 13h14',
  1.5: 'M2 3.5h14M2 9h14M2 14.5h14',
  1.75: 'M2 2h14M2 9h14M2 16h14',
};

function sizeSteps(idx) {
  return SIZES.map((_, i) => `<span class="${i < idx ? 'on' : i === idx ? 'cur' : ''}"></span>`).join('');
}

function renderSettings() {
  const s = getSettings();
  const sizeIdx = SIZES.indexOf(s.fontSize);
  els.settingsBody.innerHTML =
    '<section class="set-group"><h3 class="set-label">Flip style</h3><div class="style-opts">' +
    STYLES.map((st) => `<button type="button" class="style-opt" data-style="${st.id}" aria-pressed="${st.id === s.style}">` +
      `<span class="name">${st.label}</span>${stylePreview(st.id, s.punct)}</button>`).join('') +
    '</div>' + punctToggle(s) + '</section>' +
    '<section class="set-group"><div class="set-row"><h3 class="set-label">Text size</h3>' +
    `<span class="set-val" id="size-val">${s.fontSize} pt</span></div><div class="size-row">` +
    `<button type="button" class="small" data-size="-1" aria-label="Smaller text" ${sizeIdx <= 0 ? 'disabled' : ''}>A</button>` +
    `<div class="steps"><div class="steps-vis" id="size-steps">${sizeSteps(sizeIdx)}</div>` +
    `<input type="range" min="0" max="${SIZES.length - 1}" step="1" value="${sizeIdx}" data-size-range aria-label="Text size" aria-valuetext="${s.fontSize} pt"></div>` +
    `<button type="button" class="big" data-size="1" aria-label="Larger text" ${sizeIdx >= SIZES.length - 1 ? 'disabled' : ''}>A</button>` +
    '</div></section>' +
    '<section class="set-group"><h3 class="set-label">Line spacing</h3><div class="seg" role="group" aria-label="Line spacing">' +
    SPACINGS.map((sp) => `<button type="button" data-spacing="${sp.value}" aria-pressed="${sp.value === s.spacing}">` +
      `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="${LINE_ICONS[sp.value]}"/></svg>${sp.label}</button>`).join('') +
    '</div></section>' +
    '<section class="set-group"><h3 class="set-label">Font</h3><div class="font-opts">' +
    FONTS.map((f) => `<button type="button" class="font-opt" data-font="${f.id}" aria-pressed="${f.id === s.font}">` +
      `<span class="aa" style="font-family:${esc(f.stack)}" aria-hidden="true">Aa</span><span class="name">${esc(f.label)}</span></button>`).join('') +
    '</div></section>' +
    '<section class="set-group"><h3 class="set-label">Theme</h3><div class="theme-opts">' +
    THEMES.map((t) => `<button type="button" class="theme-${t.id}" data-theme="${t.id}" aria-pressed="${t.id === s.theme}">${t.label}</button>`).join('') +
    '</div></section>';
}

/** On/off switch for punctuation flipping; only live under Reversed words. */
function punctToggle(s) {
  const live = s.style === 'words';
  return `<button type="button" class="toggle-row" role="switch" data-punct="1" aria-checked="${s.punct}" ${live ? '' : 'disabled'}>` +
    '<span class="toggle-text"><span class="toggle-name">Flip punctuation</span>' +
    `<span class="toggle-note">${live ? 'Commas and periods face right to left' : 'Only used with Reversed words'}</span></span>` +
    '<span class="switch" aria-hidden="true"></span></button>';
}

/** Text size slider: dragging moves the dots, letting go applies the size. */
function onSettingsInput(e) {
  const r = e.target.closest('[data-size-range]');
  if (!r) return;
  const i = clamp(+r.value, 0, SIZES.length - 1);
  if (e.type === 'input') {
    $('size-steps').innerHTML = sizeSteps(i);
    $('size-val').textContent = SIZES[i] + ' pt';
  } else if (SIZES[i] !== getSettings().fontSize) {
    updateSettings({ fontSize: SIZES[i] });
  }
}

function onSettingsClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const s = getSettings();
  if (b.dataset.style) updateSettings({ style: b.dataset.style });
  else if (b.dataset.punct) updateSettings({ punct: !s.punct });
  else if (b.dataset.size) {
    const i = clamp(SIZES.indexOf(s.fontSize) + Number(b.dataset.size), 0, SIZES.length - 1);
    updateSettings({ fontSize: SIZES[i] });
  } else if (b.dataset.spacing) updateSettings({ spacing: Number(b.dataset.spacing) });
  else if (b.dataset.font) {
    // Load the face first so the page never shows a moment of fallback text
    // squeezed into lines measured for another font.
    const id = b.dataset.font;
    pendingFont = id;
    fontReady(id, s.fontSize).then(() => { if (pendingFont === id) updateSettings({ font: id }); });
  } else if (b.dataset.theme) updateSettings({ theme: b.dataset.theme });
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// For automated checks / debugging in the console.
export const _debug = {
  state: () => ({ anchor, cur: leaves && leaves.cur.ref, geom, uiOpen, sheetOpen }),
  next: () => turnForward(),
  prev: () => turnBackward(),
  jump: (ci, pi = 0, wi = 0) => jumpTo({ ci, pi, wi }),
  headingHTML,
};

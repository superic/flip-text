// The reader: full-screen pages, paper page-turn animation, tap/swipe input,
// overlay chrome, contents and settings sheets.
//
// Three pre-rendered "leaves" are kept at all times: prev (rotated -180deg,
// off to the left and hidden), cur (on top) and next (underneath). A forward
// turn rotates cur around its left edge from 0 to -180deg, revealing next; a
// backward turn swings prev back in from -180deg to 0. When a turn settles the
// leaves just swap roles and only one leaf has to be re-rendered.
import { layoutChapter, pageHTML, pageIndexFor, headingHTML } from './layout.js';
import { loadBook, getPosition, savePosition } from './books.js';
import {
  getSettings, updateSettings, onSettingsChange, lineHeightPx,
  STYLES, SIZES, SPACINGS, THEMES,
} from './settings.js';
import * as metrics from './metrics.js';

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

const TURN_MS = 450; // duration of a full visible sweep (0 to 90 degrees)
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------ setup */

function init() {
  if (els) return;
  els = {
    reader: $('reader'), stage: $('stage'), ui: $('reader-ui'), measure: $('measure'),
    title: $('ui-title'), chapter: $('ui-chapter'), progress: $('ui-progress'), fill: $('ui-fill'),
    contents: $('contents-sheet'), toc: $('toc'), settings: $('settings-sheet'), settingsBody: $('settings-body'),
  };
  const mk = () => {
    const leaf = document.createElement('div');
    leaf.className = 'leaf';
    leaf.innerHTML =
      '<div class="face front"><div class="page text"></div>' +
      '<div class="fx fx-dim"></div><div class="fx fx-cast"></div><div class="fx fx-shade"></div></div>' +
      '<div class="face back"></div>';
    leaf.pageEl = leaf.querySelector('.page');
    leaf.front = leaf.querySelector('.front');
    leaf.back = leaf.querySelector('.back');
    leaf.dim = leaf.querySelector('.fx-dim');
    leaf.cast = leaf.querySelector('.fx-cast');
    leaf.shade = leaf.querySelector('.fx-shade');
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

  document.addEventListener('keydown', (e) => {
    if (!active || sheetOpen) { if (e.key === 'Escape' && sheetOpen) closeSheet(); return; }
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turnForward(); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); turnBackward(); }
    else if (e.key === 'Escape') showUI(!uiOpen);
  });

  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (active) relayoutIfNeeded(); }, 180); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  onSettingsChange((s, prev) => {
    if (!active || !book) return;
    if (s.fontSize !== prev.fontSize || s.spacing !== prev.spacing) {
      metrics.invalidatePage();
      relayout();
    } else if (s.style !== prev.style) {
      metrics.invalidatePage();
      for (const l of Object.values(leaves)) fill(l, l.ref);
    }
    if (sheetOpen === 'settings') renderSettings();
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
  els.title.textContent = entry.title;
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
    key: `${Math.floor(r.width)}x${Math.floor(r.height)}:${getSettings().fontSize}:${lineHeightPx()}`,
  };
}

function ensureGeom() {
  const g = measureGeom();
  if (!geom || g.key !== geom.key) { layouts = new Map(); }
  geom = g;
  els.stage.style.perspective = Math.round(Math.max(1200, g.stageW * 2.6)) + 'px';
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
  const style = getSettings().style;
  leaf.pageEl.className = 'page text style-' + style;
  if (!ref) { leaf.pageEl.innerHTML = ''; return; }
  if (ref.end) {
    leaf.pageEl.innerHTML =
      `<div class="end-page"><div class="fin">The End</div><p>You have finished<br><em>${esc(book.title)}</em>.</p>` +
      '<button type="button" class="btn btn-primary" data-end="library">Back to Library</button></div>';
    return;
  }
  leaf.pageEl.innerHTML = pageHTML(book, getLayout(ref.ci), pageOf(ref), style);
}

function resetLeaf(leaf, angle) {
  leaf.classList.remove('turning');
  leaf.style.transform = angle ? 'rotateY(-180deg)' : '';
  leaf.style.opacity = '';
  leaf.front.style.opacity = '';
  leaf.back.style.opacity = '';
  for (const fx of [leaf.dim, leaf.cast, leaf.shade]) { fx.style.opacity = ''; fx.style.transform = ''; }
}

/** Render cur/next/prev from the text anchor. Used on open, jumps and relayouts. */
function renderAll() {
  if (anim) anim.finish();
  resetLeaf(leaves.cur, 0);
  ensureGeom();
  const ref = refForAnchor(anchor);
  fill(leaves.cur, ref);
  fill(leaves.next, nextRef(ref));
  fill(leaves.prev, prevRef(ref));
  resetLeaf(leaves.next, 0);
  resetLeaf(leaves.prev, 180);
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
  savePosition(entry.id, { chapterIdx: anchor.ci, paraIdx: anchor.pi, wordIdx: anchor.wi, pct: progressPct(ref) });
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
    els.chapter.textContent = 'The End';
    els.progress.textContent = '100% · finished';
    els.fill.style.width = '100%';
    return;
  }
  const ch = book.chapters[ref.ci];
  els.chapter.textContent = [ch.number, ch.title].filter(Boolean).join('. ');
  const left = getLayout(ref.ci).pages.length - 1 - ref.pi;
  const pct = progressPct(ref);
  const leftTxt = left === 0 ? 'last page in chapter' : left === 1 ? '1 page left in chapter' : `${left} pages left in chapter`;
  els.progress.textContent = `${Math.floor(pct)}% · ${leftTxt}`;
  els.fill.style.width = pct + '%';
}

/* ------------------------------------------------------------ page turn */

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

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
 * Timing for a turn from angle `from` to `to`. Past 90 degrees the page is
 * edge-on and off to the left, i.e. invisible on a one-page screen, so that
 * stretch is passed through quickly and the eased time is spent on the
 * visible 0-90 degree part.
 */
function turnPlan(from, to, E) {
  const total = Math.abs(to - from);
  if (total < 0.5) return { dur: 1, ease: (t) => t };
  const hiddenA = Math.max(0, Math.max(from, to) - Math.max(90, Math.min(from, to)));
  const visA = total - hiddenA;
  const visDur = Math.max(140, (TURN_MS * visA) / 90);
  if (!hiddenA) return { dur: visDur, ease: E };
  const hidDur = 70;
  const dur = visDur + hidDur;
  const s = hidDur / dur;
  const a = hiddenA / total;
  if (to > from) { // turning away: visible part first, then the hidden part
    return { dur, ease: (t) => (t < 1 - s ? (1 - a) * E(t / (1 - s)) : 1 - a + a * ((t - (1 - s)) / s)) };
  }
  // coming back: hidden part first, then the visible part
  return { dur, ease: (t) => (t < s ? a * (t / s) : a + (1 - a) * E((t - s) / (1 - s))) };
}

/** Screen x of the turning page's free edge, after perspective projection. */
function projectedEdge(theta) {
  const w = geom.stageW;
  const P = parseFloat(els.stage.style.perspective) || 1600;
  const rad = (theta * Math.PI) / 180;
  const x = w * Math.cos(rad);
  const z = w * Math.sin(rad);
  const ox = w / 2;
  const px = ox + (x - ox) * (P / Math.max(1, P - z));
  return clamp(px, 0, w);
}

/**
 * Pose a turn. theta = how far the page has turned (0 = flat on the right,
 * 180 = fully over to the left). Only transform/opacity are touched.
 */
function setTurn(turnLeaf, underLeaf, theta) {
  turnLeaf.style.transform = `rotateY(${-theta}deg)`;
  const front = theta < 90;
  turnLeaf.front.style.opacity = front ? '1' : '0';
  turnLeaf.back.style.opacity = front ? '0' : '1';
  const p = Math.min(1, theta / 90);
  // Shading band sweeps across the lifting page and deepens as it tilts.
  turnLeaf.shade.style.opacity = String(Math.min(1, p * 1.4));
  turnLeaf.shade.style.transform = `translateX(${-p * 60}%)`;
  // Shadow cast onto the page below, just beyond the turning edge.
  const edge = projectedEdge(theta);
  underLeaf.cast.style.transform = `translateX(${edge}px)`;
  underLeaf.cast.style.opacity = String(theta <= 90 ? Math.min(1, theta / 10) : Math.max(0, 1 - (theta - 90) / 35));
  underLeaf.dim.style.opacity = String(0.16 * Math.max(0, 1 - theta / 110));
}

function clearUnderFx(leaf) {
  for (const fx of [leaf.dim, leaf.cast]) { fx.style.opacity = ''; fx.style.transform = ''; }
}

function settle(dir) {
  const { prev, cur, next } = leaves;
  leaves = dir === 'fwd' ? { prev: cur, cur: next, next: prev } : { prev: next, cur: prev, next: cur };
  resetLeaf(leaves.prev, 180);
  resetLeaf(leaves.cur, 0);
  resetLeaf(leaves.next, 0);
  setRoles();
  if (dir === 'fwd') fill(leaves.next, nextRef(leaves.cur.ref));
  else fill(leaves.prev, prevRef(leaves.cur.ref));
  pageShown();
}

function canForward() { return !!(leaves.next.ref); }
function canBackward() { return !!(leaves.prev.ref); }

/** Forward turn. `from` lets a drag hand over mid-turn. */
function turnForward(from = 0, ease = easeInOut) {
  if (anim) anim.finish();
  if (!canForward()) { nudge(); return; }
  metrics.finishPageForward();
  const turn = leaves.cur;
  const under = leaves.next;
  if (reducedMotion()) {
    runAnim(1, 0, 200, (t) => t, (o) => { turn.style.opacity = String(o); }, () => settle('fwd'));
    return;
  }
  turn.classList.add('turning');
  const plan = turnPlan(from, 180, ease);
  runAnim(from, 180, plan.dur, plan.ease, (th) => setTurn(turn, under, th), () => settle('fwd'));
}

function turnBackward(from = 180, ease = easeInOut) {
  if (anim) anim.finish();
  if (!canBackward()) { nudge(); return; }
  metrics.discardPage();
  const turn = leaves.prev;
  const under = leaves.cur;
  turn.classList.add('turning');
  if (reducedMotion()) {
    turn.style.transform = '';
    runAnim(0, 1, 200, (t) => t, (o) => { turn.style.opacity = String(o); }, () => settle('back'));
    return;
  }
  const plan = turnPlan(from, 0, ease);
  runAnim(from, 0, plan.dur, plan.ease, (th) => setTurn(turn, under, th), () => settle('back'));
}

/** Small lift-and-drop when there is no page to turn to. */
function nudge() {
  if (reducedMotion()) return;
  const leaf = leaves.cur;
  if (!leaf.ref) return;
  runAnim(0, 1, 260, (t) => t, (t) => {
    leaf.style.transform = `rotateY(${-Math.sin(t * Math.PI) * 5}deg)`;
  }, () => resetLeaf(leaf, 0));
}

/* ------------------------------------------------------------ input */

function onDown(e) {
  if (!e.isPrimary || sheetOpen) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), mode: null, theta: 0, samples: [[e.clientX, performance.now()]] };
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
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
    if (anim) anim.finish();
    if (uiOpen) showUI(false);
    if (dx < 0 && canForward()) g.mode = 'fwd';
    else if (dx > 0 && canBackward()) g.mode = 'back';
    else g.mode = 'none';
    if (reducedMotion() && g.mode !== 'none') g.mode = 'rm-' + g.mode;
    if (g.mode === 'fwd') leaves.cur.classList.add('turning');
    if (g.mode === 'back') { leaves.prev.classList.add('turning'); }
  }
  // Rotation follows the finger: the page's free edge tracks the drag
  // distance (edge at screen-width minus the distance dragged).
  const w = geom.stageW;
  const follow = (d) => (Math.acos(clamp(1 - d / w, -1, 1)) * 180) / Math.PI;
  if (g.mode === 'fwd') {
    g.theta = clamp(follow(-dx), 0, 180);
    setTurn(leaves.cur, leaves.next, g.theta);
  } else if (g.mode === 'back') {
    // The previous page swings in from the left: its edge sits at the finger.
    g.theta = (Math.acos(clamp(dx / w, 0, 1)) * 180) / Math.PI;
    setTurn(leaves.prev, leaves.cur, g.theta);
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
  const dx = e.clientX - g.x0;
  const dy = e.clientY - g.y0;
  const v = velocity(g);
  if (g.mode === 'fwd') {
    const go = g.theta > 62 || (v < -0.3 && g.theta > 8);
    if (go) turnForward(g.theta, easeOut);
    else snapBack('fwd', g.theta);
    return;
  }
  if (g.mode === 'back') {
    const go = g.theta < 62 || (v > 0.3 && g.theta < 86);
    if (go) turnBackward(g.theta, easeOut);
    else snapBack('back', g.theta);
    return;
  }
  if (g.mode === 'rm-fwd') { if (dx < -40) turnForward(); return; }
  if (g.mode === 'rm-back') { if (dx > 40) turnBackward(); return; }
  if (g.mode === 'none') return;
  // A tap.
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && performance.now() - g.t0 < 700) onTap(e.clientX, e.clientY);
}

function onCancel(e) {
  const g = gesture;
  if (!g || e.pointerId !== g.id) return;
  gesture = null;
  if (g.mode === 'fwd' || g.mode === 'back') snapBack(g.mode, g.theta);
}

function snapBack(mode, theta) {
  if (mode === 'fwd') {
    const turn = leaves.cur;
    const under = leaves.next;
    const plan = turnPlan(theta, 0, easeOut);
    runAnim(theta, 0, plan.dur, plan.ease, (th) => setTurn(turn, under, th), () => {
      resetLeaf(turn, 0); clearUnderFx(under);
    });
  } else {
    const turn = leaves.prev;
    const under = leaves.cur;
    const plan = turnPlan(theta, 180, easeOut);
    runAnim(theta, 180, plan.dur, plan.ease, (th) => setTurn(turn, under, th), () => {
      resetLeaf(turn, 180); clearUnderFx(under);
    });
  }
}

function onTap(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (hit && hit.closest('[data-end="library"]')) { exitHandler(); return; }
  if (uiOpen) { showUI(false); return; }
  const w = els.stage.clientWidth;
  if (x > (w * 2) / 3) turnForward();
  else if (x < w / 3) turnBackward();
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
  const curCi = leaves.cur.ref && !leaves.cur.ref.end ? leaves.cur.ref.ci : -1;
  let html = '';
  let part = null;
  book.chapters.forEach((ch, ci) => {
    if (ch.part && ch.part !== part) html += `<li class="part">${esc(ch.part)}</li>`;
    part = ch.part;
    html += `<li><button type="button" data-ci="${ci}" class="${ci === curCi ? 'current' : ''}">` +
      `<span class="n">${esc(ch.number || ci + 1)}</span><span>${esc(ch.title || 'Chapter ' + (ci + 1))}</span></button></li>`;
  });
  els.toc.innerHTML = html;
}

function stylePreview(id) {
  const a = ['The ox plows one', 'furrow, then turns'];
  const b = ['and plows the next', 'one back again.'];
  const l2 = id === 'words' ? a[1].split(' ').reverse().join(' ') : a[1];
  const l4 = id === 'words' ? b[1].split(' ').reverse().join(' ') : b[1];
  const rev = id === 'normal' ? '' : ' rev';
  return `<div class="preview text style-${id}">` +
    `<div class="ln">${a[0]}</div><div class="ln${rev}">${l2}</div>` +
    `<div class="ln">${b[0]}</div><div class="ln last${rev}">${l4}</div></div>`;
}

function renderSettings() {
  const s = getSettings();
  const sizeIdx = SIZES.indexOf(s.fontSize);
  els.settingsBody.innerHTML =
    '<div class="set-group"><div class="set-label">Flip style</div><div class="style-opts">' +
    STYLES.map((st) => `<button type="button" class="style-opt" data-style="${st.id}" aria-pressed="${st.id === s.style}">` +
      `<div class="name">${st.label}</div>${stylePreview(st.id)}</button>`).join('') +
    '</div></div>' +
    '<div class="set-group"><div class="set-label">Text size</div><div class="size-row">' +
    `<button type="button" class="small" data-size="-1" aria-label="Smaller text" ${sizeIdx <= 0 ? 'disabled' : ''}>A−</button>` +
    `<div class="val">${s.fontSize} pt</div>` +
    `<button type="button" class="big" data-size="1" aria-label="Larger text" ${sizeIdx >= SIZES.length - 1 ? 'disabled' : ''}>A+</button>` +
    '</div></div>' +
    '<div class="set-group"><div class="set-label">Line spacing</div><div class="seg">' +
    SPACINGS.map((sp) => `<button type="button" data-spacing="${sp.value}" aria-pressed="${sp.value === s.spacing}">${sp.label}</button>`).join('') +
    '</div></div>' +
    '<div class="set-group"><div class="set-label">Theme</div><div class="seg">' +
    THEMES.map((t) => `<button type="button" class="theme-${t.id}" data-theme="${t.id}" aria-pressed="${t.id === s.theme}">${t.label}</button>`).join('') +
    '</div></div>';
}

function onSettingsClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const s = getSettings();
  if (b.dataset.style) updateSettings({ style: b.dataset.style });
  else if (b.dataset.size) {
    const i = clamp(SIZES.indexOf(s.fontSize) + Number(b.dataset.size), 0, SIZES.length - 1);
    updateSettings({ fontSize: SIZES[i] });
  } else if (b.dataset.spacing) updateSettings({ spacing: Number(b.dataset.spacing) });
  else if (b.dataset.theme) updateSettings({ theme: b.dataset.theme });
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

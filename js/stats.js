// Reading stats screen + "Send my results".
import { summarize, resetStats, getRecords } from './metrics.js';
import { STYLES, fontOf } from './settings.js';
import { getPosition } from './books.js';
import { toast } from './toast.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtInt = (n) => Math.round(n).toLocaleString();

// Chart/bar colours per flip style (css/app.css): the line colour, and a
// darker or lighter twin for text so labels keep 4.5:1 contrast.
const SERIES = {
  mirrored: { line: 'var(--s-mirrored)', ink: 'var(--accent)' },
  normal: { line: 'var(--s-normal)', ink: 'var(--s-normal-ink)' },
  words: { line: 'var(--s-words)', ink: 'var(--s-words-ink)' },
  upside: { line: 'var(--s-upside)', ink: 'var(--s-upside-ink)' },
};
const seriesOf = (id) => SERIES[id] || SERIES.words;
// Display order: the two compared styles first.
const ORDER = ['mirrored', 'normal', 'words', 'upside'];
const ordered = () => [...STYLES].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} m`;
}
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const BACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';

let bookIndex = [];
let confirming = false;

export function renderStats(index) {
  if (index) bookIndex = index;
  const sum = summarize();
  const body = document.getElementById('stats-body');

  body.innerHTML =
    `<header class="stats-top"><a class="back-round" href="#/" aria-label="Back to Library">${BACK_ICON}</a><h1>Reading stats</h1></header>` +
    headline(sum) +
    '<section class="stat-card chart-card" aria-label="Speed by session"><div class="card-row"><h2>Speed by session</h2><span>words a minute</span></div>' +
    trendChart(sum) + '</section>' +
    styleList(sum) +
    `<div class="totals"><div><span class="v">${fmtDuration(sum.totals.ms)}</span><span class="k">reading</span></div>` +
    `<div><span class="v">${fmtInt(sum.totals.pages)}</span><span class="k">pages</span></div>` +
    `<div><span class="v">${fmtInt(sum.totals.words)}</span><span class="k">words</span></div></div>` +
    '<div class="stats-actions">' +
    `<button type="button" class="btn btn-primary send-btn" id="send-results">${SHARE_ICON}Send my results</button>` +
    '<div id="share-fallback"></div>' +
    '<div id="reset-area"></div></div>';

  renderReset();
  body.querySelector('#send-results').onclick = () => sendResults();
}

/** Latest session that has pages in style `id`: { wpm, i } or null. */
function latest(sum, id) {
  for (let i = sum.sessions.length - 1; i >= 0; i--) {
    const a = sum.sessions[i].styles[id];
    if (a && a.wpm) return { wpm: a.wpm, i };
  }
  return null;
}

/** Mirrored speed relative to normal, in whole percent (negative = slower). */
const relPct = (m, n) => Math.round((m / n - 1) * 100);
const relText = (d) => (d === 0 ? 'about as fast as normal' : `${Math.abs(d)}% ${d < 0 ? 'slower' : 'faster'}`);

/** "Last session" card: Mirrored vs Normal, and one sentence comparing them. */
function headline(sum) {
  const m = latest(sum, 'mirrored');
  const n = latest(sum, 'normal');
  const num = (a, cls) => (a ? `<span class="v ${cls}">${fmtInt(a.wpm)}</span>` : '<span class="v v-none">—</span>');
  let text;
  if (!m && !n) text = 'Read a few pages to see your speed here. A page counts once it has been on screen for a few seconds.';
  else if (!n) text = 'Read a few pages in Normal to compare.';
  else if (!m) text = 'Read a few pages in Mirrored to compare.';
  else {
    const d = relPct(m.wpm, n.wpm);
    const now = d === 0 ? 'about as fast as normal' : `<strong>${relText(d)}</strong> than normal`;
    const both = sum.sessions.filter((s) => s.styles.mirrored && s.styles.normal);
    if (both.length < 2) {
      text = `Mirrored lines are ${now} so far.`;
    } else {
      const d0 = relPct(both[0].styles.mirrored.wpm, both[0].styles.normal.wpm);
      let since;
      if (d0 === d) since = ', the same as in your first session.';
      else if (d !== 0 && d0 !== 0 && Math.sign(d) === Math.sign(d0)) since = `, ${Math.abs(d) < Math.abs(d0) ? 'down' : 'up'} from ${Math.abs(d0)}% in your first session.`;
      else since = `; in your first session they were ${d0 === 0 ? 'about as fast' : relText(d0)}.`;
      text = `Mirrored lines are now ${now}${since}`;
    }
  }
  const label = !m && !n ? 'Your speed' : m && n && m.i !== n.i ? 'Latest sessions' : 'Last session';
  return '<section class="stat-card headline" aria-label="Last session">' +
    `<span class="eyebrow">${label}</span><div class="headline-nums">` +
    `<div><span class="k">Mirrored</span>${num(m, 'v-mirrored')}<span class="u">words a minute</span></div>` +
    `<div><span class="k">Normal</span>${num(n, 'v-normal')}<span class="u">words a minute</span></div></div>` +
    `<p>${text}</p></section>`;
}

/** Every style's overall average, with a bar; "Not tried yet" when empty. */
function styleList(sum) {
  const maxWpm = Math.max(1, ...STYLES.map((s) => sum.byStyle[s.id].wpm || 0));
  return '<section class="stat-card styles-card" aria-label="All styles">' + ordered().map((s) => {
    const a = sum.byStyle[s.id];
    if (!a.pages) return `<div class="style-row"><span class="nm">${s.label}</span><span class="none">Not tried yet</span></div>`;
    return `<div class="style-row" title="${a.pages} page${a.pages === 1 ? '' : 's'} · ${fmtDuration(a.ms)}"><span class="nm">${s.label}</span>` +
      `<div class="bar-t"><div style="width:${(a.wpm / maxWpm) * 100}%;background:${seriesOf(s.id).line}"></div></div>` +
      `<span class="wpm"><strong>${fmtInt(a.wpm)}</strong> wpm</span></div>`;
  }).join('') + '</section>';
}

/** A tidy step for ~2-4 gridlines over [lo, hi]. */
function niceStep(range) {
  for (const s of [5, 10, 20, 25, 50, 100, 200, 250, 500]) if (range / s <= 3) return s;
  return 1000;
}

/**
 * Inline SVG line chart: x = session number, y = session average WPM, one
 * line per style, labelled at its end instead of with a legend.
 */
function trendChart(sum) {
  const sessions = sum.sessions;
  if (!sessions.length) return '<p class="chart-empty">The chart appears after your first reading session.</p>';
  const W = 316, H = 196, L = 32, R = 14, T = 24, B = 26;
  const vals = [];
  sessions.forEach((s) => Object.values(s.styles).forEach((a) => { if (a.wpm) vals.push(a.wpm); }));
  const step = niceStep(Math.max(1, Math.max(...vals) - Math.min(...vals)));
  let lo = Math.floor(Math.min(...vals) / step) * step;
  let hi = Math.ceil(Math.max(...vals) / step) * step;
  if (hi === lo) { lo = Math.max(0, lo - step); hi += step; }
  const n = sessions.length;
  const x = (i) => (n === 1 ? (L + W - R) / 2 : L + 6 + (i * (W - L - R - 6)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));

  const desc = [];
  let svg = '';
  for (let v = lo; v <= hi + 0.01; v += step) {
    svg += `<line class="grid" x1="${L}" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>` +
      `<text class="axis" x="0" y="${(y(v) + 4).toFixed(1)}">${v}</text>`;
  }
  svg += n > 1
    ? `<text class="axis" x="${x(0)}" y="${H - 6}" text-anchor="middle">1</text><text class="axis" x="${x(n - 1)}" y="${H - 6}" text-anchor="middle">${n}</text>` +
      `<text class="axis" x="${(L + W) / 2}" y="${H - 6}" text-anchor="middle">session</text>`
    : `<text class="axis" x="${x(0)}" y="${H - 6}" text-anchor="middle">session 1</text>`;

  // Mirrored is drawn last so it sits on top.
  const draw = ordered().reverse();
  const labels = [];
  const series = [];
  let lines = '';
  draw.forEach((st) => {
    const pts = [];
    sessions.forEach((s, i) => { const a = s.styles[st.id]; if (a && a.wpm) pts.push([x(i), y(a.wpm), a.wpm]); });
    if (!pts.length) return;
    const c = seriesOf(st.id);
    const main = st.id === 'mirrored';
    if (pts.length > 1) {
      lines += `<polyline fill="none" stroke="${c.line}" stroke-width="${main ? 3 : 2.5}" stroke-linejoin="round" stroke-linecap="round" ` +
        `points="${pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
    }
    const [ex, ey, ev] = pts[pts.length - 1];
    lines += `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="${main ? 4.5 : 4}" fill="${c.line}"/>`;
    labels.push({ text: st.label, x: ex, ey, fill: c.ink });
    series.push(pts);
    desc.push(`${st.label} ${Math.round(pts[0][2])}${pts.length > 1 ? ' to ' + Math.round(ev) : ''}`);
  });
  // Each label sits just above its line's end, or just below when that
  // keeps it clearer of the lines (its own included); then nudge apart any that collide.
  const yAt = (pts, px) => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (px >= x0 && px <= x1) return y0 + ((y1 - y0) * (px - x0)) / Math.max(1, x1 - x0);
    }
    return null;
  };
  labels.forEach((l) => {
    const w = l.text.length * 6.6; // rough width of 12px Figtree
    const clearance = (cy) => {
      let best = Infinity;
      series.forEach((pts) => {
        for (let t = 0; t <= 4; t++) {
          const oy = yAt(pts, l.x - (w * t) / 4);
          if (oy != null) best = Math.min(best, Math.abs(oy - (cy - 4)));
        }
      });
      return best;
    };
    const above = l.ey - 10, below = l.ey + 18;
    l.y = clearance(above) >= 12 || clearance(above) >= clearance(below) || below > H - B ? above : below;
  });
  labels.sort((a, b) => a.y - b.y);
  for (let i = 0; i < labels.length; i++) {
    labels[i].y = Math.max(labels[i].y, 12);
    if (i && labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  }
  const lbl = labels.map((l) => `<text class="lbl" x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" text-anchor="${n === 1 ? 'middle' : 'end'}" fill="${l.fill}">${esc(l.text)}</text>`).join('');
  const aria = `Words a minute over ${n} session${n === 1 ? '' : 's'}: ${desc.join('; ')}.`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${svg}${lines}${lbl}</svg></div>`;
}

function renderReset() {
  const area = document.getElementById('reset-area');
  if (!area) return;
  if (!confirming) {
    area.innerHTML = '<div style="text-align:center"><button type="button" class="linkish" id="reset-btn">Reset stats</button></div>';
    area.querySelector('#reset-btn').onclick = () => { confirming = true; renderReset(); };
    return;
  }
  area.innerHTML = '<div class="confirm-box"><p>Erase all reading-speed results? This cannot be undone. Your place in each book is kept.</p>' +
    '<div class="row"><button type="button" class="btn" id="reset-no">Keep them</button>' +
    '<button type="button" class="btn btn-danger" id="reset-yes">Erase</button></div></div>';
  area.querySelector('#reset-no').onclick = () => { confirming = false; renderReset(); };
  area.querySelector('#reset-yes').onclick = () => { confirming = false; resetStats(); renderStats(); toast('Stats reset'); };
}

export function resultsText() {
  const sum = summarize();
  const lines = ['Ox-Turn Reader results'];
  if (sum.first) lines.push(`${fmtDate(sum.first)}${sum.first !== sum.last ? ' to ' + fmtDate(sum.last) : ''} · ${sum.sessions.length} session${sum.sessions.length === 1 ? '' : 's'}`);
  lines.push('');
  lines.push('Average speed by flip style:');
  STYLES.forEach((s) => {
    const a = sum.byStyle[s.id];
    const label = s.id === 'words' ? s.label + punctNote() : s.label;
    lines.push(a.pages ? `- ${label}: ${Math.round(a.wpm)} wpm (${a.pages} pages, ${fmtDuration(a.ms)})` : `- ${s.label}: not tried yet`);
  });
  lines.push('');
  lines.push(`Total: ${sum.totals.pages} pages, ${fmtInt(sum.totals.words)} words, ${fmtDuration(sum.totals.ms)} reading`);
  // Font(s) the measured pages were read in. Records from before the font
  // picker existed have no `font`: they were all read in the built-in font.
  const fonts = {};
  getRecords().forEach((r) => { const id = r.font || 'book'; fonts[id] = (fonts[id] || 0) + 1; });
  const fontList = Object.entries(fonts).sort((a, b) => b[1] - a[1]);
  if (fontList.length) {
    lines.push(`Font${fontList.length === 1 ? '' : 's'}: ` +
      fontList.map(([id, n]) => `${fontOf(id).label} (${n} page${n === 1 ? '' : 's'})`).join(', '));
  }
  if (bookIndex.length) {
    lines.push('');
    lines.push('Books:');
    bookIndex.forEach((b) => {
      const p = getPosition(b.id).pct || 0;
      lines.push(`- ${b.title}: ${p >= 100 ? 'finished' : Math.floor(p) + '%'}`);
    });
  }
  return lines.join('\n');
}

/**
 * Whether Reversed words pages were read with punctuation flipped. Records
 * from before the setting existed have no `punct`: they were not flipped.
 */
function punctNote() {
  const recs = getRecords().filter((r) => r.style === 'words');
  const on = recs.filter((r) => r.punct === true).length;
  if (!recs.length) return '';
  if (on === recs.length) return ' (punctuation flipped)';
  if (!on) return ' (punctuation not flipped)';
  return ` (punctuation flipped on ${on} of ${recs.length} pages)`;
}

async function sendResults() {
  const text = resultsText();
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) {
      if (e && e.name === 'AbortError') return; // user closed the share sheet
    }
  }
  if (await copyText(text)) { toast('Copied — paste it into a message'); return; }
  const fb = document.getElementById('share-fallback');
  fb.innerHTML = '<div class="share-fallback"><p class="muted" style="font-family:var(--sans)">Select this text and copy it:</p>' +
    `<textarea readonly>${esc(text)}</textarea></div>`;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* try the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

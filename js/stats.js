// Reading stats screen + "Send my results".
import { summarize, resetStats } from './metrics.js';
import { STYLES } from './settings.js';
import { getPosition } from './books.js';
import { toast } from './toast.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const colorOf = (id) => COLORS[Math.max(0, STYLES.findIndex((s) => s.id === id))];
const fmtInt = (n) => Math.round(n).toLocaleString();

function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

let bookIndex = [];
let confirming = false;

export function renderStats(index) {
  if (index) bookIndex = index;
  const sum = summarize();
  const body = document.getElementById('stats-body');
  const maxWpm = Math.max(1, ...STYLES.map((s) => sum.byStyle[s.id].wpm || 0));

  const rows = STYLES.map((s) => {
    const a = sum.byStyle[s.id];
    const color = colorOf(s.id);
    if (!a.pages) {
      return `<div class="wpm-row"><div class="wpm-head"><span class="wpm-name"><span class="swatch" style="background:${color}"></span>${s.label}</span>` +
        '<span class="wpm-none">not tried yet</span></div></div>';
    }
    return `<div class="wpm-row"><div class="wpm-head"><span class="wpm-name"><span class="swatch" style="background:${color}"></span>${s.label}</span>` +
      `<span class="wpm-num">${fmtInt(a.wpm)}<small>words/min</small></span></div>` +
      `<div class="wpm-bar"><div style="width:${(a.wpm / maxWpm) * 100}%;background:${color}"></div></div>` +
      `<div class="wpm-sub">${a.pages} page${a.pages === 1 ? '' : 's'} · ${fmtDuration(a.ms)}</div></div>`;
  }).join('');

  body.innerHTML =
    '<div class="stats-top"><a class="btn" href="#/">‹ Library</a></div>' +
    '<h1 style="margin:14px 0 4px">Reading stats</h1>' +
    '<p class="muted" style="margin:0;font-family:var(--sans)">Measured quietly while you read. Only pages read at a steady pace count.</p>' +
    '<div class="stat-card"><h2>Average reading speed</h2><p class="hint">By flip style, in words per minute</p>' + rows + '</div>' +
    '<div class="stat-card"><h2>Speed over time</h2><p class="hint">Average words per minute in each reading session</p>' + trendChart(sum) + '</div>' +
    '<div class="stat-card"><h2>Totals</h2>' +
    `<div class="totals"><div><div class="v">${fmtInt(sum.totals.pages)}</div><div class="k">pages</div></div>` +
    `<div><div class="v">${fmtDuration(sum.totals.ms)}</div><div class="k">reading time</div></div>` +
    `<div><div class="v">${fmtInt(sum.totals.words)}</div><div class="k">words</div></div></div>` +
    (sum.first ? `<p class="hint" style="margin:12px 0 0;text-align:center">${sum.sessions.length} session${sum.sessions.length === 1 ? '' : 's'} · ${fmtDate(sum.first)}${sum.first !== sum.last ? ' – ' + fmtDate(sum.last) : ''}</p>` : '') +
    '</div>' +
    '<div class="stats-actions">' +
    '<button type="button" class="btn btn-primary btn-wide" id="send-results">Send my results</button>' +
    '<div id="share-fallback"></div>' +
    '<div id="reset-area"></div></div>';

  renderReset();
  body.querySelector('#send-results').onclick = () => sendResults();
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

/** Inline SVG line chart: x = session number, y = session average WPM, one line per style. */
function trendChart(sum) {
  const sessions = sum.sessions;
  if (!sessions.length) return '<p class="muted" style="font-family:var(--sans)">The chart appears after your first reading session.</p>';
  const W = 360, H = 230, L = 36, R = 10, T = 10, B = 36;
  let max = 0;
  sessions.forEach((s) => Object.values(s.styles).forEach((a) => { max = Math.max(max, a.wpm || 0); }));
  const step = max > 400 ? 100 : 50;
  const yMax = Math.max(step, Math.ceil((max * 1.08) / step) * step);
  const n = sessions.length;
  const x = (i) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / yMax);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Words per minute by session, one line per flip style">`;
  for (let v = 0; v <= yMax; v += step) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text class="axis-label" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const tickEvery = Math.max(1, Math.ceil(n / 8));
  sessions.forEach((s, i) => {
    if (i % tickEvery === 0 || i === n - 1) svg += `<text class="axis-label" x="${x(i)}" y="${H - B + 18}" text-anchor="middle">${i + 1}</text>`;
  });
  svg += `<text class="axis-label" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">Session</text>`;
  const used = [];
  STYLES.forEach((st) => {
    const pts = [];
    sessions.forEach((s, i) => { const a = s.styles[st.id]; if (a && a.wpm) pts.push([x(i), y(a.wpm), a, i]); });
    if (!pts.length) return;
    used.push(st);
    const c = colorOf(st.id);
    if (pts.length > 1) svg += `<polyline fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
    pts.forEach(([px, py, a, i]) => {
      svg += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="${c}" stroke="var(--card)" stroke-width="2"><title>${esc(st.label)}, session ${i + 1}: ${Math.round(a.wpm)} wpm (${a.pages} pages)</title></circle>`;
    });
  });
  svg += '</svg>';
  const legend = '<div class="legend">' + used.map((st) => `<span><span class="swatch" style="background:${colorOf(st.id)}"></span>${st.label}</span>`).join('') + '</div>';
  return `<div class="chart">${svg}${legend}</div>`;
}

export function resultsText() {
  const sum = summarize();
  const lines = ['Ox-Turn Reader results'];
  if (sum.first) lines.push(`${fmtDate(sum.first)}${sum.first !== sum.last ? ' to ' + fmtDate(sum.last) : ''} · ${sum.sessions.length} session${sum.sessions.length === 1 ? '' : 's'}`);
  lines.push('');
  lines.push('Average speed by flip style:');
  STYLES.forEach((s) => {
    const a = sum.byStyle[s.id];
    lines.push(a.pages ? `- ${s.label}: ${Math.round(a.wpm)} wpm (${a.pages} pages, ${fmtDuration(a.ms)})` : `- ${s.label}: not tried yet`);
  });
  lines.push('');
  lines.push(`Total: ${sum.totals.pages} pages, ${fmtInt(sum.totals.words)} words, ${fmtDuration(sum.totals.ms)} reading`);
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

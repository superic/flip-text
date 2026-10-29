// App entry: routing between Library / Reader / Stats, install prompts, service worker.
import { applySettings } from './settings.js';
import { loadIndex } from './books.js';
import { renderLibrary } from './library.js';
import { openReader, closeReader, _debug } from './reader.js';
import { renderStats } from './stats.js';
import { load, save, KEYS } from './storage.js';

applySettings();
window.__ox = _debug; // handy for debugging from the console

const screens = {
  library: document.getElementById('library'),
  reader: document.getElementById('reader'),
  stats: document.getElementById('stats'),
};
let index = null;

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

async function getIndex() {
  if (index) return index;
  try {
    index = await loadIndex();
  } catch {
    index = null;
  }
  return index;
}

async function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/read\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const idx = await getIndex();
    const entry = idx && idx.find((b) => b.id === id);
    if (!entry) { location.replace('#/'); return; }
    show('reader');
    openReader(entry, { onExit: () => { location.hash = '#/'; } });
    return;
  }
  closeReader();
  if (h === '#/stats') {
    show('stats');
    screens.stats.scrollTop = 0;
    renderStats(await getIndex());
    return;
  }
  show('library');
  const idx = await getIndex();
  if (!idx) {
    const shelf = document.getElementById('shelf');
    shelf.innerHTML = '<div><p>The books could not be loaded. Check the internet connection.</p>' +
      '<button type="button" class="btn" id="retry">Try again</button></div>';
    shelf.querySelector('#retry').onclick = () => route();
    return;
  }
  renderLibrary(idx, { onOpen: (id) => { location.hash = '#/read/' + encodeURIComponent(id); } });
  renderInstall();
}

window.addEventListener('hashchange', route);
route();

/* ---------------------------------------------------- Add to Home Screen */

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
let deferredPrompt = null;

const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  save(KEYS.installDismissed, true);
  renderInstall();
});

function renderInstall(force = false) {
  const area = document.getElementById('install-area');
  const how = document.getElementById('how-install');
  if (isStandalone()) { area.innerHTML = ''; how.hidden = true; return; }
  how.hidden = false;
  const dismissed = load(KEYS.installDismissed, false);
  let icon = SHARE_ICON;
  let html = '';
  if (deferredPrompt && (force || !dismissed)) {
    icon = PLUS_ICON;
    html = '<p>Keep your place and read offline: install Ox-Turn on this device.</p>' +
      '<button type="button" class="btn btn-primary" data-install>Install</button>';
  } else if (isIOS && (force || !dismissed)) {
    html = '<p>Keep your place: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>';
  } else if (force) {
    icon = PLUS_ICON;
    html = '<p>To install, open your browser’s menu and choose <strong>Add to Home Screen</strong> or <strong>Install app</strong>.</p>';
  }
  if (!html) { area.innerHTML = ''; return; }
  area.innerHTML = `<section class="tip" aria-label="Install"><div class="tip-ico">${icon}</div><div class="tip-body">${html}</div>` +
    `<button type="button" class="tip-x" aria-label="Dismiss">${CLOSE_ICON}</button></section>`;
  area.querySelector('.tip-x').onclick = () => { save(KEYS.installDismissed, true); area.innerHTML = ''; };
  const btn = area.querySelector('[data-install]');
  if (btn) {
    btn.onclick = async () => {
      const p = deferredPrompt;
      if (!p) return;
      deferredPrompt = null;
      p.prompt();
      try { await p.userChoice; } catch { /* ignore */ }
      renderInstall();
    };
  }
}

document.getElementById('how-install').addEventListener('click', () => {
  renderInstall(true);
  screens.library.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ---------------------------------------------------- Offline support */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  });
}

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

const SHARE_ICON = '<svg class="share-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share button" role="img">' +
  '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2"/></svg>';

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
  let html = '';
  if (deferredPrompt && (force || !dismissed)) {
    html = '<strong>Install Ox-Turn</strong>Put the reader on your Home Screen so it keeps your place and works offline.' +
      '<br><button type="button" class="btn btn-primary" data-install>Install</button>';
  } else if (isIOS && (force || !dismissed)) {
    html = '<strong>Add Ox-Turn to your Home Screen</strong>' +
      `so it keeps your place: tap the Share button ${SHARE_ICON} then <b>“Add to Home Screen”</b>.`;
  } else if (force) {
    html = '<strong>How to install</strong>Open your browser’s menu and choose <b>“Add to Home Screen”</b> or <b>“Install app”</b>.';
  }
  if (!html) { area.innerHTML = ''; return; }
  area.innerHTML = `<div class="install-card">${html}<button type="button" class="close" aria-label="Dismiss">×</button></div>`;
  area.querySelector('.close').onclick = () => { save(KEYS.installDismissed, true); area.innerHTML = ''; };
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

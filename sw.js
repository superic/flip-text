// Service worker: offline support (app shell, books, interface and reading fonts).
// Bump VERSION on every deploy so old caches are cleared.
// Stories added on the device live in IndexedDB (js/stories.js) and never
// pass through here: nothing is fetched for them, so nothing is cached.
// HTML/JS/CSS and the book list are network-first (updates reach the reader
// on the next launch when online); book texts and icons are stale-while-revalidate.
const VERSION = 'v6';
const CACHE = 'oxturn-' + VERSION;
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/main.js',
  'js/addstory.js',
  'js/books.js',
  'js/import.js',
  'js/layout.js',
  'js/hyphenate.js',
  'js/hyph/en-us.js',
  'js/library.js',
  'js/metrics.js',
  'js/punct.js',
  'js/curl.js',
  'js/reader.js',
  'js/settings.js',
  'js/stats.js',
  'js/storage.js',
  'js/stories.js',
  'js/toast.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'books/index.json',
  // Interface + reading fonts (stale-while-revalidate like the books; they never change)
  'fonts/figtree/figtree-latin-var.woff2',
  'fonts/literata/literata-latin-var.woff2',
  'fonts/source-serif-4/source-serif-4-latin-var.woff2',
  'fonts/eb-garamond/eb-garamond-latin-var.woff2',
  'fonts/merriweather/merriweather-latin-var.woff2',
  'fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-400.woff2',
  'fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-700.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Also precache every book listed in the index.
    try {
      const res = await cache.match('books/index.json');
      const list = res ? await res.json() : [];
      await cache.addAll(list.map((b) => b.file));
    } catch { /* books will be cached on first open */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('oxturn-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function networkFirst(req, fallbackKey) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = async () => {
      const hit = (await caches.match(req, { ignoreSearch: true })) || (fallbackKey && (await caches.match(fallbackKey)));
      return hit;
    };
    // If the network is very slow, answer from cache after 4 s.
    const timer = setTimeout(async () => {
      const hit = await fromCache();
      if (hit && !settled) { settled = true; resolve(hit); }
    }, 4000);
    fetch(req).then(async (res) => {
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(async () => {
      clearTimeout(timer);
      const hit = await fromCache();
      if (!settled) { settled = true; resolve(hit || Response.error()); }
    });
  });
}

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(update); return hit; }
  return (await update) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, 'index.html'));
  } else if (/\.(js|css|webmanifest)$/.test(path) || path.endsWith('/books/index.json')) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});

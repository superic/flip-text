// Tiny localStorage wrapper. Every access is guarded: private browsing, full
// storage or disabled storage must never break the app. An in-memory copy keeps
// things working for the current visit even when localStorage throws.
const memory = new Map();

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw);
  } catch { /* fall through */ }
  return memory.has(key) ? memory.get(key) : fallback;
}

export function save(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export function remove(key) {
  memory.delete(key);
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export const KEYS = {
  settings: 'ox.settings',
  last: 'ox.lastBook',
  pos: (id) => `ox.pos.${id}`,
  records: 'ox.records',
  recorded: 'ox.recordedPages',
  installDismissed: 'ox.installDismissed',
};

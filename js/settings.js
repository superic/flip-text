// Reader settings (flip style, text size, line spacing, theme) + theme application.
import { load, save, KEYS } from './storage.js';

export const STYLES = [
  { id: 'mirrored', label: 'Mirrored', desc: 'Letters mirrored, like Leonardo' },
  { id: 'words', label: 'Reversed words', desc: 'Words run right to left' },
  { id: 'upside', label: 'Upside down', desc: 'Line turned over' },
  { id: 'normal', label: 'Normal', desc: 'Every line left to right' },
];
export const SIZES = [16, 18, 20, 22, 24, 26, 28, 31, 34];
export const SPACINGS = [
  { value: 1.3, label: 'Snug' },
  { value: 1.5, label: 'Normal' },
  { value: 1.75, label: 'Roomy' },
];
export const THEMES = [
  { id: 'paper', label: 'Paper', color: '#f6eedb' },
  { id: 'white', label: 'White', color: '#f3f3f1' },
  { id: 'dark', label: 'Dark', color: '#0f0f0e' },
];

const DEFAULTS = { style: 'mirrored', fontSize: 20, spacing: 1.5, theme: 'paper' };

function sanitize(s) {
  const out = { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  if (!STYLES.some((x) => x.id === out.style)) out.style = DEFAULTS.style;
  if (!SIZES.includes(out.fontSize)) out.fontSize = DEFAULTS.fontSize;
  if (!SPACINGS.some((x) => x.value === out.spacing)) out.spacing = DEFAULTS.spacing;
  if (!THEMES.some((x) => x.id === out.theme)) out.theme = DEFAULTS.theme;
  return out;
}

let current = sanitize(load(KEYS.settings, null));
const listeners = new Set();

export const getSettings = () => current;
export const styleLabel = (id) => (STYLES.find((s) => s.id === id) || { label: id }).label;
/** Line height in whole pixels so lines sit on an exact grid. */
export const lineHeightPx = (s = current) => Math.round(s.fontSize * s.spacing);

export function updateSettings(patch) {
  const prev = current;
  current = sanitize({ ...current, ...patch });
  save(KEYS.settings, current);
  applySettings();
  listeners.forEach((fn) => fn(current, prev));
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = current.theme;
  root.style.setProperty('--font-size', current.fontSize + 'px');
  root.style.setProperty('--lh', lineHeightPx() + 'px');
  const meta = document.querySelector('meta[name="theme-color"]');
  const t = THEMES.find((x) => x.id === current.theme);
  if (meta && t) meta.setAttribute('content', t.color);
}

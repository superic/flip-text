// Reader settings (flip style, punctuation flipping, text size, line spacing,
// font, theme) + theme application.
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
  { id: 'paper', label: 'Paper', color: '#F5EFE4' },
  { id: 'white', label: 'White', color: '#FFFFFF' },
  { id: 'dark', label: 'Dark', color: '#161513' },
];

// Reading fonts. Everything but the built-in stack is self-hosted in fonts/
// (see the @font-face rules in css/app.css), so nothing is fetched from Google
// at run time and the service worker can keep them for offline use.
export const FONTS = [
  { id: 'book', label: 'Book (built-in)', family: null, stack: 'var(--serif)' },
  { id: 'literata', label: 'Literata', family: 'Literata', stack: '"Literata", Georgia, serif' },
  { id: 'source-serif', label: 'Source Serif 4', family: 'Source Serif 4', stack: '"Source Serif 4", Georgia, serif' },
  { id: 'garamond', label: 'EB Garamond', family: 'EB Garamond', stack: '"EB Garamond", Georgia, serif' },
  { id: 'merriweather', label: 'Merriweather', family: 'Merriweather', stack: '"Merriweather", Georgia, serif' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', family: 'Atkinson Hyperlegible', stack: '"Atkinson Hyperlegible", var(--sans)' },
];

// punct: move punctuation across on Reversed words lines (see punct.js).
const DEFAULTS = { style: 'mirrored', punct: true, fontSize: 20, spacing: 1.5, font: 'book', theme: 'paper' };

function sanitize(s, defaults = DEFAULTS) {
  const out = { ...defaults, ...(s && typeof s === 'object' ? s : {}) };
  if (!STYLES.some((x) => x.id === out.style)) out.style = DEFAULTS.style;
  if (typeof out.punct !== 'boolean') out.punct = DEFAULTS.punct;
  if (!SIZES.includes(out.fontSize)) out.fontSize = DEFAULTS.fontSize;
  if (!SPACINGS.some((x) => x.value === out.spacing)) out.spacing = DEFAULTS.spacing;
  if (!FONTS.some((x) => x.id === out.font)) out.font = DEFAULTS.font;
  if (!THEMES.some((x) => x.id === out.theme)) out.theme = DEFAULTS.theme;
  return out;
}

// New readers start in Literata. Anyone who has used the app before (saved
// settings, a book opened or a measured page) keeps the built-in font unless
// they chose another; the choice is saved at once so it never changes later.
let current = (() => {
  const saved = load(KEYS.settings, null);
  if (saved) return sanitize(saved);
  const pages = load(KEYS.records, []);
  const isNew = load(KEYS.last, null) == null && !(Array.isArray(pages) && pages.length);
  const s = sanitize(null, isNew ? { ...DEFAULTS, font: 'literata' } : DEFAULTS);
  save(KEYS.settings, s);
  return s;
})();
const listeners = new Set();

export const getSettings = () => current;
export const styleLabel = (id) => (STYLES.find((s) => s.id === id) || { label: id }).label;
export const fontOf = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
/** Punctuation flipping in effect: true/false for Reversed words, null for other styles. */
export const punctOf = (s = current) => (s.style === 'words' ? s.punct : null);
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

/**
 * Resolves once the web font for `font` is loaded (both weights the page uses:
 * 400 for text, 600/700 for headings), so line measuring never runs against a
 * fallback font. Never rejects; gives up after `timeout` ms so a missing file
 * can't stop a book from opening (the text then lays out in the fallback).
 */
export function fontReady(font = current.font, size = current.fontSize, timeout = 4000) {
  const f = fontOf(font);
  if (!f.family || !document.fonts || !document.fonts.load) return Promise.resolve(true);
  const loads = Promise.all([400, 700].map((w) => document.fonts.load(`${w} ${size}px "${f.family}"`)))
    .then(() => document.fonts.check(`400 ${size}px "${f.family}"`))
    .catch(() => false);
  return Promise.race([loads, new Promise((r) => setTimeout(() => r(false), timeout))]);
}

export function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = current.theme;
  root.style.setProperty('--font-size', current.fontSize + 'px');
  root.style.setProperty('--lh', lineHeightPx() + 'px');
  root.style.setProperty('--read-font', fontOf(current.font).stack);
  const meta = document.querySelector('meta[name="theme-color"]');
  const t = THEMES.find((x) => x.id === current.theme);
  if (meta && t) meta.setAttribute('content', t.color);
}

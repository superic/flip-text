// "Add a story" sheet on the Library: paste text (or open a .txt file), check
// the title, add it to the shelf. Parsing is in import.js, saving in
// stories.js; nothing here touches the network.
import { guessTitle, guessAuthor, summarize, parseStory, bookWords, polish, MIN_WORDS } from './import.js';
import { saveStory, newId } from './stories.js';

const $ = (id) => document.getElementById(id);

let els = null;
let onAddedFn = () => {};
let autoTitle = '';   // the title we filled in; replaced only while the field still shows it
let fileTitle = '';   // a title from the chosen file's name, if the text has none
let body = '';        // the text to import (without a title line taken as the title)
let timer = 0;
let saving = false;

function init() {
  if (els) return;
  els = {
    wrap: $('add-sheet'), form: $('add-form'), text: $('add-text'), summary: $('add-summary'),
    paste: $('add-paste'), fileBtn: $('add-file-btn'), file: $('add-file'),
    title: $('add-name'), author: $('add-author'), suggest: $('add-suggest'),
    error: $('add-error'), go: $('add-go'), hint: $('add-hint'),
  };
  els.wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeAddSheet();
    else if (e.target.closest('[data-cancel]')) { clearDraft(); closeAddSheet(); }
  });
  // Big pastes are parsed a moment after typing stops.
  els.text.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, els.text.value.length > 20000 ? 250 : 60); });
  els.title.addEventListener('input', update);
  els.author.addEventListener('input', update);
  els.suggest.addEventListener('click', () => { els.author.value = els.suggest.dataset.name || ''; update(); });
  els.fileBtn.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', onFile);
  if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {
    els.paste.hidden = false;
    els.paste.addEventListener('click', onPaste);
  }
  els.form.addEventListener('submit', (e) => { e.preventDefault(); add(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.wrap.hidden) closeAddSheet(); });
}

export function openAddSheet({ onAdded }) {
  init();
  onAddedFn = onAdded;
  els.error.hidden = true;
  els.wrap.hidden = false;
  els.form.scrollTop = 0;
  update();
}

/** Close, keeping whatever was pasted (Cancel clears it first). */
export function closeAddSheet() {
  if (els) els.wrap.hidden = true;
}

function clearDraft() {
  els.text.value = '';
  els.title.value = '';
  els.author.value = '';
  els.file.value = '';
  autoTitle = fileTitle = '';
  update();
}

const fmt = (n) => n.toLocaleString('en-US');

/** Title autofill, live summary, author suggestion, button state. */
function update() {
  clearTimeout(timer);
  const text = els.text.value;
  const guess = text.trim() ? guessTitle(text) : null;
  // Fill the title only while the reader has not typed their own.
  const cur = els.title.value.trim();
  const candidate = (guess && guess.title) || fileTitle;
  if (!cur || cur === autoTitle) {
    els.title.value = candidate;
    autoTitle = candidate;
  }
  // The first line is dropped from the story only when it is the title.
  const title = els.title.value.trim();
  body = guess && polish(title) === guess.title ? guess.rest : text;

  const sum = text.trim() ? summarize(body) : null;
  els.summary.hidden = !sum;
  if (sum) {
    const words = sum.words > 200 ? Math.round(sum.words / 10) * 10 : sum.words;
    els.summary.textContent = `About ${fmt(words)} word${words === 1 ? '' : 's'} · ${fmt(sum.paragraphs)} paragraph${sum.paragraphs === 1 ? '' : 's'}` +
      (sum.chapters > 1 ? ` · ${sum.chapters} chapters` : '');
  }

  const name = !els.author.value.trim() && sum ? guessAuthor(body) : null;
  els.suggest.hidden = !name;
  if (name) {
    els.suggest.dataset.name = name;
    els.suggest.textContent = `Use “${name}”`;
  }

  const enough = sum && sum.words >= MIN_WORDS;
  els.go.disabled = saving || !title || !enough;
  els.hint.textContent = !sum ? 'Paste a story or choose a file to begin.'
    : !enough ? 'That’s very short. Paste the whole story.'
    : !title ? 'Give the story a title to add it.' : '';
  els.hint.hidden = !els.hint.textContent;
}

async function onPaste() {
  try {
    const t = await navigator.clipboard.readText();
    if (t && t.trim()) { els.text.value = t; fileTitle = ''; update(); return; }
  } catch { /* fall back to the box */ }
  els.text.focus();
  showError('Tap and hold in the box above, then choose Paste.');
}

function onFile() {
  const f = els.file.files && els.file.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    els.text.value = String(reader.result || '');
    fileTitle = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (fileTitle.length > 80) fileTitle = '';
    els.error.hidden = true;
    update();
  };
  reader.onerror = () => showError('That file could not be opened. Try copying the text and pasting it instead.');
  reader.readAsText(f, 'UTF-8');
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
}

async function add() {
  update();
  if (els.go.disabled) return;
  saving = true;
  els.go.disabled = true;
  els.go.textContent = 'Adding…';
  els.error.hidden = true;
  try {
    const book = parseStory(body, { id: newId(), title: els.title.value, author: els.author.value });
    const entry = await saveStory(book, { wordCount: bookWords(book) });
    saving = false;
    els.go.textContent = 'Add to shelf';
    clearDraft();
    closeAddSheet();
    onAddedFn(entry);
  } catch {
    // Keep everything on screen so nothing pasted is lost.
    saving = false;
    els.go.textContent = 'Add to shelf';
    showError('Couldn’t save — this phone’s storage is full or blocked. Your text is still here.');
    update();
  }
}

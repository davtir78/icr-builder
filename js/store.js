// The draft: state, change notification, and autosave to localStorage.
//
// The draft is saved in this browser only (localStorage, key below) and is never sent anywhere.
// Every access is wrapped in try/catch: storage can be blocked (private windows, site settings),
// and the builder works without it, saying so.
//
// Safety rules for what is saved and restored:
//   - a record is analysed (checked) before it is saved, so a draft that cannot be analysed is never stored;
//   - a stored draft is restored only if it has the shape of a record, and a "restoring" flag is kept
//     while the first analysis of a restored draft runs: if the page died during it (a hostile or huge draft),
//     the next visit finds the flag and discards the draft instead of dying again.

import { blankModel, fromMarkdown, toMarkdown } from './model.js';
import { analyze } from './lint.js';
import { advise } from './advice.js';
import { MAX_RECORD_BYTES, byteLength, overlongLine, overlongMessage } from './limits.js';

export const DRAFT_KEY = 'icr-builder:draft:v1';
export const RESTORING_KEY = 'icr-builder:restoring';
const SAVE_DELAY = 400;

const listeners = new Set();
let model = blankModel();
let version = 0;
let epoch = 0; // counts the times the whole record was replaced (a file or example loaded, the draft cleared)
let cache = { version: -1 };
let saveTimer = null;
const saveState = { ok: true, at: null, available: true };
// The file as it was opened, while the record is still exactly what was read from it. Writing a record out is not always
// neutral for the checks (an empty optional section is left out, closing # marks of a heading and the indent of the first line
// of the text before the first section are rewritten), so a file that is checked as opened and as written can give two results.
let opened = null; // { text, analysis }

/**
 * What the page says when the file as opened and the file as it will be saved are checked differently: why they can differ,
 * and what the file as it will be saved would get.
 */
function exportNote(exported) {
  const found = exported.problems.map((p) => p.message);
  const verdict = exported.unsupported ? 'could not be fully checked here'
    : !found.length ? 'would conform'
      : `would not conform: ${found.slice(0, 3).join('; ')}${found.length > 3 ? ` (and ${found.length - 3} more)` : ''}`;
  return 'The file as you opened it would be written out differently (for example an empty optional section is left out, the first line '
    + 'of the text before the first section loses its indent, closing # marks of a heading are stripped twice, and a file with no front '
    + 'matter, or an empty one, is written with front matter fields), and that changes what the checks find. The checks shown are those '
    + `of the file as it was opened. As it will be saved, the file ${verdict}. Once you change something the checks are those of the `
    + 'record as it will be saved.';
}

/** The same verdict: the same findings, and the same "not checked here". */
function sameVerdict(a, b) {
  const key = (x) => JSON.stringify([x.problems.map((p) => p.message).sort(), x.unsupported ?? null, x.yamlError ?? null]);
  return key(a) === key(b);
}

function derived() {
  if (cache.version !== version) {
    const markdown = toMarkdown(model);
    let analysis = analyze(markdown);
    if (opened) {
      opened.analysis ??= analyze(opened.text);
      if (!sameVerdict(opened.analysis, analysis)) analysis = { ...opened.analysis, exportNote: exportNote(analysis) };
    }
    cache = { version, markdown, analysis, advice: advise(analysis) };
  }
  return cache;
}

function notify() { for (const fn of [...listeners]) fn(); }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Does this look like a record this tool wrote? (A stored draft is untrusted: it may be old, edited or damaged.) */
export function isModelShape(m) {
  return isObj(m)
    && (m.fm === null || isObj(m.fm))
    && (m.h1 === null || typeof m.h1 === 'string')
    && typeof m.preamble === 'string'
    && Array.isArray(m.sections)
    && m.sections.every((s) => isObj(s) && typeof s.title === 'string' && typeof s.content === 'string')
    && (m.fm !== null || typeof m.fmRaw === 'string');
}

function writeDraft() {
  try {
    const json = JSON.stringify({ v: 1, savedAt: new Date().toISOString(), model, opened: opened ? opened.text : undefined });
    derived(); // never store a record that could not be analysed
    localStorage.setItem(DRAFT_KEY, json);
    saveState.ok = true;
    saveState.available = true;
    saveState.at = new Date();
  } catch {
    saveState.ok = false;
    saveState.available = false;
  }
  notify();
}

export const store = {
  /** The record. Change it only through change() or replace(). */
  get model() { return model; },
  get markdown() { return derived().markdown; },
  get analysis() { return derived().analysis; },
  get advice() { return derived().advice; },
  get saveState() { return saveState; },
  get epoch() { return epoch; },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Runs fn(model) to edit the record, then saves and notifies. */
  change(fn) {
    // The record is analysed at once, so a change that makes that fail (a value too deeply nested to write out, say) is
    // undone and reported to the caller, instead of leaving a record that the page cannot show.
    const before = structuredClone(model);
    const wasOpened = opened;
    opened = null; // an edit: the checks are now those of the record as it will be written
    try {
      fn(model);
      version++;
      derived();
    } catch (e) {
      for (const k of Object.keys(model)) delete model[k];
      Object.assign(model, before);
      opened = wasOpened;
      version++;
      throw new Error(`That change could not be applied (${e.reason || e.message}), so the record was left as it was.`);
    }
    notify();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeDraft, SAVE_DELAY);
  },

  /** Replaces the whole record (a loaded example or file, or a new one). The old record is kept if the new one cannot be analysed. */
  replace(next, openedText = null) {
    const previous = model;
    const wasOpened = opened;
    model = next;
    opened = typeof openedText === 'string' ? { text: openedText, analysis: null } : null;
    version++;
    try { derived(); } catch (e) { model = previous; opened = wasOpened; version++; throw e; }
    epoch++;
    notify();
    clearTimeout(saveTimer);
    writeDraft();
  },

  /**
   * Restores the saved draft. Returns 'restored', 'none', 'invalid' (a draft of the wrong shape was
   * discarded) or 'crashed' (the last attempt to open the saved draft never finished, so it was discarded).
   */
  load() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      saveState.available = true;
      if (localStorage.getItem(RESTORING_KEY)) { localStorage.removeItem(RESTORING_KEY); localStorage.removeItem(DRAFT_KEY); return raw ? 'crashed' : 'none'; }
      if (!raw) return 'none';
      let saved;
      try { saved = JSON.parse(raw); } catch { saved = null; }
      if (saved?.v !== 1 || !isModelShape(saved.model)) { localStorage.removeItem(DRAFT_KEY); return 'invalid'; }
      localStorage.setItem(RESTORING_KEY, '1');
      model = saved.model;
      opened = typeof saved.opened === 'string' && byteLength(saved.opened) <= MAX_RECORD_BYTES ? { text: saved.opened, analysis: null } : null;
      version++;
      saveState.at = saved.savedAt ? new Date(saved.savedAt) : null;
      return 'restored';
    } catch {
      saveState.available = false;
      return 'none';
    }
  },

  /** Called once the restored draft has been analysed and shown: clears the flag set by load(). */
  confirmRestored() {
    try { derived(); localStorage.removeItem(RESTORING_KEY); } catch { /* left set: the next visit discards the draft */ }
  },

  /** Deletes the saved draft and starts a new blank record. */
  clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable: nothing to remove */ }
    model = blankModel();
    opened = null;
    version++;
    epoch++;
    saveState.at = null;
    notify();
  },

  /** True when the record is still the empty one a new visit starts with, so replacing it loses nothing. */
  isPristine() {
    const blank = blankModel(model.fm?.date);
    return toMarkdown(blank) === toMarkdown(model);
  },

  /** Loads markdown as the record. Returns { warnings }. Throws a readable error for a file that is too large. */
  loadMarkdown(text) {
    const bytes = byteLength(text);
    if (bytes > MAX_RECORD_BYTES) throw new Error(`That text is ${Math.round(bytes / 1024)} KB; an ICR is a small file and the limit here is ${MAX_RECORD_BYTES / 1024} KB.`);
    const tooLong = overlongLine(text);
    if (tooLong) throw new Error(`That text cannot be loaded: ${overlongMessage(tooLong).replace(' (nothing else was checked)', '')}.`);
    const { model: next, warnings } = fromMarkdown(text);
    store.replace(next, text);
    const note = store.analysis.exportNote;
    return { warnings: note ? [...warnings, note] : warnings };
  },
};

// The record being edited, and its conversion to and from ICR markdown.
//
// The model is plain JSON, so it can be stored as it is:
//   fm        the front matter exactly as parsed (any keys, any types), or null when it could not be read
//   fmRaw     the front matter text, kept only while `fm` is null
//   h1        the "# Title" line; null means "follow the title field"; '' means the file has none
//   preamble  anything between the H1 and the first section (a guidance comment, for example)
//   sections  [{ title, content }] in document order, as written (duplicates and unknown headings are kept)
//
// Keeping the parsed values untouched is what lets a broken file be opened and show the right
// failures: nothing is corrected on the way in. The linter runs on the markdown written from the
// model, so the checklist is always about the file that would be exported.
//
// What is not kept: comments inside the YAML front matter, the style of lists in it (inline
// `[a, b]` becomes a block list), and the exact number of blank lines between sections.

import { parseYaml, dumpYaml } from './yaml.js';
import { splitDocument, scanBody, SECTIONS, SECTION_TITLES } from './lint.js';
import { atxHeading, stripClosingHashes, trimBlanksEnd } from './text.js';
import { MAX_RECORD_BYTES, byteLength } from './limits.js';

export const FM_ORDER = {
  '': ['icr', 'id', 'title', 'status', 'version', 'date', 'pattern', 'interaction', 'provider', 'consumers', 'interfaces', 'data', 'decisions', 'supersedes', 'review-by'],
  pattern: ['id', 'url'],
  provider: ['system', 'owner', 'contact'],
  'consumers[]': ['system', 'owner', 'contact'],
  'interfaces[]': ['type', 'ref', 'version'],
  data: ['classification', 'personal-information'],
};

const OPTIONAL = new Set(SECTIONS.filter(([, required]) => !required).map(([title]) => title));

export const todayIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** A new, empty record: the required sections are present and empty, so the checklist shows what is left to write. */
export function blankModel(today = todayIso()) {
  return {
    fm: { icr: '0.2', status: 'draft', version: '0.1.0', date: today, consumers: [{}], interfaces: [], data: {} },
    h1: null,
    preamble: '',
    sections: SECTIONS.filter(([, required]) => required).map(([title]) => ({ title, content: '' })),
  };
}

/** The first "# Title" line of the text: where it starts, how long the line is, and its title. Read line by line, with no pattern that can backtrack over a long line. */
function findH1(text) {
  let at = 0;
  while (at <= text.length) {
    let end = text.indexOf('\n', at);
    if (end < 0) end = text.length;
    const line = text.slice(at, end);
    const head = atxHeading(line, { indent: 0, maxLevel: 1 });
    if (head) {
      const title = trimBlanksEnd(head.text);
      if (title) return { index: at, length: line.length, title };
    }
    at = end + 1;
  }
  return null;
}

/** Reads ICR markdown into a model. Never throws and never corrects: `warnings` say what could not be read. */
export function fromMarkdown(text) {
  const warnings = [];
  const doc = splitDocument(text);
  const model = { fm: null, fmRaw: '', h1: '', preamble: '', sections: [] };
  let body;
  if (!doc) {
    warnings.push('The file has no YAML front matter between --- lines, so the front matter fields start blank.');
    model.fm = blankModel().fm;
    body = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  } else {
    body = doc.body;
    try {
      const front = parseYaml(doc.yaml);
      if (front !== null && typeof front === 'object' && !Array.isArray(front)) {
        model.fm = front; // checked below, once the body is read, that it can be written back out
      }
      else if (front === undefined || front === null) model.fm = {};
      else { model.fmRaw = doc.yaml; warnings.push('The front matter is not a set of "key: value" lines, so it is kept as text: edit it under "Edit the front matter as YAML".'); }
    } catch (e) {
      model.fmRaw = doc.yaml;
      warnings.push(e.unsupported
        ? `The front matter uses YAML this tool cannot read (${e.reason || e.message}). It is kept as text, unchanged, and the form fields are not available: edit it under "Edit the front matter as YAML".`
        : `The front matter is not valid YAML (${e.reason || e.message}). It is kept as text, unchanged, so you can correct it under "Edit the front matter as YAML".`);
    }
  }
  const scan = scanBody(body);
  let pre = scan.preamble;
  const h = findH1(pre);
  if (h) {
    model.h1 = stripClosingHashes(h.title);
    pre = pre.slice(0, h.index) + pre.slice(h.index + h.length);
  }
  model.preamble = pre.replace(/^\s*\n/, '').trim();
  if (model.fm && typeof model.fm.title === 'string' && model.h1 === model.fm.title) model.h1 = null;
  model.sections = scan.sections.map((s) => ({ title: s.title, content: s.raw }));
  // js-yaml reads some values (pairs inside a flow list, empty entries) that are nested too deeply to be written back out in any
  // form the writer produces, and some that are far longer in block form than they were written: the whole file may not be longer
  // than the page accepts. Such front matter is kept as text, so that it can still be shown and exported unchanged.
  if (doc && model.fm && Object.keys(model.fm).length) {
    try { dumpYaml(model.fm, { order: FM_ORDER, maxBytes: MAX_RECORD_BYTES - bodyBytes(model) }); } catch (e) {
      // the heading that equalled the title is the title no more once the fields are gone: it is written as it is
      if (model.h1 === null) model.h1 = typeof model.fm.title === 'string' ? model.fm.title : '';
      model.fm = null;
      model.fmRaw = doc.yaml;
      warnings.push('The front matter has a value that cannot be written back out as YAML of this tool\'s kind (nested too deeply, or far longer in block form than it is written), so it is kept as text, unchanged: edit it under "Edit the front matter as YAML".');
    }
  }
  return { model, warnings };
}

/** The markdown after the front matter: the heading, the text before the first section, and the sections. */
function bodyText(model) {
  const h1 = model.h1 === null ? (typeof model.fm?.title === 'string' ? model.fm.title : '') : model.h1;
  const blocks = [];
  if (h1) blocks.push(`# ${h1}`);
  if (model.preamble && model.preamble.trim()) blocks.push(model.preamble.trim());
  for (const s of model.sections) {
    if (OPTIONAL.has(s.title) && !s.content.trim()) continue; // an optional section left empty is left out
    blocks.push(s.content.trim() ? `## ${s.title}\n\n${s.content.trimEnd()}` : `## ${s.title}`);
  }
  return blocks.join('\n\n') + '\n';
}

/** The bytes of the file that are not the YAML: the fences and the body. */
const bodyBytes = (model) => byteLength(bodyText(model)) + byteLength('---\n\n---\n\n');

/** Writes the model as ICR markdown. */
export function toMarkdown(model) {
  // front matter kept as text is written as it was read, trailing blank lines included (`|+` at the end depends on them); what is
  // written from fields may not be longer than a record may be (a record read from a file was checked against what its body leaves)
  const yaml = model.fm ? dumpYaml(model.fm, { order: FM_ORDER, maxBytes: MAX_RECORD_BYTES }).trimEnd() : model.fmRaw;
  return '---\n' + yaml + '\n---\n\n' + bodyText(model);
}

// ---------- sections ----------

export const sectionIndex = (model, title) => model.sections.findIndex((s) => s.title === title);
export const getSection = (model, title) => model.sections[sectionIndex(model, title)]?.content ?? '';

/** Sets a section's text, adding the section in its place in the standard order when the record has none. */
export function setSection(model, title, content) {
  const i = sectionIndex(model, title);
  if (i >= 0) { model.sections[i].content = content; return; }
  const target = SECTION_TITLES.indexOf(title);
  let after = -1;
  model.sections.forEach((s, k) => { const c = SECTION_TITLES.indexOf(s.title); if (c >= 0 && c < target) after = k; });
  model.sections.splice(after + 1, 0, { title, content });
}

/** Headings in the record that are not part of the specification, or repeat one. */
export function strayHeadings(model) {
  const seen = new Set();
  const out = [];
  model.sections.forEach((s, i) => {
    if (!SECTION_TITLES.includes(s.title) || seen.has(s.title)) out.push({ index: i, title: s.title, duplicate: seen.has(s.title) });
    seen.add(s.title);
  });
  return out;
}

// ---------- front matter ----------

/** The value at a path such as ['provider', 'system'] or ['consumers', 0, 'owner']; undefined when absent. */
export function getPath(obj, path) {
  return path.reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

/**
 * Sets the value at a path. An empty string or undefined removes the key, and an object left empty
 * by that is removed too (arrays keep their items), so a blank field is "not written", not "written empty".
 */
export function setPath(obj, path, value) {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    if (value === '' || value === undefined) { if (Array.isArray(obj)) obj[head] = {}; else delete obj[head]; } else obj[head] = value;
    return;
  }
  if (obj[head] === undefined || obj[head] === null || typeof obj[head] !== 'object') {
    if (value === '' || value === undefined) return;
    obj[head] = typeof rest[0] === 'number' ? [] : {};
  }
  setPath(obj[head], rest, value);
  const child = obj[head];
  if (!Array.isArray(child) && typeof child === 'object' && Object.keys(child).length === 0 && !Array.isArray(obj)) delete obj[head];
}

/** A file name for the record: ICR-AB-0001-booking-api.md */
export function fileName(model) {
  const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const id = typeof model.fm?.id === 'string' && model.fm.id.trim() ? model.fm.id.trim().replace(/[^A-Za-z0-9-]+/g, '-') : 'ICR-draft';
  const title = slug(model.fm?.title);
  return `${id}${title ? '-' + title : ''}.md`;
}

// The checks of a file that has just been opened are those of the file as it was opened, not of what writing it out would give.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from '../js/lint.js';
import { fromMarkdown, toMarkdown } from '../js/model.js';
import { store } from '../js/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, '..', 'templates');
const FILES = fs.readdirSync(TEMPLATES).filter((n) => n.endsWith('.md')).sort();
const read = (f) => fs.readFileSync(path.join(TEMPLATES, f), 'utf8').replace(/\r\n/g, '\n');
const messages = (list) => [...list].sort();
const shown = () => messages(store.analysis.problems.map((p) => p.message));

test('the six worked records are checked as opened, and writing them out is neutral', () => {
  assert.equal(FILES.length, 6);
  for (const f of FILES) {
    const text = read(f);
    store.loadMarkdown(text);
    assert.deepEqual(shown(), messages(lint(text)), f);
    assert.equal(store.analysis.exportNote, undefined, `${f}: nothing to say`);
  }
});

// each of these is a file whose export is checked differently from the file
const CASES = {
  'a second, empty "Related records" section (a duplicate)': () => read('ICR-AB-0003-notifications.md').replace(/\n$/, '\n\n## Related records\n'),
  'an empty "Open issues" before "Purpose" (out of order)': () => read('0001-partner-booking-api.md').replace(/^## Purpose$/m, '## Open issues\n\n## Purpose'),
  'a tab-indented "## Purpose" line first in the text before the first section (code, not a heading)': () => read('0001-partner-booking-api.md').replace(/^## Purpose\n/m, '').replace(/^(# .*\n\n)/m, '$1\t## Purpose\n\n'),
  'closing # marks that are stripped twice': () => read('0001-partner-booking-api.md').replace(/^## Support and escalation$/m, '## Support and escalation  ## #'),
};

for (const [name, make] of Object.entries(CASES)) {
  test(`opened: ${name}: the findings shown are the file's, with a note, until something is edited`, () => {
    const text = make();
    const { model } = fromMarkdown(text);
    const exported = toMarkdown(model);
    assert.notDeepEqual(messages(lint(exported)), messages(lint(text)), 'the export is checked differently from the file');
    const { warnings } = store.loadMarkdown(text);
    assert.deepEqual(shown(), messages(lint(text)), 'the findings are those of the file');
    assert.match(store.analysis.exportNote ?? '', /would be written out differently/);
    assert.ok(warnings.some((w) => /would be written out differently/.test(w)), 'and the import says so');
    store.change((m) => { m.preamble = m.preamble; });
    assert.equal(store.analysis.exportNote, undefined, 'after an edit the note is gone');
    assert.deepEqual(shown(), messages(lint(store.markdown)), 'and the findings are those of the record as it will be saved');
  });
}

// ---------- the property: right after an import, the findings shown are the findings of the file ----------

function lcg(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

export function mutateSections(text, rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const [front, ...rest] = text.split(/^(?=## )/m); // the text up to the first "## ", then one block per section
  let blocks = rest.slice();
  const ops = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < ops; k++) {
    const r = rnd();
    const i = Math.floor(rnd() * blocks.length);
    if (!blocks.length) break;
    if (r < 0.12) blocks.splice(i, 0, blocks[i]); // duplicate
    else if (r < 0.24 && blocks.length > 1) { const j = Math.floor(rnd() * blocks.length); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; } // reorder
    else if (r < 0.36) blocks[i] = blocks[i].split('\n')[0] + '\n\n'; // empty
    else if (r < 0.46) blocks.splice(i, 0, `## ${pick(['Open issues', 'Related records', 'Open questions'])}\n\n`); // an empty heading
    else if (r < 0.56) blocks[i] = '\t' + blocks[i]; // a tab-indented heading
    else if (r < 0.66) blocks[i] = blocks[i].replace(/^(## .*?)$/m, (m) => m + pick([' ##', '  ## #', ' #', ' ## ##'])); // closing hashes
    else if (r < 0.74) blocks[i] = ' ' + blocks[i].replace(/^## /, '## ').replace(/^/, pick(['', ' ', '  '])); // indented
    else if (r < 0.82) blocks.splice(i, 1); // removed
    else if (r < 0.9) blocks[i] = blocks[i].replace(/^(## .*)$/m, '$1   '); // trailing blanks
    else blocks.splice(i, 0, pick(['\t## Purpose\n\ntext\n\n', '   ## Purpose\n\ntext\n\n', '    ## Purpose\n\nText\n\n'])); // code-like heading lines
  }
  const preambleNoise = rnd() < 0.2 ? pick(['\t## Purpose\n\n', '   text\n\n', '\n\n\n']) : '';
  return front + preambleNoise + blocks.join('');
}

test('for random edits of the sections of the six records, the findings shown right after an import are the file\'s own', () => {
  const rnd = lcg(20261010);
  let differing = 0;
  const N = 600;
  for (let n = 0; n < N; n++) {
    const text = mutateSections(read(FILES[n % FILES.length]), rnd);
    store.loadMarkdown(text);
    const want = messages(lint(text));
    const got = shown();
    if (JSON.stringify(got) !== JSON.stringify(want)) assert.deepEqual(got, want, `edit ${n}: ${JSON.stringify(text.slice(0, 200))}`);
    if (JSON.stringify(messages(lint(toMarkdown(fromMarkdown(text).model)))) !== JSON.stringify(want)) differing++;
  }
  assert.ok(differing > 20, `${differing} of ${N} edits were checked differently once written out, and all of them are shown as the file`);
});

test('a CRLF file whose front matter is kept as text is written with LF line endings', () => {
  const lf = read('0001-partner-booking-api.md').replace(/^version: .*$/m, '&v version: 2.1.0');
  const { model } = fromMarkdown(lf.replace(/\n/g, '\r\n'));
  assert.equal(model.fm, null);
  assert.ok(!toMarkdown(model).includes('\r'));
});

// ---------- what the note says: the verdict of the file as it will be saved ----------

test('the note says whether the file as it will be saved would conform, in both directions', () => {
  // the file passes (the tab-indented line is code, not a heading), the export has the heading twice
  const passes = read('0001-partner-booking-api.md').replace(/^(# .*\n\n)/m, '$1\t## Purpose\n\n');
  assert.deepEqual(messages(lint(passes)), messages(lint(read('0001-partner-booking-api.md'))), 'the file is checked as the original is');
  store.loadMarkdown(passes);
  assert.match(store.analysis.exportNote ?? '', /As it will be saved, the file would not conform: .*Purpose/);
  assert.match(store.analysis.exportNote, /duplicate section "Purpose"/);
  assert.deepEqual(shown(), messages(lint(passes)), 'and the findings shown are the file\'s');
  // the file fails, the export passes
  store.loadMarkdown(CASES['a tab-indented "## Purpose" line first in the text before the first section (code, not a heading)']());
  assert.ok(store.analysis.problems.length > 0);
  assert.match(store.analysis.exportNote ?? '', /As it will be saved, the file would conform\./);
});

test('a file with no front matter, or an empty one, is written with front matter fields, and the note says so', () => {
  for (const text of [read('0001-partner-booking-api.md').replace(/^---\n[\s\S]*?\n---\n/, ''), read('0001-partner-booking-api.md').replace(/^---\n[\s\S]*?\n---\n/, '---\n\n---\n')]) {
    const { warnings } = store.loadMarkdown(text);
    assert.deepEqual(shown(), messages(lint(text)));
    assert.ok(store.analysis.problems.some((p) => /no YAML front matter|front matter is empty/.test(p.message)), shown().join('; '));
    assert.match(store.analysis.exportNote ?? '', /no front matter, or an empty one, is written with front matter fields/);
    assert.match(store.analysis.exportNote, /As it will be saved, the file would not conform/);
    assert.ok(warnings.some((w) => /would not conform/.test(w)));
  }
});

// ---------- the note is drawn, in the review and in the checks panel, and goes after an edit ----------

test('the review and the checks panel draw the note with the verdict of the export, and it goes when something is edited', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.js');
  const dom = installFakeDom();
  try {
    const { createReviewView } = await import('../js/views/review.js');
    const { createPanel } = await import('../js/views/panel.js');
    store.loadMarkdown(CASES['a tab-indented "## Purpose" line first in the text before the first section (code, not a heading)']());
    const review = createReviewView({ store });
    const panel = createPanel({ store });
    document.body.append(review.el, panel.el);
    panel.update();
    assert.match(review.el.textContent, /The saved file will differ from the file you opened/);
    assert.match(review.el.textContent, /As it will be saved, the file would conform\./);
    assert.match(panel.el.textContent, /would be written out differently/);
    assert.match(panel.el.textContent, /As it will be saved, the file would conform\./);
    // the findings drawn are the file's own: the missing Purpose is in the list
    assert.match(review.el.textContent, /Purpose/);
    store.change((m) => { m.preamble = m.preamble.trim(); });
    review.update();
    panel.update();
    assert.doesNotMatch(review.el.textContent, /The saved file will differ|As it will be saved, the file/);
    assert.doesNotMatch(panel.el.textContent, /would be written out differently/);
  } finally { dom.uninstall(); }
});

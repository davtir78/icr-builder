import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, splitDocument, scanBody } from '../js/lint.js';
import { parseYaml } from '../js/yaml.js';
import { fromMarkdown, toMarkdown, blankModel, getSection, setSection, setPath, getPath, strayHeadings, fileName } from '../js/model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, '..', 'templates');
const EXAMPLES = fs.readdirSync(TEMPLATES).filter((n) => n.endsWith('.md'));
const read = (f) => fs.readFileSync(path.join(TEMPLATES, f), 'utf8').replace(/\r\n/g, '\n');

/** Everything a reader of the record can see: front matter values, the heading, and each section as written. */
function content(text) {
  const doc = splitDocument(text);
  const scan = scanBody(doc.body);
  return { front: parseYaml(doc.yaml), preamble: scan.preamble.trim(), sections: scan.sections.map((s) => [s.title, s.raw]) };
}

for (const f of EXAMPLES) {
  test(`round trip: ${f} loses nothing`, () => {
    const original = read(f);
    const { model, warnings } = fromMarkdown(original);
    assert.deepEqual(warnings, []);
    const out = toMarkdown(model);
    assert.deepEqual(lint(out), [], 'the exported record still conforms');
    assert.deepEqual(content(out).front, content(original).front, 'front matter values');
    assert.deepEqual(content(out).sections, content(original).sections, 'every section, word for word');
    assert.equal(content(out).preamble, content(original).preamble, 'the heading and what follows it');
    // Writing it again changes nothing: the export is stable.
    assert.equal(toMarkdown(fromMarkdown(out).model), out);
  });
}

test('round trip: the Appointment Booking ICR comes back byte for byte', () => {
  const original = read('ICR-AB-0001-booking-api.md');
  assert.equal(toMarkdown(fromMarkdown(original).model), original);
});

test('round trip: a broken record keeps its failures (nothing is corrected on import)', () => {
  const broken = read('0001-partner-booking-api.md').replace('status: active', 'status: live').replace('icr: "0.2"', 'icr: "0.1"').replace(/## Observability[\s\S]*?(?=\n## Support)/, '');
  const { model } = fromMarkdown(broken);
  assert.deepEqual(lint(toMarkdown(model)), lint(broken));
  assert.equal(lint(broken).length, 3);
});

test('a heading that differs from the title is kept; one that matches follows the title', () => {
  const t = read('ICR-AB-0001-booking-api.md');
  assert.equal(fromMarkdown(t).model.h1, null);
  const m = fromMarkdown(t.replace('# Booking API', '# The booking contract')).model;
  assert.equal(m.h1, 'The booking contract');
  assert.match(toMarkdown(m), /\n# The booking contract\n/);
  const renamed = fromMarkdown(t).model;
  renamed.fm.title = 'Booking API v2';
  assert.match(toMarkdown(renamed), /\n# Booking API v2\n/);
});

test('guidance comments between the heading and the first section are kept', () => {
  const m = fromMarkdown(read('0002-meter-reading-stream.md')).model;
  assert.match(m.preamble, /WORKED EXAMPLE/);
  assert.match(toMarkdown(m), /<!-- WORKED EXAMPLE/);
});

test('a comment that opens a section stays with the section', () => {
  const t = read('0001-partner-booking-api.md').replace('## Purpose\n', '## Purpose\n\n<!-- one line of guidance -->\n\n');
  const m = fromMarkdown(t).model;
  assert.match(getSection(m, 'Purpose'), /^<!-- one line of guidance -->/);
  assert.deepEqual(lint(toMarkdown(m)), []);
});

test('the specification template opens, writes and fails only on its placeholders', () => {
  const t = fs.readFileSync(path.join(HERE, 'fixtures', 'template.md'), 'utf8').replace(/\r\n/g, '\n');
  const { model, warnings } = fromMarkdown(t);
  assert.deepEqual(warnings, []);
  assert.equal(model.fm.id, 'ICR-XXXX');
  // The template is not a conforming record, and exporting it must not change what the linter says.
  assert.deepEqual(lint(toMarkdown(model)).sort(), lint(t).sort());
});

test('a file with no front matter opens with blank fields and its sections', () => {
  const { model, warnings } = fromMarkdown('# Notes\n\n## Purpose\n\nBecause.\n');
  assert.equal(warnings.length, 1);
  assert.equal(getSection(model, 'Purpose'), 'Because.');
  assert.equal(model.h1, 'Notes');
});

test('front matter that cannot be read is kept as text and written back as it was', () => {
  const t = read('0001-partner-booking-api.md').replace(/^title: .*$/m, 'title: [unclosed');
  const { model, warnings } = fromMarkdown(t);
  assert.equal(model.fm, null);
  assert.match(warnings[0], /not valid YAML/);
  assert.match(model.fmRaw, /title: \[unclosed/);
  assert.deepEqual(lint(toMarkdown(model)), lint(t));
});

test('duplicate and unknown headings are kept and reported as stray', () => {
  const t = read('0001-partner-booking-api.md').replace('## Observability', '## Notes\n\nx\n\n## Security\n\ntwice\n\n## Observability');
  const { model } = fromMarkdown(t);
  assert.deepEqual(strayHeadings(model).map((s) => s.title), ['Notes', 'Security']);
  assert.deepEqual(lint(toMarkdown(model)).sort(), lint(t).sort());
});

// ---------- a new record ----------

test('a blank record has every required section, empty, so the checklist lists them', () => {
  const m = blankModel('2026-10-09');
  const problems = lint(toMarkdown(m));
  assert.equal(problems.filter((p) => /^required section ".*" is empty$/.test(p)).length, 14);
  assert.ok(problems.includes("front matter / must have required property 'id'"));
  assert.ok(problems.includes("front matter / must have required property 'pattern'"));
  assert.ok(!problems.some((p) => /\/icr|\/status|\/version|\/date/.test(p)), 'the defaults are valid');
});

test('optional sections that are empty are left out; written ones are put in order', () => {
  const m = blankModel();
  setSection(m, 'Open issues', '');
  setSection(m, 'Environments and onboarding', '- Test: sandbox');
  setSection(m, 'Related records', '- Pattern: x');
  const titles = [...toMarkdown(m).matchAll(/^## (.+)$/gm)].map((x) => x[1]);
  assert.ok(!titles.includes('Open issues'));
  assert.ok(titles.indexOf('Environments and onboarding') === titles.indexOf('Examples') + 1);
  assert.ok(titles.indexOf('Related records') === titles.indexOf('Acceptance criteria') + 1);
});

test('setPath removes blank values and empty objects, and keeps list items', () => {
  const fm = { provider: { system: 'A' }, consumers: [{ system: 'x', owner: 'y' }] };
  setPath(fm, ['provider', 'system'], '');
  assert.equal('provider' in fm, false);
  setPath(fm, ['consumers', 0, 'system'], '');
  assert.deepEqual(fm.consumers, [{ owner: 'y' }]);
  setPath(fm, ['data', 'personal-information'], false);
  assert.equal(getPath(fm, ['data', 'personal-information']), false);
});

test('file names are built from the id and the title', () => {
  assert.equal(fileName({ fm: { id: 'ICR-AB-0001', title: 'Booking API' } }), 'ICR-AB-0001-booking-api.md');
  assert.equal(fileName({ fm: {} }), 'ICR-draft.md');
});

test('strings that look like other YAML types are quoted so they read back as strings', () => {
  const m = blankModel();
  m.fm.title = 'true';
  m.fm.id = 'ICR-1';
  m.fm.provider = { system: '1.5', owner: 'a: b', contact: '# nobody' };
  const back = fromMarkdown(toMarkdown(m)).model.fm;
  assert.equal(back.title, 'true');
  assert.deepEqual({ ...back.provider }, m.fm.provider);
});

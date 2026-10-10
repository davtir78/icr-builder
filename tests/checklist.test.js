import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../js/lint.js';
import { buildChecklist } from '../js/checklist.js';
import { blankModel, toMarkdown } from '../js/model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, '..', 'templates', f), 'utf8');
const check = (text) => buildChecklist(analyze(text));
const state = (c, kind, key) => c[kind].find((x) => (x.id ?? x.key ?? x.title) === key).state;

test('every worked example: verdict ok, all rules pass, all required fields and sections pass', () => {
  for (const f of fs.readdirSync(path.join(HERE, '..', 'templates')).filter((n) => n.endsWith('.md'))) {
    const c = check(read(f));
    assert.equal(c.verdict.ok, true, f);
    assert.ok(c.rules.every((r) => r.state === 'pass'), f);
    assert.ok(c.fields.every((r) => r.state === 'pass'), f);
    assert.ok(c.sections.filter((s) => s.required).every((s) => s.state === 'pass'), f);
  }
});

test('a blank record: front matter fields and sections fail, and rules that need a section wait', () => {
  const c = check(toMarkdown(blankModel('2026-10-09')));
  assert.equal(c.verdict.ok, false);
  assert.equal(state(c, 'fields', 'id'), 'fail');
  assert.equal(state(c, 'fields', 'icr'), 'pass');
  assert.equal(state(c, 'sections', 'Purpose'), 'fail');
  assert.equal(state(c, 'sections', 'Open issues'), 'na');
  assert.equal(state(c, 'rules', 'criteria'), 'todo');
  assert.equal(state(c, 'rules', 'flows'), 'todo');
  assert.equal(state(c, 'rules', 'examples'), 'todo');
  assert.equal(state(c, 'rules', 'sections'), 'fail');
});

test('the checklist names the same failures the linter reports', () => {
  const bad = read('0001-partner-booking-api.md').replace('status: active', 'status: agreed').replace(/\s*$/, '\n\n## Open issues\n\n- Undecided.\n').replace(/## Examples[\s\S]*?(?=\n## )/, '## Examples\n\nNone.\n');
  const c = check(bad);
  assert.equal(state(c, 'rules', 'status'), 'fail');
  assert.equal(state(c, 'rules', 'examples'), 'fail');
  assert.equal(c.verdict.count, 2);
  assert.equal(state(c, 'sections', 'Examples'), 'fail');
  assert.equal(state(c, 'fields', 'status'), 'pass', 'the status value itself is valid; the rule failing is about open issues');
});

test('front matter that is not valid YAML makes the field rows wait rather than pass', () => {
  const c = check(read('0001-partner-booking-api.md').replace(/^title: .*$/m, 'title: [x'));
  assert.equal(state(c, 'rules', 'frontmatter'), 'fail');
  assert.ok(c.fields.every((f) => f.state === 'todo'));
});

test('a field is marked from the schema finding about it', () => {
  const c = check(read('0001-partner-booking-api.md').replace('icr: "0.2"', 'icr: "0.1"').replace(/^id: .*\n/m, ''));
  assert.equal(state(c, 'fields', 'icr'), 'fail');
  assert.equal(state(c, 'fields', 'id'), 'fail');
  assert.equal(state(c, 'fields', 'title'), 'pass');
});

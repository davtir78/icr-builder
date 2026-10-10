// Tests for js/lint.js. The cases are those of the specification's tools/lint-icr.test.cjs: each
// edits a worked example and states whether the linter should accept it, with the same messages.
// (The specification's tests run the command-line linter; these call the browser module in-process.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, analyze } from '../js/lint.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, '..', 'templates');
const read = (f) => fs.readFileSync(path.join(TEMPLATES, f), 'utf8').replace(/\r\n/g, '\n');
const EXAMPLE = read('0001-partner-booking-api.md');
const F = '`'.repeat(3);

function run(text) {
  const problems = lint(text);
  return { ok: problems.length === 0, out: problems.map((p) => `  - ${p}`).join('\n') };
}
function edit(fn) {
  const out = fn(EXAMPLE);
  assert.notEqual(out, EXAMPLE, 'the edit changed nothing');
  return out;
}
const accepts = (name, fn) => test(`accepts: ${name}`, () => { const r = run(edit(fn)); assert.ok(r.ok, r.out); });
const rejects = (name, fn, pattern) => test(`rejects: ${name}`, () => { const r = run(edit(fn)); assert.ok(!r.ok, 'should have failed'); assert.match(r.out, pattern); });

// ── the worked examples ──
const EXAMPLES = fs.readdirSync(TEMPLATES).filter((n) => n.endsWith('.md'));
for (const f of EXAMPLES) {
  test(`the worked example ${f} passes`, () => { const r = run(read(f)); assert.ok(r.ok, r.out); });
}
test('there are six worked examples', () => { assert.equal(EXAMPLES.length, 6); });

const COMMENT_WITH_FENCE = '<!--\nGuidance with an example:\n' + F + '\nexample\n' + F + '\n-->\n';

// ── valid Markdown the linter must accept ──
accepts('a ~~~mermaid fence', (t) => t.replace(F + 'mermaid', '~~~mermaid').replace(/(sequenceDiagram[\s\S]*?\n)```\n/, '$1~~~\n'));
accepts('a space before the info string', (t) => t.replace(F + 'mermaid', F + ' mermaid'));
accepts('a closing fence longer than the opening one', (t) => t.replace(/(\n  end\n)```\n/, '$1' + '`'.repeat(4) + '\n'));
accepts('"1)" numbered criteria', (t) => t.replace(/^(\d+)\. /gm, (m, n, off, s) => (s.slice(off).startsWith(n + '. ') && s.lastIndexOf('## Acceptance criteria', off) >= 0 && off > s.indexOf('## Acceptance criteria') && off < s.indexOf('## Related records') ? n + ') ' : m)));
accepts('a stray "<!--" in inline code followed later by a Mermaid arrow', (t) => t.replace('## Purpose\n', '## Purpose\n\nWrite `<!--` to open a comment.\n'));
accepts('an unclosed XML comment inside an Examples fence', (t) => t.replace(F + 'http\nHTTP/1.1 409', F + 'xml\n<!-- not closed\n' + F + '\n\n' + F + 'http\nHTTP/1.1 409'));
accepts('a closing # on a heading', (t) => t.replace('## Purpose\n', '## Purpose ##\n'));
accepts('a byte-order mark', (t) => '﻿' + t);
accepts('trailing spaces after the closing front matter delimiter', (t) => t.replace('\n---\n\n# ', '\n---  \n\n# '));
accepts('a change log as a sub-heading of Change and versioning', (t) => t.replace('## Observability', '### Change log\n\n- 2.1.0: added the cancel operation.\n\n## Observability'));
accepts('CRLF line endings', (t) => t.replace(/\n/g, '\r\n'));

// ── things the spec says must fail ──
rejects('empty front matter', (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '---\n\n---\n'), /front matter is empty/);
rejects('whitespace-only front matter', (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '---\n   \n---\n'), /front matter is empty/);
rejects('a record that still says icr 0.1', (t) => t.replace('icr: "0.2"', 'icr: "0.1"'), /\/icr must be equal to constant/);
rejects('an empty accTitle', (t) => t.replace(/accTitle: .*\n/, 'accTitle:\n'), /no accTitle/);
rejects('an empty accDescr', (t) => t.replace(/accDescr: .*\n/, 'accDescr:\n'), /no accDescr/);
rejects('a diagram shown only inside a longer fence', (t) => t.replace(F + 'mermaid', '`'.repeat(4) + 'markdown\n' + F + 'mermaid').replace(/(sequenceDiagram[\s\S]*?\n  end\n)```\n/, '$1' + F + '\n' + '`'.repeat(4) + '\n'), /no Mermaid sequenceDiagram/);
rejects('a flowchart that mentions sequenceDiagram on a later line', (t) => t.replace('sequenceDiagram\n', 'flowchart LR\n  sequenceDiagram\n'), /no Mermaid sequenceDiagram/);
rejects('acceptance criterion 2 written as a bullet', (t) => t.replace(/(## Acceptance criteria[\s\S]*?)^2\. /m, '$1- '), /not all numbered/);
rejects('acceptance criteria after the first written as bullets', (t) => t.replace(/(## Acceptance criteria[\s\S]*?^1\. [^\n]*\n)\d+\. /m, '$1- ').replace(/^(\d+)\. /gm, (m, n) => (n === '1' ? m : '- ')), /not all numbered/);
rejects('bullet criteria before the numbered ones', (t) => t.replace(/(## Acceptance criteria\n\n)/, '$1- A bulleted criterion.\n- Another.\n'), /not all numbered/);
rejects('an Examples section with no fence', (t) => t.replace(/## Examples[\s\S]*?(?=\n## )/, '## Examples\n\nSee the developer portal.\n'), /Examples has no fenced example/);
rejects('a missing Interaction flows section', (t) => t.replace(/## Interaction flows[\s\S]*?(?=\n## Interface specification)/, ''), /missing required section "Interaction flows"/);
rejects('an unknown level-2 heading', (t) => t.replace('## Observability', '## Change log\n\nNothing yet.\n\n## Observability'), /unknown section "Change log"/);
rejects('agreed with open issues', (t) => t.replace('status: active', 'status: agreed').replace(/\s*$/, '\n\n## Open issues\n\n- The retry limit is undecided.\n'), /with open issues/);

// ── precedence between comments and fences, and the rest of round two ──
accepts('a guidance comment that contains a fence', (t) => t.replace('## Purpose\n', '## Purpose\n\n' + COMMENT_WITH_FENCE));
rejects('a comment opened and never closed (at the end of the document: a later "-->" would close it)', (t) => t.trimEnd() + '\n\n<!-- never closed\n', /never closed/);
accepts('a multi-line init directive before sequenceDiagram', (t) => t.replace(/sequenceDiagram\n/, "%%{init: {\n  'theme': 'dark'\n}}%%\nsequenceDiagram\n"));
rejects('an empty brace-form accDescr', (t) => t.replace(/accDescr: .*\n/, 'accDescr {\n}\n'), /no accDescr/);
accepts('a brace-form accDescr with a body', (t) => t.replace(/accDescr: (.*)\n/, 'accDescr {\n  $1\n}\n'));
accepts('notes and a thematic break after the criteria', (t) => t.replace('## Related records', '* * *\n\nNotes:\n\n- Criterion 9 needs the OpenAPI file.\n\n## Related records'));
const MERMAID_BLOCK = EXAMPLE.match(/```mermaid\n([\s\S]*?)\n```/)[1];
const indented = (body) => body.split('\n').map((l) => (l ? '    ' + l : l)).join('\n');
const FLOWS = /## Interaction flows[\s\S]*?(?=\n## Interface specification)/;
accepts('two fences indented four spaces inside one list item', (t) => t.replace(FLOWS, '## Interaction flows\n\n-   The flow:\n\n    ' + F + 'text\n    notes\n    ' + F + '\n\n    ' + F + 'mermaid\n' + indented(MERMAID_BLOCK) + '\n    ' + F + '\n'));
accepts('a fence indented four spaces after wrapped list text', (t) => t.replace(FLOWS, '## Interaction flows\n\n- The flow, which is\n  wrapped onto a second line:\n\n    ' + F + 'mermaid\n' + indented(MERMAID_BLOCK) + '\n    ' + F + '\n'));
accepts('a comment opener written as <!-->', (t) => t.replace('## Purpose\n', '## Purpose\n\n<!-->\n'));
accepts('a heading indented one space', (t) => t.replace('## Purpose\n', ' ## Purpose\n'));
accepts('a heading with a tab after the hashes', (t) => t.replace('## Purpose\n', '##\tPurpose\n'));
rejects('an indented code block that contains fence lines, as the only example', (t) => t.replace(/## Examples[\s\S]*?(?=\n## )/, '## Examples\n\n    ' + F + '\n    sample\n    ' + F + '\n'), /Examples has no fenced example/);

// ── front matter checks the schema makes (messages worded as Ajv words them) ──
const fm = (name, fn, pattern) => rejects(`front matter: ${name}`, fn, pattern);
fm('a missing required field', (t) => t.replace(/^id: .*\n/m, ''), /front matter \/ must have required property 'id'/);
fm('a bad id', (t) => t.replace(/^id: .*$/m, 'id: PRJ-1'), /\/id must match pattern "\^ICR-\[0-9A-Za-z-\]\+\$"/);
fm('a title that is too short', (t) => t.replace(/^title: .*$/m, 'title: ab'), /\/title must NOT have fewer than 3 characters/);
fm('a status outside the list', (t) => t.replace('status: active', 'status: live'), /\/status must be equal to one of the allowed values/);
fm('a version that is not semantic', (t) => t.replace(/^version: .*$/m, 'version: 2.1'), /\/version must be string/);
fm('a version that does not match', (t) => t.replace(/^version: .*$/m, 'version: v2'), /\/version must match pattern/);
fm('a date that is not a date', (t) => t.replace(/^date: .*$/m, 'date: 2026-02-30'), /\/date must match format "date"/);
fm('an interaction outside the list', (t) => t.replace(/^interaction: .*$/m, 'interaction: sync'), /\/interaction must be equal to one of the allowed values/);
fm('no consumers', (t) => t.replace(/consumers:\n(?: {2}.*\n)+/, 'consumers: []\n'), /\/consumers must NOT have fewer than 1 items/);
fm('an unknown property', (t) => t.replace(/^data:/m, 'owner: me\ndata:'), /front matter \/ must NOT have additional properties/);
fm('personal-information that is not a boolean', (t) => t.replace(/personal-information: .*/, 'personal-information: "yes"'), /\/data\/personal-information must be boolean/);
fm('an interface type outside the list', (t) => t.replace(/- type: openapi/, '- type: swagger'), /\/interfaces\/0\/type must be equal to one of the allowed values/);
fm('a number where a string is required', (t) => t.replace('icr: "0.2"', 'icr: 0.2'), /\/icr must be string/);
fm('a pattern url that is not a URI', (t) => t.replace(/^( {2}url: ).*$/m, '$1<link to the pattern>'), /\/pattern\/url must match format "uri"/);
fm('front matter that is not valid YAML', (t) => t.replace(/^title: .*$/m, 'title: [unclosed'), /front matter is not valid YAML/);
test('rejects: no front matter at all', () => {
  assert.deepEqual(lint('# Just a heading\n\n## Purpose\n\nx\n'), ['no YAML front matter']);
});

test('a record with broken YAML still has its sections checked', () => {
  const p = lint(EXAMPLE.replace(/^title: .*$/m, 'title: [unclosed').replace(/## Examples[\s\S]*?(?=\n## )/, '## Examples\n\nNone.\n'));
  assert.ok(p.some((m) => /not valid YAML/.test(m)));
  assert.ok(p.includes('Examples has no fenced example'));
});

test('analyze tags each finding with its rule', () => {
  const a = analyze(EXAMPLE.replace('status: active', 'status: agreed').replace(/\s*$/, '\n\n## Open issues\n\n- Open.\n').replace('icr: "0.2"', 'icr: "0.1"'));
  const byRule = Object.fromEntries(a.problems.map((p) => [p.rule, p.message]));
  assert.match(byRule.status, /with open issues/);
  assert.match(byRule.frontmatter, /\/icr must be equal to constant/);
  assert.equal(a.problems.find((p) => p.rule === 'frontmatter').field, 'icr');
});

test('a section holding only a comment is empty (comments are not content)', () => {
  const t = EXAMPLE.replace(/## Purpose\n[\s\S]*?(?=\n## Parties)/, '## Purpose\n\n<!-- write it -->\n');
  assert.deepEqual(lint(t), ['required section "Purpose" is empty']);
});

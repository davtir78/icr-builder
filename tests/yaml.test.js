import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml as parseRaw, dumpYaml, resolvePlain, needsQuotes, YamlError } from '../js/yaml.js';
import { ICR_SCHEMA } from '../js/schema.js';

// parseYaml returns objects with no prototype (so a key such as __proto__ is only a key); compare them as plain data.
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const parseYaml = (s) => plain(parseRaw(s));

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('plain scalars resolve as the YAML core schema does', () => {
  assert.equal(resolvePlain('~'), null);
  assert.equal(resolvePlain('null'), null);
  assert.equal(resolvePlain('true'), true);
  assert.equal(resolvePlain('False'), false);
  assert.equal(resolvePlain('42'), 42);
  assert.equal(resolvePlain('0x1F'), 31);
  assert.equal(resolvePlain('0.2'), 0.2);
  assert.equal(resolvePlain('1e3'), 1000);
  // strings that merely look like something else
  for (const s of ['1.0.0', '2026-09-19', 'ICR-0001', '1:30', 'yes', 'No', 'v2']) assert.equal(resolvePlain(s), s);
});

test('block maps, nested maps, lists of maps and lists at the key indent', () => {
  const v = parseYaml(`icr: "0.2"
pattern:
  id: int-api-external
  url: https://www.itarchitecturepatterns.net/patterns/int-api-external
consumers:
  - system: A
    owner: B
    contact: c@example.org
  - system: D
    owner: E
decisions:
- ADR-1
- ADR-2
supersedes: null
`);
  assert.deepEqual(v, {
    icr: '0.2',
    pattern: { id: 'int-api-external', url: 'https://www.itarchitecturepatterns.net/patterns/int-api-external' },
    consumers: [{ system: 'A', owner: 'B', contact: 'c@example.org' }, { system: 'D', owner: 'E' }],
    decisions: ['ADR-1', 'ADR-2'],
    supersedes: null,
  });
});

test('flow collections, quotes, comments and block scalars', () => {
  assert.deepEqual(parseYaml('decisions: [ADR-0012, "ADR 2", \'it\'\'s\']  # why\nempty: []\nm: {a: 1, b: x}'), { decisions: ['ADR-0012', 'ADR 2', "it's"], empty: [], m: { a: 1, b: 'x' } });
  assert.deepEqual(parseYaml('a: "x # not a comment"  # a comment\nb: y#z'), { a: 'x # not a comment', b: 'y#z' });
  assert.deepEqual(parseYaml('a: |\n  one\n  two\nb: >\n  folded\n  text\nc: 1'), { a: 'one\ntwo\n', b: 'folded text\n', c: 1 });
  assert.deepEqual(parseYaml('d: [a,\n  b]\n'), { d: ['a', 'b'] });
  assert.equal(parseYaml('t: "tab\\there \\u00e9"').t, 'tab\there é');
});

test('an empty document is undefined; scalars and lists at the top are returned as they are', () => {
  assert.equal(parseYaml(''), undefined);
  assert.equal(parseYaml('  \n# only a comment\n'), undefined);
  assert.equal(parseYaml('just text'), 'just text');
  assert.deepEqual(parseYaml('- a\n- b'), ['a', 'b']);
});

test('errors are reported, with a line number', () => {
  for (const bad of ['a: [unclosed', 'a: 1\na: 2', 'a: x: y', 'a: "open', 'a: 1\n  b: 2', '\tkey: v', 'a: &anchor x', 'a: @x']) {
    assert.throws(() => parseYaml(bad), YamlError, bad);
  }
  try { parseYaml('a: 1\nb: x: y'); } catch (e) { assert.match(e.reason, /line 2/); }
});

test('every front matter in the examples is read and written back to the same values', () => {
  for (const f of fs.readdirSync(path.join(HERE, '..', 'templates')).filter((n) => n.endsWith('.md'))) {
    const t = fs.readFileSync(path.join(HERE, '..', 'templates', f), 'utf8');
    const yaml = t.match(/^---\n([\s\S]*?)\n---\n/)[1];
    const v = parseYaml(yaml);
    assert.deepEqual(parseYaml(dumpYaml(v)), v, f);
  }
});

test('strings are quoted only when they have to be', () => {
  assert.equal(needsQuotes('Booking API'), false);
  assert.equal(needsQuotes('2026-09-19'), false);
  assert.equal(needsQuotes('ICR-AB-0001'), false);
  assert.equal(needsQuotes('0.2'), true);
  assert.equal(needsQuotes('true'), true);
  assert.equal(needsQuotes(''), true);
  assert.equal(needsQuotes('a: b'), true);
  assert.equal(needsQuotes('note # more'), true);
  assert.equal(needsQuotes('- item'), true);
  assert.equal(needsQuotes('x\ny'), true);
  assert.equal(dumpYaml({ icr: '0.2', t: 'say "hi"', n: null, b: false, e: [], o: {} }), 'icr: "0.2"\nt: say "hi"\nn: null\nb: false\ne: []\no: {}');
});

test('keys are written in the preferred order, the rest after, undefined left out', () => {
  const out = dumpYaml({ z: 1, id: 'x', icr: '0.2', gone: undefined, a: 2 }, { order: { '': ['icr', 'id'] } });
  assert.equal(out, 'icr: "0.2"\nid: x\nz: 1\na: 2');
});

test('the embedded schema is the specification\'s schema', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'icr.schema.json'), 'utf8'));
  assert.deepEqual(ICR_SCHEMA, fixture);
});

// ---------- agreement with js-yaml 4.3 (the reference reads front matter with it) ----------
import { analyze, lint } from '../js/lint.js';
import { fromMarkdown, toMarkdown } from '../js/model.js';
const EX = fs.readFileSync(path.join(HERE, '..', 'templates', '0001-partner-booking-api.md'), 'utf8').replace(/\r\n/g, '\n');
const errorOf = (text) => { try { parseRaw(text); } catch (e) { return e; } return null; };

test('a plain value cannot start with a block indicator: "title: - x y z", "title: ? abc", "title: -" are invalid', () => {
  for (const bad of ['title: - x y z', 'title: ? abc def', 'title: -', 'title: ?', 'title: : x', 'a: - x']) {
    const e = errorOf(bad);
    assert.ok(e instanceof YamlError && !e.unsupported, bad);
    assert.match(e.reason, /bad indentation of a mapping entry/);
  }
  for (const ok of ['title: -x', 'title: ?x', 'title: a - b', 'title: a ? b', 'title: a:b']) assert.doesNotThrow(() => parseRaw(ok), ok);
  const a = analyze(EX.replace(/^title: .*$/m, 'title: - x y z'));
  assert.ok(a.problems.some((p) => /not valid YAML/.test(p.message)), 'reported as invalid, as the reference does');
});

test('a block mapping inside a flow sequence is a mapping, so the schema rejects it as the reference does', () => {
  assert.deepEqual(parseYaml('decisions: [a: b]'), { decisions: [{ a: 'b' }] });
  assert.deepEqual(parseYaml('decisions: [a: b, c, "d": e, f:g]'), { decisions: [{ a: 'b' }, 'c', { d: 'e' }, 'f:g'] });
  assert.ok(lint(EX.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [a: b]\n')).includes('front matter /decisions/0 must be string'));
  for (const bad of ['a: [,]', 'a: [a,,b]', 'a: {a: 1,,}', 'a: [- x]']) assert.ok(errorOf(bad) && !errorOf(bad).unsupported, bad);
  assert.deepEqual(parseYaml('a: [a, b,]'), { a: ['a', 'b'] });
});

test('complex keys and a "---" document start are reported as unsupported here, not as invalid', () => {
  for (const text of ['? id\n: ICR-0001', '? [a]\n: b', '- ? a', 'a: [? x]', '--- # c\nid: x', '---\nid: x', 'a: [*x]', 'a: [&x y]', 'a: [!!str x]']) {
    const e = errorOf(text);
    assert.ok(e?.unsupported, text);
  }
  const t = EX.replace(/^icr: .*$/m, '--- # start of the document\nicr: "0.2"');
  const a = analyze(t);
  assert.ok(a.unsupported, 'noted as not checked');
  assert.deepEqual(a.problems.filter((p) => p.rule === 'frontmatter'), [], 'and not reported as invalid');
  const { model, warnings } = fromMarkdown(t);
  assert.equal(model.fm, null);
  assert.match(warnings[0], /uses YAML this tool cannot read/);
  assert.match(toMarkdown(model), /--- # start of the document/);
  const complex = analyze(EX.replace(/^id: .*$/m, '? id\n: ICR-0001'));
  assert.ok(complex.unsupported);
  assert.deepEqual(complex.problems.filter((p) => p.rule === 'frontmatter'), []);
});

test('other differences found against js-yaml 4.3', () => {
  assert.deepEqual(parseYaml('a:b: c'), { 'a:b': 'c' }, 'a colon with no blank after it is part of the key');
  assert.equal(parseYaml('a: >\n  x\n  y\n\n  z\n').a, 'x y\nz\n', 'a blank line in a folded scalar is one line break');
  assert.equal(parseYaml('a: >\n\n  x\n').a, '\nx\n', 'leading blank lines are kept');
  assert.equal(parseYaml('a:\n   b\n  c').a, 'b c', 'a plain scalar on its own line may continue at a lower indent than its first line');
  assert.ok(errorOf('- x # c\n  y'), 'a comment ends a plain scalar');
  assert.ok(errorOf('id: a #b\nid2: x\n  y'.replace('id2: x\n  y', '- 1')), 'content after a commented scalar is not a continuation');
  assert.ok(errorOf('a: 1\n...\nb: 2'), 'content after a document end marker');
  assert.equal(parseYaml('a: 1\n...\n# comment\n').a, 1);
  assert.equal(parseYaml('x: a\n  b # c').x, 'a b');
});

test('numbers are read as js-yaml 4.3 reads them', () => {
  const cases = { '0': 0, '-0': 0, '017': 17, '08': 8, '+5': 5, '0o17': 15, '0b101': 5, '0x1F': 31, '1.5': 1.5, '1.': 1, '.5': 0.5, '1e3': 1000, '1.0e+3': 1000, '-1.5e-2': -0.015 };
  for (const [text, value] of Object.entries(cases)) assert.equal(resolvePlain(text), value, text);
  for (const s of ['1_000', '1_0.5', '0x_1F', '1__0', '1_', '_1', '-.5', '0b', '0x', '0o8', '1e', '1e+', '12:30', '1,000', '1e999', '9'.repeat(400)]) assert.equal(resolvePlain(s), s, s);
  assert.equal(resolvePlain('.inf'), Infinity);
  assert.equal(resolvePlain('-.INF'), -Infinity);
  assert.ok(Number.isNaN(resolvePlain('.NaN')));
  // the writer quotes the string "1_000" so that js-yaml 4.1 (which read it as a number) and 4.3 agree
  assert.equal(needsQuotes('1_000'), true);
  assert.equal(dumpYaml({ version: '1_000' }), 'version: "1_000"');
});

// ---------- second review: more agreement with js-yaml 4.3 (N1) ----------

test('a block scalar whose first line is blanks reaching further than its text is invalid, as in js-yaml', () => {
  for (const bad of ['title: >\n   \n  Partner room availability API', 'title: |\n   \n  Partner', 'title: |-\n   \n  P', '- |\n   \n  x', '- >\n    \n  x']) {
    const e = errorOf(bad);
    assert.ok(e instanceof YamlError && !e.unsupported, JSON.stringify(bad));
    assert.match(e.reason, /bad indentation of a (mapping|sequence) entry/);
  }
  // blanks no wider than the text are just a blank line
  assert.equal(parseYaml('a: |\n  \n  x\n').a, '\nx\n');
  assert.equal(parseYaml('a: |\n    \n    x\n').a, '\nx\n');
  const a = analyze(EX.replace(/^title: .*$/m, 'title: >\n   \n  Partner room availability API'));
  assert.ok(a.problems.some((p) => /not valid YAML/.test(p.message)));
});

test('blanks beyond the indent inside a block scalar are kept', () => {
  assert.equal(parseYaml('a: |\n  x\n    \n  y\n').a, 'x\n  \ny\n');
  assert.equal(parseYaml('a: >\n  x\n    \n  y\n').a, 'x\n  \ny\n');
  assert.equal(parseYaml('a: |\n  x\n  \n  y\n').a, 'x\n\ny\n');
  assert.equal(parseYaml('a: |\n  x\n   ').a, 'x\n \n');
  assert.equal(parseYaml('a: >+\n  \n').a, '\n');
});

test('a comment may follow a closing quote or bracket with no space before the #', () => {
  assert.deepEqual(parseYaml('icr: "0.2"#spec\nid: x'), { icr: '0.2', id: 'x' });
  assert.deepEqual(parseYaml("a: 'x'#c"), { a: 'x' });
  assert.deepEqual(parseYaml('a: [x]#c'), { a: ['x'] });
  assert.deepEqual(parseYaml('a: {x: 1}#c'), { a: { x: 1 } });
  assert.deepEqual(parseYaml('a: [a, [b]#c\n  ]'), { a: ['a', ['b']] });
  // a # glued to plain text is part of it
  assert.deepEqual(parseYaml('a: x#c\nb: x[1]#c'), { a: 'x#c', b: 'x[1]#c' });
  assert.deepEqual(parseYaml('a:"q"#c'), 'a:"q"#c');
  assert.equal(lint(EX.replace(/^icr: .*$/m, 'icr: "0.2"#spec')).length, 0);
});

test('keys that js-yaml resolves are duplicates when they resolve alike', () => {
  for (const dup of ['~: 1\nnull: 2', 'true: 1\nTrue: 2', '1: a\n01: b', '1: a\n0x1: b', '"1": a\n1: b', 'a: 1\n"a": 2', '.5: a\n0.5: b']) {
    const e = errorOf(dup);
    assert.ok(e instanceof YamlError && !e.unsupported && /duplicated mapping key/.test(e.reason), JSON.stringify(dup));
  }
  assert.deepEqual(parseYaml('~: 1'), { null: 1 });
  assert.deepEqual(parseYaml('"~": 1\n~: 2'), { '~': 1, null: 2 });
});

test('flow collections as keys and single-line complex keys are unsupported here, not invalid', () => {
  for (const text of ['[a]: x', 'a: 1\n[a]: x', '{a: 1}: x', '? k: v', 'a: 1\n? k: v', 'a: 1\n? k\n: v', '- a\n- [b]: c']) {
    assert.ok(errorOf(text)?.unsupported, JSON.stringify(text));
  }
  const a = analyze(EX.replace(/^id: .*$/m, '? k: v\nid: ICR-0001'));
  assert.ok(a.unsupported);
  assert.deepEqual(a.problems.filter((p) => p.rule === 'frontmatter'), []);
});

// ---------- third review (R3-1, R3-2, R3-8) ----------

test('a quote or bracket in the middle of plain text opens nothing, and the # after it is text (R3-1)', () => {
  for (const [text, want] of [
    ['title: Booking API "v2"#draft', 'Booking API "v2"#draft'],
    ['title: Booking API [v2]#draft', 'Booking API [v2]#draft'],
    ['title: Booking API {v2}#draft', 'Booking API {v2}#draft'],
    ["title: Booking API 'v2'#draft", "Booking API 'v2'#draft"],
    ['title: Booking "x #y"', 'Booking "x'],
    ['title: Booking\n  API "v2"#draft', 'Booking API "v2"#draft'],
    ['title: Booking\n  "v2"#draft', 'Booking "v2"#draft'],
  ]) assert.equal(parseYaml(text).title, want, text);
  // as a value, a key or a list item, a quote or bracket does open one, and a # right after it is a comment
  assert.deepEqual(parseYaml('a: "x"#c\nb: [y]#c\nc: \'z\' #c\n"k"#c: v'.replace('\n"k"#c: v', '')), { a: 'x', b: ['y'], c: 'z' });
  assert.deepEqual(parseYaml('- "a"#c\n- - \'b\'#c'), ['a', ['b']]);
  assert.ok(errorOf('title: Booking "x"#y: z'), 'the reference rejects a ": " inside the plain value');
  // and what the page writes back is what was read
  const t = EX.replace(/^title: .*$/m, 'title: Booking API "v2"#draft');
  assert.match(toMarkdown(fromMarkdown(t).model), /^title: Booking API "v2"#draft$/m);
  assert.equal(fromMarkdown(t).model.fm.title, 'Booking API "v2"#draft');
});

test('"..." ends the document only at the start of a line (R3-2)', () => {
  assert.throws(() => parseYaml('a:\n  b: 1\n  ...'), YamlError);
  assert.throws(() => parseYaml('a:\n  - b\n  ...'), YamlError);
  assert.equal(parseYaml('k:\n  ...').k, '...');
  assert.equal(parseYaml('a: 1\n...').a, 1);
  assert.equal(parseYaml('a: 1\n... # the end').a, 1);
  const broken = EX.replace(/^(provider:\n(?: {2}.*\n)+)/m, '$1  ...\n');
  assert.notEqual(broken, EX);
  assert.ok(lint(broken).some((m) => /not valid YAML/.test(m)), 'a record whose provider block is followed by an indented "..." is invalid');
});

test('an apostrophe inside a plain flow value, and a quoted list item over several lines, are read (R3-8)', () => {
  assert.deepEqual(parseYaml("a: [it's, b]"), { a: ["it's", 'b'] });
  assert.deepEqual(parseYaml("a: [it's, 'b c', \"d\", 'it''s']"), { a: ["it's", 'b c', 'd', "it's"] });
  assert.deepEqual(parseYaml('- "a\n  b"\n- c'), ['a b', 'c']);
  assert.deepEqual(parseYaml('- a\n- "b\n  c" # note\n- d'), ['a', 'b c', 'd']);
  assert.deepEqual(parseYaml('a:\n  - "x\n    y"'), { a: ['x y'] });
  assert.deepEqual(parseYaml('- k: "b\n    c"'), [{ k: 'b c' }]);
});

// ---------- fourth review (R4-1, R4-2, R4-3) ----------

const NBSP = '\u00a0';

test('YAML separates with a space or a tab only; no-break, ideographic and other Unicode spaces are text (R4-1)', () => {
  // as a value or a key, such a character is part of the text, so the schema sees it
  assert.equal(parseYaml(`status: active${NBSP}`).status, `active${NBSP}`);
  assert.equal(parseYaml(`title: ${NBSP}x`).title, `${NBSP}x`);
  assert.deepEqual(Object.keys(parseYaml('data\ufeff: x')), ['data\ufeff']);
  assert.deepEqual(Object.keys(parseYaml('data\u3000: x')), ['data\u3000']);
  assert.equal(parseYaml('a: b\u3000').a, 'b\u3000');
  assert.equal(parseYaml('a: b\u2028c').a, 'b\u2028c');
  // after a colon one is not a separator, so there is no mapping entry; the same for a dash
  for (const bad of [`status:${NBSP}active`, 'a:\u3000b', `version:${NBSP}1.0.0`, `url:${NBSP}https://x.example/y`, `-${NBSP}a`]) assert.ok(errorOf('first: 1\n' + bad), JSON.stringify(bad));
  // but one at the start of a line begins a plain scalar, so it is a key (as in js-yaml), not indentation
  assert.deepEqual(Object.keys(parseYaml(`first: 1\n${NBSP}a: b`)), ['first', `${NBSP}a`]);
  // through the whole linter
  assert.ok(lint(EX.replace(/^status: .*$/m, `status: active${NBSP}`)).some((m) => /status/.test(m)), 'a no-break space after the status is not the status');
  assert.ok(lint(EX.replace(/^status: .*$/m, `status:${NBSP}active`)).some((m) => /not valid YAML/.test(m)));
  assert.ok(lint(EX.replace(/^date: .*$/m, `date:\u3000${'2026-10-09'}`)).length > 0);
});

test('YAML never indents with a tab (R4-1)', () => {
  for (const bad of ['provider:\n  system: A\n  \towner: B', 'provider:\n\tsystem: A', 'provider:\n  \tsystem: A\n  owner: B', 'provider:\n \t system: A', 'a:\n  - b\n  \t- c', 'a:\n\t- b']) {
    const e = errorOf(bad);
    assert.ok(e instanceof YamlError && !e.unsupported && /tab characters must not be used in indentation/.test(e.reason), JSON.stringify(bad));
  }
  // a tab after a list dash cannot line up a mapping or a sequence that starts there, so js-yaml refuses it; a scalar is fine
  for (const bad of ['- \tk: v', '-\tk: v\n- x', 'a:\n  -\tk: v\n    j: w', '-\t- a']) assert.match(errorOf(bad)?.reason ?? '', /bad indentation of a sequence entry/, bad);
  assert.deepEqual(parseYaml('-\tk\n- x'), ['k', 'x']);
  // a tab is fine where it only separates, and in block scalar text
  assert.deepEqual(parseYaml('a:\tb\nc: d\t# e'), { a: 'b', c: 'd' });
  assert.deepEqual(parseYaml('- \ta\n-\tb'), ['a', 'b']);
  assert.equal(parseYaml('a: |\n  x\n  \ty\n').a, 'x\n\ty\n');
  const a = analyze(EX.replace(/^( {2})owner: (.*)$/m, '  \towner: $2'));
  assert.ok(a.problems.some((p) => /not valid YAML: tab characters must not be used in indentation/.test(p.message)));
});

test('a document with a character js-yaml refuses is invalid, as it is for the linter (R4-2)', () => {
  const cases = { 'BEL': '\u0007', 'vertical tab': '\u000b', 'form feed': '\u000c', 'DEL': '\u007f', 'C1 control': '\u009f', 'U+FFFE': '\ufffe', 'a lone surrogate': '\ud800', 'a lone low surrogate': '\udc00', 'NUL': '\u0000' };
  for (const [name, ch] of Object.entries(cases)) {
    const e = errorOf(`title: Booking ${ch} API`);
    assert.ok(e instanceof YamlError && !e.unsupported && /non-printable characters/.test(e.reason), name);
    assert.ok(lint(EX.replace(/^title: .*$/m, `title: Booking ${ch} API`)).some((m) => /front matter is not valid YAML: the stream contains non-printable characters/.test(m)), name);
  }
  // tab, a NEL (a line break to js-yaml) and a correctly paired surrogate are fine; a byte order mark at the start is dropped
  assert.equal(parseYaml('a: x\ty').a, 'x\ty');
  assert.equal(parseYaml('a: \ud83d\ude00').a, '\ud83d\ude00');
  assert.deepEqual(Object.keys(parseYaml('\ufeffa: b')), ['a']);
  assert.equal(parseYaml(`a: "${String.fromCharCode(92)}u0007"`).a, String.fromCharCode(7));
});

test('in a flow collection a # where a value can start begins a comment (R4-3a)', () => {
  for (const bad of ['decisions: [ADR-0012,#0019]', 'decisions: [ADR-0012, ADR-0019,#note]', 'decisions: [#x]', 'decisions: [a, #c\n  ']) {
    const e = errorOf(bad);
    assert.ok(e instanceof YamlError && /unexpected end of the stream within a flow collection/.test(e.reason), JSON.stringify(bad));
  }
  assert.deepEqual(parseYaml('a: [x,#c\n  y]'), { a: ['x', 'y'] });
  assert.deepEqual(parseYaml('a: {x: 1,#c\n  y: 2}'), { a: { x: 1, y: 2 } });
  assert.deepEqual(parseYaml('a: [x, y#z]'), { a: ['x', 'y#z'] }, 'a # inside plain text is text');
  assert.deepEqual(parseYaml('a: {k:#c\n  1}'), { a: { 'k:#c 1': null } }, 'a colon with no blank after it is part of the text');
});

test('a block scalar header may carry one chomping indicator only (R4-3b)', () => {
  for (const bad of ['title: |--\n  x', 'title: >+-\n  x', 'title: |-+\n  x', 'title: |+-\n  x', 'title: >--']) {
    assert.match(errorOf(bad)?.reason ?? '', /repeat of a chomping mode identifier/, JSON.stringify(bad));
  }
  assert.equal(parseYaml('t: |-\n  x\n').t, 'x');
  assert.equal(parseYaml('t: |2-\n   x\n').t, ' x');
});

test('flow indicators end a plain scalar inside a flow collection (R4-3c)', () => {
  for (const bad of ['decisions: [x, :"["]', 'decisions: [:"["]', 'a: [x[y]]', 'a: {x: y{z}}']) assert.ok(errorOf(bad) && !errorOf(bad).unsupported, bad);
  assert.deepEqual(parseYaml('a: [x, : y]'), { a: ['x', { null: 'y' }] });
  assert.deepEqual(parseYaml('a: [http://x/y, b:c]'), { a: ['http://x/y', 'b:c'] });
});

// ---------- fifth review (R5-2, R5-5) ----------

test('a plain value in a flow collection that goes on over a line must be indented past its key, and a comment ends it (R5-2)', () => {
  for (const bad of [
    'decisions: [ADR-00\n12, ADR-0019]',
    'd:\n  e: [A\n  B]',
    'd:\n  e: [A\n   B]'.replace('   B', '  B'),
    '[a # c\n b]',
    'a: [a # c\n   b]',
    '[a\n# c\n b]',
    'x: 1\ny:\n  - [a\n  b]',
    'd:\n  e: {a: b\n  c: d}',
  ]) {
    const e = errorOf(bad);
    assert.ok(e instanceof YamlError && !e.unsupported && /missed comma between flow collection entries/.test(e.reason), JSON.stringify(bad));
  }
  // continuations that are indented past the key, entries that start a new line after a comma, and closers, are fine
  assert.deepEqual(parseYaml('decisions: [ADR-00\n 12, ADR-0019]'), { decisions: ['ADR-00 12', 'ADR-0019'] });
  assert.deepEqual(parseYaml('d:\n  e: [A\n   B]'), { d: { e: ['A B'] } });
  assert.deepEqual(parseYaml('decisions: [ADR-0012,\nADR-0019]'), { decisions: ['ADR-0012', 'ADR-0019'] });
  assert.deepEqual(parseYaml('[a # c\n]'), ['a']);
  assert.deepEqual(parseYaml('[a # c\n, b]'), ['a', 'b']);
  assert.deepEqual(parseYaml('[a\nb]'), ['a b'], 'a flow collection that is the whole document has no key to be indented past');
});

test('a blank line inside a flow value is a line break, as in js-yaml (R5-2)', () => {
  assert.deepEqual(parseYaml('[a\n\n b]'), ['a\nb']);
  assert.deepEqual(parseYaml('["a\n\n b"]'), ['a\nb']);
  assert.deepEqual(parseYaml('["a\n\n\n b"]'), ['a\n\nb']);
  assert.deepEqual(parseYaml('{a: b\n\n c}'), { a: 'b\nc' });
  assert.deepEqual(parseYaml('{a: "b\n\n c"}'), { a: 'b\nc' });
  assert.deepEqual(parseYaml('[a\n b]'), ['a b'], 'one line break is a space');
  assert.deepEqual(parseYaml("['a\n\n b']"), ['a\nb']);
});

test('the colon of a pair stays on its key\'s line, and a key does not run over lines (R5-2)', () => {
  for (const bad of ['[a\n : b]', '{a\n : b}', '[a\n b: c]', '{a\n b: c}', '["a"\n : b]']) assert.match(errorOf(bad)?.reason ?? '', /missed comma between flow collection entries/, JSON.stringify(bad));
  assert.deepEqual(parseYaml('[a: b,\n c: d]'), [{ a: 'b' }, { c: 'd' }]);
});

test('a line break put into "decisions: [ADR-0012, ADR-0019]" is read as js-yaml reads it, whichever line ending it is (R5-2)', () => {
  for (const eol of ['\n', '\r', '\r\n']) {
    for (const bad of [`decisions: [ADR-00${eol}12, ADR-0019]`, `decisions: [ADR-0012, ADR-00${eol}19]`, `decisions: [ADR-${eol}0012, ADR-0019]`]) {
      assert.match(errorOf(bad)?.reason ?? '', /missed comma between flow collection entries/, JSON.stringify(bad));
    }
    for (const fine of [`decisions: [ADR-0012,${eol}ADR-0019]`, `decisions: [ADR-0012, ADR-0019${eol}]`, `decisions: [${eol}ADR-0012, ADR-0019]`, `decisions: [ADR-0012${eol}, ADR-0019]`]) {
      assert.deepEqual(parseYaml(fine), { decisions: ['ADR-0012', 'ADR-0019'] }, JSON.stringify(fine));
    }
  }
});

test('flow nesting is limited as js-yaml limits it: a scalar inside counts as a level, and a hundredth level is refused (R5-5)', () => {
  const deepSeq = (n) => `a: ${'['.repeat(n)}${']'.repeat(n)}`;
  const deepMap = (n) => `a: ${'{a: '.repeat(n)}x${'}'.repeat(n)}`;
  assert.doesNotThrow(() => parseYaml(deepSeq(99)));
  assert.match(errorOf(deepSeq(100))?.reason ?? '', /nested too deeply/);
  assert.doesNotThrow(() => parseYaml(deepMap(98)));
  assert.match(errorOf(deepMap(99))?.reason ?? '', /nested too deeply/);
  assert.match(errorOf(`a: ${'[a, '.repeat(4000)}x${']'.repeat(4000)}`)?.reason ?? '', /nested too deeply/, 'thousands of levels are refused with a message, not a crash');
  // block nesting follows the same limit
  const blockMap = (n) => `${Array.from({ length: n }, (_, i) => `${' '.repeat(i)}k${i}:`).join('\n')}\n${' '.repeat(n)}x: 1`;
  assert.doesNotThrow(() => parseYaml(blockMap(98)));
  assert.match(errorOf(blockMap(99))?.reason ?? '', /nested too deeply/);
});

// ---------- R5-3: values that hold characters js-yaml refuses are written as escapes ----------

test('a title written in the file as an escape of DEL, a C1 control, U+FFFE, U+FFFF or a lone surrogate imports, exports and checks as it did', () => {
  const BS = String.fromCharCode(92);
  for (const [name, hex, ch] of [['DEL', '007f', '\u007f'], ['C1 start', '0080', '\u0080'], ['NEL', '0085', '\u0085'], ['C1 end', '009f', '\u009f'], ['U+FFFE', 'fffe', '￾'], ['U+FFFF', 'ffff', '￿'], ['a lone surrogate', 'd800', '\ud800'], ['a lone low surrogate', 'dc00', '\udc00'], ['BEL', '0007', '\u0007']]) {
    const original = EX.replace(/^title: .*$/m, `title: "Booking ${BS}u${hex} API"`);
    const { model } = fromMarkdown(original);
    assert.equal(model.fm.title, `Booking ${ch} API`, name);
    const exported = toMarkdown(model);
    assert.match(exported, new RegExp(`^title: "Booking ${BS}${BS}u${hex} API"$`, 'm'), `${name}: written as an escape`);
    // no raw character js-yaml refuses is in what is written, so the linter reads it as valid YAML
    assert.doesNotMatch(exported.split('\n---\n')[0], /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x84\x86-\x9f￾￿]/, name);
    assert.ok(!lint(exported).some((m) => /not valid YAML/.test(m)), `${name}: ${lint(exported).join('; ')}`);
    assert.equal(fromMarkdown(exported).model.fm.title, `Booking ${ch} API`, `${name}: it comes back the same`);
  }
  // an emoji (a surrogate pair) and ordinary text are not quoted for it
  assert.equal(needsQuotes('Booking 😀'), false);
  assert.equal(needsQuotes('Booking é'), false);
  assert.equal(needsQuotes('x￾y'), true);
  assert.equal(needsQuotes('x\ud800y'), true);
});

// ---------- round 6: markers inside values, escaped breaks, comments inside flow collections, depth, tails, round trips ----------

const BS6 = String.fromCharCode(92);
const withFm = (replace, by) => EX.replace(replace, by);
const invalidYaml = (md) => lint(md).some((m) => /not valid YAML/.test(m));

test('N1: a document marker at the left margin ends the document inside a flow collection or a quoted value', () => {
  const bad = [
    ['decisions: [ADR-0012,\n... ADR-0019]', /unexpected end of the document within a flow collection/],
    ['decisions: [ADR-0012,\n--- ADR-0019]', /unexpected end of the document within a flow collection/],
    ['decisions: [ADR-0012,\n...\n]', /unexpected end of the document within a flow collection/],
    ['title: "Partner room availability\n... and booking API"', /unexpected end of the document within a double quoted scalar/],
    ["title: 'Partner room availability\n--- and booking API'", /unexpected end of the document within a single quoted scalar/],
  ];
  for (const [text, reason] of bad) assert.match(errorOf(text)?.reason ?? '', reason, JSON.stringify(text));
  // indented, or not followed by a blank, it is text
  assert.deepEqual(parseYaml('decisions: [ADR-0012,\n  ... ADR-0019]'), { decisions: ['ADR-0012', '... ADR-0019'] });
  assert.deepEqual(parseYaml('title: "Partner\n  ... and booking"'), { title: 'Partner ... and booking' });
  assert.deepEqual(parseYaml('title: "Partner\n...x"'), { title: 'Partner ...x' });
  assert.deepEqual(parseYaml('title: "Partner\n---x"'), { title: 'Partner ---x' });
  // and in a record, the file is reported as invalid YAML, as the linter reports it
  assert.ok(invalidYaml(withFm('decisions: [ADR-0012, ADR-0019]', 'decisions: [ADR-0012,\n... ADR-0019]')));
  assert.ok(invalidYaml(withFm(/^title: .*$/m, 'title: "Partner room availability\n... and booking API"')));
});

test('N2: a backslash at the end of a line joins a double-quoted value, and lines fold as YAML folds them', () => {
  assert.deepEqual(parseYaml(`title: "Partner room avail${BS6}\n  ability"`), { title: 'Partner room availability' });
  assert.deepEqual(parseYaml(`decisions: ["ADR-00${BS6}\n  12"]`), { decisions: ['ADR-0012'] });
  assert.deepEqual(parseYaml(`a: {k: "v${BS6}\n  w"}`), { a: { k: 'vw' } });
  assert.deepEqual(parseYaml('a: "x  \n  y"'), { a: 'x y' }, 'trailing blanks go');
  assert.deepEqual(parseYaml('a: "x\n\n  y"'), { a: 'x\ny' }, 'a blank line is a line break');
  assert.deepEqual(parseYaml(`a: "x${BS6}\n\n  y"`), { a: 'xy' }, 'an escaped break takes the blank line after it too');
  assert.deepEqual(parseYaml(`a: "x ${BS6}\n  y"`), { a: 'x y' }, 'a blank before the escaped break is kept');
  assert.deepEqual(parseYaml("a: 'x  \n  y'"), { a: 'x y' });
  assert.deepEqual(parseYaml('a: ["a  \n  b"]'), { a: ['a b'] });
});

test("N3: a comment on a continuation line of a flow collection is found with the collection's own state", () => {
  assert.deepEqual(parseYaml('x: [\n [ s\n ] ,#c\n ]'), { x: [['s']] });
  assert.deepEqual(parseYaml('x: [ [\n -x\n ] ,#c\n {} ]'), { x: [['-x'], {}] });
  assert.deepEqual(parseYaml('decisions: ["ADR-0012\n  part"# note\n  ]'), { decisions: ['ADR-0012 part'] });
  assert.deepEqual(parseYaml("x: ['a\n\n b'#c\n]"), { x: ['a\nb'] });
  assert.deepEqual(parseYaml('x: ["a #b\n  c"]'), { x: ['a #b c'] }, 'a # inside a quoted value is text');
  assert.deepEqual(parseYaml('x: ["a\n#b\n  c"]'), { x: ['a #b c'] });
});

test("L1: a stray line break before a key's colon is invalid YAML, not an unsupported construct", () => {
  for (const text of ['id\n: v', 'a: 1\n: v', 'x:\n  - a\n: b', 'provider:\n  owner: Guest team\n  id\n: int-api-external', 'provider:\n  system: A\n  id\n  : int-api-external']) {
    const e = errorOf(text);
    assert.ok(e && !e.unsupported, JSON.stringify(text));
  }
  assert.match(errorOf('a: 1\n: v')?.reason ?? '', /incomplete explicit mapping pair/);
  assert.ok(invalidYaml(withFm(/^status: .*$/m, 'status: active\n: int-api-external')));
  // "? key" with ": value" is still valid YAML that is not read here
  assert.equal(errorOf('? a\n: b')?.unsupported, true);
});

test('L2: block and mixed nesting are limited as js-yaml limits it, and what is written back is always readable', () => {
  const dashes = (n, tail) => `x:\n${'- '.repeat(n)}${tail}`;
  assert.doesNotThrow(() => parseYaml(dashes(97, 'a')));
  assert.match(errorOf(dashes(98, 'a'))?.reason ?? '', /nested too deeply/);
  assert.match(errorOf(`y:\n  ${'{a: '.repeat(98)}z${'}'.repeat(98)}`)?.reason ?? '', /nested too deeply/);
  assert.doesNotThrow(() => parseYaml(`y:\n  ${'{a: '.repeat(97)}z${'}'.repeat(97)}`));
  // a value as deep as the reader allows is written in a form that js-yaml accepts
  const nest = (n, leaf) => { let v = leaf; for (let i = 0; i < n; i++) v = [v]; return v; };
  for (const n of [90, 96, 97]) {
    const written = dumpYaml({ title: 't', k: nest(n, 'x') });
    assert.deepEqual(parseYaml(written), { title: 't', k: nest(n, 'x') }, `depth ${n}`);
  }
  // one that no form can hold is refused when it is written, not written as a file the linter rejects
  assert.throws(() => dumpYaml({ k: nest(120, 'x') }), /nested too deeply/);
});

test('L3: U+2028, U+2029 and a key that starts "-:" are written so that they read back', () => {
  for (const s of ['\u2028', '\u2029', 'a\u2028b', '-:x', '-:®', '-:', 'plain']) {
    const rec = { [s]: s, list: [s], nested: { [s]: s } };
    const out = dumpYaml(rec);
    assert.doesNotMatch(out, /[\u2028\u2029]/, 'no raw separator is written');
    assert.deepEqual(parseYaml(out), rec, JSON.stringify(s));
  }
  assert.deepEqual(parseYaml(`"${BS6}u2028": "\u2028x"`), { '\u2028': '\u2028x' }, 'a separator after a quoted key colon is read');
});

test('a flow collection or quoted value that closes on a later line may be followed by the next entry, as js-yaml reads it', () => {
  assert.deepEqual(parseYaml('d:\n  - {1\n}"p q": '), { d: [{ 1: null }], 'p q': null });
  assert.deepEqual(parseYaml('a:\n  b:\n    c: [a\n  ]k: 1\n  m: 2'), { a: { b: { c: ['a'] }, k: 1, m: 2 } });
  assert.deepEqual(parseYaml('- [a,\n]- b\n- c'), [['a'], 'b', 'c']);
  assert.deepEqual(parseYaml('x: [a,\n]k: 1\nz: 2'), { x: ['a'], k: 1, z: 2 });
  assert.deepEqual(parseYaml('a: "x\n"b: 1'), { a: 'x ', b: 1 });
  assert.match(errorOf('x: [a,\n]\tk: 1')?.reason ?? '', /tab characters/);
  assert.ok(errorOf('x: [a,\n]b c'), 'text that is not an entry is refused');
});

test('document end and start markers: text after "..." and a later "---" are a second document, "...#c" is text', () => {
  assert.match(errorOf('k: 1\n... x')?.reason ?? '', /expected a single document/);
  assert.match(errorOf('k: 1\n--- x: 2')?.reason ?? '', /expected a single document/);
  assert.ok(errorOf('k: 1\n...#c'));
  assert.deepEqual(parseYaml('k: 1\n... #c\n'), { k: 1 });
  assert.deepEqual(parseYaml('...#c: 1'), { '...#c': 1 });
});

test('a plain key may start with a colon, as js-yaml reads it', () => {
  assert.deepEqual(parseYaml(':consumers: 1'), { ':consumers': 1 });
});

test('smaller differences found by fuzzing against js-yaml 4.3.2', () => {
  // a tab in the margin is only refused where a block entry starts: a value on a line of its own may be indented with one
  assert.deepEqual(parseYaml('k:\n \t1'), { k: 1 });
  assert.deepEqual(parseYaml('\ta'), 'a');
  assert.match(errorOf('k:\n \tv: 1')?.reason ?? '', /tab characters must not be used in indentation/);
  assert.match(errorOf('\tk: v')?.reason ?? '', /tab characters must not be used in indentation/);
  // "- " or "? " at the start of a plain value that goes over lines is a block entry that cannot start there
  assert.match(errorOf('k: - \n\n  b')?.reason ?? '', /bad indentation of a mapping entry/);
  assert.match(errorOf('k: ? \n\n  b')?.reason ?? '', /bad indentation of a mapping entry/);
  // a line of a quoted value that begins with a "#" is the value's own, and what follows the closing quote is not dropped
  assert.ok(errorOf("k: 'a\n#c'r"));
  assert.deepEqual(parseYaml("k: 'a\n#c'\nj: 1"), { k: 'a #c', j: 1 });
  // an explicit key in a flow collection, and an anchor followed by a comment, are valid YAML this reader does not read
  assert.equal(errorOf('a: [?\n\n b]')?.unsupported, true);
  assert.equal(errorOf('k: [&a #c\n    x]')?.unsupported, true);
  assert.equal(errorOf('a: [x, ?\n  b]')?.unsupported, true);
});

// ---------- round 7: blanks after a backslash in a flow collection, the README's documented differences, block scalars, long values ----------

test('F1: a backslash then blanks at the end of a line inside a flow collection is an escaped blank, not an escaped line break', () => {
  const B = String.fromCharCode(92);
  assert.deepEqual(parseYaml(`e: ["a${B} \n b"]`), { e: ['a  b'] });
  assert.deepEqual(parseYaml(`- ["a${B} \n b"]`), [['a  b']]);
  assert.deepEqual(parseYaml(`e: ["a ${B} \n b"]`), { e: ['a   b'] });
  assert.deepEqual(parseYaml(`e: ["a${B}\t\n b"]`), { e: ['a\t b'] });
  assert.deepEqual(parseYaml(`decisions: ["ADR${B} \n  0012"]`), { decisions: ['ADR  0012'] });
  assert.deepEqual(parseYaml(`e: {k: 'a  \n b'}`), { e: { k: 'a b' } });
  assert.deepEqual(parseYaml(`e: ["a${B}\n b"]`), { e: ['ab'] }, 'a backslash right before the line break still joins');
  // the blank after the backslash is kept, so a link written that way is not the link it looks like, and is not rewritten
  const url = `pattern: {id: int-api-external, url: "https://www.itarchitecturepatterns.net/${B} \n  patterns/int-api-external"}`;
  const text = EX.replace(/^pattern:\n {2}id: .*\n {2}url: .*\n/m, url + '\n');
  assert.ok(lint(text).some((m) => /pattern\/url must match format "uri"/.test(m)), lint(text).join('; '));
  const { model } = fromMarkdown(text);
  assert.equal(model.fm.pattern.url, 'https://www.itarchitecturepatterns.net/  patterns/int-api-external');
  assert.equal(fromMarkdown(toMarkdown(model)).model.fm.pattern.url, model.fm.pattern.url, 'export keeps it');
  // and an interface reference of two blanks is a value, not an empty one
  assert.deepEqual(parseYaml(`interfaces: [{type: openapi, ref: "${B} \n  "}]`), { interfaces: [{ type: 'openapi', ref: '  ' }] });
});

test('D1(a): an empty list entry followed by a "- " line at a lesser indent goes on with the same list, as js-yaml reads it', () => {
  assert.deepEqual(parseYaml('s:\n- -\n-'), { s: [[null, null]] });
  assert.deepEqual(parseYaml('s:\n- -\n- x'), { s: [[null, 'x']] });
  assert.deepEqual(parseYaml('- -\n-'), [[null, null]]);
  assert.deepEqual(parseYaml('- - -\n-\n-'), [[[null, null, null]]]);
  assert.deepEqual(parseYaml('k:\n  - -\n  -'), { k: [[null, null]] });
  assert.deepEqual(parseYaml('k:\n  -\n- a'), { k: [null, 'a'] });
  assert.deepEqual(parseYaml('- a\n-\n- b'), ['a', null, 'b']);
  assert.match(errorOf('s:\n- -\n-\n e')?.reason ?? '', /bad indentation of a sequence entry/);
});

test('D1(b): an anchor, alias or tag in front of a second or later key is unsupported, not invalid', () => {
  for (const text of ['id: x\n&a version: 1', 'id: x\n!!str version: 1', 'id: x\n*a version: 1', '&a id: x', 'a:\n  b: 1\n  &x c: 2']) {
    const e = errorOf(text);
    assert.ok(e && e.unsupported === true, JSON.stringify(text));
  }
  const md = EX.replace(/^version: .*$/m, '&a version: 2.1.0');
  assert.ok(!lint(md).some((m) => /not valid YAML/.test(m)), lint(md).join('; '));
  assert.equal(fromMarkdown(md).model.fm, null, 'kept as text');
});

test('D1(c): block scalars are read as js-yaml reads them, tabs and blank lines included', () => {
  assert.deepEqual(parseYaml('k: |\n  \t\n  1'), { k: '\t\n1\n' });
  assert.deepEqual(parseYaml('k: |\n \t\n  1'), { k: '\t\n 1\n' });
  assert.deepEqual(parseYaml('k: |+\n  a\n\t'), { k: 'a\n' });
  assert.deepEqual(parseYaml('x: |\n  a\n  \tb\n  c'), { x: 'a\n\tb\nc\n' });
  assert.deepEqual(parseYaml('k: >\n  a\n\n  b\n   c\n  d'), { k: 'a\nb\n c\nd\n' });
  assert.deepEqual(parseYaml('k: |-\n  a\n\n'), { k: 'a' });
  assert.deepEqual(parseYaml('k: >+\n  a\n\n\n'), { k: 'a\n\n\n' });
  assert.deepEqual(parseYaml('k: |2\n    a'), { k: '  a\n' });
  assert.match(errorOf('k: |\n   \n  a')?.reason ?? '', /bad indentation of a mapping entry/);
});

test('D1(e): a plain key "-", a first line "--- x" and an escape past U+10FFFF', () => {
  assert.deepEqual(parseYaml('a:\n-: 1'), { a: null, '-': 1 });
  assert.deepEqual(parseYaml('k: {-: 1}'), { k: { '-': 1 } });
  assert.deepEqual(parseYaml('- -: 1'), [{ '-': 1 }]);
  assert.match(errorOf('k: [-]')?.reason ?? '', /missed comma/);
  assert.match(errorOf('k: [- a]')?.reason ?? '', /missed comma/);
  assert.equal(errorOf('--- x')?.unsupported, true);
  assert.equal(errorOf('--- x\nk: 1')?.unsupported, true);
  const e = errorOf('a: "\\U00110000"');
  assert.ok(e && !e.unsupported && /valid Unicode code point/.test(e.reason));
});

// Every example the README's "Documented differences" gives behaves here as it says (so the README cannot drift from the reader).
test('the README documented differences are true of the reader', () => {
  const readme = fs.readFileSync(path.join(HERE, '..', 'README.md'), 'utf8').replace(/\s+/g, ' ');
  const claims = [
    // [text the README must contain, [example, expected state]]
    ['(`&a version: 1`)', ['id: x\n&a version: 1', 'unsupported']],
    ['also inside a flow collection: `[? a]`', ['a: [? a]', 'unsupported']],
    ['a flow collection used as a key (`[a]: x`)', ['[a]: x', 'unsupported']],
    ['a first line that starts with `---`, whatever follows it (`--- x`, `---#c`, `---x: 1`)', ['--- x', 'unsupported']],
    ['`---#c`', ['---#c\nk: 1', 'unsupported']],
    ['`---x: 1`', ['---x: 1\nk: 2', 'unsupported']],
    ['and a `%` directive line (`%YAML 1.2`)', ['%YAML 1.2\n--- #c\nk: 1', 'unsupported']],
    ['`---`', ['---', 'unsupported']],
    ['an unknown tag such as `!t`', ['k: !t x', 'unsupported']],
    ['an alias with no anchor such as `*a`', ['k: *a', 'unsupported']],
    ['(`"\\U00110000"`)', ['k: "\\U00110000"', 'invalid']],
    ['`[x, : ?:]` is reported here as unsupported', ['[x, : ?:]', 'unsupported']],
    ['(`>1`, then `z`: js-yaml `z ` with a blank, here `z` and a line', ['>1\nz', { value: 'z\n' }]],
    ['`|-1` and two blank lines: js-yaml two line breaks, here nothing', ['|-1\n\n\n', { value: '' }]],
    ['`>-1`, then `x`: `x ` against `x`', ['>-1\nx\n', { value: 'x' }]],
    ['or front matter of only comments, is read by js-yaml as `null` and here as nothing', ['# c\n', { value: undefined }]],
    ['bell, a form feed or another C0 control anywhere in the front matter makes it invalid here, a comment included', ['k: 1 # \u0007', 'invalid']],
    ['inside a quoted value too, where js-yaml accepts them', ['k: "\u007f"', 'invalid']],
    ['such as `1_000`, were numbers there and are strings from 4.3 on', ['k: 1_000', { value: { k: '1_000' } }]],
  ];
  for (const [phrase, [example, expected]] of claims) {
    assert.ok(readme.includes(phrase), `README says: ${phrase}`);
    const e = errorOf(example);
    if (expected === 'unsupported') assert.equal(e?.unsupported, true, example);
    else if (expected === 'invalid') assert.ok(e && !e.unsupported, example);
    else assert.deepEqual(parseYaml(example), expected.value, example);
  }
  // and what the README no longer lists as a difference does match
  assert.doesNotMatch(readme, /look like list items or flow collections|a line of only tabs inside a block scalar|`:consumers:`/);
  assert.doesNotMatch(readme, /after an empty `-` entry/);
  assert.deepEqual(parseYaml('k: |\n  a\n  \t\n  b'), { k: 'a\n\t\nb\n' });
});

// ---------- W1: a value js-yaml reads that cannot be written back is kept as text ----------

test('W1: pairs nested in a flow list and empty list entries, past what any written form holds, keep the front matter as text', () => {
  for (const [name, yaml] of [['pairs 90 deep', 'decisions: ' + '[a: '.repeat(90) + 'x' + ']'.repeat(90)], ['99 empty entries', 'decisions:\n' + '- '.repeat(99)]]) {
    const text = EX.replace(/^decisions:.*\n/m, yaml + '\n');
    const { model, warnings } = fromMarkdown(text);
    assert.equal(model.fm, null, name);
    assert.equal(model.fmRaw.includes('decisions:'), true, name);
    assert.ok(warnings.some((w) => /cannot be written back out/.test(w)), name);
    assert.doesNotThrow(() => toMarkdown(model), name);
    assert.ok(toMarkdown(model).includes(yaml.trimEnd()), `${name}: exported unchanged`);
  }
});

// ---------- X1: long values are wrapped on export ----------

test('X1: a long value that was folded from many lines is written over several lines, each short enough to read back', () => {
  const B = String.fromCharCode(92);
  const words = Array.from({ length: 150 }, (_, i) => `${'word '.repeat(39)}w${i}`); // 150 lines of about 200 characters
  const text = EX.replace(/^title: .*$/m, `title: "${words.join('\n  ')}"`);
  const { model } = fromMarkdown(text);
  assert.ok(model.fm.title.length > 25000);
  const out = toMarkdown(model);
  const longest = Math.max(...out.split('\n').map((l) => l.length));
  assert.ok(longest < 5000, `longest line ${longest}`);
  const again = fromMarkdown(out);
  assert.equal(again.model.fm.title, model.fm.title);
  assert.ok(!analyze(out).problems.some((p) => /characters long/.test(p.message)));
  assert.equal(toMarkdown(again.model), out, 'writing it again changes nothing');
  // blanks, tabs, separators and surrogates at the places where a line is broken survive
  for (const v of [' '.repeat(9000) + 'x' + ' '.repeat(9000), ('a\tb ' + B + '\u2028 \ud83d\ude00').repeat(3000), '\ud800'.repeat(5000), 'x'.repeat(30000)]) {
    const written = dumpYaml({ k: v, list: [v], n: { k: v } });
    assert.ok(Math.max(...written.split('\n').map((l) => l.length)) < 5000);
    assert.deepEqual(parseYaml(written), { k: v, list: [v], n: { k: v } });
  }
});

// ---------- round 8: entries that begin where a multi-line value closed, document starts, text kept as it was ----------

import { carriedCases } from './helpers/carried-cases.js';

test('N1: an entry that begins on the line where a multi-line flow collection or quoted value closed is read as js-yaml reads it', () => {
  const cases = carriedCases();
  const expected = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'carried-expected.json'), 'utf8'));
  assert.equal(expected.length, cases.length);
  let accepted = 0;
  const wrong = [];
  cases.forEach((text, i) => {
    let got;
    try { got = parseYaml(text); } catch { got = null; }
    if (expected[i] !== null) accepted++;
    if (JSON.stringify(got) !== JSON.stringify(expected[i])) wrong.push(JSON.stringify(text));
  });
  assert.ok(accepted > 1000, `${accepted} of the shapes are valid YAML`);
  assert.deepEqual(wrong, [], `${wrong.length} of ${cases.length} shapes differ from js-yaml`);
});

test('N1: a "#" in the value that closed is not a comment of the entry that follows it', () => {
  const B = String.fromCharCode(92);
  // js-yaml reads ref as "" (an escaped line break joins "" and the blanks), so the linter fails it; it was read as two blanks
  const a = parseYaml(`decisions: ["ADR-AB-0001\nADR-AB-0002  #"]interfaces: [{type: openapi, ref: "${B}\n  ", version: 1.2.0}]`);
  assert.equal(a.interfaces[0].ref, '');
  assert.deepEqual(a.decisions, ['ADR-AB-0001 ADR-AB-0002  #']);
  assert.deepEqual(parseYaml(`k: ["a\nb  #"]m: ["c${B}\n d"]`), { k: ['a b  #'], m: ['cd'] });
  assert.deepEqual(parseYaml(`k: ["a\nb  #"]m: "c${B}\n d"`), { k: ['a b  #'], m: 'cd' });
  assert.deepEqual(parseYaml('k: ["a\nb  #"]m: [c\n d]'), { k: ['a b  #'], m: ['c d'] });
  // end to end: the reference is empty, so the record fails the schema, as it does in the linter
  const md = EX.replace(/^interfaces:\n(?: {2,}.*\n)+/m, '').replace(/^decisions:.*$/m, `decisions: ["ADR-AB-0001\nADR-AB-0002  #"]interfaces: [{type: openapi, ref: "${B}\n  ", version: 1.2.0}]`);
  assert.ok(lint(md).some((m) => /interfaces\/0\/ref/.test(m)), lint(md).join('; '));
});

test('N3: a first line that starts with "---", and a "%" directive, are unsupported, not invalid', () => {
  for (const first of ['---#c', '---x: 1', '--- x', '---']) {
    const md = EX.replace(/^---\n/, `${first}\n`);
    assert.equal(errorOf(`${first}\nk: 1`)?.unsupported, true, first);
    assert.ok(!lint(md).some((m) => /not valid YAML/.test(m)), `${first}: ${lint(md).join('; ')}`);
  }
  const md = EX.replace(/^---\n/, '---\n%YAML 1.2\n--- #c\n');
  assert.equal(errorOf('%YAML 1.2\n--- #c\nicr: "0.2"')?.unsupported, true);
  assert.ok(!lint(md).some((m) => /not valid YAML/.test(m)), lint(md).join('; '));
  // later in the document, and indented, the same text is an ordinary key
  assert.deepEqual(parseYaml('k: 1\n---x: 2'), { k: 1, '---x': 2 });
  assert.deepEqual(parseYaml('  ---x: 1'), { '---x': 1 });
});

test('N4: front matter kept as text is written byte for byte, trailing blank lines included', () => {
  const kept = [
    'title: |+\n  a\n\n&a id: x\n',
    'icr: "0.2"\n&a id: ICR-0001\ntitle: |+\n  A title\n\n\n',
    '&a icr: "0.2"\n',
    'k: !t x\n\n',
  ];
  for (const yaml of kept) {
    const text = `---\n${yaml}\n---\n\n# Title\n\n## Purpose\n\nText.\n`;
    const { model } = fromMarkdown(text);
    assert.equal(model.fm, null, JSON.stringify(yaml));
    assert.equal(model.fmRaw, yaml);
    assert.equal(toMarkdown(model).split('\n---\n')[0], `---\n${yaml}`, JSON.stringify(yaml));
    assert.equal(fromMarkdown(toMarkdown(model)).model.fmRaw, yaml, 'a second round trip changes nothing');
  }
  // a "|+" scalar at the end keeps its blank lines, so the title is the same one the linter reads
  const md = EX.replace(/^title: .*$/m, '&t title: |+\n  A title for the record\n\n\n').replace(/^(interaction: .*)$/m, '$1');
  const out = toMarkdown(fromMarkdown(md).model);
  assert.ok(out.startsWith(md.split('\n---\n')[0] + '\n---\n'), 'the front matter is exactly what was read');
});
import { MAX_RECORD_BYTES } from '../js/limits.js';

// ---------- round 9: a tab inside a quoted value, a null in a key, the size of a file ----------

test('H1: a tab among the blanks that begin a line inside a quoted value, with an entry after the closing bracket, is refused', () => {
  for (const text of ["k: ['a\n\tb']m: x", "a:\n  k: ['a\n  \tb']m: x", "- ['a\n\tb']- x", "[{x: 'a\n\tb'}]m: x", 'decisions: ["ADR-0012\n\tADR-0019"]owner: me']) {
    assert.match(errorOf(text)?.reason ?? '', /tab characters must not be used in indentation/, JSON.stringify(text));
  }
  // without an entry after the closing bracket the tab is inside the value, and fine
  assert.deepEqual(parseYaml("k: ['a\n\tb']"), { k: ['a b'] });
  const md = EX.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-0012\n\tADR-0019"]owner: me\n');
  assert.ok(lint(md).some((m) => /not valid YAML: tab characters/.test(m)), lint(md).join('; '));
});

test('L1: a null in a collection used as a key is empty text, as Array.prototype.join writes it', () => {
  assert.deepEqual(parseYaml('k: {[~, a]}'), { k: { ',a': null } });
  assert.deepEqual(parseYaml('k: {[~]: 1}'), { k: { '': 1 } });
  assert.match(errorOf('k: {"": 1, [~]}')?.reason ?? '', /duplicated mapping key/);
  assert.deepEqual(parseYaml('{~: x, [null]}'), { null: 'x', '': null });
  assert.deepEqual(parseYaml('k: {[a, b]: 1}'), { k: { 'a,b': 1 } });
});

test('L2: front matter is kept as text when the file written from it would be longer than the page accepts, counted in bytes', () => {
  const entries = Array.from({ length: 19000 }, (_, i) => `ADR-${String(i).padStart(4, '0')}`);
  const lines = [];
  for (let i = 0; i < entries.length; i += 6) lines.push('  ' + entries.slice(i, i + 6).join(', ') + ',');
  const text = EX.replace(/^decisions:.*\n/m, `decisions: [\n${lines.join('\n')}\n  ]\n`);
  assert.ok(Buffer.byteLength(text) < MAX_RECORD_BYTES, `${Buffer.byteLength(text)} bytes in`);
  const { model, warnings } = fromMarkdown(text);
  assert.equal(model.fm, null, 'kept as text');
  assert.ok(warnings.some((w) => /cannot be written back out/.test(w)));
  const out = toMarkdown(model);
  assert.ok(Buffer.byteLength(out) < MAX_RECORD_BYTES);
  assert.equal(out, text.replace(/\r\n/g, '\n'), 'what is written is what was read');
  // the same list in a short file is still read into fields
  assert.notEqual(fromMarkdown(EX.replace(/^decisions:.*\n/m, 'decisions: [' + entries.slice(0, 50).join(', ') + ']\n')).model.fm, null);
  // and the count is in UTF-8 bytes: an accented text is longer in bytes than in characters
  const accented = EX.replace(/^decisions:.*\n/m, 'decisions: [' + Array.from({ length: 12000 }, (_, i) => `é${i}`).join(', ') + ']\n');
  assert.ok(Buffer.byteLength(accented) < MAX_RECORD_BYTES);
  const kept = fromMarkdown(accented).model;
  assert.ok(kept.fm === null || Buffer.byteLength(toMarkdown(kept)) <= MAX_RECORD_BYTES, 'the export is within the limit either way');
});

// Cases found by review: front matter edge cases that must agree with the linter, and hostile or huge input.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, analyze } from '../js/lint.js';
import { parseYaml } from '../js/yaml.js';
import { fromMarkdown, toMarkdown } from '../js/model.js';
import { store, isModelShape } from '../js/store.js';
import { MAX_RECORD_BYTES } from '../js/limits.js';
import { summarise, buildChecklist } from '../js/checklist.js';
import { advise } from '../js/advice.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EX = fs.readFileSync(path.join(HERE, '..', 'templates', '0001-partner-booking-api.md'), 'utf8').replace(/\r\n/g, '\n');
const fmEdit = (fn) => fn(EX);
// The timing tests below catch quadratic blow-ups (several seconds to minutes), not small differences, so the bound is
// generous enough to hold on a busy machine or a CI runner.
const LIMIT_MS = 3000;

// ---------- prototype-named keys ----------
for (const key of ['constructor', 'hasOwnProperty', 'toString', '__proto__', 'valueOf']) {
  test(`an unknown front matter key named ${key} is reported, not accepted`, () => {
    const p = lint(fmEdit((t) => t.replace(/^data:/m, `${key}: 1\ndata:`)));
    assert.ok(p.includes('front matter / must NOT have additional properties'), p.join('; '));
  });
  test(`a required property named like ${key} does not satisfy a missing one`, () => {
    // the record has no "${key}" requirement; what matters is that inherited names are not found as own keys
    const p = lint(fmEdit((t) => t.replace(/^provider:\n {2}system: .*\n/m, `provider:\n  ${key}: x\n`)));
    assert.ok(p.some((m) => /provider.*must have required property 'system'|provider must NOT have additional/.test(m)), p.join('; '));
  });
}

// ---------- the uri format ----------
for (const bad of ['https://ex.org/é', 'https://a/%zz', 'https://a/[x', '<link to the pattern>', 'not a uri', 'www.itarchitecturepatterns.net']) {
  test(`pattern url ${JSON.stringify(bad)} is not a URI`, () => {
    assert.ok(lint(fmEdit((t) => t.replace(/^( {2}url: ).*$/m, `$1"${bad.replace(/"/g, '\\"')}"`))).some((m) => /pattern\/url must match format "uri"/.test(m)));
  });
}
test('ordinary links are URIs', () => {
  for (const ok of ['https://www.itarchitecturepatterns.net/patterns/int-api-external', 'https://a.b/c?d=e#f', 'mailto:a@b.c', 'https://[::1]:8080/x']) {
    assert.deepEqual(lint(fmEdit((t) => t.replace(/^( {2}url: ).*$/m, `$1"${ok}"`))), [], ok);
  }
});

// ---------- YAML the linter reads ----------
test('a title wrapped over two lines is one title', () => {
  const t = fmEdit((x) => x.replace(/^title: .*$/m, 'title: Partner room availability\n  and booking API'));
  assert.deepEqual(lint(t), []);
  assert.equal(parseYaml('title: one\n  two\n  three\nnext: 1').title, 'one two three');
});
test('a quoted scalar may continue on the next lines', () => {
  assert.equal(parseYaml('a: "one\n  two"\nb: \'x\n\n  y\'').a, 'one two');
  assert.equal(parseYaml('b: \'x\n\n  y\'').b, 'x\ny');
});
test('a "..." end marker closes the document', () => {
  assert.equal(parseYaml('a: 1\n...\n').a, 1);
});
test('underscored numbers are strings, as js-yaml 4.3 reads them (4.1 read them as numbers)', () => {
  assert.equal(parseYaml('a: 1_000').a, '1_000');
  assert.equal(parseYaml('a: 1000').a, 1000);
  assert.equal(parseYaml('a: 0x1F').a, 31);
});
test('plain scalars that start with an indicator are invalid, as in the reference reader', () => {
  for (const bad of ['title: %pct', 'title: ]x', 'title: ,x', 'title: @x']) assert.throws(() => parseYaml(bad), /plain scalar|reserved/, bad);
});
test('an anchor, alias or tag is reported as unsupported, not as invalid, and the text is kept', () => {
  for (const text of ['title: &a Booking API', 'title: !!str Booking API', 'consumers: *x']) {
    let err;
    try { parseYaml(text); } catch (e) { err = e; }
    assert.ok(err?.unsupported, text);
  }
  const t = EX.replace(/^title: .*$/m, 'title: &t Partner API');
  const a = analyze(t);
  assert.ok(a.unsupported);
  assert.deepEqual(a.problems.filter((p) => p.rule === 'frontmatter'), []);
  const { model, warnings } = fromMarkdown(t);
  assert.equal(model.fm, null);
  assert.match(warnings[0], /cannot read/);
  assert.match(toMarkdown(model), /title: &t Partner API/);
  const sum = summarise(a, []);
  assert.equal(sum.state, 'unverified');
  assert.equal(buildChecklist(a).verdict.ok, false);
});

// ---------- the state of a record ----------
test('a record that conforms but still holds prompts is "structural", not a success', () => {
  const t = EX.replace('## Purpose\n', '## Purpose\n\n<describe the purpose>\n');
  const a = analyze(t);
  assert.equal(a.problems.length, 0);
  assert.equal(summarise(a, advise(a)).state, 'structural');
  assert.equal(summarise(analyze(EX), advise(analyze(EX))).state, 'structural', 'the worked example has two real <angle> values in its examples, which advice cannot tell from prompts');
  const clean = fs.readFileSync(path.join(HERE, '..', 'templates', 'ICR-AB-0001-booking-api.md'), 'utf8');
  assert.equal(summarise(analyze(clean), advise(analyze(clean))).state, 'ok');
});

// ---------- hostile and huge input ----------
const timed = (fn) => { const t0 = Date.now(); const r = fn(); return { r, ms: Date.now() - t0 }; };
const BIG = MAX_RECORD_BYTES;

test('a 256 KB file of unclosed comment openers is analysed quickly', () => {
  const text = EX.replace('## Purpose\n', `## Purpose\n\n${'<!-- x\n'.repeat(Math.floor(BIG / 7))}`);
  assert.ok(timed(() => lint(text)).ms < 3000);
});
test('a 256 KB file of fences analyses quickly', () => {
  const text = EX + '\n' + '```\nx\n```\n'.repeat(Math.floor(BIG / 12));
  assert.ok(timed(() => lint(text)).ms < 3000);
});
test('a 256 KB file of thousands of stray headings is analysed quickly and reports a bounded list', () => {
  const text = EX + '\n' + '## Stray\n\nx\n'.repeat(Math.floor(BIG / 13));
  const { r, ms } = timed(() => analyze(text));
  assert.ok(ms < 3000, `${ms} ms`);
  assert.ok(r.problems.length < 100, `${r.problems.length} problems`);
});
test('a 256 KB file of backticks, brackets and mermaid directives analyses quickly', () => {
  for (const unit of ['`a', '[x](', '%%{ ', '- ', '|a', '* *']) {
    const text = EX.replace('sequenceDiagram\n', `sequenceDiagram\n${unit.repeat(Math.floor(BIG / unit.length / 2))}\n`);
    assert.ok(timed(() => lint(text)).ms < 3000, unit);
  }
});
test('deeply nested or very long front matter does not hang or crash', () => {
  for (const yaml of ['a: ' + '['.repeat(50000), 'a: ' + '{a: '.repeat(20000), '- '.repeat(20000) + 'x', `a: "${'x'.repeat(BIG / 2)}`, 'a: |\n' + '  x\n'.repeat(40000)]) {
    const { ms } = timed(() => { try { analyze(`---\n${yaml}\n---\n\n## Purpose\n\nx\n`); } catch { assert.fail('analyze threw'); } });
    assert.ok(ms < 4000, `${ms} ms for ${yaml.slice(0, 12)}`);
  }
});

test('a record over the size limit is refused with a readable message', () => {
  assert.throws(() => store.loadMarkdown('x'.repeat(MAX_RECORD_BYTES + 1)), /limit here is 256 KB/);
});

test('a stored draft of the wrong shape is rejected', () => {
  assert.equal(isModelShape({ fm: {}, h1: null, preamble: '', sections: [null] }), false);
  assert.equal(isModelShape({ fm: {}, h1: null, preamble: '', sections: [{ title: 'x', content: 3 }] }), false);
  assert.equal(isModelShape({ fm: 'x', h1: null, preamble: '', sections: [] }), false);
  assert.equal(isModelShape({ fm: null, fmRaw: 'a: 1', h1: '', preamble: '', sections: [] }), true);
  assert.equal(isModelShape({ fm: {}, h1: null, preamble: '', sections: [{ title: 'Purpose', content: 'x' }] }), true);
  assert.equal(isModelShape(null), false);
});

test('the preview reader handles hostile markdown quickly', async () => {
  const { parseMarkdown } = await import('../js/markdown.js');
  for (const unit of ['`a', '[x](', '**a ', '_a ', '- a\n\n', '> ', '| a |\n', '```\n', '1. a\n\n\n']) {
    const text = unit.repeat(Math.floor(BIG / unit.length));
    assert.ok(timed(() => parseMarkdown(text)).ms < 4000, JSON.stringify(unit));
  }
});

test('restoring a draft: valid, invalid shape, and one that stopped the page last time', async () => {
  const data = new Map();
  globalThis.localStorage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  const { store: s, DRAFT_KEY, RESTORING_KEY } = await import('../js/store.js');
  const good = { v: 1, savedAt: '2026-10-09T00:00:00Z', model: { fm: {}, h1: null, preamble: '', sections: [{ title: 'Purpose', content: 'x' }] } };
  data.set(DRAFT_KEY, JSON.stringify(good));
  assert.equal(s.load(), 'restored');
  assert.ok(data.has(RESTORING_KEY), 'the flag is set while the restored draft is first analysed');
  s.confirmRestored();
  assert.ok(!data.has(RESTORING_KEY), 'and cleared once it has been analysed');
  // the page died before confirmRestored: the next visit drops the draft instead of dying again
  data.set(DRAFT_KEY, JSON.stringify(good));
  data.set(RESTORING_KEY, '1');
  assert.equal(s.load(), 'crashed');
  assert.ok(!data.has(DRAFT_KEY) && !data.has(RESTORING_KEY));
  data.set(DRAFT_KEY, JSON.stringify({ v: 1, model: { fm: {}, h1: null, preamble: '', sections: [null] } }));
  assert.equal(s.load(), 'invalid');
  assert.ok(!data.has(DRAFT_KEY));
  data.set(DRAFT_KEY, '{not json');
  assert.equal(s.load(), 'invalid');
  delete globalThis.localStorage;
});

// ---------- one long run of blanks must not make a reader quadratic ----------
// A pattern such as /\s+$/ or /^#[ \t]+(.+?)[ \t]*$/ restarts at every blank of a long run, so one 256 KB line took
// minutes. Each shape below puts a run of blanks followed by a non-blank where a reader trims or splits a line, and
// runs every reader that does not check the line length first (that check is tested separately, below). ICR_REDOS_SIZE
// shrinks the run, to prove on the old code that these tests fail without waiting minutes.
const RUN = Number(process.env.ICR_REDOS_SIZE || BIG - 4096);
const spaces = ' '.repeat(RUN);
const tabs = '\t'.repeat(RUN);
const withPurpose = (s) => EX.replace('## Purpose\n', `## Purpose\n\n${s}\n`);
const RUN_SHAPES = {
  'a section heading padded with spaces': EX.replace('## Purpose\n', `## Purpose${spaces}x\n`),
  'a section heading padded with tabs': EX.replace('## Purpose\n', `## Purpose${tabs}x\n`),
  'a title with a long run of spaces inside': EX.replace(/^title: .*$/m, `title: a${spaces}b`),
  'a key padded with spaces before its colon': EX.replace(/^title: /m, `title${spaces}: `),
  'a key padded with tabs before its colon': EX.replace(/^title: /m, `title${tabs}: `),
  'a value with trailing spaces and then a letter': EX.replace(/^status: .*$/m, `status: draft${spaces}x`),
  'an H1 with a long run of spaces inside': EX.replace(/^# .*$/m, `# T${spaces}x`),
  'an H1 with trailing spaces': EX.replace(/^# .*$/m, `# T${spaces}`),
  'a ### line in a section': withPurpose(`### a${spaces}x`),
  'a ### line with closing hashes after a long run': withPurpose(`### a${spaces}#x`),
  'a participant line padded with spaces': EX.replace('sequenceDiagram\n', `sequenceDiagram\nparticipant${spaces}x\n`),
  'a section that ends in spaces and then a letter': withPurpose(`-${spaces}x`),
  'a table separator row padded with spaces': withPurpose(`| a |\n-${spaces}x`),
  'a table separator row padded with tabs': withPurpose(`| a |\n|-${tabs}x`),
};

for (const [name, text] of Object.entries(RUN_SHAPES)) {
  test(`${name}: every reader takes well within the time limit`, async () => {
    const { scanBody, splitDocument } = await import('../js/lint.js');
    const { parseMarkdown } = await import('../js/markdown.js');
    const stages = {
      'read the front matter': () => { const d = splitDocument(text); if (d) { try { parseYaml(d.yaml); } catch { /* an error is fine; slowness is not */ } } },
      'scan the body': () => { const d = splitDocument(text); if (d) scanBody(d.body); },
      'import': () => fromMarkdown(text),
      'export': () => toMarkdown(fromMarkdown(text).model),
      'preview': () => { const d = splitDocument(text); parseMarkdown(d ? d.body : text); },
    };
    for (const [stage, fn] of Object.entries(stages)) {
      const { ms } = timed(fn);
      assert.ok(ms < LIMIT_MS, `${stage}: ${ms} ms`);
    }
  });
}

test('many unclosed accDescr blocks, and very many blank lines in a diagram, are linear', async () => {
  const { diagramTitle } = await import('../js/mermaid.js');
  const unit = Math.floor(RUN / 11);
  const noDescr = EX.replace(/^ *accDescr:.*\n/m, '');
  assert.notEqual(noDescr, EX);
  const text = noDescr.replace('sequenceDiagram\n', `sequenceDiagram\n${'accDescr{x\n'.repeat(unit)}`);
  const { r, ms } = timed(() => analyze(text));
  assert.ok(ms < LIMIT_MS, `${ms} ms`);
  assert.ok(r.problems.some((p) => /no accDescr/.test(p.message)), 'an accDescr block that is never closed is not an accDescr');
  assert.ok(timed(() => diagramTitle(`sequenceDiagram\n${'\n'.repeat(RUN)}x\naccTitle: T`)).ms < LIMIT_MS, 'accTitle search over blank lines');
  assert.ok(timed(() => diagramTitle(`sequenceDiagram\n${' \n'.repeat(RUN / 2)}x`)).ms < LIMIT_MS, 'accTitle search over lines of one space');
});

// ---------- a line may not be very long ----------
test('a line over the limit is reported by the checks, quickly, and refused on import', async () => {
  const { MAX_LINE_CHARS } = await import('../js/limits.js');
  const long = EX.replace('## Purpose\n', `## Purpose\n\n${'x'.repeat(MAX_LINE_CHARS + 1)}\n`);
  const { r, ms } = timed(() => analyze(long));
  assert.ok(ms < 200, `${ms} ms`);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0].message, /line \d+ is 20,001 characters long, and a line may be at most 20,000/);
  assert.match(r.problems[0].message, /break it up or remove it/);
  assert.throws(() => store.loadMarkdown(long), /That text cannot be loaded: line \d+ is 20,001 characters long/);
  const edge = EX.replace('## Purpose\n', `## Purpose\n\n${'x'.repeat(MAX_LINE_CHARS)}\n`);
  assert.equal(analyze(edge).problems.some((p) => /characters long/.test(p.message)), false, 'a line at the limit is accepted');
  assert.doesNotThrow(() => store.loadMarkdown(edge));
});

test('the size limit counts bytes, as the file size does, and says so', () => {
  const lines = (n, ch) => `${ch.repeat(100)}\n`.repeat(n);
  // 140,000 two-byte characters are 280,000 bytes: over the limit although they are under 262,144 characters
  const wide = lines(1400, 'é');
  assert.ok(wide.length < MAX_RECORD_BYTES && Buffer.byteLength(wide) > MAX_RECORD_BYTES);
  assert.throws(() => store.loadMarkdown(wide), /That text is 27\d KB; .* limit here is 256 KB/);
  assert.doesNotThrow(() => store.loadMarkdown(lines(1000, 'é')));
});

// ---------- a flow collection over very many lines is read in one pass (N2) ----------
// The reader used to rescan everything gathered so far each time it added a line, so a few tens of thousands of short
// lines of one open flow collection took minutes. LINES sizes the shapes to about 256 KB (ICR_REDOS_SIZE shrinks them).
const LINES = Math.floor(RUN / 5);
const flowIn = (value) => EX.replace(/^decisions:[\s\S]*?(?=^\w)/m, value);
const MANY_LINES = {
  'a flow sequence over very many short lines': flowIn(`decisions: [\n${'  a,\n'.repeat(LINES)}  b]\n`),
  'a flow mapping over very many short lines': flowIn(`decisions: {\n${'  a: 1,\n'.repeat(Math.floor(LINES * 0.6))}  b: 2}\n`),
  'an unclosed bracket on every line': flowIn(`decisions: [\n${'  a, [b, {c: d\n'.repeat(Math.floor(LINES / 3))}`),
  'an unclosed brace on every line': flowIn(`decisions: {\n${'  a: {b: [c\n'.repeat(Math.floor(LINES / 3))}`),
  'an unclosed double quote': flowIn(`decisions: ["a, 'b\n${'  "a, \'b\n'.repeat(Math.floor(LINES / 2))}`),
  'an unclosed single quote': flowIn(`decisions: ['a, "b\n${"  'a, \"b\n".repeat(Math.floor(LINES / 2))}`),
  'a quoted scalar over very many lines': flowIn(`decisions: "a\n${'  b\n'.repeat(LINES)}`),
  'a plain scalar over very many lines': flowIn(`decisions: a\n${'  b\n'.repeat(LINES)}`),
  'a flow collection closed by the very last line': flowIn(`decisions: [\n${'  [a, b],\n'.repeat(Math.floor(LINES / 2))}  c\n]\n`),
};
for (const [name, text] of Object.entries(MANY_LINES)) {
  test(`${name}: every reader takes well within the time limit`, async () => {
    const { splitDocument } = await import('../js/lint.js');
    const stages = {
      'read the front matter': () => { const d = splitDocument(text); try { parseYaml(d.yaml); } catch { /* an error is fine; slowness is not */ } },
      'import': () => fromMarkdown(text),
      'export': () => toMarkdown(fromMarkdown(text).model),
      'check': () => analyze(text),
    };
    for (const [stage, fn] of Object.entries(stages)) {
      const { ms } = timed(fn);
      assert.ok(ms < LIMIT_MS, `${stage}: ${ms} ms for ${text.length} characters`);
    }
    const { ms } = timed(stages['read the front matter']);
    assert.ok(ms < 200, `the front matter reader took ${ms} ms (it takes about 15; walking the tail for every level takes over 300)`);
  });
}

test('a long flow collection that is closed is still read, and one that is not is reported', () => {
  const ok = parseYaml(`k: [\n${'  a,\n'.repeat(5000)}  b]`);
  assert.equal(ok.k.length, 5001);
  assert.equal(ok.k[5000], 'b');
  assert.throws(() => parseYaml(`k: [\n${'  a,\n'.repeat(50)}`), /unexpected end of the stream within a flow collection/);
  assert.deepEqual(JSON.parse(JSON.stringify(parseYaml('k: [a,\n  "b ]",\n  [c,\n  d]]'))), { k: ['a', 'b ]', ['c', 'd']] });
});

// ---------- quoted values over many long lines, and deep nesting over a very long tail (R3-3) ----------
// The reader used to read all the text gathered so far again after every added line of a quoted value, and made a new
// regular expression for every \x or \u escape; and every level of a deeply nested document walked over the same
// trailing blank or comment lines.
const BSL = String.fromCharCode(92);
const longLine = (unit, n) => unit.repeat(Math.ceil(n / unit.length));
const PER_LINE = Math.max(200, Math.floor(RUN / 190)); // 190 continuation lines make about RUN characters
const TAIL = Math.floor(RUN / 2);
const nested = (levels, tail) => `${Array.from({ length: levels }, (_, i) => `${' '.repeat(i)}k${i}:`).join('\n')}\n${' '.repeat(levels)}x: 1\n${tail}`;
const R3_SHAPES = {
  'an unclosed double-quoted value with hex escapes on long lines': flowIn(`decisions: "${longLine(BSL + 'x41', PER_LINE)}\n${`  ${longLine(BSL + 'u0041', PER_LINE)}\n`.repeat(190)}`),
  'an unclosed double-quoted value with wide escapes on long lines': flowIn(`decisions: "${longLine(BSL + 'U00000041', PER_LINE)}\n${`  ${longLine(BSL + 'U00000041', PER_LINE)}\n`.repeat(190)}`),
  'an unclosed double-quoted value of plain text on long lines': flowIn(`decisions: "${longLine('abc ', PER_LINE)}\n${`  ${longLine('abc ', PER_LINE)}\n`.repeat(190)}`),
  'an unclosed single-quoted value with doubled quotes on long lines': flowIn(`decisions: '${longLine("it''s ", PER_LINE)}\n${`  ${longLine("it''s ", PER_LINE)}\n`.repeat(190)}`),
  'a quoted value closed by its last line': flowIn(`decisions: "${longLine('abc ', PER_LINE)}\n${`  ${longLine('abc ', PER_LINE)}\n`.repeat(150)}  end"\n`),
};
for (const [name, text] of Object.entries(R3_SHAPES)) {
  test(`${name}: every reader takes well within the time limit`, async () => {
    const { splitDocument } = await import('../js/lint.js');
    const stages = {
      'read the front matter': () => { const d = splitDocument(text); try { parseYaml(d.yaml); } catch { /* an error is fine; slowness is not */ } },
      'import': () => fromMarkdown(text),
      'export': () => toMarkdown(fromMarkdown(text).model),
      'check': () => analyze(text),
    };
    for (const [stage, fn] of Object.entries(stages)) {
      const { ms } = timed(fn);
      assert.ok(ms < LIMIT_MS, `${stage}: ${ms} ms for ${text.length} characters`);
    }
    const { ms } = timed(stages['read the front matter']);
    assert.ok(ms < 200, `the front matter reader took ${ms} ms (it takes about 30; reading the text again for every added line takes over 250)`);
  });
}
for (const [label, tail] of [['blank lines', '\n'.repeat(TAIL)], ['comment lines', '#\n'.repeat(Math.floor(TAIL / 2))], ['blank and comment lines', '# c\n\n'.repeat(Math.floor(TAIL / 3))]]) {
  test(`98 levels of nesting followed by a very long tail of ${label}: every reader takes well within the time limit`, async () => {
    const yaml = nested(98, tail);
    const text = `---\n${yaml}\n---\n\n${EX.split(/\n---\n/).slice(1).join('\n---\n').replace(/^\n/, '')}`;
    const stages = {
      'read the front matter': () => { try { parseYaml(yaml); } catch { /* fine */ } },
      'import': () => fromMarkdown(text),
      'export': () => toMarkdown(fromMarkdown(text).model),
      'check': () => analyze(text),
    };
    for (const [stage, fn] of Object.entries(stages)) {
      const { ms } = timed(fn);
      assert.ok(ms < LIMIT_MS, `${stage}: ${ms} ms for ${text.length} characters`);
    }
    const { ms } = timed(stages['read the front matter']);
    assert.ok(ms < 200, `the front matter reader took ${ms} ms (it takes about 15; walking the tail for every level takes over 300)`);
  });
}

test('an escape in a quoted value is checked without making a regular expression for it (R3-3)', () => {
  const BS = String.fromCharCode(92);
  const real = globalThis.RegExp;
  let made = 0;
  globalThis.RegExp = new Proxy(real, { construct(target, args, newTarget) { made++; return Reflect.construct(target, args, newTarget); } });
  try {
    const text = `a: "${[BS + 'x41', BS + 'u0041', BS + 'U00000041'].join('').repeat(2000)}"`;
    const v = parseYaml(text).a;
    assert.equal(v.length, 6000);
  } finally { globalThis.RegExp = real; }
  assert.ok(made < 20, `${made} regular expressions were made while reading 6000 escapes`);
  assert.throws(() => parseYaml(`a: "${BS}x4"`), /expected hexadecimal character/);
  assert.throws(() => parseYaml(`a: "${BS}u00G1"`), /expected hexadecimal character/);
});

test('a change that makes the record impossible to analyse is undone and reported, not left half applied (R5-5)', () => {
  const before = JSON.stringify(store.model);
  assert.throws(() => store.change((m) => { m.fm = { icr: '0.2', get title() { throw new RangeError('Maximum call stack size exceeded'); } }; }), /could not be applied.*left as it was/);
  assert.equal(JSON.stringify(store.model), before, 'the record is as it was');
  assert.doesNotThrow(() => store.markdown, 'and it can still be shown');
  store.change((m) => { m.fm.title = 'Still works'; });
  assert.equal(store.model.fm.title, 'Still works');
});

test('3,000 nested flow mappings in front matter are refused with a message, and the record can still be exported (R5-5)', () => {
  const text = EX.replace(/^decisions:.*$/m, `decisions: ${'{a: '.repeat(3000)}x${'}'.repeat(3000)}`);
  const { model } = fromMarkdown(text);
  assert.equal(model.fm, null, 'kept as text');
  assert.doesNotThrow(() => toMarkdown(model));
  assert.ok(analyze(text).problems.some((p) => /not valid YAML: the YAML is nested too deeply/.test(p.message)));
});

// ---------- L4: very many lines of deeply nested empty lists took time in proportion to depth times line length ----------
// "- - - ... []" was cut down one level at a time, and the line that followed was read again by every level that ended.
const deepLines = (line) => 'decisions:\n' + (line + '\n').repeat(Math.floor((BIG - 20000) / (line.length + 1))); // as many as the size limit lets in
const DEEP_SHAPES = {
  'compact block sequences 97 deep, ending in an empty list': deepLines(`${'- '.repeat(97)}[]`),
  'compact block sequences 97 deep with nothing at the end': deepLines(`${'- '.repeat(97)}`),
  'flow sequences 97 deep and empty': deepLines(`- ${'['.repeat(97)}${']'.repeat(97)}`),
  'flow sequences 98 deep, which js-yaml refuses': deepLines(`- ${'['.repeat(98)}${']'.repeat(98)}`),
};
for (const [name, yaml] of Object.entries(DEEP_SHAPES)) {
  test(`${name}, on very many lines: the store takes well within the time limit to load it and to apply a change`, () => {
    const text = EX.replace(/^decisions:.*\n/m, yaml);
    assert.ok(Buffer.byteLength(text) < MAX_RECORD_BYTES, `${Buffer.byteLength(text)} bytes is within the record limit`);
    const load = timed(() => store.loadMarkdown(text));
    assert.ok(load.ms < LIMIT_MS, `loading took ${load.ms} ms for ${text.length} characters`);
    const change = timed(() => store.change((m) => { if (m.fm) m.fm.title = 'Changed'; }));
    assert.ok(change.ms < LIMIT_MS, `a change took ${change.ms} ms`);
    const read = timed(() => { try { parseYaml(yaml); } catch { /* an error is fine; slowness is not */ } });
    assert.ok(read.ms < 500, `the front matter reader took ${read.ms} ms (it takes about 100; cutting the line down at every level takes over 1500)`);
    store.loadMarkdown(EX);
  });
}

// ---------- P1: folding a long quoted value that goes over very many lines, inside a flow collection ----------
// readQuoted trimmed the end of the text it had built at every line break, which is quadratic in the number of lines.
for (const [label, q] of [['double', '"'], ['single', "'"]]) {
  test(`a ${label}-quoted value of 120,000 lines inside a flow collection is read in well within the time limit, and the record loads`, () => {
    const yaml = `decisions: [${q}a${'\nb'.repeat(120000)}${q}]\n`;
    const text = EX.replace(/^decisions:.*\n/m, yaml);
    assert.ok(Buffer.byteLength(text) < MAX_RECORD_BYTES, `${Buffer.byteLength(text)} bytes is within the record limit`);
    const read = timed(() => parseYaml(yaml));
    assert.equal(read.r.decisions[0].length, 240001, 'one "a" and 120,000 lines of "b", each folded to a blank');
    assert.ok(read.ms < 500, `the front matter reader took ${read.ms} ms (it takes under 100; trimming at every break takes seconds)`);
    const load = timed(() => store.loadMarkdown(text));
    assert.ok(load.ms < LIMIT_MS, `loading took ${load.ms} ms`);
    store.loadMarkdown(EX);
  });
}
test('blanks before a line break inside a quoted value in a flow collection are still dropped, and those an escape wrote are kept', () => {
  const B = String.fromCharCode(92);
  const plainOf = (text) => JSON.parse(JSON.stringify(parseYaml(text)));
  assert.deepEqual(plainOf('k: ["a  \n b"]'), { k: ['a b'] });
  assert.deepEqual(plainOf(`k: ["a${B}x20 \n b"]`), { k: ['a  b'] }, 'an escaped blank and a literal one: only the literal one goes');
  assert.deepEqual(plainOf(`k: ["a${B}t\n b"]`), { k: ['a\t b'] });
  assert.deepEqual(plainOf('k: ["a   "]'), { k: ['a   '] }, 'blanks before the closing quote stay');
  assert.deepEqual(plainOf("k: ['a   ']"), { k: ['a   '] });
});

// ---------- N2: very many empty entries that js-yaml reads into one deeply nested list ----------
// "- - ... -" (96 deep) followed by "-" lines at the margin: js-yaml puts every one of them in the innermost list, which written as
// block lines is 96 levels of indent per entry (23 MB for 118,000 of them). Such a record is kept as text.
const EMPTIES_DEEP = {
  '96 compact empty entries then 118,000 dashes at the margin': 'decisions:\n' + '- '.repeat(96) + '\n' + '-\n'.repeat(118000),
  '96 empty entries on lines of their own then 118,000 dashes at the margin': 'decisions:\n' + Array.from({ length: 96 }, (_, i) => `${' '.repeat(i * 2)}-`).join('\n') + '\n' + '-\n'.repeat(117000),
};
for (const [name, yaml] of Object.entries(EMPTIES_DEEP)) {
  test(`${name}: import, change, check and export each take within the time limit, and the export is within the record limit`, () => {
    const text = EX.replace(/^decisions:.*\n/m, yaml);
    assert.ok(Buffer.byteLength(text) < MAX_RECORD_BYTES, `${Buffer.byteLength(text)} bytes is within the record limit`);
    const imported = timed(() => fromMarkdown(text));
    assert.ok(imported.ms < LIMIT_MS, `import took ${imported.ms} ms`);
    const exported = timed(() => toMarkdown(imported.r.model));
    assert.ok(exported.ms < LIMIT_MS, `export took ${exported.ms} ms`);
    assert.ok(Buffer.byteLength(exported.r) <= MAX_RECORD_BYTES, `the export is ${Buffer.byteLength(exported.r)} bytes`);
    assert.ok(timed(() => analyze(exported.r)).ms < LIMIT_MS);
    assert.ok(timed(() => store.loadMarkdown(text)).ms < LIMIT_MS);
    const change = timed(() => store.change((m) => { if (m.fm) m.fm.title = 'Changed'; else m.h1 = 'Changed'; }));
    assert.ok(change.ms < LIMIT_MS, `a change took ${change.ms} ms`);
    assert.equal(imported.r.model.fm, null, 'the front matter is kept as text');
    store.loadMarkdown(EX);
  });
}
test('a few empty entries at the margin after deep ones are still a list (js-yaml reads them into the innermost one)', () => {
  const text = EX.replace(/^decisions:.*\n/m, 'decisions:\n' + '- '.repeat(96) + '\n' + '-\n'.repeat(500));
  const { model } = fromMarkdown(text);
  let v = model.fm?.decisions;
  let depth = 0;
  while (Array.isArray(v) && Array.isArray(v[0])) { v = v[0]; depth++; }
  assert.equal(depth, 95);
  assert.equal(v.length, 501);
});

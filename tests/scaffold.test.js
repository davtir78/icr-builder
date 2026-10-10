import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, lint, SECTION_TITLES } from '../js/lint.js';
import { blankModel, toMarkdown, fromMarkdown, getSection, setSection, setPath } from '../js/model.js';
import { scaffoldFor, applyPattern } from '../js/scaffold.js';
import { advise, placeholdersIn } from '../js/advice.js';
import { buildFlow, defaultFlowOptions } from '../js/flow.js';
import { PATTERNS } from '../js/data/patterns.js';
import { INTERACTIONS } from '../js/data/guidance.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, '..', 'templates', f), 'utf8');

test('choosing int-api-external gives sync-request-response, the pattern link and a Security section that references its controls', () => {
  const m = blankModel('2026-10-09');
  const r = applyPattern(m, 'int-api-external');
  assert.deepEqual(m.fm.pattern, { id: 'int-api-external', url: 'https://www.itarchitecturepatterns.net/patterns/int-api-external' });
  assert.equal(m.fm.interaction, 'sync-request-response');
  assert.ok(r.changed.includes('interaction'));
  assert.match(getSection(m, 'Security'), /- Pattern controls inherited: \[Integration API Management \(External\)\]\(https:\/\/www\.itarchitecturepatterns\.net\/patterns\/int-api-external\);/);
  assert.match(getSection(m, 'Security'), /public internet through the gateway/);
  assert.match(getSection(m, 'Service levels'), /Availability: .*measured at/);
  assert.match(getSection(m, 'Service levels'), /429/);
  assert.match(getSection(m, 'Interaction'), /Pattern: \[Integration API Management \(External\)\]/);
});

test('every pattern fills the front matter and the four prompted sections', () => {
  for (const p of PATTERNS) {
    const m = blankModel();
    applyPattern(m, p.id);
    assert.equal(m.fm.pattern.id, p.id);
    assert.equal(m.fm.interaction, p.interaction);
    for (const t of ['Interaction', 'Security', 'Service levels', 'Error handling']) assert.ok(getSection(m, t).trim(), `${p.id}: ${t}`);
    assert.ok(getSection(m, 'Security').includes(p.url), p.id);
  }
});

test('choosing a pattern never overwrites what the author wrote', () => {
  const m = blankModel();
  setSection(m, 'Security', '- Authentication: OAuth 2.0 client credentials.\n- Transport: TLS 1.3.');
  setSection(m, 'Error handling', 'Our own words.');
  applyPattern(m, 'int-api-external');
  assert.match(getSection(m, 'Security'), /^- Authentication: OAuth 2\.0 client credentials\.\n- Transport: TLS 1\.3\.\n- Pattern controls inherited: \[Integration API Management \(External\)\]/);
  assert.equal(getSection(m, 'Error handling'), 'Our own words.');
});

test('choosing a different pattern updates the pattern lines but not the rest', () => {
  const m = blankModel();
  applyPattern(m, 'int-api-external');
  setSection(m, 'Security', getSection(m, 'Security').replace('<team>', 'Platform team'));
  applyPattern(m, 'int-api-cloud');
  const sec = getSection(m, 'Security');
  assert.match(sec, /int-api-cloud/);
  assert.doesNotMatch(sec, /int-api-external/);
  assert.match(sec, /Platform team/);
  assert.equal(m.fm.pattern.id, 'int-api-cloud');
  assert.equal((sec.match(/Pattern controls inherited/g) || []).length, 1);
  assert.match(getSection(m, 'Interaction'), /int-api-cloud/);
});

test('every section has a scaffold for every interaction, with no stray undefined', () => {
  for (const { id } of INTERACTIONS) {
    const m = blankModel();
    m.fm.interaction = id;
    for (const t of SECTION_TITLES) {
      if (t === 'Interaction flows') continue; // built by the flow helper
      const s = scaffoldFor(t, m);
      assert.ok(s.trim(), `${id}: ${t}`);
      assert.doesNotMatch(s, /undefined|\[object/, `${id}: ${t}`);
    }
  }
});

test('the parties scaffold uses the names entered', () => {
  const m = blankModel();
  setPath(m.fm, ['provider', 'system'], 'Billing API');
  setPath(m.fm, ['consumers', 0, 'system'], 'Mobile app');
  const s = scaffoldFor('Parties and responsibilities', m);
  assert.match(s, /\| Provider \| Billing API \|/);
  assert.match(s, /\| Consumer \| Mobile app \|/);
});

test('a record built only from the prompts reaches conformance, and the advice says what is left to write', () => {
  const m = blankModel('2026-10-09');
  m.fm.id = 'ICR-T-0001';
  m.fm.title = 'Test integration';
  m.fm.provider = { system: 'Provider system', owner: 'Provider team' };
  m.fm.consumers = [{ system: 'Consumer system', owner: 'Consumer team' }];
  m.fm.data = { classification: 'OFFICIAL', 'personal-information': false };
  applyPattern(m, 'int-esp-cloud');
  for (const t of SECTION_TITLES) {
    if (['Environments and onboarding', 'Related records', 'Open issues'].includes(t)) continue;
    if (t === 'Interaction flows') setSection(m, t, buildFlow(defaultFlowOptions(m.fm, m.fm.interaction)).markdown);
    else if (!getSection(m, t).trim()) setSection(m, t, scaffoldFor(t, m));
  }
  const text = toMarkdown(m);
  assert.deepEqual(lint(text), []);
  const advice = advise(analyze(text));
  assert.ok(advice.some((a) => a.id === 'placeholders' && a.section === 'Security'));
  assert.ok(advice.filter((a) => a.id === 'placeholders').length >= 8);
});

test('the worked examples have no prompts left, apart from two real <angle-bracket> values in their examples', () => {
  // <access token> in an Authorization header, and <region> in a URL template: advice cannot tell them from prompts.
  const known = { '0001-partner-booking-api.md': ['Examples'], '0002-meter-reading-stream.md': ['Interface specification'] };
  for (const f of fs.readdirSync(path.join(HERE, '..', 'templates')).filter((n) => n.endsWith('.md'))) {
    const sections = advise(analyze(read(f))).filter((a) => a.id === 'placeholders').map((a) => a.section);
    assert.deepEqual(sections, known[f] ?? [], f);
  }
});

test('advice: placeholders are found, ordinary angle brackets are not', () => {
  assert.deepEqual(placeholdersIn('a <n> b <the system> c'), ['<n>', '<the system>']);
  assert.deepEqual(placeholdersIn('x <br> y <a href="z"> List<String> -> `<tag>` </b>'), []);
});

test('advice: each check fires on the fault it names', () => {
  const base = fromMarkdown(read('ICR-AB-0001-booking-api.md')).model;
  const adviceOf = (edit) => { const m = structuredClone(base); edit(m); return advise(analyze(toMarkdown(m))).map((a) => a.id); };
  assert.deepEqual(adviceOf(() => {}), []);
  assert.ok(adviceOf((m) => setSection(m, 'Acceptance criteria', '1. It works.\n2. It is fast. Proved by: a test.')).includes('criteria-proof'));
  assert.ok(adviceOf((m) => setSection(m, 'Service levels', '- Availability: 99.9% per month.')).includes('service-measure'));
  assert.ok(adviceOf((m) => setSection(m, 'Interaction', '- Volume: high.')).includes('interaction-volume'));
  assert.ok(adviceOf((m) => setSection(m, 'Parties and responsibilities', '| Provider | Booking API | x |')).includes('parties-missing'));
  assert.ok(adviceOf((m) => setSection(m, 'Examples', 'One:\n\n```http\nGET /\n```')).includes('examples-error'));
  assert.ok(adviceOf((m) => setSection(m, 'Interaction flows', getSection(m, 'Interaction flows').replace(/\n\d\. .*/g, ''))).includes('flow-steps'));
});

// ---------- the author's own words are kept (review finding H3) ----------

test('switching pattern twice keeps the author\'s wording on the pattern lines and changes only the link', () => {
  const m = blankModel();
  applyPattern(m, 'int-esp-cloud');
  setSection(m, 'Security', getSection(m, 'Security').replace(/^- Pattern controls inherited:.*$/m, '- Pattern controls inherited: [Integration Event Streaming (Cloud)](https://www.itarchitecturepatterns.net/patterns/int-esp-cloud); additional controls: topic ACLs per consumer, payload encryption with customer keys.'));
  setSection(m, 'Interaction', getSection(m, 'Interaction').replace(/^- Pattern:.*$/m, '- Pattern: [Integration Event Streaming (Cloud)](https://www.itarchitecturepatterns.net/patterns/int-esp-cloud), we deviate: compacted topics, no replay beyond 7 days.'));
  const r1 = applyPattern(m, 'int-esp-external');
  assert.match(getSection(m, 'Security'), /^- Pattern controls inherited: \[Integration Event Streaming \(External\)\]\(https:\/\/www\.itarchitecturepatterns\.net\/patterns\/int-esp-external\); additional controls: topic ACLs per consumer, payload encryption with customer keys\.$/m);
  assert.match(getSection(m, 'Interaction'), /^- Pattern: \[Integration Event Streaming \(External\)\]\(https:\/\/www\.itarchitecturepatterns\.net\/patterns\/int-esp-external\), we deviate: compacted topics, no replay beyond 7 days\.$/m);
  assert.deepEqual(r1.kept, []);
  applyPattern(m, 'int-esp-internal');
  assert.match(getSection(m, 'Security'), /int-esp-internal\); additional controls: topic ACLs per consumer/);
  assert.match(getSection(m, 'Interaction'), /int-esp-internal\), we deviate: compacted topics/);
  assert.equal((getSection(m, 'Security').match(/Pattern controls inherited/g) || []).length, 1);
});

test('a pattern line worded without a pattern link is left untouched and reported', () => {
  const m = blankModel();
  setSection(m, 'Security', '- Pattern controls inherited: the platform baseline; additional controls: none.');
  setSection(m, 'Interaction', '- Pattern: our house standard, no deviation.');
  const r = applyPattern(m, 'int-api-external');
  assert.equal(getSection(m, 'Security'), '- Pattern controls inherited: the platform baseline; additional controls: none.');
  assert.equal(getSection(m, 'Interaction'), '- Pattern: our house standard, no deviation.');
  assert.equal(r.kept.length, 2);
});

test('the unreplaced prompt in a pattern line becomes the link, and the rest of the line stays', () => {
  const m = blankModel();
  setSection(m, 'Security', '- Pattern controls inherited: <link to the pattern>; additional controls: mTLS between sites.');
  applyPattern(m, 'int-api-internal');
  assert.match(getSection(m, 'Security'), /^- Pattern controls inherited: \[Integration API Management \(Internal\)\]\(.*int-api-internal\); additional controls: mTLS between sites\.$/);
});

test('choosing a pattern keeps an interaction that already fits it (M1)', () => {
  const m = blankModel();
  m.fm.interaction = 'stream';
  applyPattern(m, 'int-esp-cloud'); // event streaming: async-event, also fits a stream
  assert.equal(m.fm.interaction, 'stream');
  m.fm.interaction = 'batch-file';
  applyPattern(m, 'int-esp-cloud');
  assert.equal(m.fm.interaction, 'async-event', 'an interaction that does not fit the pattern follows it');
  m.fm.interaction = 'async-event';
  applyPattern(m, 'int-cdc-cloud');
  assert.equal(m.fm.interaction, 'async-event', 'async-event is among the interactions cdc also fits');
});

test('event streaming and change data capture prompts and flow give retries and the dead-letter topic to the consumer (M2)', () => {
  for (const id of ['int-esp-cloud', 'int-cdc-internal']) {
    const m = blankModel();
    applyPattern(m, id);
    const errors = getSection(m, 'Error handling');
    assert.match(errors, /the consumer owns retries/);
    assert.doesNotMatch(errors, /broker redelivers|the broker retries/);
    const flow = buildFlow(defaultFlowOptions(m.fm, m.fm.interaction));
    assert.match(flow.mermaid, /read from the last committed offset/);
    assert.match(flow.mermaid, /write to the dead-letter topic/);
    assert.doesNotMatch(flow.mermaid, /deliver |redeliver/);
    assert.match(flow.steps.join(' '), /does not redeliver/);
    assert.deepEqual(analyze(toMarkdownWithFlow(m, flow)).problems.filter((p) => p.rule === 'flows'), []);
  }
  // a broker that does push (not log-based) keeps the redelivery wording, with the owner left to choose
  const q = blankModel();
  applyPattern(q, 'int-native-cloud');
  assert.match(getSection(q, 'Error handling'), /the broker \| the consumer/);
});

function toMarkdownWithFlow(m, flow) {
  const copy = structuredClone(m);
  setSection(copy, 'Interaction flows', flow.markdown);
  return toMarkdown(copy).replace(/(^## Interaction flows)/m, '$1');
}

test('prompts that were imprecise are corrected (L3)', () => {
  const m = blankModel();
  m.fm.interaction = 'sync-request-response';
  assert.match(scaffoldFor('Error handling', m), /except 429.*Retry-After.*only a safe or idempotent request/);
  m.fm.interaction = 'async-message';
  assert.doesNotMatch(scaffoldFor('Service levels', m), /queue depth stays under/);
  m.fm.interaction = 'async-event';
  assert.doesNotMatch(scaffoldFor('Interface specification', m), /File format/);
  assert.match(scaffoldFor('Interface specification', m), /AsyncAPI or CloudEvents/);
  m.fm.interaction = 'batch-file';
  assert.match(scaffoldFor('Interface specification', m), /File format/);
});

// ---------- switching the pattern (review finding NM2) ----------

test('switching pattern refreshes the sections that are still exactly the inserted prompts', () => {
  const m = blankModel();
  applyPattern(m, 'int-api-external');
  assert.match(getSection(m, 'Error handling'), /Failed messages or files: not applicable; the interaction is synchronous/);
  assert.match(getSection(m, 'Interaction'), /Ordering: not applicable; each request stands alone/);
  const r = applyPattern(m, 'int-esp-internal');
  assert.equal(m.fm.interaction, 'async-event');
  for (const t of ['Interaction', 'Service levels', 'Error handling']) assert.ok(r.changed.includes(`${t} (prompts refreshed)`), t);
  assert.doesNotMatch(getSection(m, 'Interaction'), /each request stands alone/);
  assert.doesNotMatch(getSection(m, 'Service levels'), /429|API gateway/);
  assert.doesNotMatch(getSection(m, 'Error handling'), /interaction is synchronous|Idempotency-Key/);
  assert.match(getSection(m, 'Error handling'), /the consumer owns retries/);
  assert.match(getSection(m, 'Security'), /int-esp-internal/);
  assert.equal(getSection(m, 'Security'), scaffoldFor('Security', m));
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.kept, []);
});

test('switching pattern leaves a section the author has started, and names it when it still holds the old prompts', () => {
  const m = blankModel();
  applyPattern(m, 'int-api-external');
  setSection(m, 'Service levels', getSection(m, 'Service levels').replace('<n> requests per second per consumer', '50 requests per second per consumer'));
  setSection(m, 'Error handling', 'Our own words, written from scratch.');
  const edited = getSection(m, 'Service levels');
  const r = applyPattern(m, 'int-esp-internal');
  assert.equal(getSection(m, 'Service levels'), edited, 'the author\'s edit is kept');
  assert.equal(getSection(m, 'Error handling'), 'Our own words, written from scratch.');
  assert.deepEqual(r.stale, ['Service levels'], 'only the section that still holds prompts for the previous choice');
  assert.ok(!r.changed.includes('Service levels (prompts refreshed)'));
});

test('an unedited generated flow follows the interaction too', () => {
  const m = blankModel();
  applyPattern(m, 'int-api-external');
  setSection(m, 'Interaction flows', buildFlow(defaultFlowOptions(m.fm, m.fm.interaction)).markdown);
  const r = applyPattern(m, 'int-esp-internal');
  assert.ok(r.changed.includes('Interaction flows (prompts refreshed)'));
  assert.equal(getSection(m, 'Interaction flows'), buildFlow(defaultFlowOptions(m.fm, 'async-event')).markdown);
});

test('a pattern line may use any bullet marker and spacing, and none is left with the old link', () => {
  const old = '[Integration API Management (External)](https://www.itarchitecturepatterns.net/patterns/int-api-external)';
  for (const marker of ['-   ', '* ', '+ ', '  - ', '*\t']) {
    const m = blankModel();
    setSection(m, 'Interaction', `${marker}Pattern: ${old}, no deviation.\n- Volume: 5 per second.`);
    setSection(m, 'Security', `${marker}Pattern controls inherited: ${old}; additional controls: none.\n- Transport: TLS 1.3.`);
    setSection(m, 'Related records', `${marker}Pattern: ${old}\n- Decisions: ADR-1`);
    const r = applyPattern(m, 'int-api-internal');
    const label = JSON.stringify(marker);
    assert.match(getSection(m, 'Interaction'), /Pattern: \[Integration API Management \(Internal\)\]\(https:\/\/www\.itarchitecturepatterns\.net\/patterns\/int-api-internal\), no deviation\.\n- Volume: 5 per second\.$/, label);
    assert.match(getSection(m, 'Security'), /Pattern controls inherited: \[Integration API Management \(Internal\)\]\(.*int-api-internal\); additional controls: none\.\n- Transport: TLS 1\.3\.$/, label);
    assert.equal((getSection(m, 'Security').match(/Pattern controls inherited/g) || []).length, 1, label);
    assert.match(getSection(m, 'Related records'), /Pattern: \[Integration API Management \(Internal\)\]\(.*int-api-internal\)\n- Decisions: ADR-1$/, label);
    for (const t of ['Interaction', 'Security', 'Related records']) assert.doesNotMatch(getSection(m, t), /int-api-external/, `${label} ${t}`);
    assert.ok(r.changed.includes('Related records (pattern link)'), label);
    assert.deepEqual(r.kept, [], label);
  }
});

test('a record with no Pattern line in Interaction is told so, and nothing is written there', () => {
  const m = blankModel();
  setSection(m, 'Interaction', '- Direction: consumer to provider.');
  const r = applyPattern(m, 'int-api-external');
  assert.equal(getSection(m, 'Interaction'), '- Direction: consumer to provider.');
  assert.ok(r.kept.some((k) => /^Interaction: it has no "- Pattern:" line/.test(k)));
  // Related records is optional: a missing line there is not reported, and the section is not created
  assert.equal(r.kept.some((k) => /^Related records/.test(k)), false);
  assert.equal(getSection(m, 'Related records'), '');
});

test('event streaming and change data capture acceptance criteria do not promise redelivery (NL1)', () => {
  for (const p of PATTERNS.filter((x) => ['esp', 'cdc'].includes(x.component))) {
    const m = blankModel();
    applyPattern(m, p.id);
    const text = scaffoldFor('Acceptance criteria', m);
    assert.doesNotMatch(text, /redeliver/i, p.id);
    assert.match(text, /committed offset/, p.id);
    assert.match(text, /dead-letter topic/, p.id);
    assert.match(text, /^1\. [\s\S]*\n2\. [\s\S]*\n3\. /, p.id);
  }
  // a broker that does push keeps its criterion about a redelivered event
  const m = blankModel();
  applyPattern(m, 'int-native-cloud');
  assert.match(scaffoldFor('Acceptance criteria', m), /An event redelivered after a failure is processed once/);
});

// ---------- relinking edge cases (review finding N5) ----------

const OLD_LINK = '[Integration API Management (External)](https://www.itarchitecturepatterns.net/patterns/int-api-external)';
const NEW_LINK = '[Integration API Management (Internal)](https://www.itarchitecturepatterns.net/patterns/int-api-internal)';

test('a quoted copy of a Pattern line earlier in the text is not the one that is changed', () => {
  const m = blankModel();
  setSection(m, 'Interaction', `> - Pattern: ${OLD_LINK}, no deviation.\n\n- Pattern: ${OLD_LINK}, no deviation.`);
  applyPattern(m, 'int-api-internal');
  assert.equal(getSection(m, 'Interaction'), `> - Pattern: ${OLD_LINK}, no deviation.\n\n- Pattern: ${NEW_LINK}, no deviation.`);
});

test('every Pattern line is relinked, and a copy inside a code fence is left alone', () => {
  const m = blankModel();
  const text = `- Pattern: ${OLD_LINK}, no deviation.\n- Volume: 5 per second.\n\nSee also:\n\n- Pattern: ${OLD_LINK}\n\n\`\`\`\n- Pattern: ${OLD_LINK}\n\`\`\``;
  setSection(m, 'Interaction', text);
  const r = applyPattern(m, 'int-api-internal');
  assert.equal(getSection(m, 'Interaction'), text.replace(OLD_LINK, NEW_LINK).replace(`- Pattern: ${OLD_LINK}\n\n\`\`\``, `- Pattern: ${NEW_LINK}\n\n\`\`\``));
  assert.equal((getSection(m, 'Interaction').match(/int-api-internal/g) || []).length, 2);
  assert.equal((getSection(m, 'Interaction').match(/int-api-external/g) || []).length, 1, 'only the fenced copy keeps the old link');
  assert.deepEqual(r.kept, []);
});

test('a numbered line, a bold label and any case are recognised as the Pattern line', () => {
  for (const label of ['1. Pattern:', '2) Pattern:', '- **Pattern:**', '- **Pattern**:', '- __Pattern__:', '- pattern:', '* PATTERN:', '- *Pattern*:']) {
    const m = blankModel();
    setSection(m, 'Interaction', `${label} ${OLD_LINK}, no deviation.\n- Volume: 5 per second.`);
    setSection(m, 'Related records', `${label} ${OLD_LINK}`);
    const r = applyPattern(m, 'int-api-internal');
    assert.equal(getSection(m, 'Interaction'), `${label} ${NEW_LINK}, no deviation.\n- Volume: 5 per second.`, label);
    assert.equal(getSection(m, 'Related records'), `${label} ${NEW_LINK}`, label);
    assert.deepEqual(r.kept, [], label);
  }
  const m = blankModel();
  setSection(m, 'Security', `1. **Pattern controls inherited:** ${OLD_LINK}; additional controls: none.`);
  applyPattern(m, 'int-api-internal');
  assert.equal(getSection(m, 'Security'), `1. **Pattern controls inherited:** ${NEW_LINK}; additional controls: none.`);
});

test('a link on the address without www is recognised too', () => {
  const m = blankModel();
  setSection(m, 'Interaction', '- Pattern: [Old](https://itarchitecturepatterns.net/patterns/int-api-external), no deviation.');
  setSection(m, 'Security', '- Pattern controls inherited: [Old](http://itarchitecturepatterns.net/patterns/int-api-external); additional controls: none.');
  applyPattern(m, 'int-api-internal');
  assert.equal(getSection(m, 'Interaction'), `- Pattern: ${NEW_LINK}, no deviation.`);
  assert.equal(getSection(m, 'Security'), `- Pattern controls inherited: ${NEW_LINK}; additional controls: none.`);
});

test('a pattern named in a line that is not a list line is reported, and nothing is added or lost', () => {
  const m = blankModel();
  const interaction = `Pattern: ${OLD_LINK} (written as a paragraph).`;
  const security = `We inherit the controls of ${OLD_LINK}, plus our own.`;
  setSection(m, 'Interaction', interaction);
  setSection(m, 'Security', security);
  const r = applyPattern(m, 'int-api-internal');
  assert.equal(getSection(m, 'Interaction'), interaction);
  assert.equal(getSection(m, 'Security'), security, 'no second, contradicting line is appended');
  assert.ok(r.kept.some((k) => /^Interaction: a pattern is linked in text that is not a "Pattern:" list line/.test(k)));
  assert.ok(r.kept.some((k) => /^Security: a pattern is linked in text that is not a "Pattern controls inherited" list line/.test(k)));
  assert.ok(!r.kept.some((k) => /has no "- Pattern:" line/.test(k)), 'and it does not claim there is no Pattern line');
});

test('two Pattern lines with no link are both reported, with the count', () => {
  const m = blankModel();
  setSection(m, 'Interaction', '- Pattern: our house standard.\n- Pattern: and another.');
  const r = applyPattern(m, 'int-api-internal');
  assert.equal(getSection(m, 'Interaction'), '- Pattern: our house standard.\n- Pattern: and another.');
  assert.ok(r.kept.some((k) => /^Interaction: 2 "Pattern" lines have no pattern link to update/.test(k)), r.kept.join(' | '));
});

// ---------- only the pattern's own link is changed (R3-6) ----------

const linkTo = (id) => { const p = PATTERNS.find((x) => x.id === id); return `[${p.title}](${p.url})`; };

test('a Pattern line that links another page keeps that link', () => {
  const m = blankModel();
  applyPattern(m, 'int-api-external');
  setSection(m, 'Interaction', `- Pattern: ${linkTo('int-api-external')}, with ${linkTo('int-cdc-internal')} feeding it.`);
  setSection(m, 'Security', `- Pattern controls inherited: ${linkTo('int-api-external')}; also see ${linkTo('int-cdc-internal')}.`);
  applyPattern(m, 'int-api-internal');
  assert.equal(getSection(m, 'Interaction'), `- Pattern: ${linkTo('int-api-internal')}, with ${linkTo('int-cdc-internal')} feeding it.`);
  assert.equal(getSection(m, 'Security'), `- Pattern controls inherited: ${linkTo('int-api-internal')}; also see ${linkTo('int-cdc-internal')}.`);
});

test('when the line names the previous pattern second, that is the link that changes', () => {
  const m = blankModel();
  applyPattern(m, 'int-api-external');
  setSection(m, 'Interaction', `- Pattern: ${linkTo('int-cdc-internal')} is upstream of ${linkTo('int-api-external')}.`);
  applyPattern(m, 'int-api-internal');
  assert.equal(getSection(m, 'Interaction'), `- Pattern: ${linkTo('int-cdc-internal')} is upstream of ${linkTo('int-api-internal')}.`);
});

test('with no previous pattern, the first link on the line is the one that is replaced', () => {
  const m = blankModel();
  setSection(m, 'Interaction', `- Pattern: ${linkTo('int-cdc-internal')}, with ${linkTo('int-api-external')}.`);
  applyPattern(m, 'int-api-internal');
  assert.equal(getSection(m, 'Interaction'), `- Pattern: ${linkTo('int-api-internal')}, with ${linkTo('int-api-external')}.`);
});

test('property: for every pair of patterns, one extra link on the line survives a switch, and the old link does not', () => {
  const ids = PATTERNS.map((p) => p.id);
  const other = (a, b) => ids.find((x) => x !== a && x !== b);
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const extra = other(a, b);
      const m = blankModel();
      applyPattern(m, a);
      setSection(m, 'Interaction', `- Pattern: ${linkTo(a)}, fed by ${linkTo(extra)}.`);
      applyPattern(m, b);
      const text = getSection(m, 'Interaction');
      assert.equal(text, `- Pattern: ${linkTo(b)}, fed by ${linkTo(extra)}.`, `${a} -> ${b}`);
      assert.equal((text.match(/\/patterns\//g) || []).length, 2);
    }
  }
});

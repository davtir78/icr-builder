import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from '../js/lint.js';
import { fromMarkdown, toMarkdown, setSection } from '../js/model.js';
import { buildFlow, defaultFlowOptions, clean, diagramsIn, participantsIn, MAX_PARTICIPANTS, FLOW_KINDS } from '../js/flow.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = fs.readFileSync(path.join(HERE, '..', 'templates', 'ICR-AB-0001-booking-api.md'), 'utf8');
const fm = { provider: { system: 'Reservations Service' }, consumers: [{ system: 'Booking widget' }, { system: 'Partner portal' }] };

function withFlow(markdown) {
  const { model } = fromMarkdown(BASE);
  setSection(model, 'Interaction flows', markdown);
  return toMarkdown(model);
}

for (const interaction of Object.keys(FLOW_KINDS)) {
  for (const useVia of [true, false]) {
    for (const failure of [true, false]) {
      for (const sender of ['consumer', 'provider']) {
        test(`${interaction}: via=${useVia} failure=${failure} sender=${sender} gives a conforming flow`, () => {
          const flow = buildFlow({ ...defaultFlowOptions(fm, interaction), useVia, failure, sender });
          assert.deepEqual(lint(withFlow(flow.markdown)), []);
          assert.ok(flow.steps.length >= 2);
          assert.match(flow.markdown, /\n1\. /);
          assert.ok(flow.participants.length <= MAX_PARTICIPANTS);
          const aliases = flow.participants.map((p) => p.alias);
          assert.equal(new Set(aliases).size, aliases.length, 'aliases are unique');
          // every alias used in a message is a declared participant
          const used = participantsIn(flow.mermaid);
          for (const a of used) assert.ok(aliases.includes(a), `${a} is declared`);
        });
      }
    }
  }
}

test('a failure is drawn as an alt branch when failure is on, and not when it is off', () => {
  const on = buildFlow({ ...defaultFlowOptions(fm, 'sync-request-response'), failure: true });
  const off = buildFlow({ ...defaultFlowOptions(fm, 'sync-request-response'), failure: false });
  assert.match(on.mermaid, /\n {2}alt /);
  assert.match(on.mermaid, /\n {2}else /);
  assert.doesNotMatch(off.mermaid, /\balt\b/);
});

test('branches are indented inside alt and the diagram text is well formed', () => {
  const { mermaid } = buildFlow(defaultFlowOptions(fm, 'sync-request-response'));
  const lines = mermaid.split('\n');
  const alt = lines.findIndex((l) => /^ {2}alt /.test(l));
  assert.match(lines[alt + 1], /^ {4}\S/);
  assert.match(lines[alt + 3], /^ {2}else /);
  assert.equal(lines.at(-1), '  end');
});

test('the party names from the front matter are used, and the accessible title and description say who is involved', () => {
  const flow = buildFlow(defaultFlowOptions(fm, 'sync-request-response'));
  assert.match(flow.mermaid, /participant C as Booking widget/);
  assert.match(flow.mermaid, /participant P as Reservations Service/);
  assert.match(flow.accTitle, /Booking widget calls Reservations Service/);
  assert.match(flow.accDescr, /Reservations Service/);
});

test('with no parties entered the diagram still builds, with generic names', () => {
  const flow = buildFlow(defaultFlowOptions({}, 'async-event'));
  assert.match(flow.mermaid, /participant P as Provider/);
  assert.deepEqual(lint(withFlow(flow.markdown)), []);
});

test('more consumers than fit are cut to the seven-participant limit, with a warning', () => {
  const many = { consumers: Array.from({ length: 9 }, (_, i) => `Consumer system ${i}`) };
  const flow = buildFlow({ ...defaultFlowOptions({ provider: { system: 'P' } }, 'async-event'), consumers: many.consumers });
  assert.equal(flow.participants.length, MAX_PARTICIPANTS);
  assert.equal(flow.warnings.length, 1);
});

test('text that would break Mermaid is cleaned', () => {
  assert.equal(clean('a; b # c\n d %% e'), 'a, b , c d % e');
  const flow = buildFlow({ ...defaultFlowOptions(fm, 'sync-request-response'), main: 'POST /x; DROP #1' });
  assert.doesNotMatch(flow.mermaid, /[;#]/);
});

test('diagramsIn reads participants of diagrams already written', () => {
  const found = diagramsIn(BASE.match(/## Interaction flows[\s\S]*?(?=\n## Interface)/)[0]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].participants.sort(), ['G', 'S', 'W']);
});

// ---------- the text says what the diagram draws (review finding NL1) ----------

const three = { provider: { system: 'Meter system' }, consumers: [{ system: 'Billing' }, { system: 'Analytics' }, { system: 'Archive' }], pattern: { id: 'int-esp-cloud' } };

for (const interaction of Object.keys(FLOW_KINDS)) {
  for (const failure of [true, false]) {
    for (const logBased of [true, false]) {
      test(`${interaction} (log-based ${logBased}, failure ${failure}): every declared participant takes part in a message`, () => {
        const flow = buildFlow({ ...defaultFlowOptions(three, interaction), failure, logBased });
        const declared = flow.participants.map((p) => p.alias);
        const lines = flow.mermaid.split('\n').filter((l) => /->>/.test(l));
        const takesPart = (l, a) => { const t = l.trim(); return t.startsWith(`${a}->>`) || t.startsWith(`${a}-->>`) || t.includes(`->>${a}:`) || t.includes(`-->>${a}:`); };
        for (const alias of declared) assert.ok(lines.some((l) => takesPart(l, alias)), `${alias} appears in no message`);
      });
    }
  }
}

for (const interaction of ['async-event', 'stream']) {
  for (const failure of [true, false]) {
    test(`${interaction}: each consumer reads, receives the records and commits its offset (failure ${failure}); the text says the same`, () => {
      const flow = buildFlow({ ...defaultFlowOptions(three, interaction), failure, logBased: true });
      for (const alias of ['C', 'C2', 'C3']) {
        assert.match(flow.mermaid, new RegExp(`${alias}->>V: read from the last committed offset`), `${alias} reads`);
        assert.match(flow.mermaid, new RegExp(`V-->>${alias}: `), `${alias} receives the records`);
        assert.match(flow.mermaid, new RegExp(`${alias}->>V: (commit the offset|write to the dead-letter topic, then commit the offset)`), `${alias} commits`);
      }
      assert.match(flow.accDescr, /commit/);
      assert.match(flow.steps.join(' '), /commit/);
      assert.match(flow.accDescr, /Billing, Analytics and Archive|Billing and Analytics and Archive|Billing.*Archive/);
      assert.deepEqual(lint(withFlow(flow.markdown)), []);
    });
  }
}

test('a request, a message or a file is drawn for the first consumer only, and the helper says so', () => {
  for (const interaction of ['sync-request-response', 'async-message', 'batch-file']) {
    const flow = buildFlow(defaultFlowOptions(three, interaction));
    assert.equal(flow.participants.filter((p) => p.role === 'consumer').length, 1, interaction);
    assert.equal(flow.warnings.length, 1, interaction);
  }
  assert.equal(buildFlow(defaultFlowOptions(fm, 'sync-request-response')).participants.filter((p) => p.role === 'consumer').length, 1);
  assert.equal(buildFlow(defaultFlowOptions(three, 'async-event')).participants.filter((p) => p.role === 'consumer').length, 3);
});

test('with one consumer the descriptions read as a sentence about one consumer (N6)', () => {
  const one = { provider: { system: 'Meter system' }, consumers: [{ system: 'Billing' }], pattern: { id: 'int-esp-cloud' } };
  for (const interaction of ['async-event', 'stream']) {
    for (const failure of [true, false]) {
      const flow = buildFlow({ ...defaultFlowOptions(one, interaction), failure, logBased: true });
      assert.match(flow.accDescr, /Billing reads (it|them)( in order)? from its last committed offset\./, flow.accDescr);
      assert.match(flow.accDescr, /The consumer commits its offset/, flow.accDescr);
      assert.doesNotMatch(flow.accDescr, /Billing read |from their|Each consumer/, flow.accDescr);
    }
  }
  const two = buildFlow({ ...defaultFlowOptions(three, 'stream'), logBased: true });
  assert.match(two.accDescr, /Billing, Analytics and Archive read them in order from their last committed offset|Billing and Analytics and Archive read them in order from their last committed offset/);
});

// ---------- no participant answers itself; every consumer named is drawn (review finding N4) ----------

const messageLines = (flow) => flow.mermaid.split('\n').map((l) => l.trim()).filter((l) => /^\w+--?>>\w+:/.test(l));
const takesPartIn = (lines, a) => lines.some((l) => l.startsWith(`${a}->>`) || l.startsWith(`${a}-->>`) || l.includes(`->>${a}:`) || l.includes(`-->>${a}:`));

for (const interaction of Object.keys(FLOW_KINDS)) {
  test(`${interaction}: across every option, no reply goes from a participant to itself and every declared participant is in a message`, () => {
    let combos = 0;
    for (const useVia of [true, false]) {
      for (const failure of [true, false]) {
        for (const sender of ['consumer', 'provider']) {
          for (const logBased of [true, false]) {
            for (const people of [fm, three, { provider: { system: 'Only provider' } }]) {
              const flow = buildFlow({ ...defaultFlowOptions(people, interaction), useVia, failure, sender, logBased });
              combos++;
              const lines = messageLines(flow);
              const label = `${interaction} via=${useVia} failure=${failure} sender=${sender} log=${logBased} consumers=${flow.participants.filter((p) => p.role === 'consumer').length}`;
              for (const l of lines.filter((x) => x.includes('-->>'))) {
                const [from, to] = l.split('-->>');
                assert.notEqual(from, to.split(':')[0], `${label}: ${l}`);
              }
              for (const p of flow.participants) assert.ok(takesPartIn(lines, p.alias), `${label}: ${p.alias} takes part in no message`);
              assert.deepEqual(lint(withFlow(flow.markdown)), [], label);
            }
          }
        }
      }
    }
    assert.ok(combos >= 48);
  });
}

test('request and response with no intermediary: the provider answers the caller', () => {
  const flow = buildFlow({ ...defaultFlowOptions(fm, 'sync-request-response'), useVia: false, failure: true });
  assert.match(flow.mermaid, /P-->>C: 200 OK with the result/);
  assert.match(flow.mermaid, /P-->>C: error response/);
  assert.doesNotMatch(flow.mermaid, /P-->>P/);
});

test('an event with no intermediary is published to every consumer, and the title, description and steps say so', () => {
  const flow = buildFlow({ ...defaultFlowOptions(three, 'async-event'), useVia: false, logBased: false, failure: true });
  for (const c of ['C', 'C2', 'C3']) {
    assert.match(flow.mermaid, new RegExp(`P->>${c}: publish event`));
    assert.match(flow.mermaid, new RegExp(`${c}-->>P: acknowledge`));
  }
  assert.match(flow.accTitle, /publishes an event to Billing and Analytics and Archive|publishes an event to Billing, Analytics and Archive/);
  assert.match(flow.accDescr, /to Billing.*Archive/);
  assert.match(flow.steps[0], /Billing.*Archive/);
});

test('the log-based option is ignored, with a warning, when no intermediary is drawn', () => {
  const flow = buildFlow({ ...defaultFlowOptions(three, 'async-event'), useVia: false, logBased: true });
  assert.equal(flow.warnings.length, 1);
  assert.match(flow.warnings[0], /needs the intermediary/);
  assert.doesNotMatch(flow.mermaid, /committed offset/);
  assert.equal(buildFlow({ ...defaultFlowOptions(three, 'async-event'), useVia: true, logBased: true }).warnings.length, 0);
});

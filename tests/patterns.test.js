import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATTERNS, COMPONENTS, BOUNDARIES, PATTERNS_SOURCE, patternById, patternsFor } from '../js/data/patterns.js';
import { ICR_SCHEMA } from '../js/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTERACTIONS = ICR_SCHEMA.properties.interaction.enum;

test('there are 33 integration patterns: 11 components in 3 boundaries', () => {
  assert.equal(COMPONENTS.length, 11);
  assert.equal(BOUNDARIES.length, 3);
  assert.equal(PATTERNS.length, 33);
  assert.equal(new Set(PATTERNS.map((p) => p.id)).size, 33);
});

test('the ids and titles are those read from the live site on the retrieval date', () => {
  // pattern-titles.txt: "<id>|<page title>" for each page read from the sitemap's int- patterns.
  const rows = fs.readFileSync(path.join(HERE, 'fixtures', 'pattern-titles.txt'), 'utf8').trim().split('\n').map((l) => l.split('|'));
  assert.equal(rows.length, 33);
  for (const [id, title] of rows) {
    const p = patternById(id);
    assert.ok(p, `${id} is in the list`);
    assert.equal(p.title, title.replace(/&amp;/g, '&'), id);
  }
  assert.equal(PATTERNS_SOURCE.retrieved, '2026-10-08');
});

test('every url is the pattern page on the site', () => {
  for (const p of PATTERNS) assert.equal(p.url, `https://www.itarchitecturepatterns.net/patterns/${p.id}`);
});

test('every suggested interaction is a value the schema allows', () => {
  for (const p of PATTERNS) {
    assert.ok(INTERACTIONS.includes(p.interaction), `${p.id}: ${p.interaction}`);
    for (const a of p.alsoFits) assert.ok(INTERACTIONS.includes(a), `${p.id}: ${a}`);
    assert.ok(!p.alsoFits.includes(p.interaction));
  }
});

test('the patterns used by the worked examples suggest the interaction the examples record', () => {
  assert.equal(patternById('int-api-external').interaction, 'sync-request-response');
  assert.equal(patternById('int-esp-cloud').interaction, 'async-event');
  assert.equal(patternById('int-filetransfer-external').interaction, 'batch-file');
  assert.equal(patternById('int-native-cloud').interaction, 'async-event');
  assert.equal(patternById('int-middleware-cloud').interaction, 'async-message');
});

test('patternsFor lists the best fits first and only suitable patterns', () => {
  const list = patternsFor('batch-file');
  assert.ok(list.length > 0);
  assert.equal(list[0].interaction, 'batch-file');
  assert.ok(list.every((p) => p.interaction === 'batch-file' || p.alsoFits.includes('batch-file')));
  assert.ok(patternsFor('stream').some((p) => p.id === 'int-cdc-internal'));
});

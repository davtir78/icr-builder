// Checks on the page itself: the privacy claim carries its exception, and the panel focus ring is not clipped.
//
// "Nothing is sent anywhere" is only true with its exception: the diagram library is fetched from a public CDN when
// the person chooses to draw. Every place that makes the claim must carry the exception.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', 'templates', 'tests'].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
const CLAIM = /nothing (is sent|leaves)|sends nothing|not sent anywhere/i;

test('every statement that nothing is sent says what the exception is', () => {
  const files = walk(ROOT).filter((f) => /\.(html|js|json|md)$/.test(f) && !/PUSH\.md$/.test(f));
  let found = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const [i, line] of text.split('\n').entries()) {
      if (!CLAIM.test(line)) continue;
      found++;
      assert.match(line, /diagram library|cdn.jsdelivr/i, `${path.relative(ROOT, f)}:${i + 1} says nothing is sent without the diagram-library exception`);
    }
  }
  assert.ok(found >= 5, `found ${found} statements`);
});

test('the scrolling panel draws its focus ring inside itself, where it is not clipped (NN3)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.panel-body:focus-visible \{ outline-offset: -\d+px; \}/);
});

test('every relative link in the README points at a file that exists, and the embedding section is there', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const m of readme.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1].split('#')[0])), `README links to ${m[1]}`);
  // and every file the README names in code font, under the folders it describes
  for (const m of readme.matchAll(/`((?:js|css|tests|tools|templates)\/[\w./-]+\.\w+)`/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), `README names ${m[1]}`);
  assert.match(readme, /## Embedding this tool in another site/);
  assert.match(readme, /Draw the diagrams/);
});

test('the embedded schema names no address that would look like a live link (N6)', () => {
  for (const f of ['js/schema.js', 'tests/fixtures/icr.schema.json']) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(text, /"\$id": "urn:/, f);
    assert.doesNotMatch(text, /raw\.githubusercontent\.com/, f);
  }
});

test('the privacy wording on the start page and in the README says what is fetched and from where (R4-6)', () => {
  const start = fs.readFileSync(path.join(ROOT, 'js', 'views', 'start.js'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(start, /for its own files \(and, when you choose "Load the example" or open a bundled example, for that example from its templates folder\)/);
  assert.match(start, /The one thing fetched from anywhere else is the Mermaid diagram library, from a public CDN/);
  assert.match(readme, /the text of\s+that link becomes the pattern's title, and a link inside a code span on the same line is changed too/);
  assert.match(readme, /uses a nonce or a hash for its own scripts makes browsers ignore\s+`'unsafe-inline'`/);
  assert.match(readme, /A drawing is removed\s+only when its frame genuinely stops answering/);
});

test('the README states how long a navigated frame can stay on screen and the shared-process caveat (R5-1)', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /once per heartbeat/);
  assert.match(readme, /removed within about 3\.5 seconds of its last heartbeat/);
  assert.match(readme, /plus up to two more of the hostile page's busy periods/);
  assert.match(readme, /11 seconds for busy periods of 4 seconds, 14 seconds for ones of 3\.4\s+seconds, and 20 to 23 seconds for ones of 10 seconds/);
  assert.match(readme, /does not respond at all while it is kept busy/);
  assert.doesNotMatch(readme, /worst I measured was about 11 seconds|and no more/);
  assert.match(readme, /runs in this page's process/);
  // the source comment gives the same bound, and no longer says "and no more"
  const source = fs.readFileSync(path.join(ROOT, 'js', 'mermaid.js'), 'utf8');
  assert.match(source, /up to two more of its busy periods/);
  assert.match(source, /20 to 23 s for 10 s ones/);
  assert.doesNotMatch(source, /and no more/);
});

test('the README lists the wider refusal of control characters and the key differences (R5-4, R5-6)', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /refused here inside a quoted value too, where js-yaml accepts\s+them/);
  // a plain key that starts with ":" is read, as js-yaml reads it, so it is no longer listed as a difference
  assert.doesNotMatch(readme, /A plain key that starts with `:`/);
  assert.match(readme, /`\[x, : \?:\]` is reported here as unsupported, and js-yaml says it is invalid/);
  assert.doesNotMatch(readme, /comes right after an empty\s+`-` entry/); // read as js-yaml reads it now, so not a difference
  const flat = readme.replace(/\s+/g, ' ');
  assert.match(flat, /a string value over 4,000 characters, written in block form, is written as a double-quoted value over several lines/);
  assert.match(flat, /keeps the whole front matter as text, as unsupported YAML does/);
  assert.match(flat, /Keys, and values written in flow form \(the deep ones above\), are not wrapped/);
  assert.match(flat, /kept as text, byte for byte \(trailing blank lines included; line endings become LF as the whole file's do\)/);
  assert.match(flat, /Where the file as opened and the file as it would be saved give different findings, the review and the checks panel say so/);
  assert.match(readme, /compared 1,380 variants and found no difference other than the documented ones/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdown, parseInline } from '../js/markdown.js';
import { splitDocument } from '../js/lint.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const types = (blocks) => blocks.map((b) => b.t);

test('headings, paragraphs, rules and comments', () => {
  const b = parseMarkdown('# Title\n\nSome *text*\nover two lines.\n\n---\n\n<!-- a\ncomment -->\n\n## Next ##\n');
  assert.deepEqual(types(b), ['h', 'p', 'hr', 'h']);
  assert.equal(b[3].children[0].text, 'Next');
  assert.equal(b[1].children.map((c) => c.t).join(), 'text,em,text');
});

test('fenced code keeps its text and language, including Mermaid and a fence inside a longer one', () => {
  const b = parseMarkdown('```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n\n````md\n```inner\nx\n```\n````\n');
  assert.equal(b[0].lang, 'mermaid');
  assert.match(b[0].text, /A->>B: hi/);
  assert.equal(b[1].lang, 'md');
  assert.match(b[1].text, /```inner/);
});

test('numbered and bulleted lists, nested, with a fence inside an item', () => {
  const b = parseMarkdown('1. one\n2. two\n   - nested\n   - more\n3. three\n\n- a\n\n  ```http\n  GET /\n  ```\n- b\n');
  assert.equal(b[0].t, 'list');
  assert.equal(b[0].ordered, true);
  assert.equal(b[0].items.length, 3);
  assert.equal(b[0].items[1].children[1].t, 'list');
  assert.equal(b[1].ordered, false);
  assert.equal(b[1].items[0].children[1].t, 'code');
  assert.equal(b[1].items.length, 2);
});

test('tables', () => {
  const b = parseMarkdown('| Party | System |\n|---|---|\n| Provider | `API` |\n| Consumer | **Widget** |\n');
  assert.equal(b[0].t, 'table');
  assert.equal(b[0].head.length, 2);
  assert.equal(b[0].rows.length, 2);
  assert.equal(b[0].rows[0][1][0].t, 'code');
});

test('inline: code, bold, italic, links, and text with underscores in words', () => {
  assert.deepEqual(parseInline('a `x*y` b').map((n) => n.t), ['text', 'code', 'text']);
  assert.deepEqual(parseInline('**bold** and _it_ and snake_case_name').map((n) => n.t), ['strong', 'text', 'em', 'text']);
  const link = parseInline('[Pattern](https://www.itarchitecturepatterns.net/patterns/int-api-external)')[0];
  assert.equal(link.t, 'link');
  assert.equal(link.href, 'https://www.itarchitecturepatterns.net/patterns/int-api-external');
});

test('every worked example reads into blocks with nothing left over as raw text', () => {
  for (const f of fs.readdirSync(path.join(HERE, '..', 'templates')).filter((n) => n.endsWith('.md'))) {
    const doc = splitDocument(fs.readFileSync(path.join(HERE, '..', 'templates', f), 'utf8'));
    const blocks = parseMarkdown(doc.body);
    assert.equal(blocks.filter((b) => b.t === 'h' && b.level === 2).length >= 14, true, f);
    assert.ok(blocks.some((b) => b.t === 'code' && b.lang === 'mermaid'), f);
    assert.ok(blocks.some((b) => b.t === 'table'), f);
  }
});

test('a link that leaves the page opens in a new tab, protocol-relative links included (NN1)', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.js');
  const { renderBlocks } = await import('../js/markdown.js');
  const dom = installFakeDom();
  try {
    const BS = String.fromCharCode(92);
    const render = (href) => {
      const frag = renderBlocks(document, parseMarkdown(`[x](${href})`));
      return frag.childNodes[0].childNodes[0];
    };
    for (const href of ['https://a.example/x', 'http://a.example/x', '//evil.example/x', `/${BS}evil.example/x`, `${BS}${BS}evil.example/x`, '//EVIL.example']) {
      const a = render(href);
      assert.equal(a.tagName, 'a', href);
      assert.equal(a.target, '_blank', href);
      assert.equal(a.rel, 'noopener noreferrer', href);
    }
    for (const href of ['#/section/purpose', '/tools/x', './x.md', '../y', 'mailto:a@b.c', 'page.md']) {
      const a = render(href);
      assert.equal(a.tagName, 'a', href);
      assert.equal(a.target, undefined, href);
    }
    // a scheme that is not allowed is shown as text
    assert.equal(render('javascript:alert(1)').tagName, undefined);
  } finally { dom.uninstall(); }
});

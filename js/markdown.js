// A small, safe Markdown reader for the live preview.
//
// It understands what an ICR uses: headings, paragraphs, bullet and numbered lists (nested), tables,
// fenced code (including ```mermaid), block quotes, rules, inline code, bold, italic and links.
// HTML comments are dropped, as a Markdown viewer drops them. Nothing is ever inserted as HTML:
// `parseMarkdown` returns a plain tree and `renderMarkdown` builds DOM nodes from it with
// textContent, so text in the record cannot become markup or script.

import { atxHeading, stripClosingHashes } from './text.js';

/** An ATX heading line: { level, text } or null. Read by hand, not by a pattern that backtracks over a long line of blanks. */
const parseHeading = (line) => {
  const h = atxHeading(line, { indent: 3, maxLevel: 6 });
  return h && { level: h.level, text: stripClosingHashes(h.text, /[ \t]/) };
};

const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)$/;

const RULE = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
const ITEM = /^( *)([-*+]|\d+[.)])[ \t]+(.*)$/;
/** A table's separator row ("| --- | :-: |"): cells of dashes, each with an optional colon at either end. Checked cell by cell, since one pattern for the whole row is quadratic on a long run of blanks. */
const isTableSeparator = (line) => {
  let t = line.trim();
  if (t[0] === '|') t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').every((c) => /^:?-+:?$/.test(c.trim()));
};

const indentOf = (s) => s.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;

/** Splits a table row into cells, ignoring an edge pipe. */
function cells(line) {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

// ---------- inline ----------

/** Inline text to nodes: { t:'text'|'code'|'strong'|'em'|'link', ... }. */
export function parseInline(src) {
  // Inline patterns are searched for repeatedly; a very long line is shown as plain text so that a hostile one cannot make this quadratic.
  if (src.length > 3000) return [{ t: 'text', text: src }];
  const out = [];
  let rest = src;
  const push = (node) => { if (node.t === 'text' && !node.text) return; out.push(node); };
  while (rest) {
    const m = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (!m) { push({ t: 'text', text: rest }); break; }
    push({ t: 'text', text: rest.slice(0, m.index) });
    if (m[1]) push({ t: 'code', text: m[2].trim() });
    else if (m[3] !== undefined || m[4] !== undefined) push({ t: 'strong', children: parseInline(m[3] ?? m[4]) });
    else if (m[5] !== undefined || m[6] !== undefined) push({ t: 'em', children: parseInline(m[5] ?? m[6]) });
    else push({ t: 'link', href: m[8], children: parseInline(m[7]) });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

// ---------- blocks ----------

/** Parses markdown (without front matter) into blocks. */
export function parseMarkdown(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return parseBlocks(lines);
}

const MAX_NESTING = 12; // deeper block quotes and lists are shown as text: real records are two or three deep

function parseBlocks(lines, depth = 0) {
  const blocks = [];
  let i = 0;
  const paragraph = [];
  const flush = () => { if (paragraph.length) { blocks.push({ t: 'p', children: parseInline(paragraph.join(' ').trim()) }); paragraph.length = 0; } };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flush(); i++; continue; }

    const fence = FENCE_OPEN.exec(line);
    if (fence && indentOf(line) < 4 && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      flush();
      const body = [];
      let k = i + 1;
      for (; k < lines.length; k++) {
        const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(lines[k]);
        if (close && close[1][0] === fence[2][0] && close[1].length >= fence[2].length) break;
        body.push(lines[k].slice(Math.min(fence[1].length, lines[k].match(/^ */)[0].length)));
      }
      blocks.push({ t: 'code', lang: fence[3].trim().split(/\s+/)[0] || '', text: body.join('\n') });
      i = k + 1;
      continue;
    }
    if (/^ {0,3}<!--/.test(line)) {
      flush();
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;
      continue;
    }
    const h = parseHeading(line);
    if (h) { flush(); blocks.push({ t: 'h', level: h.level, children: parseInline(h.text) }); i++; continue; }
    if (RULE.test(line) && !paragraph.length) { blocks.push({ t: 'hr' }); i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const head = cells(line);
      const rows = [];
      let k = i + 2;
      while (k < lines.length && lines[k].trim() && lines[k].includes('|')) { rows.push(cells(lines[k])); k++; }
      blocks.push({ t: 'table', head: head.map(parseInline), rows: rows.map((r) => r.map(parseInline)) });
      i = k;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) { quote.push(lines[i].replace(/^ {0,3}> ?/, '')); i++; }
      blocks.push(depth >= MAX_NESTING ? { t: 'p', children: [{ t: 'text', text: quote.join(' ') }] } : { t: 'quote', children: parseBlocks(quote, depth + 1) });
      continue;
    }
    if (ITEM.test(line)) {
      flush();
      const taken = takeList(lines, i, depth);
      blocks.push(taken.block);
      i = taken.next;
      continue;
    }
    paragraph.push(line.trim());
    i++;
  }
  flush();
  return blocks;
}

/** Reads a list starting at lines[start]; items may hold nested lists and fenced code. */
function takeList(lines, start, depth) {
  const first = ITEM.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const baseIndent = first[1].length;
  const list = { t: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;
    const item = { text: [m[3]], rest: [] };
    i++;
    // everything indented deeper than the marker, and blank lines between such lines, belongs to the item
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        let n = i + 1;
        while (n < lines.length && !lines[n].trim()) n++;
        const nxt = n < lines.length ? lines[n] : undefined;
        if (nxt !== undefined && indentOf(nxt) > baseIndent) { item.rest.push(l); i++; continue; }
        break;
      }
      if (indentOf(l) > baseIndent) { item.rest.push(l); i++; continue; }
      if (item.rest.length === 0 && !ITEM.test(l) && !parseHeading(l) && !FENCE_OPEN.test(l) && !/^ {0,3}<!--/.test(l)) { item.text.push(l.trim()); i++; continue; } // lazy continuation
      break;
    }
    const inner = item.rest.map((l) => l.slice(Math.min(baseIndent + 2, l.match(/^ */)[0].length)));
    list.items.push({ children: [{ t: 'p', children: parseInline(item.text.join(' ').trim()) }, ...(depth >= MAX_NESTING ? [] : parseBlocks(inner, depth + 1))] });
  }
  return { block: list, next: i };
}

// ---------- rendering ----------

const SAFE_URL = /^(https?:|mailto:|#|\/|\.{0,2}\/|[^:]*$)/i;

/** A link that leaves this page: an http(s) URL, or a protocol-relative one ("//host/x"; browsers read "/" + backslash the same way), so it opens in a new tab and not over the page. */
const isExternal = (href) => /^(?:https?:|[\\/]{2})/i.test(href);

function inlineNodes(doc, nodes) {
  return nodes.map((n) => {
    switch (n.t) {
      case 'code': { const c = doc.createElement('code'); c.textContent = n.text; return c; }
      case 'strong': { const e = doc.createElement('strong'); e.append(...inlineNodes(doc, n.children)); return e; }
      case 'em': { const e = doc.createElement('em'); e.append(...inlineNodes(doc, n.children)); return e; }
      case 'link': {
        if (!SAFE_URL.test(n.href)) return doc.createTextNode(n.children.map((c) => c.text ?? '').join('') || n.href);
        const a = doc.createElement('a');
        a.href = n.href;
        if (isExternal(n.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        a.append(...inlineNodes(doc, n.children));
        return a;
      }
      default: return doc.createTextNode(n.text);
    }
  });
}

/**
 * Builds DOM for blocks. `onCode(block, element)` may return a replacement element for a code block
 * (the preview uses it to offer diagram rendering for mermaid blocks).
 */
export function renderBlocks(doc, blocks, { onCode } = {}) {
  const frag = doc.createDocumentFragment();
  for (const b of blocks) {
    let el;
    switch (b.t) {
      case 'h': el = doc.createElement(`h${Math.min(b.level + 1, 6)}`); el.append(...inlineNodes(doc, b.children)); break; // the page's own h1 is the tool title, so levels shift down one
      case 'p': el = doc.createElement('p'); el.append(...inlineNodes(doc, b.children)); break;
      case 'hr': el = doc.createElement('hr'); break;
      case 'quote': el = doc.createElement('blockquote'); el.append(renderBlocks(doc, b.children, { onCode })); break;
      case 'code': {
        const pre = doc.createElement('pre');
        const code = doc.createElement('code');
        if (b.lang) code.className = `language-${b.lang.replace(/[^\w-]/g, '')}`;
        code.textContent = b.text;
        pre.append(code);
        pre.tabIndex = 0; // keyboard users can scroll a long code block
        el = (onCode && onCode(b, pre)) || pre;
        break;
      }
      case 'list': {
        el = doc.createElement(b.ordered ? 'ol' : 'ul');
        if (b.ordered && b.start !== 1) el.start = b.start;
        for (const item of b.items) {
          const li = doc.createElement('li');
          item.children.forEach((c, idx) => {
            const sub = renderBlocks(doc, [c], { onCode });
            if (idx === 0 && c.t === 'p') li.append(...sub.firstChild.childNodes); // a tight first line sits directly in the item
            else li.append(sub);
          });
          el.append(li);
        }
        break;
      }
      case 'table': {
        el = doc.createElement('table');
        const thead = doc.createElement('thead');
        const hr = doc.createElement('tr');
        for (const c of b.head) { const th = doc.createElement('th'); th.scope = 'col'; th.append(...inlineNodes(doc, c)); hr.append(th); }
        thead.append(hr);
        const tbody = doc.createElement('tbody');
        for (const row of b.rows) {
          const tr = doc.createElement('tr');
          for (const c of row) { const td = doc.createElement('td'); td.append(...inlineNodes(doc, c)); tr.append(td); }
          tbody.append(tr);
        }
        el.append(thead, tbody);
        break;
      }
      default: continue;
    }
    frag.append(el);
  }
  return frag;
}

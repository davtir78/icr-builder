// The ICR conformance rules (specification v0.2, section 4), ported from the specification's
// tools/lint-icr.cjs so they run in the browser with no dependencies:
//
//   1. front matter validates against schema/icr.schema.json;
//   2. every required section is present, in order, with its exact heading, and non-empty;
//   3. acceptance criteria are numbered;
//   4. status is "agreed" or "active" only if Open issues is absent or empty;
//   5. Interaction flows holds a Mermaid sequenceDiagram with an accTitle and an accDescr;
//   6. Examples holds a fenced example.
//
// `lint(text)` returns the same messages as the command-line linter. `analyze(text)` returns the
// same findings with the rule each belongs to, the section it is about, and the parsed document,
// which the checklist and the importer use.
//
// Differences from the command-line linter, all in how the front matter is read:
//   - YAML is read by ./yaml.js (the subset front matter uses) instead of js-yaml;
//   - the schema is checked by a small validator below that supports the keywords this schema
//     uses and words its messages the way Ajv does ("must be equal to constant", ...);
//   - the "date" and "uri" formats are checked, as ajv-formats does.

import { parseYaml } from './yaml.js';
import { ICR_SCHEMA } from './schema.js';
import { isDate, isUri } from './formats.js';
import { stripClosingHashes } from './text.js';
import { overlongLine, overlongMessage } from './limits.js';

// In document order. Optional sections may be left out but, when present, must be in place.
export const SECTIONS = [
  ['Purpose', true], ['Parties and responsibilities', true], ['Interaction', true], ['Interaction flows', true],
  ['Interface specification', true], ['Examples', true], ['Environments and onboarding', false], ['Data', true],
  ['Security', true], ['Service levels', true], ['Error handling', true], ['Change and versioning', true],
  ['Observability', true], ['Support and escalation', true], ['Acceptance criteria', true],
  ['Related records', false], ['Open issues', false],
];
export const SECTION_TITLES = SECTIONS.map(([title]) => title);
export const REQUIRED = SECTIONS.filter(([, required]) => required).map(([title]) => title);

export const RULES = [
  { id: 'frontmatter', label: 'Front matter validates against the schema' },
  { id: 'sections', label: 'Every required section is present, in order, and not empty' },
  { id: 'criteria', label: 'Acceptance criteria are numbered' },
  { id: 'status', label: 'Agreed or active only with no open issues' },
  { id: 'flows', label: 'Interaction flows has a sequence diagram with accTitle and accDescr' },
  { id: 'examples', label: 'Examples has a fenced example' },
];

// ---------- schema validation (the part of Ajv this schema needs) ----------

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' : typeOf(v) === t);

const FORMATS = { date: isDate, uri: isUri };

/** Validates `data` against the ICR schema. Returns Ajv-style errors: { instancePath, message, keyword, params }. */
export function validateFront(data, schema = ICR_SCHEMA) {
  const errors = [];
  const resolve = (ref) => ref.replace(/^#\//, '').split('/').reduce((n, k) => n[k], schema);

  function check(s, v, path) {
    if (s.$ref) s = { ...resolve(s.$ref), ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== '$ref')) };
    const err = (keyword, message, params = {}) => errors.push({ instancePath: path, message, keyword, params });
    const t = s.type === undefined ? null : Array.isArray(s.type) ? s.type : [s.type];
    if (t && !t.some((x) => isType(v, x))) err('type', `must be ${t.join(',')}`, { type: s.type });
    if (typeof v === 'string') {
      if (s.minLength !== undefined && [...v].length < s.minLength) err('minLength', `must NOT have fewer than ${s.minLength} characters`);
      if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(v)) err('pattern', `must match pattern "${s.pattern}"`);
      if (s.format && FORMATS[s.format] && !FORMATS[s.format](v)) err('format', `must match format "${s.format}"`);
    }
    if (Array.isArray(v) && s.minItems !== undefined && v.length < s.minItems) err('minItems', `must NOT have fewer than ${s.minItems} items`);
    if (s.const !== undefined && v !== s.const) err('const', 'must be equal to constant');
    if (s.enum && !s.enum.includes(v)) err('enum', 'must be equal to one of the allowed values');
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of s.required || []) if (!Object.prototype.hasOwnProperty.call(v, k)) err('required', `must have required property '${k}'`, { missingProperty: k });
      if (s.additionalProperties === false) {
        for (const k of Object.keys(v)) {
          if (!(s.properties && Object.hasOwn(s.properties, k))) {
            errors.push({ instancePath: path, message: 'must NOT have additional properties', keyword: 'additionalProperties', params: { additionalProperty: k } });
          }
        }
      }
      for (const [k, sub] of Object.entries(s.properties || {})) if (Object.hasOwn(v, k)) check(sub, v[k], `${path}/${k}`);
    }
    if (Array.isArray(v) && s.items) v.forEach((item, i) => check(s.items, item, `${path}/${i}`));
  }
  check(schema, data, '');
  return errors;
}

// ---------- Markdown structure (fences, comments, sections) ----------

/**
 * Fenced code blocks, found the way CommonMark finds them: opened by three or more backticks or
 * tildes (any indentation, so a fence inside a list item counts), closed by a line of the same
 * character at least as long, and running to the end of the text when never closed. A backtick
 * fence's info string may not contain a backtick.
 */
export function fences(text) {
  const blocks = [];
  const lines = text.split('\n');
  let offset = 0;
  let context = 'none'; // what the last non-blank line belongs to: a list item, an indented code block, or neither
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)$/);
    // Indented four or more spaces, a line is code, not a fence, unless it continues a list item.
    const deep = open && open[1].replace(/\t/g, '    ').length > 3;
    if (open && !(deep && context !== 'list') && !(open[2][0] === '`' && open[3].includes('`'))) {
      const char = open[2][0];
      const bodyStart = offset + lines[i].length + 1;
      let at = bodyStart;
      let closed = -1;
      for (let k = i + 1; k < lines.length; k++) {
        const close = lines[k].match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
        if (close && close[1][0] === char && close[1].length >= open[2].length) { closed = k; break; }
        at += lines[k].length + 1;
      }
      if (closed < 0) {
        blocks.push({ start: offset, end: text.length, info: open[3].trim(), body: text.slice(Math.min(bodyStart, text.length)) });
        break;
      }
      const end = at + lines[closed].length;
      blocks.push({ start: offset, end, info: open[3].trim(), body: text.slice(bodyStart, at) });
      offset = end + 1;
      i = closed;
      if (!open[1]) context = 'none'; // a fence at the left margin ends a list item; an indented one stays inside it
      continue;
    }
    if (lines[i].trim()) {
      const indent = lines[i].match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
      if (/^ {0,3}([-*+]|\d+[.)])[ \t]/.test(lines[i])) context = 'list';
      else if (indent === 0) context = 'none';
      else if (indent < 4) { if (context === 'code') context = 'none'; } // a wrapped line of a list item keeps the list
      else if (context === 'none') context = 'code';
    }
    offset += lines[i].length + 1;
  }
  return blocks;
}

/**
 * Blanks HTML comment blocks (a comment that starts a line, up to its closing "-->"), reading the text once,
 * line by line, so whichever of a fence and a comment opens first wins: a fence line inside a comment is
 * not a fence, and a "<!--" inside a fence is not a comment. A comment never closed hides the rest of the
 * document on GitHub, and is reported.
 */
export function stripBlockComments(text) {
  const lines = text.split('\n');
  const out = [];
  let fence = null;
  let inComment = false;
  for (const line of lines) {
    if (inComment) {
      out.push(line.replace(/[^\n]/g, ' '));
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (fence) {
      out.push(line);
      const close = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      continue;
    }
    const open = line.match(/^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)$/);
    if (open && open[1].replace(/\t/g, '    ').length <= 3 && !(open[2][0] === '`' && open[3].includes('`'))) {
      fence = { char: open[2][0], len: open[2].length };
      out.push(line);
      continue;
    }
    if (/^ {0,3}<!--/.test(line)) {
      out.push(line.replace(/[^\n]/g, ' '));
      inComment = !line.slice(line.indexOf('<!--') + 2).includes('-->');
      continue;
    }
    out.push(line);
  }
  return { text: out.join('\n'), unclosed: inComment };
}

/** The text with the given [start, end) ranges blanked to spaces. Offsets, and newlines, are kept. */
export function blank(text, ranges) {
  // One pass, however many ranges: the text is rebuilt once, not rewritten for each range (a file with tens of
  // thousands of fences or comments must not take quadratic time).
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const parts = [];
  let cursor = 0;
  for (const [a, b] of sorted) {
    const from = Math.max(a, cursor);
    if (b <= from) continue;
    parts.push(text.slice(cursor, from), text.slice(from, b).replace(/[^\n]/g, ' '));
    cursor = b;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}

/** The text with Mermaid %%{ ... }%% directives removed, found with indexOf so an unclosed one cannot make the search quadratic. */
function withoutDirectives(source) {
  let out = '';
  let at = 0;
  for (;;) {
    const open = source.indexOf('%%{', at);
    if (open < 0) break;
    const close = source.indexOf('}%%', open + 3);
    if (close < 0) break;
    out += source.slice(at, open);
    at = close + 3;
  }
  return out + source.slice(at);
}

/** The first line of a Mermaid diagram that is not blank, a %% directive, or the leading front matter. */
export function firstDiagramLine(source) {
  const body = withoutDirectives(source.replace(/^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, ''));
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('%%')) return t;
  }
  return '';
}

/**
 * Does a diagram have an accDescr: one line ("accDescr: text") or a block ("accDescr { text }")? The block form is
 * found with indexOf, so thousands of unclosed "accDescr {" lines cannot each rescan the rest of the diagram.
 */
export function hasAccDescr(diagram) {
  if (/^[ \t]*accDescr[ \t]*:[ \t]*\S/m.test(diagram)) return true;
  let noClose = false;
  for (const m of diagram.matchAll(/^[ \t]*accDescr[ \t]*\{/gm)) {
    if (noClose) break;
    const from = m.index + m[0].length;
    const close = diagram.indexOf('}', from);
    if (close < 0) { noClose = true; continue; }
    if (diagram.slice(from, close).trim()) return true;
  }
  return false;
}

/** Normalises what a file legitimately varies in: a byte-order mark and CRLF line endings. */
export const normalise = (text) => text.replace(/^﻿/, '').replace(/\r\n/g, '\n');

/** Splits a document into its front matter text and body, or returns null when it has no front matter. */
export function splitDocument(text) {
  const m = normalise(text).match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n([\s\S]*)$/);
  return m ? { yaml: m[1], body: m[2] } : null;
}

/**
 * The body's structure: the text before the first section, and each level-2 section with its
 * content as the linter sees it (comments blanked) and as written (`raw`).
 */
export function scanBody(bodyText) {
  const stripped = stripBlockComments(bodyText);
  const maskedRaw = blank(stripped.text, fences(stripped.text).map((b) => [b.start, b.end])).replace(/`+[^`\n]*`+/g, (c) => ' '.repeat(c.length));
  const comments = [...maskedRaw.matchAll(/<!--[\s\S]*?-->/g)].map((c) => [c.index, c.index + c[0].length]);
  const body = blank(stripped.text, comments);
  // A `## ` line inside a code fence is example content — an embedded OpenAPI or Markdown snippet — not a section.
  const masked = blank(body, fences(body).map((b) => [b.start, b.end]));
  const headings = [...masked.matchAll(/^ {0,3}##[ \t]+(.+)$/gm)];
  const sections = headings.map((h, i, all) => {
    const from = h.index + h[0].length;
    const to = i + 1 < all.length ? all[i + 1].index : undefined;
    return {
      title: stripClosingHashes(h[1]).trim(),
      // Leading blank lines go, but not the indentation of the first line: it decides between a fence and code.
      content: body.slice(from, to).replace(/^(?:[ \t]*\n)+/, '').trimEnd(),
      raw: bodyText.slice(from, to).replace(/^(?:[ \t]*\n)+/, '').trimEnd(),
    };
  });
  return {
    unclosedComment: stripped.unclosed,
    preamble: bodyText.slice(0, headings.length ? headings[0].index : undefined),
    sections,
  };
}

// ---------- the rules ----------

/** The numbered-criteria check: returns null when fine, or the message. */
function criteriaProblem(content) {
  const lines = blank(content, fences(content).map((b) => [b.start, b.end])).split('\n');
  if (!lines.some((x) => /^[ \t]*1[.)][ \t]+\S/.test(x))) return 'acceptance criteria are not numbered';
  // A run is a list and what follows it without a paragraph or a thematic break between. Numbered and bulleted
  // items in one run are criteria that are not all numbered (a bulleted list of notes after a paragraph is a separate run).
  const thematic = (x) => /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(x);
  const item = (x) => /^ {0,3}([-*+]|\d+[.)])[ \t]+\S/.test(x) && !thematic(x);
  let numberedItems = false;
  let bulletedItems = false;
  let afterBlank = false;
  let mixed = false;
  const endRun = () => { mixed = mixed || (numberedItems && bulletedItems); numberedItems = false; bulletedItems = false; };
  for (const x of lines) {
    if (!x.trim()) { afterBlank = true; continue; }
    if (thematic(x)) endRun();
    else if (item(x)) { if (/^ {0,3}\d/.test(x)) numberedItems = true; else bulletedItems = true; }
    else if (!/^[ \t]/.test(x) && afterBlank) endRun(); // a paragraph at the left margin ends the run
    afterBlank = false;
  }
  endRun();
  return mixed ? 'acceptance criteria are not all numbered: numbered and bulleted items are in one list' : null;
}

/**
 * Checks an ICR. Returns
 *   problems  [{ rule, message, section?, field? }]  the findings, in the linter's order
 *   front     the parsed front matter (undefined when it could not be read)
 *   sections  [{ title, content, raw }]
 *   preamble  the text before the first section
 *   yamlError the YAML error message, when the front matter could not be read
 *   hasFrontMatter
 */
export function analyze(text) {
  const problems = [];
  const add = (rule, message, extra = {}) => problems.push({ rule, message, ...extra });
  // Before any pattern runs: one very long line is the way to make a reader slow, and no real record has one.
  const tooLong = overlongLine(text);
  if (tooLong) {
    add('sections', overlongMessage(tooLong));
    return { problems, front: undefined, sections: [], preamble: '', hasFrontMatter: false, tooLong };
  }
  const doc = splitDocument(text);
  if (!doc) {
    add('frontmatter', 'no YAML front matter');
    return { problems, front: undefined, sections: [], preamble: '', hasFrontMatter: false };
  }
  // Malformed YAML is this file's problem to report, not a reason to stop linting the others —
  // and its sections are still worth checking.
  let front;
  let yamlError = null;
  let unsupported = null;
  try {
    front = parseYaml(doc.yaml);
  } catch (e) {
    yamlError = e.reason || e.message;
    // Valid YAML that this reader does not read (an anchor, a tag) is not reported as a fault in the file: the
    // linter would read it. The front matter simply cannot be checked here, and the checklist says so.
    if (e.unsupported) unsupported = yamlError;
    else add('frontmatter', `front matter is not valid YAML: ${yamlError}`);
  }
  if (!yamlError) {
    // An empty block parses to undefined, which must not be allowed to skip the schema.
    if (front === undefined || front === null) add('frontmatter', 'front matter is empty');
    else {
      for (const e of validateFront(front)) {
        const field = e.instancePath.split('/')[1] || (e.keyword === 'required' ? e.params.missingProperty : '');
        add('frontmatter', `front matter ${e.instancePath || '/'} ${e.message}`, { field, path: e.instancePath, keyword: e.keyword, params: e.params });
      }
    }
  }

  const scan = scanBody(doc.body);
  if (scan.unclosedComment) add('sections', 'an HTML comment is opened and never closed, so GitHub hides the rest of the document');
  const sections = scan.sections;

  const order = SECTION_TITLES;
  const seen = sections.map((s) => s.title);
  // A file with thousands of stray headings reports the first few and counts the rest, so neither this loop nor the page that lists them stalls.
  const MAX_LISTED = 20;
  let strays = 0;
  for (const t of seen) if (!order.includes(t) && ++strays <= MAX_LISTED) add('sections', `unknown section "${t}"`, { section: t });
  if (strays > MAX_LISTED) add('sections', `and ${strays - MAX_LISTED} more unknown sections`);
  const positions = seen.filter((t) => order.includes(t)).map((t) => order.indexOf(t));
  if (positions.some((p, i) => i && p < positions[i - 1])) add('sections', 'sections are out of order');
  const counted = new Set();
  let repeats = 0;
  for (const t of seen) {
    if (counted.has(t)) { if (++repeats <= MAX_LISTED) add('sections', `duplicate section "${t}"`, { section: t }); } else counted.add(t);
  }
  if (repeats > MAX_LISTED) add('sections', `and ${repeats - MAX_LISTED} more duplicate sections`);
  for (const t of REQUIRED) {
    const s = sections.find((x) => x.title === t);
    if (!s) add('sections', `missing required section "${t}"`, { section: t });
    else if (!s.content) add('sections', `required section "${t}" is empty`, { section: t });
  }

  const ac = sections.find((s) => s.title === 'Acceptance criteria');
  if (ac && ac.content) {
    const msg = criteriaProblem(ac.content);
    if (msg) add('criteria', msg, { section: 'Acceptance criteria' });
  }

  const flows = sections.find((s) => s.title === 'Interaction flows');
  if (flows && flows.content) {
    // Only top-level blocks count: a diagram shown inside a longer fence is an example, not a diagram.
    const diagrams = fences(flows.content).filter((b) => b.info.split(/\s+/)[0] === 'mermaid').map((b) => b.body);
    const sequences = diagrams.filter((d) => /^sequenceDiagram\b/.test(firstDiagramLine(d)));
    if (!sequences.length) add('flows', 'Interaction flows has no Mermaid sequenceDiagram', { section: 'Interaction flows' });
    for (const d of sequences) {
      if (!/^[ \t]*accTitle[ \t]*:[ \t]*\S/m.test(d)) add('flows', 'a sequence diagram has no accTitle', { section: 'Interaction flows' });
      if (!hasAccDescr(d)) add('flows', 'a sequence diagram has no accDescr', { section: 'Interaction flows' });
    }
  }

  const examples = sections.find((s) => s.title === 'Examples');
  if (examples && examples.content && !fences(examples.content).length) add('examples', 'Examples has no fenced example', { section: 'Examples' });

  const issues = sections.find((s) => s.title === 'Open issues');
  if (['agreed', 'active'].includes(front?.status) && issues && issues.content) {
    add('status', `status "${front.status}" with open issues`, { section: 'Open issues', field: 'status' });
  }
  return { problems, front, sections, preamble: scan.preamble, yamlError, unsupported, hasFrontMatter: true };
}

/** The linter's messages for a document: an empty array when it conforms. */
export function lint(text) {
  return analyze(text).problems.map((p) => p.message);
}

// A small YAML reader and writer for ICR front matter.
//
// The ICR linter reads front matter with js-yaml (4.3.2 is the version this reader was compared with) in
// JSON_SCHEMA mode. This tool has no dependencies, so it reads the part of YAML that front matter uses, and
// resolves scalars the way JSON_SCHEMA does:
//
//   null       null  Null  NULL  ~  (and an empty value)
//   boolean    true  True  TRUE  false  False  FALSE
//   number     integers (decimal, 0x, 0o, 0b) and floats (1.5, .5, 1e3, .inf, .nan), written without "_"
//   string     everything else, so a date such as 2026-09-19 stays a string, and so do 1.0.0 and 1_000
//
// Supported: block mappings and sequences (a sequence may sit at its key's indent), flow sequences
// and mappings (also across lines), plain / 'single' / "double" quoted scalars, block scalars
// (| and >, with - and + chomping), and # comments.
//
// Valid YAML that is not read here is reported as "unsupported" (a note: the front matter is kept as text and is
// not checked), never as invalid: anchors, aliases and tags, complex keys ("? key"), and a "---" document start.
// Invalid YAML is an error, worded as js-yaml words it where that is easy. Text that is not valid YAML as the
// reference reads it ("title: - x", "[a,,b]") is an error here too.

export class YamlError extends Error {
  /** `unsupported` marks valid YAML this reader does not read (anchors, tags...), as against YAML that is invalid. */
  constructor(reason, line, unsupported = false) {
    super(line ? `${reason} (line ${line})` : reason);
    this.reason = line ? `${reason} (line ${line})` : reason;
    this.line = line;
    this.unsupported = unsupported;
  }
}

// js-yaml 4.3 refuses to compose a node when a hundred are already open: the root, every collection on the way, and the scalar
// or flow collection at the end, which counts one more where js-yaml first tries it as a mapping (under a block sequence, as the
// document, and on a line of its own under a key). An empty entry in a sequence is no node. Front matter is two or three levels deep.
const MAX_NODES = 100;
const TOO_DEEP = 'the YAML is nested too deeply to read here';
const MAX_CONTINUATION_LINES = 200; // a quoted or plain scalar wrapped over more lines than this is refused, not reread for ever

// Integers and floats as js-yaml 4.3's int and float types read them (js-yaml 4.1 also accepted "_" in numbers, so
// "1_000" was a number there and is a string from 4.3 on; the writer below quotes both readings).
const DEC_INT = /^[-+]?[0-9]+$/;
const BASE_INT = /^[-+]?0(?:b[01]+|x[0-9a-fA-F]+|o[0-7]+)$/;
const FLOAT = /^(?:[-+]?[0-9]+(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const FLOAT_SPECIAL = /^(?:[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const LEGACY_NUMBER = /^[-+]?(?:0b[01_]+|0o?[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?)$/;

function parseInteger(s) {
  let sign = 1;
  let v = s;
  if (v[0] === '-' || v[0] === '+') { if (v[0] === '-') sign = -1; v = v.slice(1); }
  if (v === '0') return 0;
  if (v[0] === '0' && v[1] === 'b') return sign * parseInt(v.slice(2), 2);
  if (v[0] === '0' && v[1] === 'x') return sign * parseInt(v.slice(2), 16);
  if (v[0] === '0' && v[1] === 'o') return sign * parseInt(v.slice(2), 8);
  return sign * parseInt(v, 10);
}

/** Resolves a plain (unquoted) scalar the way js-yaml's JSON_SCHEMA does. */
export function resolvePlain(s) {
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (DEC_INT.test(s) || BASE_INT.test(s)) {
    const n = parseInteger(s);
    if (Number.isFinite(n)) return n; // a run of digits too long for a number is tried as a float, then left as text
  }
  if (FLOAT.test(s)) {
    if (FLOAT_SPECIAL.test(s)) {
      const t = s.toLowerCase();
      if (t.endsWith('.nan')) return NaN;
      return t[0] === '-' ? -Infinity : Infinity;
    }
    if (Number.isFinite(parseFloat(s))) return (s[0] === '-' ? -1 : 1) * parseFloat(s.replace(/^[-+]/, ''));
  }
  return s;
}

/**
 * The text with a trailing comment removed. A # starts a comment at the line start or after whitespace, outside quotes,
 * and also straight after a quote or bracket that closes a value ("0.2"#spec). A quote or bracket opens a value only where
 * a value can start: first on the line, after "- ", after a key's colon, or inside a flow collection after "[", "{", ","
 * or ":". In the middle of plain text (Booking "v2"#draft) it is just text, and so is the # after it.
 * `continuation` is a line that continues a plain scalar: nothing on it opens a value.
 */
function stripComment(line, continuation = false, flow = false) {
  let quote = null;
  let depth = flow ? 1 : 0; // flow brackets opened where a value can start (`flow`: the line continues a flow collection)
  let closed = -2; // where a quote or a flow collection last closed: a "#" right after it starts a comment
  let fresh = !continuation; // a value may start at the next non-blank character
  const blank = (ch) => ch === ' ' || ch === '\t';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") { if (c === "'") { if (line[i + 1] === "'") i++; else { quote = null; closed = i; fresh = false; } } continue; }
    if (quote === '"') { if (c === '\\') i++; else if (c === '"') { quote = null; closed = i; fresh = false; } continue; }
    if (blank(c)) continue;
    if (c === '-' && fresh && depth === 0 && (i + 1 >= line.length || blank(line[i + 1]))) continue; // a "- " list marker
    if (fresh && (c === '"' || c === "'")) { quote = c; fresh = false; continue; }
    if (c === '[' || c === '{') { if (fresh || depth > 0) { depth++; fresh = true; continue; } }
    if ((c === ']' || c === '}') && depth > 0) { depth--; closed = i; fresh = false; continue; }
    // inside a flow collection a plain scalar cannot start with "#", so one at a fresh position (after "[", "{", "," or ":") is a comment
    if (c === '#' && (i === 0 || blank(line[i - 1]) || closed === i - 1 || (depth > 0 && fresh))) return line.slice(0, i);
    if (depth > 0 && c === ',') { fresh = true; continue; }
    // a colon is an indicator when it follows a quoted key, or is followed by a blank or a flow indicator ("a:#c" is plain text)
    if (depth > 0 && c === ':') { const next = line[i + 1]; fresh = closed === i - 1 || next === undefined || blank(next) || next === ',' || next === ']' || next === '}' || next === '[' || next === '{'; continue; }
    if (depth === 0 && c === ':' && (i + 1 >= line.length || blank(line[i + 1]))) { fresh = !continuation; continue; } // a key's colon
    fresh = false;
  }
  return line;
}

const HEX = /^[0-9a-fA-F]+$/;
// Between the lines of a flow collection the text carries this mark, which no document can hold (U+0001 is refused before
// reading): it says where a line ended, so that the colon of a pair can be required to stay on its key's line.
const BREAK = '\u0001';
const isGap = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === BREAK;

/** True for the two characters YAML separates with. JavaScript's \s and trim() also take no-break and ideographic spaces, U+FEFF, U+2028 and more. */
const isBlank = (ch) => ch === ' ' || ch === '\t';
const trimStart = (s) => { let i = 0; while (i < s.length && isBlank(s[i])) i++; return i ? s.slice(i) : s; };
const trimEnd = (s) => { let e = s.length; while (e > 0 && isBlank(s[e - 1])) e--; return e < s.length ? s.slice(0, e) : s; };
const trim = (s) => trimEnd(trimStart(s));
const ESCAPES = { 0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ' };

/** Reads a quoted scalar from the start of `s`. Returns the value and the number of characters used. */
function readQuoted(s, line) {
  const q = s[0];
  let out = '';
  // Literal blanks are held here until something follows them on the line: a line break drops them (js-yaml trims only the
  // blanks that were written as blanks), and an escape or the closing quote keeps them. Trimming the end of `out` at every
  // break instead made a long value that goes over many lines quadratic.
  let pend = '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === BREAK) continue; // the mark between the lines of a flow collection: not text
    if (c === '\n') {
      // A line break inside a quoted value: the blanks before it go, the blanks and breaks after it are skipped, and the
      // lot is one space, or, when there were blank lines, one line break fewer than the breaks that were there.
      pend = '';
      let breaks = 1;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '\n') breaks++;
        else if (s[j] !== ' ' && s[j] !== '\t' && s[j] !== BREAK) break;
      }
      out += breaks === 1 ? ' ' : '\n'.repeat(breaks - 1);
      i = j - 1;
      continue;
    }
    if (q === "'") {
      if (c === "'") {
        if (s[i + 1] === "'") { out += pend + "'"; pend = ''; i++; continue; }
        return { value: out + pend, used: i + 1 };
      }
      if (c === ' ' || c === '\t') pend += c; else { out += pend + c; pend = ''; }
    } else {
      if (c === '"') return { value: out + pend, used: i + 1 };
      if (c === '\\') {
        out += pend;
        pend = '';
        let n = s[++i];
        while (n === BREAK) n = s[++i];
        if (n === undefined) break; // the text ends on the backslash: the value may go on over the next line
        if (n === '\n') {
          // an escaped line break joins the lines: it and every blank and break after it vanish, and blanks before it stay
          let j = i + 1;
          while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === BREAK)) j++;
          i = j - 1;
          continue;
        }
        if (n === 'x' || n === 'u' || n === 'U') {
          const len = n === 'x' ? 2 : n === 'u' ? 4 : 8;
          const hex = s.slice(i + 1, i + 1 + len);
          if (hex.length !== len || !HEX.test(hex)) throw new YamlError('expected hexadecimal character in an escape sequence', line);
          const code = parseInt(hex, 16);
          if (code > 0x10FFFF) throw new YamlError('expected valid Unicode code point in an escape sequence', line);
          out += String.fromCodePoint(code);
          i += len;
        } else if (n in ESCAPES) out += ESCAPES[n];
        else throw new YamlError('unknown escape sequence', line);
      } else if (c === ' ' || c === '\t') pend += c;
      else { out += pend + c; pend = ''; }
    }
  }
  throw new YamlError(`unexpected end of the stream within a ${q === '"' ? 'double' : 'single'} quoted scalar`, line);
}

/**
 * The text of a plain scalar that ran over lines of a flow collection (each break marked with BREAK and a line break):
 * every line trimmed, one break a space, and n blank lines n line breaks.
 */
function foldPlain(text) {
  const flat = text.split(BREAK).join('');
  if (!flat.includes('\n')) return flat;
  const lines = flat.split('\n');
  let out = trimEnd(lines[0]);
  let blanks = 0;
  for (let k = 1; k < lines.length; k++) {
    const l = trim(lines[k]);
    if (l === '') { blanks++; continue; }
    out += (blanks ? '\n'.repeat(blanks) : ' ') + l;
    blanks = 0;
  }
  return out;
}

/** A flow collection ([...] or {...}) or a scalar, read from `s` (which may span lines). */
function readFlow(s, line, base = 0) {
  let i = 0;
  const ws = () => { while (i < s.length && isGap(s[i])) i++; };
  let nest = 0;
  // js-yaml counts a scalar inside a collection as one more level of nesting, and refuses a hundredth level
  const leaf = () => { if (base + nest + 1 > MAX_NODES) throw new YamlError(TOO_DEEP, line); };
  let spanned = false; // the scalar just read ran over more than one line
  // js-yaml uses the text of a key; a collection used as a key becomes "[object Object]" (a list of scalars, its items joined)
  const keyText = (k) => {
    if (k === null || typeof k !== 'object') return String(k);
    if (!Array.isArray(k)) return '[object Object]';
    return k.map((el) => {
      if (Array.isArray(el)) throw new YamlError('nested arrays are not supported inside keys', line);
      if (el === null || el === undefined) return ''; // as Array.prototype.join writes them: a null in a key is empty text
      return typeof el === 'object' ? '[object Object]' : String(el);
    }).join(',');
  };
  // a collection that ran over more than one line cannot be a key either
  function node(inFlowKey) {
    ws();
    const startAt = i;
    const value = readNode(inFlowKey);
    if (value !== null && typeof value === 'object') spanned = s.slice(startAt, i).includes(BREAK);
    return value;
  }
  function readNode(inFlowKey) {
    spanned = false;
    ws();
    const c = s[i];
    if ((c === '[' || c === '{') && base + ++nest > MAX_NODES) throw new YamlError(TOO_DEEP, line);
    if (c === '[') {
      i++;
      const arr = [];
      for (;;) {
        ws();
        if (s[i] === ']') { i++; nest--; return arr; }
        if (i >= s.length) throw new YamlError('unexpected end of the stream within a flow collection', line);
        if (s[i] === ',') throw new YamlError("expected the node content, but found ','", line);
        // "[a: b]" is a sequence of one single-pair mapping, as in YAML; the schema then says it is not a string
        const first = node(true);
        const keyEnd = i;
        ws();
        if (s[i] === ':' && (spanned || /[\n\u0001]/.test(s.slice(keyEnd, i)))) throw new YamlError('missed comma between flow collection entries', line); // the colon of a pair stays on the key's line
        if (s[i] === ':') {
          i++; ws();
          const pair = Object.create(null);
          pair[keyText(first)] = s[i] !== ',' && s[i] !== ']' ? node(false) : null;
          arr.push(pair);
        } else arr.push(first);
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; nest--; return arr; }
        throw new YamlError("expected ',' or ']' in a flow sequence", line);
      }
    }
    if (c === '{') {
      i++;
      const obj = Object.create(null); // no inherited keys, and a key named __proto__ is just a key
      for (;;) {
        ws();
        if (s[i] === '}') { i++; nest--; return obj; }
        if (i >= s.length) throw new YamlError('unexpected end of the stream within a flow collection', line);
        if (s[i] === ',') throw new YamlError("expected the node content, but found ','", line);
        const key = node(true);
        const keyEnd = i;
        ws();
        if (s[i] === ':' && (spanned || /[\n\u0001]/.test(s.slice(keyEnd, i)))) throw new YamlError('missed comma between flow collection entries', line);
        let value = null;
        if (s[i] === ':') { i++; ws(); if (s[i] !== ',' && s[i] !== '}') value = node(false); }
        if (Object.prototype.hasOwnProperty.call(obj, keyText(key))) throw new YamlError('duplicated mapping key', line);
        obj[keyText(key)] = value;
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; nest--; return obj; }
        throw new YamlError("expected ',' or '}' in a flow mapping", line);
      }
    }
    if (c === '"' || c === "'") { const start = i; const r = readQuoted(s.slice(i), line); i += r.used; spanned = s.slice(start, i).includes(BREAK); leaf(); return r.value; }
    let j = i;
    while (j < s.length) {
      const ch = s[j];
      // a flow indicator ends a plain scalar here, and so does a colon followed by a blank or one, key or value
      if (ch === ',' || ch === ']' || ch === '}' || ch === '[' || ch === '{') break;
      if (ch === ':' && (j + 1 >= s.length || isGap(s[j + 1]) || s[j + 1] === ',' || s[j + 1] === ']' || s[j + 1] === '}' || s[j + 1] === '[' || s[j + 1] === '{')) break;
      j++;
    }
    let from = i;
    let to = j;
    while (from < to && isGap(s[from])) from++;
    while (to > from && isGap(s[to - 1])) to--;
    spanned = s.slice(from, to).includes(BREAK); // a scalar that runs over lines cannot be a key
    const raw = foldPlain(s.slice(from, to));
    i = to; // the gap after the text is left for the caller to skip (and to look at)
    if (/^[&*!]/.test(raw)) throw new YamlError(`an anchor, alias or tag (${raw.split(/[ \t]/)[0]})`, line, true);
    if (/^[?:]([ \t\n]|$)/.test(raw)) throw new YamlError('a complex (?) key or an empty key', line, true);
    // a dash alone is no value, but "-" straight before a colon is a key
    if (/^-([ \t\n]|$)/.test(raw) && !(raw === '-' && to === j && s[j] === ':')) throw new YamlError('missed comma between flow collection entries', line);
    if (/^[@`%|>]/.test(raw)) throw new YamlError('a plain scalar cannot start with this character', line);
    leaf();
    return resolvePlain(raw);
  }
  const value = node(false);
  ws();
  if (s[i] === ':' && (i + 1 >= s.length || isBlank(s[i + 1]))) throw new YamlError('a flow collection used as a key', line, true);
  if (i < s.length) throw new YamlError('unexpected content after a flow collection', line);
  return value;
}

/** Finds where a quoted value that may run over several lines closes, one piece of text at a time. */
function quoteScanner(q) {
  let escaped = false;
  let pending = false; // a single quote was just seen inside a single-quoted value: it closes it unless another follows
  let done = false;
  return {
    add(s) {
      for (let i = 0; i < s.length && !done; i++) {
        const c = s[i];
        if (escaped) { escaped = false; continue; }
        if (pending) { pending = false; if (c === "'") continue; done = true; return; }
        if (q === '"') { if (c === '\\') escaped = true; else if (c === '"') done = true; } else if (c === "'") pending = true;
      }
    },
    get closed() { return done || pending; },
  };
}

/**
 * Reads a flow collection line by line, with all its state carried from one line to the next: how deep it is, whether a
 * quoted value is open, whether a value can start at the next character, and whether the last thing read is a plain
 * scalar that a following line could continue. Each line is read once (rescanning everything gathered so far on every
 * added line made a collection of tens of thousands of short lines take minutes).
 *
 * It also finds where a comment starts, because that depends on the state: inside a quoted value a "#" is text even at
 * the start of a line, a "#" at a place where a value can start (after "[", "{", "," or ":") starts a comment, and so
 * does one after a blank or straight after a closing quote or bracket. A quote opens a quoted value only where a value can
 * start, so an apostrophe inside plain text ([it's, b]) is just text.
 */
function flowScanner() {
  let depth = 0;
  let quote = null;
  let escaped = false; // a backslash was the last character, so the next one is taken whatever it is
  let pending = false; // a single quote was just seen inside a single-quoted value: it closes it unless another follows
  let fresh = true; // a value may start at the next non-blank character
  let plain = false; // the last thing seen is a plain scalar, which a following line could continue
  let quoteClosed = false; // the last non-blank character closed a quoted value
  let tailAt = -1; // where the collection closed in the last line read with `stop`, when it did
  let tabbed = false; // the last line held a tab used as separation (see below)
  let prop = 0; // 1: inside the name of an anchor or tag, 2: just after it
  return {
    /**
     * Reads one line, and returns it without a comment at its end. With `stop`, the line is read only as far as the bracket
     * that closes the collection (`tail` says where): what follows it is the start of the next entry of the block around.
     */
    addLine(line, stop = false) {
      let cut = line.length;
      tailAt = -1;
      tabbed = false;
      let seenText = false;
      let closedAt = -2; // where a quote or a bracket last closed in this line
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (escaped) { escaped = false; continue; }
        if (pending) {
          pending = false;
          if (c === "'") continue; // a doubled quote is a quote
          quote = null;
          fresh = false;
          quoteClosed = true;
          closedAt = i - 1;
        }
        if (quote) {
          if (quote === '"') { if (c === '\\') escaped = true; else if (c === '"') { quote = null; fresh = false; quoteClosed = true; closedAt = i; } } else if (c === "'") pending = true;
          continue;
        }
        if (c === ' ' || c === '\t') {
          // js-yaml refuses a tab it meets as separation (in the margin, or between values), not one inside a plain value
          if (c === '\t' && (!seenText || !plain)) tabbed = true;
          if (prop === 1) { prop = 2; fresh = true; } // the end of an anchor or tag: a value may follow it
          continue;
        }
        seenText = true;
        if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t' || closedAt === i - 1 || fresh)) { cut = i; break; }
        // the name of an anchor or tag runs to a blank or a flow indicator; it is not a plain value that a comment ends
        if (prop === 1) { if (c === '[' || c === '{' || c === ']' || c === '}' || c === ',') prop = 0; else continue; } else prop = 0;
        const closedBefore = quoteClosed;
        quoteClosed = false;
        if (fresh && (c === '&' || c === '!')) { prop = 1; fresh = false; plain = false; continue; }
        if (fresh && (c === '"' || c === "'")) { quote = c; fresh = false; plain = false; continue; }
        if (c === '[' || c === '{') { depth++; fresh = true; plain = false; continue; }
        if (c === ']' || c === '}') {
          depth--; fresh = false; plain = false; closedAt = i;
          if (stop && depth === 0) { tailAt = i + 1; break; }
          continue;
        }
        if (c === ',') { fresh = true; plain = false; continue; }
        // "? " is the indicator of an explicit key (valid YAML this reader does not read): what follows starts a value
        if (c === '?' && fresh && (line[i + 1] === undefined || line[i + 1] === ' ' || line[i + 1] === '\t')) { fresh = true; plain = false; continue; }
        // a colon is an indicator after a quoted key or when a blank or a flow indicator follows (the end of a line is a blank)
        if (c === ':') { const next = line[i + 1]; if (closedBefore || next === undefined || next === ' ' || next === '\t' || next === ',' || next === ']' || next === '}' || next === '[' || next === '{') { fresh = true; plain = false; continue; } }
        fresh = false;
        plain = true;
      }
      // the end of a line: it closes a single quote that was pending, and consumes a backslash that was the last character
      if (pending) { pending = false; quote = null; fresh = false; quoteClosed = true; }
      escaped = false;
      if (tailAt >= 0) return line.slice(0, tailAt);
      return cut === line.length ? line : line.slice(0, cut);
    },
    get tail() { return tailAt; },
    get tabbed() { return tabbed; },
    get open() { return depth > 0 || quote !== null; },
    get plainOpen() { return plain && quote === null; },
    get inQuote() { return quote !== null; },
  };
}

/** Splits "key: value" at the first mapping colon outside quotes. Returns null when the text is not a mapping entry. */
function splitEntry(text, line) {
  let key;
  let rest;
  if (text[0] === '"' || text[0] === "'") {
    let r;
    try { r = readQuoted(text, line); } catch (e) { if (/unexpected end of the stream within/.test(e.reason)) return null; throw e; } // a quoted value that goes on over the next lines
    const after = text.slice(r.used);
    const m = after.match(/^[ \t]*:(?:[ \t]+([^]*)|$)/);
    if (!m) return null;
    key = r.value;
    rest = m[1] ?? '';
  } else {
    // A plain key runs to the first colon, and that colon must be followed by a blank or the end. Found with indexOf
    // rather than a lazy pattern, which is quadratic on a long run of blanks before the colon.
    const first = text[0];
    if (first === '?' && isBlank(text[1] ?? ' ')) return null; // "? key": a complex key, handled by the caller
    if (first === '-') { if (isBlank(text[1] ?? ' ')) return null; } else if (first === ':') { if (isBlank(text[1] ?? ' ')) return null; } else if (/[ \t#\[\]{},&*!|>'"%@`]/.test(first)) return null; // ":k" is a plain key
    let colon = text.indexOf(':', first === ':' ? 1 : 0);
    while (colon > 0 && colon + 1 < text.length && !isBlank(text[colon + 1])) colon = text.indexOf(':', colon + 1);
    if (colon <= 0) return null;
    // js-yaml resolves a plain key and then uses its text: "~" and "null" are one key, so are "true" and "True", "1" and "0x1".
    key = String(resolvePlain(trimEnd(text.slice(0, colon))));
    rest = text.slice(colon + 1);
  }
  return { key, rest: trim(rest) };
}

// The characters js-yaml refuses in a document (its own pattern): C0 controls but tab, LF and CR, DEL, C1 controls but
// U+0085, U+FFFE and U+FFFF, and a surrogate with no partner.
const NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

export function parseYaml(source) {
  if (source.charCodeAt(0) === 0xFEFF) source = source.slice(1); // a byte order mark is not part of the document
  const bad = NON_PRINTABLE.exec(source);
  if (bad) {
    const at = bad.index + (bad[0].length > 1 ? bad[0].length - 1 : 0); // the pattern may start one character before a lone low surrogate
    throw new YamlError('the stream contains non-printable characters', source.slice(0, at).split('\n').length);
  }
  const raw = source.replace(/\r\n?/g, '\n').split('\n');
  if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop(); // the end of the last line is not another, empty, line
  let pos = 0;
  let ended = -1; // the line of a "..." document end marker

  const lead = (l) => { let n = 0; while (l[n] === ' ') n++; return n; };
  // The next line at or after each line that holds anything but blanks and a comment, found once: every level of a deeply
  // nested document peeks at the same trailing lines, and walking over a hundred thousand blank lines for each was slow.
  const lineCount = raw.length;
  const nextContent = new Int32Array(lineCount + 1);
  nextContent[lineCount] = lineCount;
  for (let k = lineCount - 1; k >= 0; k--) nextContent[k] = trim(stripComment(raw[k])) ? k : nextContent[k + 1];
  // The line a "- - - x" entry is being read from, as the innermost level sees it (the text after the dashes read so far):
  // cutting the line down at every level took time in proportion to its length times its depth.
  let entryRest = null;
  // The last line's token: every level of a deep nest peeks at the line that follows it again and again.
  let lastToken = null;
  function tokenAt(i) {
    // (the line a value closed on may begin with what would be a comment: it is not one there, so look for it by its number)
    if (entryRest !== null && entryRest.i === i) return entryRest;
    const j = i >= lineCount ? lineCount : nextContent[i];
    if (j >= lineCount) return null;
    if (entryRest !== null && entryRest.i === j) return entryRest;
    if (lastToken !== null && lastToken.i === j) return lastToken;
    if (/^\.\.\.([ \t]|$)/.test(raw[j])) { ended = j; return null; } // a document end marker: only at the start of a line ("...#c" is plain text)
    // a document start marker after the first content line begins a second document, which js-yaml refuses
    if (j !== nextContent[0] && /^---([ \t]|$)/.test(raw[j])) throw new YamlError('expected a single document in the stream, but found more', j + 1);
    const text = trimEnd(stripComment(raw[j]));
    // `tab`: a tab among the blanks before the text. YAML never indents with one: js-yaml refuses a block entry that starts
    // after one (so does this reader, where the entry is read) but reads a plain, quoted or flow value there.
    lastToken = { i: j, indent: lead(text), text: trim(text), line: j + 1, tab: hasTabIndent(raw[j]) };
    return lastToken;
  }
  const peek = () => tokenAt(pos);

  const hasCommentLine = (line) => trimEnd(stripComment(line, false, true)) !== trimEnd(line);
  /** Does the line's leading run of blanks (up to its first other character) hold a tab? */
  function hasTabIndent(l) { let n = 0; while (isBlank(l[n])) { if (l[n] === '\t') return true; n++; } return false; }

  function scalarFrom(rest, line) {
    if (rest[0] === '"' || rest[0] === "'") {
      const r = readQuoted(rest, line);
      if (trim(rest.slice(r.used))) throw new YamlError('unexpected content after a quoted scalar', line);
      return r.value;
    }
    if (/^[&*!]/.test(rest)) throw new YamlError(`an anchor, alias or tag (${rest.split(/[ \t]/)[0]})`, line, true);
    if (/^[@`%,\]}]/.test(rest)) throw new YamlError('a plain scalar cannot start with this character', line);
    if (/^[-?:]([ \t\n]|$)/.test(rest)) throw new YamlError('bad indentation of a mapping entry', line); // "title: - x": a block entry cannot start here
    if (/:([ \t\n]|$)/.test(rest)) throw new YamlError('mapping values are not allowed here', line); // `rest` may span lines
    return resolvePlain(rest);
  }

  /**
   * A flow collection or a quoted value closed on a line after the one it started on, and `tailText` follows it there: js-yaml
   * reads on from that place as the next entry of the block around, at the indent of that line ("]k: v" at the margin is a
   * new key). Returns the line to read next.
   */
  function carryOn(endLine, tailText, tabbed) {
    const text = trim(stripComment(tailText));
    if (!text) return endLine + 1;
    // a tab among the blanks that lead up to the new entry is a tab in indentation, whichever side of the bracket it is on
    if (tabbed || /^[ \t]*\t/.test(tailText)) throw new YamlError('tab characters must not be used in indentation', endLine + 1);
    entryRest = { i: endLine, indent: lead(raw[endLine]), text, line: endLine + 1, src: tailText };
    return endLine;
  }

  /** The value written after "key:" or "- ", on the same line. `parentIndent` is the indent of the line it is on. */
  let usedFlow = false;
  function inlineValue(rest, token, parentIndent) {
    usedFlow = false;
    const value = readInline(rest, token, parentIndent);
    if (!usedFlow) leafCheck(token.line); // a scalar is one more node
    return value;
  }
  function readInline(rest, token, parentIndent) {
    // The text of the line this value is on, for its trailing blanks and its comment. An entry that began on the line where a
    // multi-line value closed has only what follows the closing bracket or quote: the text before it is that value's own.
    const src = token.src ?? raw[token.i];
    if (rest[0] === '[' || rest[0] === '{') {
      // the blanks at the end of the first line are text too: a backslash before them is an escaped blank, not a line break
      const tail = stripComment(src);
      const first = rest + tail.slice(trimEnd(tail).length);
      const parts = [first];
      let endLine = token.i;
      const scan = flowScanner();
      scan.addLine(first);
      let commentEnded = hasCommentLine(src) && scan.plainOpen; // a comment ended a plain scalar, so it cannot go on
      while (scan.open) {
        endLine++;
        if (endLine >= raw.length) throw new YamlError('unexpected end of the stream within a flow collection', token.line);
        const line = raw[endLine];
        // a line that starts with a document marker ends the document, whatever is open
        if (/^(---|\.\.\.)([ \t]|$)/.test(line)) throw new YamlError('unexpected end of the document within a flow collection', endLine + 1);
        const startedPlain = scan.plainOpen;
        const startedInQuote = scan.inQuote;
        const code = scan.addLine(line, true);
        const text = trim(code);
        const hadComment = code.length < line.length;
        // A plain value that goes on over the next line must be indented further than the key it belongs to, and a comment
        // ends it: otherwise the next text is a new entry with no comma before it (js-yaml: "missed comma between flow
        // collection entries"). Inside a quoted value the lines are the value's own.
        if (!startedInQuote && text !== '' && startedPlain && !',]}'.includes(text[0]) && (commentEnded || lead(line) <= parentIndent)) throw new YamlError('missed comma between flow collection entries', endLine + 1);
        if (!startedInQuote && text === '' && hadComment && startedPlain) commentEnded = true; // a line of only a comment
        else if (text !== '') commentEnded = hadComment && scan.plainOpen;
        parts.push(BREAK + '\n' + code); // the line breaks stay in the text: quoted and plain values fold them as YAML folds them
      }
      pos = endLine + 1;
      // (a line that starts inside a quoted value is not scanned for its blanks, so its margin is looked at here)
      if (scan.tail >= 0) pos = carryOn(endLine, raw[endLine].slice(scan.tail), scan.tabbed || hasTabIndent(raw[endLine])); // text after the bracket that closed on a later line
      usedFlow = true;
      return readFlow(parts.join(''), token.line, blockDepth + valueLevel());
    }
    if (/^[|>]/.test(rest)) return blockScalar(rest, token, parentIndent);
    if (rest[0] === '"' || rest[0] === "'") {
      // A quoted scalar may continue on the next lines. The lines are kept as they are, with their line breaks, and
      // readQuoted folds them (trailing blanks go, a break is a space, blank lines are line breaks, a backslash at the end
      // of a line joins). The quote state is carried from line to line and the text is read once at the end: reading it
      // again after every added line made a long unclosed value take seconds.
      const tail = stripComment(src);
      const first = rest + tail.slice(trimEnd(tail).length); // the blanks at the end of the first line are text too: a backslash before them is an escaped blank
      const scan = quoteScanner(rest[0]);
      scan.add(first.slice(1));
      const parts = [first];
      let end = token.i;
      while (!scan.closed && end + 1 < raw.length && end - token.i < MAX_CONTINUATION_LINES) {
        end++;
        if (/^(---|\.\.\.)([ \t]|$)/.test(raw[end])) throw new YamlError(`unexpected end of the document within a ${rest[0] === '"' ? 'double' : 'single'} quoted scalar`, end + 1);
        const piece = '\n' + raw[end];
        parts.push(piece);
        scan.add(piece);
      }
      const text = parts.join('');
      const r = readQuoted(text, token.line);
      if (end > token.i) pos = carryOn(end, text.slice(r.used), hasTabIndent(raw[end])); // text after the closing quote of a value that ran over lines
      else {
        if (trim(stripComment(text.slice(r.used)))) throw new YamlError('unexpected content after a quoted scalar', token.line);
        pos = end + 1;
      }
      return r.value;
    }
    pos = token.i + 1;
    // A plain scalar may continue on the lines after it, indented deeper than its key.
    let text = rest;
    let k = pos;
    let used = 0;
    // A comment ends a plain scalar: what follows on the next lines is not a continuation (and is then an error).
    const hasComment = (line, continuation = false) => trimEnd(stripComment(line, continuation)) !== trimEnd(line);
    let commentEnds = hasComment(src);
    while (!commentEnds && !/^[&*!@`%,\]}]/.test(rest) && used < MAX_CONTINUATION_LINES) {
      let j = k;
      let blanks = 0;
      while (j < raw.length && trim(raw[j]) === '') { blanks++; j++; }
      if (j >= raw.length || lead(raw[j]) <= parentIndent || /^(---|\.\.\.)([ \t]|$)/.test(raw[j])) break;
      const piece = trim(stripComment(raw[j], true));
      if (!piece || /^#/.test(trim(raw[j]))) break;
      text += (blanks ? '\n'.repeat(blanks) : ' ') + piece;
      k = j + 1;
      used++;
      commentEnds = hasComment(raw[j], true);
    }
    pos = k;
    return scalarFrom(text, token.line);
  }

  /** Folds the lines of a ">" scalar: a line break between two ordinary lines is a space, a blank line is a line break, and a more-indented line keeps its line breaks. */
  /**
   * A literal or folded block scalar, read as js-yaml reads it (its readBlockScalar, line by line): the indent is that of the
   * first line that is not only spaces, a line of only spaces is empty whatever its length, and a tab is content, so a line
   * of blanks with a tab among them is text, and ends the scalar when it is indented less than the text.
   */
  function blockScalar(header, token, parentIndent) {
    const m = header.match(/^([|>])([-+]?)([1-9]?)([-+]?)[ \t]*$/);
    if (!m) throw new YamlError('bad block scalar header', token.line);
    if (m[2] && m[4]) throw new YamlError('repeat of a chomping mode identifier', token.line);
    const folding = m[1] === '>';
    const chomp = m[2] || m[4];
    let textIndent = parentIndent + 1;
    let detected = false;
    if (m[3]) { textIndent = parentIndent + Number(m[3]); detected = true; }
    let text = '';
    let didRead = false;
    let empty = 0; // empty lines since the last text
    let atMoreIndented = false;
    let i = token.i + 1;
    for (; i < raw.length; i++) {
      const l = raw[i];
      let ind = 0;
      while ((!detected || ind < textIndent) && l[ind] === ' ') ind++;
      if (!detected && ind > textIndent) textIndent = ind;
      if (ind === l.length) { empty++; continue; }
      if (!detected && textIndent === 0) throw new YamlError('missing indentation for block scalar', i + 1);
      if (ind < textIndent) break;
      if (folding) {
        if (l[ind] === ' ' || l[ind] === '\t') { // more indented lines are not folded
          atMoreIndented = true;
          text += '\n'.repeat(didRead ? 1 + empty : empty);
        } else if (atMoreIndented) {
          atMoreIndented = false;
          text += '\n'.repeat(empty + 1);
        } else if (empty === 0) {
          if (didRead) text += ' ';
        } else text += '\n'.repeat(empty);
      } else text += '\n'.repeat(didRead ? 1 + empty : empty);
      didRead = true;
      detected = true;
      empty = 0;
      text += l.slice(ind);
    }
    if (i >= raw.length && !detected && textIndent === 0) throw new YamlError('missing indentation for block scalar', i);
    // the end of the scalar, a line indented less than its text or the end of the document: chomping
    if (chomp === '+') text += '\n'.repeat(didRead ? 1 + empty : empty);
    else if (chomp !== '-' && didRead) text += '\n';
    pos = i;
    return text;
  }

  let blockDepth = 0; // block collections open on the way to here
  let curKind = null; // the innermost of them: 'map' or 'seq' (null at the root)
  // js-yaml reads a value that is not a block collection one level deeper than the key's own when it comes in a sequence (or
  // is the document), and when it starts on a line of its own under a key: it tries it as a mapping first.
  let onNewLine = 0;
  const valueLevel = () => (curKind === 'map' ? onNewLine : 1);
  /** A scalar (or an empty value under a key) here is a node: the depth it reaches must not pass the limit. */
  /** A block collection is a node of its own: the hundredth level it opens is refused. */
  const tooDeep = () => { if (blockDepth > MAX_NODES) throw new YamlError(TOO_DEEP, peek()?.line ?? 1); };
  const leafCheck = (line) => { if (blockDepth + 1 + valueLevel() > MAX_NODES) throw new YamlError(TOO_DEEP, line); };
  // "? key" starts a complex key, which is valid YAML this reader does not read; a ": value" line with no "? key" before it is not valid
  const complexKey = (t, text = t.text) => {
    if (text[0] === ':') throw new YamlError('incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line', t.line);
    throw new YamlError('a complex (?) key', t.line, true);
  };
  const noTab = (t) => { if (t.tab) throw new YamlError('tab characters must not be used in indentation', t.line); };
  function parseNode(minIndent, parentIndent = minIndent - 1, newLine = false) {
    const t = peek();
    if (!t || t.indent < minIndent) return null;
    // a block collection cannot start after a tab in the margin: there, only a value (plain, quoted or flow) is read
    if (/^[?:]([ \t]|$)/.test(t.text)) { noTab(t); complexKey(t); }
    if (/^-([ \t]|$)/.test(t.text)) { noTab(t); return parseSeq(t.indent); }
    if (splitEntry(t.text, t.line)) { noTab(t); return parseMap(t.indent); }
    pos = t.i;
    const saved = onNewLine;
    onNewLine = newLine ? 1 : 0;
    try { return inlineValue(t.text, t, parentIndent); } finally { onNewLine = saved; }
  }

  function parseSeq(indent) {
    const savedKind = curKind;
    curKind = 'seq';
    blockDepth++;
    try { tooDeep(); return readSeq(indent); } finally { blockDepth--; curKind = savedKind; }
  }
  function readSeq(indent) {
    const out = [];
    // js-yaml, after an empty entry, takes a following "- " line as the next entry of this list whatever its indent (less than
    // this list's is possible: "- -" then "-" at the margin is one list of two empty entries inside the first)
    let carried = false;
    for (;;) {
      const t = peek();
      if (!t || !/^-([ \t]|$)/.test(t.text) || (t.indent !== indent && !(carried && t.indent < indent))) {
        if (t && t.indent > indent) throw new YamlError('bad indentation of a sequence entry', t.line);
        return out;
      }
      noTab(t);
      let blanks = 1; // the text after the dash starts at this offset of the entry's text
      while (isBlank(t.text[blanks])) blanks++;
      const rest = t.text.slice(blanks);
      if (!rest) {
        pos = t.i + 1;
        const next = peek();
        // an empty entry is no node of its own to js-yaml: it only has a value when a deeper line comes
        if (next && next.indent > indent) { out.push(parseNode(next.indent, indent)); carried = false; } else { out.push(null); carried = true; }
        continue;
      }
      if (/^[?:]([ \t]|$)/.test(rest)) complexKey(t, rest);
      carried = false;
      const offset = t.indent + blanks;
      if (/^-([ \t]|$)/.test(rest) || splitEntry(rest, t.line)) {
        // "- key: value" (or "- - x"): the entry is a node whose first line starts at the column after "- ".
        // With a tab among the blanks after the dash, js-yaml cannot line up a mapping or a sequence that starts there.
        if (t.text.slice(1, blanks).includes('\t')) throw new YamlError('bad indentation of a sequence entry', t.line);
        entryRest = { i: t.i, indent: offset, text: rest, line: t.line, src: t.src };
        out.push(parseNode(offset));
      } else {
        out.push(inlineValue(rest, t, indent));
      }
    }
  }

  function parseMap(indent) {
    const savedKind = curKind;
    curKind = 'map';
    blockDepth++;
    try { tooDeep(); return readMap(indent); } finally { blockDepth--; curKind = savedKind; }
  }
  function readMap(indent) {
    const out = Object.create(null);
    for (;;) {
      const t = peek();
      if (!t || t.indent !== indent) {
        if (t && t.indent > indent) throw new YamlError('bad indentation of a mapping entry', t.line);
        return out;
      }
      const entry = splitEntry(t.text, t.line);
      if (!entry) {
        if (/^[&*!]/.test(t.text)) throw new YamlError(`an anchor, alias or tag (${t.text.split(/[ \t]/)[0]})`, t.line, true);
        if (/^[?:]([ \t]|$)/.test(t.text)) complexKey(t);
        if (/^[[{].*[\]}][ \t]*:([ \t]|$)/.test(t.text)) throw new YamlError('a flow collection used as a key', t.line, true);
        if (/^-([ \t]|$)/.test(t.text)) return out; // a sequence at the map's own indent belongs to the key before it
        throw new YamlError('can not read a mapping entry: expected "key: value"', t.line);
      }
      noTab(t);
      if (Object.prototype.hasOwnProperty.call(out, entry.key)) throw new YamlError('duplicated mapping key', t.line);
      let value;
      if (entry.rest === '') {
        pos = t.i + 1;
        const next = peek();
        if (next && next.indent > indent) value = parseNode(next.indent, indent, true);
        else if (next && next.indent === indent && /^-([ \t]|$)/.test(next.text)) value = parseSeq(indent);
        else { leafCheck(t.line); value = null; }
      } else {
        value = inlineValue(entry.rest, t, indent);
      }
      out[entry.key] = value;
    }
  }

  /** After a "..." marker only blanks and comments may follow, on its line and after it: more is a second document. */
  const nothingAfterEnd = () => {
    if (ended < 0) return;
    for (let k = ended; k < raw.length; k++) {
      if (trim(stripComment(k === ended ? raw[k].slice(3) : raw[k]))) throw new YamlError('expected a single document in the stream, but found more', k + 1);
    }
  };

  const first = peek();
  if (!first) {
    nothingAfterEnd();
    return undefined; // an empty document, as js-yaml reports it
  }
  // At the start of the document js-yaml takes "---" as a document start whatever follows it ("---x: 1", "---#c"), and a "%" line
  // as a directive: valid YAML (or an error of its own) that this reader does not read.
  if (/^---([ \t]|$)/.test(first.text) || (first.indent === 0 && first.text.startsWith('---'))) throw new YamlError('a document start marker (---)', first.line, true);
  if (first.indent === 0 && first.text[0] === '%') throw new YamlError('a directive (%)', first.line, true);
  if (/^(---|\.\.\.)([ \t]|$)/.test(first.text)) throw new YamlError('document markers are not supported inside front matter', first.line);
  const value = parseNode(first.indent);
  const extra = peek();
  if (extra) throw new YamlError('bad indentation, or content that is not a mapping entry or sequence item', extra.line);
  nothingAfterEnd();
  return value;
}

// ---------- writing ----------

const INDICATOR_START = /^[?:,\[\]{}#&*!|>'"%@`]/;
// characters that must be written as an escape in a quoted string: C0 and C1 controls, DEL, line and paragraph separators, U+FFFE and
// U+FFFF, and a surrogate with no partner (js-yaml refuses these in plain text and in the reader's own output)
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** True when the string must be quoted to read back as the same string. */
export function needsQuotes(s) {
  if (s === '') return true;
  if (typeof resolvePlain(s) !== 'string') return true; // would read back as null, a boolean or a number
  if (LEGACY_NUMBER.test(s)) return true; // a number to js-yaml 4.1 ("1_000"), so quoted for whichever version reads it
  if (/^\s|\s$/.test(s)) return true;
  if (INDICATOR_START.test(s)) return true;
  if (/^-(\s|$|:)/.test(s)) return true; // a dash, and "-:", which a key starting so cannot be read as
  if (/: |:$| #|^---|^\.\.\./.test(s)) return true;
  if (CONTROL.test(s)) return true;
  return false;
}

// JSON.stringify leaves DEL, the C1 controls, U+2028, U+2029, U+FFFE and U+FFFF as they are; the YAML written out must not hold them raw
const RAW_REFUSED = /[\u007f-\u009f\u2028\u2029\ufffe\uffff]/g;
export const quoteScalar = (s) => (needsQuotes(s) ? JSON.stringify(s).replace(RAW_REFUSED, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) : s);

/** The length of a string in UTF-8 bytes (what the page counts a file in). */
function utf8Length(str) {
  if (!/[^\u0000-\u007f]/.test(str)) return str.length;
  let n = 0;
  for (const ch of str) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  return n;
}

// A string longer than this is written as a double-quoted value over several lines, each ending in a backslash: one line of it
// would be over the length the page accepts back (MAX_LINE_CHARS), and a long value that was folded from many lines is the usual way
// to get one. The escaped breaks join it up again, and blanks at the end of a piece are kept by the backslash.
const WRAP_AT = 4000;

function scalarText(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isNaN(v) ? '.nan' : v === Infinity ? '.inf' : v === -Infinity ? '-.inf' : String(v);
  return quoteScalar(String(v));
}

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The number of nodes js-yaml counts on the deepest path of `v` (the node itself, every collection and the scalar at the
 * end, and in block style one more when the first node that is not a block collection sits in a block sequence): see
 * MAX_NODES. Counting stops one past the limit, so a very deep value costs no more than a shallow one.
 */
function nodesOf(v, parentKind, block, used = 0) {
  const kids = Array.isArray(v) ? v : isMap(v) ? Object.keys(v).filter((k) => v[k] !== undefined).map((k) => v[k]) : null;
  if (!kids || !kids.length) return used + 1 + (block && parentKind !== 'map' ? 1 : 0);
  if (used >= MAX_NODES) return used + 1;
  const kind = Array.isArray(v) ? 'seq' : 'map';
  let deepest = 0;
  for (const kid of kids) {
    deepest = Math.max(deepest, nodesOf(kid, kind, block, used + 1));
    if (deepest > MAX_NODES) break;
  }
  return deepest;
}

/**
 * Writes a value as block-style YAML. `order` maps a path to the preferred order of the keys of the
 * map found there ("" is the top level, "provider" a key, "consumers[]" the items of a list). Keys
 * not listed follow, in their own order. Keys whose value is undefined are left out.
 */
export function dumpYaml(value, { order = {}, maxBytes = Infinity } = {}) {
  // What has been written so far, so that a value whose block form is far larger than it was read from (many entries at a deep
  // indent) is refused before it is built, not after: the page would not load that much text back in any case.
  let written = 0;
  const account = (line) => {
    written += utf8Length(line) + 1;
    if (written > maxBytes) throw new Error('written as YAML, the front matter would be longer than the page accepts');
    return line;
  };
  /** The lines of `head value` (head is "key:" or "-"), with a long string wrapped. */
  const scalarLines = (head, v, pad) => {
    const text = scalarText(v);
    if (typeof v !== 'string' || text.length <= WRAP_AT) return [`${head} ${text}`];
    const body = JSON.stringify(v).slice(1, -1).replace(RAW_REFUSED, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const pieces = body.match(/\\u[0-9a-fA-F]{4}|\\[^]|[^\\]/gu);
    const chunks = [];
    let cur = '';
    for (let i = 0; i < pieces.length; i++) {
      cur += pieces[i];
      if (cur.length >= WRAP_AT && i + 1 < pieces.length) {
        chunks.push(cur);
        cur = '';
        // a blank that would begin the next line is dropped by the folding there: it is written as an escape instead
        if (pieces[i + 1] === ' ') pieces[i + 1] = '\\ ';
        else if (pieces[i + 1] === '\t') pieces[i + 1] = '\\t';
      }
    }
    chunks.push(cur);
    return chunks.map((c, k) => {
      const first = k === 0 ? `${head} "` : `${pad}  `;
      return first + c + (k === chunks.length - 1 ? '"' : '\\');
    });
  };
  /** A value written on one line, in flow style. */
  const flowText = (v) => {
    if (Array.isArray(v)) return v.length ? `[${v.map(flowText).join(', ')}]` : '[]';
    if (isMap(v)) {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined);
      return keys.length ? `{${keys.map((k) => `${quoteScalar(k)}: ${flowText(v[k])}`).join(', ')}}` : '{}';
    }
    return scalarText(v);
  };
  const keysOf = (o, path) => {
    const pref = order[path] || [];
    const rank = (k) => { const i = pref.indexOf(k); return i < 0 ? pref.length : i; };
    // Array.prototype.sort is stable, so keys that share a rank keep their own order.
    return Object.keys(o).filter((k) => o[k] !== undefined).sort((a, b) => rank(a) - rank(b));
  };

  function lines(v, indent, path) {
    const pad = ' '.repeat(indent);
    if (isMap(v)) {
      const keys = keysOf(v, path);
      if (!keys.length) return [account(`${pad}{}`)];
      const out = [];
      for (const k of keys) {
        const child = v[k];
        const head = `${pad}${quoteScalar(k)}:`;
        const childPath = path ? `${path}.${k}` : k;
        // js-yaml refuses a hundredth node of nesting, and block style costs one more level than flow style under a block
        // sequence: a value that would be refused as block lines is written as a flow collection. (One that js-yaml reads but
        // no form written here can hold, such as pairs nested in a flow list, throws: the import keeps such a record as text.)
        if (indent === 0 && (Array.isArray(child) || isMap(child)) && nodesOf(child, 'map', true, 1) > MAX_NODES) {
          if (nodesOf(child, 'map', false, 1) > MAX_NODES) throw new Error(`"${k}" is nested too deeply to be written as YAML that js-yaml reads`);
          out.push(account(`${head} ${flowText(child)}`));
          continue;
        }
        if (Array.isArray(child)) {
          if (!child.length) out.push(account(`${head} []`));
          else { out.push(account(head)); for (const l of lines(child, indent + 2, childPath)) out.push(l); }
        } else if (isMap(child)) {
          if (!keysOf(child, childPath).length) out.push(account(`${head} {}`));
          else { out.push(account(head)); for (const l of lines(child, indent + 2, childPath)) out.push(l); }
        } else for (const l of scalarLines(head, child, pad)) out.push(account(l));
      }
      return out;
    }
    if (Array.isArray(v)) {
      const out = [];
      const itemPath = `${path}[]`;
      for (const item of v) {
        const nonEmpty = isMap(item) ? keysOf(item, itemPath).length : Array.isArray(item) ? item.length : 0;
        if (nonEmpty) {
          const inner = lines(item, indent + 2, itemPath);
          inner[0] = `${pad}- ${inner[0].slice(indent + 2)}`;
          for (const l of inner) out.push(l);
        } else if (isMap(item) || Array.isArray(item)) out.push(account(`${pad}- ${isMap(item) ? '{}' : '[]'}`));
        else for (const l of scalarLines(`${pad}-`, item, pad)) out.push(account(l));
      }
      return out;
    }
    return [account(`${pad}${scalarText(v)}`)];
  }
  return lines(value, 0, '').join('\n');
}

// Cross-check: runs the specification's command-line linter (tools/lint-icr.cjs) and this tool's
// browser port (js/lint.js) over the worked examples and many broken variants of them, and reports
// any variant on which the two give different findings.
//
//   node tools/compare-with-linter.mjs <path to lint-icr.cjs> [--any-js-yaml]
//
// The command-line linter needs ajv, ajv-formats and js-yaml, which Node finds beside it, above it, or
// in NODE_PATH. This is a development check, not part of `npm test` (which needs no dependencies).
//
// The answer depends on the js-yaml version the linter loads (js-yaml 4.1 reads "1_000" as a number and 4.3 as a
// string, for one), so the run stops unless that version is the one this reader was compared with: PINNED_JS_YAML.
// Install it outside this repository (npm install js-yaml@4.3.2 ajv ajv-formats, then set NODE_PATH to its
// node_modules), or pass --any-js-yaml to run against another version and read the differences with that in mind.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint } from '../js/lint.js';

export const PINNED_JS_YAML = '4.3.2';
const LINTER = process.argv[2];
if (!LINTER) { console.error('usage: node tools/compare-with-linter.mjs <path to lint-icr.cjs> [--any-js-yaml]'); process.exit(2); }
{
  // Which js-yaml does the linter load? Ask Node from the linter's own folder, so it resolves the way the linter does.
  const found = spawnSync(process.execPath, ['-p', "require('js-yaml/package.json').version"], { cwd: path.dirname(path.resolve(LINTER)), encoding: 'utf8' });
  const version = found.status === 0 ? found.stdout.trim() : null;
  console.log(`js-yaml loaded by the linter: ${version ?? 'not found'} (this reader was compared with ${PINNED_JS_YAML})`);
  if (version !== PINNED_JS_YAML && !process.argv.includes('--any-js-yaml')) {
    console.error(`Stopping: install js-yaml@${PINNED_JS_YAML} where the linter finds it (or pass --any-js-yaml to compare against ${version ?? 'whatever is found'} anyway).`);
    process.exit(2);
  }
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, '..', 'templates');
const F = '`'.repeat(3);

const MUTATIONS = [
  ['unchanged', (t) => t],
  ['no front matter', (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '')],
  ['empty front matter', (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '---\n\n---\n')],
  ['icr 0.1', (t) => t.replace('icr: "0.2"', 'icr: "0.1"')],
  ['icr 0.2 unquoted', (t) => t.replace('icr: "0.2"', 'icr: 0.2')],
  ['missing id', (t) => t.replace(/^id: .*\n/m, '')],
  ['bad id', (t) => t.replace(/^id: .*$/m, 'id: PRJ-1')],
  ['short title', (t) => t.replace(/^title: .*$/m, 'title: ab')],
  ['bad status', (t) => t.replace(/^status: .*$/m, 'status: live')],
  ['version 2.1', (t) => t.replace(/^version: .*$/m, 'version: 2.1')],
  ['version v2', (t) => t.replace(/^version: .*$/m, 'version: v2')],
  ['version prerelease', (t) => t.replace(/^version: .*$/m, 'version: 1.0.0-rc.1')],
  ['bad date', (t) => t.replace(/^date: .*$/m, 'date: 2026-02-30')],
  ['leap date', (t) => t.replace(/^date: .*$/m, 'date: 2028-02-29')],
  ['non-leap date', (t) => t.replace(/^date: .*$/m, 'date: 2027-02-29')],
  ['text date', (t) => t.replace(/^date: .*$/m, 'date: yesterday')],
  ['bad interaction', (t) => t.replace(/^interaction: .*$/m, 'interaction: sync')],
  ['no consumers', (t) => t.replace(/consumers:\n(?: {2}.*\n)+/, 'consumers: []\n')],
  ['consumers null', (t) => t.replace(/consumers:\n(?: {2}.*\n)+/, 'consumers:\n')],
  ['unknown property', (t) => t.replace(/^data:/m, 'owner: me\ndata:')],
  ['personal-information string', (t) => t.replace(/personal-information: .*/, 'personal-information: "yes"')],
  ['personal-information missing', (t) => t.replace(/ {2}personal-information: .*\n/, '')],
  ['interface type', (t) => t.replace(/- type: \w+/, '- type: swagger')],
  ['interface ref empty', (t) => t.replace(/^( {4}ref: ).*$/m, '$1""')],
  ['pattern url not uri', (t) => t.replace(/^( {2}url: ).*$/m, '$1<link to the pattern>')],
  ['pattern missing id', (t) => t.replace(/^ {2}id: .*\n/m, '')],
  ['provider missing owner', (t) => t.replace(/^ {2}owner: .*\n/m, '')],
  ['provider extra key', (t) => t.replace(/^ {2}owner: .*\n/m, (m) => m + '  phone: 1\n')],
  ['supersedes number', (t) => t.replace(/^data:/m, 'supersedes: 12\ndata:')],
  ['supersedes null', (t) => t.replace(/^data:/m, 'supersedes: null\ndata:')],
  ['review-by bad', (t) => t.replace(/^data:/m, 'review-by: soon\ndata:')],
  ['decisions not strings', (t) => t.replace(/^data:/m, 'decisions: [1, 2]\ndata:')],
  ['broken yaml bracket', (t) => t.replace(/^title: .*$/m, 'title: [unclosed')],
  ['yaml colon in value', (t) => t.replace(/^title: .*$/m, 'title: Booking: v2')],
  ['yaml duplicate key', (t) => t.replace(/^id: .*$/m, (m) => m + '\n' + m)],
  ['yaml quoted title', (t) => t.replace(/^title: .*$/m, 'title: "A quoted: title"')],
  ['yaml single quoted', (t) => t.replace(/^title: .*$/m, "title: 'it''s a title'")],
  ['yaml flow decisions', (t) => t.replace(/^data:/m, 'decisions: [ADR-1, "ADR-2"]\ndata:')],
  ['yaml comment', (t) => t.replace(/^status: .*$/m, (m) => m + '   # the status')],
  ['yaml folded title', (t) => t.replace(/^title: .*$/m, 'title: >\n  A folded\n  title')],
  ['yaml bool title', (t) => t.replace(/^title: .*$/m, 'title: true')],
  ['yaml null title', (t) => t.replace(/^title: .*$/m, 'title: ~')],
  ['missing Purpose', (t) => t.replace(/## Purpose[\s\S]*?(?=\n## Parties)/, '')],
  ['empty Purpose', (t) => t.replace(/## Purpose\n[\s\S]*?(?=\n## Parties)/, '## Purpose\n')],
  ['missing Error handling', (t) => t.replace(/## Error handling[\s\S]*?(?=\n## Change and versioning)/, '')],
  ['missing flows', (t) => t.replace(/## Interaction flows[\s\S]*?(?=\n## Interface specification)/, '')],
  ['sections swapped', (t) => { const a = t.match(/## Data[\s\S]*?(?=\n## Security)/)[0]; return t.replace(a, '').replace('## Observability', a + '\n## Observability'); }],
  ['duplicate section', (t) => t.replace('## Observability', '## Security\n\nDuplicate.\n\n## Observability')],
  ['unknown heading', (t) => t.replace('## Observability', '## Change log\n\nNothing yet.\n\n## Observability')],
  ['no accTitle', (t) => t.replace(/ {2}accTitle: .*\n/, '')],
  ['no accDescr', (t) => t.replace(/ {2}accDescr: .*\n/, '')],
  ['empty accTitle', (t) => t.replace(/accTitle: .*\n/, 'accTitle:\n')],
  ['no mermaid', (t) => t.replace(F + 'mermaid', F + 'text')],
  ['flowchart instead', (t) => t.replace('sequenceDiagram\n', 'flowchart LR\n')],
  ['bullet criteria', (t) => t.replace(/(## Acceptance criteria[\s\S]*?)^2\. /m, '$1- ')],
  ['prose criteria', (t) => t.replace(/## Acceptance criteria[\s\S]*?(?=\n## Related records|\n*$)/, '## Acceptance criteria\n\nIt should work.\n')],
  ['no example fence', (t) => t.replace(/## Examples[\s\S]*?(?=\n## )/, '## Examples\n\nSee the portal.\n')],
  ['agreed with open issues', (t) => t.replace(/^status: .*$/m, 'status: agreed').replace(/\s*$/, '\n\n## Open issues\n\n- Undecided.\n')],
  ['active with open issues', (t) => t.replace(/^status: .*$/m, 'status: active').replace(/\s*$/, '\n\n## Open issues\n\n- Undecided.\n')],
  ['draft with open issues', (t) => t.replace(/^status: .*$/m, 'status: draft').replace(/\s*$/, '\n\n## Open issues\n\n- Undecided.\n')],
  ['unclosed comment', (t) => t.trimEnd() + '\n\n<!-- never closed\n'],
  ['CRLF', (t) => t.replace(/\n/g, '\r\n')],
  ['BOM', (t) => '﻿' + t],
  // found by review of the browser port
  ['key constructor', (t) => t.replace(/^data:/m, 'constructor: 1\ndata:')],
  ['key hasOwnProperty', (t) => t.replace(/^data:/m, 'hasOwnProperty: 1\ndata:')],
  ['key toString', (t) => t.replace(/^data:/m, 'toString: 1\ndata:')],
  ['key __proto__', (t) => t.replace(/^data:/m, '__proto__: 1\ndata:')],
  ['nested key constructor', (t) => t.replace(/^( {2}owner: .*)$/m, '$1\n  constructor: 1')],
  ['url non-ascii', (t) => t.replace(/^( {2}url: ).*$/m, '$1"https://ex.org/é"')],
  ['url %zz', (t) => t.replace(/^( {2}url: ).*$/m, '$1"https://a/%zz"')],
  ['url unclosed bracket', (t) => t.replace(/^( {2}url: ).*$/m, '$1"https://a/[x"')],
  ['url ipv6', (t) => t.replace(/^( {2}url: ).*$/m, '$1"https://[::1]:8080/x"')],
  ['url mailto', (t) => t.replace(/^( {2}url: ).*$/m, '$1"mailto:a@b.c"')],
  ['title percent', (t) => t.replace(/^title: .*$/m, 'title: %pct')],
  ['title at sign', (t) => t.replace(/^title: .*$/m, 'title: @x')],
  ['title wrapped', (t) => t.replace(/^title: .*$/m, 'title: Partner room availability\n  and booking API')],
  ['title wrapped three lines', (t) => t.replace(/^title: .*$/m, 'title: one\n  two\n  three')],
  ['title multi-line double quoted', (t) => t.replace(/^title: .*$/m, 'title: "one\n  two"')],
  ['title multi-line single quoted', (t) => t.replace(/^title: .*$/m, "title: 'one\n  two'")],
  ['document end marker', (t) => t.replace(/\n---\n/, '\n...\n---\n')],
  ['version underscore', (t) => t.replace(/^version: .*$/m, 'version: 1_000')],
  ['tag !!str', (t) => t.replace(/^title: .*$/m, 'title: !!str Partner API')],
  ['anchor', (t) => t.replace(/^title: .*$/m, 'title: &t Partner API')],
  ['alias', (t) => t.replace(/^title: .*$/m, 'title: &t Partner API').replace(/^decisions:/m, 'review-by: *t\ndecisions:')],
  ['title block dash', (t) => t.replace(/^title: .*$/m, 'title: - x y z')],
  ['title question mark', (t) => t.replace(/^title: .*$/m, 'title: ? abc def')],
  ['decisions flow pair', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [a: b]\n')],
  ['key with a colon inside', (t) => t.replace(/^title: .*$/m, 'title: Partner API\nx:y: 1')],
  ['complex key', (t) => t.replace(/^id: .*$/m, '? id\n: ICR-0001')],
  ['block scalar, first line wider than the text', (t) => t.replace(/^title: .*$/m, 'title: >\n   \n  Partner room availability API')],
  ['block scalar, blank first line as wide as the text', (t) => t.replace(/^title: .*$/m, 'title: |\n  \n  Partner room availability API')],
  ['literal scalar keeps blanks', (t) => t.replace(/^title: .*$/m, 'title: |\n  Partner room\n    \n  availability API')],
  ['folded scalar keeps blanks', (t) => t.replace(/^title: .*$/m, 'title: >\n  Partner room\n    \n  availability API')],
  ['comment after a closing quote', (t) => t.replace(/^icr: "0.2"/m, 'icr: "0.2"#spec')],
  ['comment after a closing bracket', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [a]#c\n')],
  ['comment glued to plain text', (t) => t.replace(/^title: .*$/m, 'title: Partner API#not-a-comment')],
  ['flow key', (t) => t.replace(/^data:/m, '[a]: x\ndata:')],
  ['null keys twice', (t) => t.replace(/^data:/m, '~: 1\nnull: 2\ndata:')],
  ['true keys twice', (t) => t.replace(/^data:/m, 'true: 1\nTrue: 2\ndata:')],
  ['numeric keys twice', (t) => t.replace(/^data:/m, '1: a\n0x1: b\ndata:')],
  ['single-line complex key', (t) => t.replace(/^data:/m, '? k: v\ndata:')],
  ['plain text, quote then #', (t) => t.replace(/^title: .*$/m, 'title: Booking API "v2"#draft')],
  ['plain text, bracket then #', (t) => t.replace(/^title: .*$/m, 'title: Booking API [v2]#draft')],
  ['plain text, brace then #', (t) => t.replace(/^title: .*$/m, 'title: Booking API {v2}#draft')],
  ['plain text, single quote then #', (t) => t.replace(/^title: .*$/m, "title: Booking API 'v2'#draft")],
  ['plain text, quote then # and a colon', (t) => t.replace(/^title: .*$/m, 'title: Booking "x"#y: z')],
  ['plain text, quote around a #', (t) => t.replace(/^title: .*$/m, 'title: Booking "x #y"')],
  ['plain continuation line, quote then #', (t) => t.replace(/^title: .*$/m, 'title: Booking\n  API "v2"#draft')],
  ['document end marker indented after a block', (t) => t.replace(/^(provider:\n(?: {2}.*\n)+)/m, '$1  ...\n')],
  ['document end marker indented in a value', (t) => t.replace(/^title: .*$/m, 'title: Booking\n  ...')],
  ['apostrophe in a plain flow value', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, "decisions: [it's, b]\n")],
  ['quoted list item over two lines', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n  - "ADR-1\n    and more"\n')],
  ['quoted list item over two lines with a comment', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n  - "ADR-1\n    and more" # note\n')],
  ['unknown tag', (t) => t.replace(/^title: .*$/m, 'title: !t Partner API')],
  ['undefined alias', (t) => t.replace(/^title: .*$/m, 'title: *nowhere')],
  ['tab in indentation', (t) => t.replace(/^( {2})owner: /m, '  \towner: ')],
  ['tab as the whole indentation', (t) => t.replace(/^ {2}system: /m, '\tsystem: ')],
  ['tab after a list dash', (t) => t.replace(/^( *)- system: /m, '$1-\tsystem: ')],
  ['tab before a comment', (t) => t.replace(/^status: .*$/m, 'status: active\t# a comment')],
  ['tab after the key colon', (t) => t.replace(/^status: /m, 'status:\t')],
  ['no-break space after the status', (t) => t.replace(/^status: .*$/m, 'status: active\u00a0')],
  ['no-break space after the key colon', (t) => t.replace(/^status: /m, 'status:\u00a0')],
  ['ideographic space after the key colon', (t) => t.replace(/^date: /m, 'date:\u3000')],
  ['byte order mark in a key', (t) => t.replace(/^data:/m, 'data\ufeff:')],
  ['no-break space before the version', (t) => t.replace(/^version: /m, 'version:\u00a0')],
  ['no-break space before a url', (t) => t.replace(/^( {2})url: /m, '  url:\u00a0')],
  ['line separator in the title', (t) => t.replace(/^title: .*$/m, 'title: Partner\u2028API')],
  ['bell in the title', (t) => t.replace(/^title: .*$/m, 'title: Partner \u0007 API')],
  ['vertical tab in a contact', (t) => t.replace(/^( {2})owner: .*$/m, '$1owner: A\u000bB')],
  ['form feed in the id', (t) => t.replace(/^id: .*$/m, 'id: ICR-\u000c0001')],
  ['delete character in the title', (t) => t.replace(/^title: .*$/m, 'title: Partner\u007f API')],
  ['C1 control in the title', (t) => t.replace(/^title: .*$/m, 'title: Partner\u009f API')],
  ['U+FFFE in the title', (t) => t.replace(/^title: .*$/m, 'title: Partner\ufffe API')],
  ['hash straight after a flow comma', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,#0019]\n')],
  ['hash after a flow entry', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012, ADR-0019,#note]\n')],
  ['hash after a flow comma, then the close', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,#c\n  ADR-0019]\n')],
  ['two chomping indicators', (t) => t.replace(/^title: .*$/m, 'title: |--\n  Partner API')],
  ['two chomping indicators, mixed', (t) => t.replace(/^title: .*$/m, 'title: >+-\n  Partner API')],
  ['flow entry starting with a colon and a quote', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [x, :"["]\n')],
  ['flow entry with an empty key', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [x, : y]\n')],
  ['flow plain value broken at column 0', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-00\n12, ADR-0019]\n')],
  ['flow plain value broken under its key', (t) => t.replace(/^data:\n/m, 'data:\n  extra: [A\n  B]\n')],
  ['flow plain value broken further in', (t) => t.replace(/^data:\n/m, 'data:\n  extra: [A\n   B]\n')],
  ['flow entries broken at column 0 after a comma', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,\nADR-0019]\n')],
  ['comment ends a flow plain value', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012 # c\n   ADR-0019]\n')],
  ['comment ends a flow plain value, then the close', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012 # c\n   ]\n')],
  ['blank line in a flow plain value', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012\n\n  ADR-0019]\n')],
  ['blank line in a flow quoted value', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-0012\n\n  ADR-0019"]\n')],
  ['flow pair colon on the next line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [a\n  : b]\n')],
  ['flow key over two lines', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [a\n  b: c]\n')],
  ['flow nesting 99 deep', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ' + '['.repeat(99) + ']'.repeat(99) + '\n')],
  ['flow nesting 100 deep', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ' + '['.repeat(100) + ']'.repeat(100) + '\n')],
  ['flow mappings 99 deep', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ' + '{a: '.repeat(99) + 'x' + '}'.repeat(99) + '\n')],
  // a document marker at the left margin ends the document, inside a flow collection or a quoted value
  ['marker dots in a flow list', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,\n... ADR-0019]\n')],
  ['marker dashes in a flow list', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,\n--- ADR-0019]\n')],
  ['marker dots on a line of their own in a flow list', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,\n...\n]\n')],
  ['marker dots in a quoted title', (t) => t.replace(/^title: .*$/m, 'title: "Partner room availability\n... and booking API"')],
  ['marker dashes in a single-quoted title', (t) => t.replace(/^title: .*$/m, "title: 'Partner room availability\n--- and booking API'")],
  ['indented dots in a flow list', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,\n  ... ADR-0019]\n')],
  ['dots with no blank after them in a quoted title', (t) => t.replace(/^title: .*$/m, 'title: "Partner room availability\n...and booking API"')],
  // folding inside double-quoted values, and a backslash at the end of a line
  ['escaped break in a quoted title', (t) => t.replace(/^title: .*$/m, 'title: "Partner room avail\\\n  ability"')],
  ['escaped break in a quoted flow entry', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-00\\\n  12"]\n')],
  ['escaped break and a blank line in a quoted title', (t) => t.replace(/^title: .*$/m, 'title: "Partner room\\\n\n  availability"')],
  ['escaped blank before a break in a quoted title', (t) => t.replace(/^title: .*$/m, 'title: "Partner room \\\n  availability"')],
  ['trailing blanks before a break in a quoted title', (t) => t.replace(/^title: .*$/m, 'title: "Partner room   \n  availability"')],
  ['blank line in a quoted title', (t) => t.replace(/^title: .*$/m, 'title: "Partner room\n\n  availability"')],
  ['blank line in a single-quoted title', (t) => t.replace(/^title: .*$/m, "title: 'Partner room\n\n  availability'")],
  // comments on the continuation lines of a flow collection
  ['comment after a closing bracket on a continuation line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [\n [ ADR-0012\n ] ,#c\n ]\n')],
  ['comment after a closing bracket, then a mapping', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ [\n -x\n ] ,#c\n {} ]\n')],
  ['comment after a quoted entry on a continuation line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-0012\n  part"# note\n  ]\n')],
  ['comment after a single-quoted entry with a blank line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, "decisions: ['ADR-0012\n\n  part'#c\n]\n")],
  ['hash inside a quoted flow entry on a later line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-0012 #b\n  c"]\n')],
  ['comment line inside a quoted flow entry', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-0012\n#b\n  c"]\n')],
  // a stray line break before a key's colon
  ['stray break before a nested key colon', (t) => t.replace(/^( {2})id: (.*)$/m, '$1id\n$1: $2')],
  ['stray break before a top-level key colon', (t) => t.replace(/^status: (.*)$/m, 'status\n: $1')],
  ['a colon line at the margin after an entry', (t) => t.replace(/^status: (.*)$/m, 'status: $1\n: x')],
  ['a colon line at the margin after a list item', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n  - ADR-0012\n: x\n')],
  ['a plain value continued by a word and a colon line', (t) => t.replace(/^( {2})owner: (.*)$/m, '$1owner: $2\n$1id\n: int-api-external')],
  // nesting of block and mixed forms
  ['block lists 97 deep', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n' + '- '.repeat(97) + 'a\n')],
  ['block lists 98 deep', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n' + '- '.repeat(98) + 'a\n')],
  ['empty block lists 99 deep', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n' + '- '.repeat(99) + '\n')],
  ['empty block lists 100 deep', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n' + '- '.repeat(100) + '\n')],
  ['flow mappings 97 deep on the next line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n  ' + '{a: '.repeat(97) + 'x' + '}'.repeat(97) + '\n')],
  ['flow mappings 98 deep on the next line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n  ' + '{a: '.repeat(98) + 'x' + '}'.repeat(98) + '\n')],
  ['block list then 96 flow lists', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n- ' + '['.repeat(96) + ']'.repeat(96) + '\n')],
  ['block list then 97 flow lists', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n- ' + '['.repeat(97) + ']'.repeat(97) + '\n')],
  // text after a flow collection or quoted value that closed on a later line is the next entry
  ['key after a closing bracket', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,\n]owner: me\n')],
  ['key after a closing quote', (t) => t.replace(/^title: .*$/m, 'title: "Partner room availability\n"owner: me')],
  ['tab after a closing bracket', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,\n]\towner: me\n')],
  ['text that is no entry after a closing bracket', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: [ADR-0012,\n]stray text\n')],
  // document end and start markers
  ['text after a document end marker', (t) => t.replace(/^---\n([\s\S]*?)\n---\n/, '---\n$1\n... x\n---\n')],
  ['comment after a document end marker', (t) => t.replace(/^---\n([\s\S]*?)\n---\n/, '---\n$1\n... # end\n---\n')],
  ['hash straight after dots at the end', (t) => t.replace(/^---\n([\s\S]*?)\n---\n/, '---\n$1\n...#c\n---\n')],
  ['a second document start', (t) => t.replace(/^---\n([\s\S]*?)\n---\n/, '---\n$1\n--- x: 2\n---\n')],
  ['plain key starting with a colon', (t) => t.replace(/^data:/m, ':extra: 1\ndata:')],
  // a backslash and blanks at the end of a line inside a flow collection: an escaped blank, not an escaped line break
  ['escaped blank at the end of a flow line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR\\ \n  0012"]\n')],
  ['escaped blank before a blank at the end of a flow line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR \\ \n  0012"]\n')],
  ['escaped blank then a tab at the end of a flow line', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR\\\t\n  0012"]\n')],
  ['escaped blank at the end of a line in a flow list in a list', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n  - ["ADR\\ \n    0012"]\n')],
  ['escaped blank in a flow link', (t) => t.replace(/^pattern:\n {2}id: (.*)\n {2}url: .*\n/m, 'pattern: {id: $1, url: "https://www.itarchitecturepatterns.net/\\ \n  patterns/int-api-external"}\n')],
  ['escaped blank in a flow interface reference', (t) => t.replace(/^interfaces:\n(?: {2,}.*\n)+/m, 'interfaces: [{type: openapi, ref: "\\ \n  ", version: 1.0.0}]\n')],
  // an empty list entry followed by a dash at a lesser indent
  ['empty entry then a dash at the margin', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n- -\n-\n')],
  ['empty entry then a dash and an entry at the margin', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n- -\n- ADR-1\n')],
  ['empty entry then a dash then a line indented once', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions:\n- -\n-\n e\n')],
  // an anchor or tag in front of a later key, a plain key "-", a first line "--- text"
  ['anchor before a later key', (t) => t.replace(/^version: .*$/m, '&a version: 2.1.0')],
  ['tag before a later key', (t) => t.replace(/^version: .*$/m, '!!str version: 2.1.0')],
  ['plain key dash', (t) => t.replace(/^data:/m, '-: 1\ndata:')],
  ['flow key dash', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: {-: 1}\n')],
  ['document start with text on the first line', (t) => t.replace(/^icr: /m, '--- x\nicr: ')],
  ['escape past U+10FFFF', (t) => t.replace(/^title: .*$/m, 'title: "Partner \\U00110000 API"')],
  // block scalars: tabs and blank lines
  ['tab line before the text of a block scalar', (t) => t.replace(/^title: .*$/m, 'title: |\n  \t\n  Partner API')],
  ['tab after one space before the text of a block scalar', (t) => t.replace(/^title: .*$/m, 'title: |\n \t\n  Partner API')],
  ['tab line after a kept block scalar', (t) => t.replace(/^title: .*$/m, 'title: |+\n  Partner API\n\t')],
  ['tab inside the text of a folded block scalar', (t) => t.replace(/^title: .*$/m, 'title: >\n  Partner\n  \tAPI\n  end')],
  ['blank lines then an indicator in a block scalar', (t) => t.replace(/^title: .*$/m, 'title: |2\n\n    Partner API')],
  // an entry that begins on the line where a multi-line value closed: a "#" in that value is not its comment
  ['closed value with a hash then an interface with an escaped break', (t) => t.replace(/^interfaces:\n(?: {2,}.*\n)+/m, '').replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-AB-0001\nADR-AB-0002  #"]interfaces: [{type: openapi, ref: "\\\n  ", version: 1.2.0}]\n')],
  ['closed flow value with a hash then a flow entry joined by a backslash', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-1\nADR-2  #"]owner: ["c\\\n d"]\n')],
  ['closed flow value with a hash then a quoted entry joined by a backslash', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-1\nADR-2  #"]owner: "c\\\n d"\n')],
  ['closed flow value with a hash then a plain flow entry over two lines', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-1\nADR-2  #"]owner: [c\n d]\n')],
  ['closed quoted value with a hash then a flow entry joined by a backslash', (t) => t.replace(/^title: .*$/m, 'title: "Partner\nAPI  #"owner: ["c\\\n d"]')],
  // a first line that starts with the dashes, a directive
  ['dashes and a comment glued together on the first line', (t) => t.replace(/^icr: /m, '---#c\nicr: ')],
  ['dashes glued to a key on the first line', (t) => t.replace(/^icr: /m, '---x: 1\nicr: ')],
  ['a YAML directive before the document start', (t) => t.replace(/^icr: /m, '%YAML 1.2\n--- #c\nicr: ')],
  // a tab among the blanks that begin a line inside a quoted value, with an entry after the closing bracket
  ['tab in the margin of a quoted flow value then an entry', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-0012\n\tADR-0019"]owner: me\n')],
  ['tab after a blank in the margin of a single-quoted flow value then an entry', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, "decisions: ['ADR-0012\n \tADR-0019']owner: me\n")],
  ['tab in the margin of a quoted flow value, nothing after', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: ["ADR-0012\n\tADR-0019"]\n')],
  ['null in a flow key', (t) => t.replace(/^decisions:[\s\S]*?(?=^\w)/m, 'decisions: {[~, a]: 1}\n')],
  ['document start comment', (t) => t.replace(/^icr: /m, '--- # start\nicr: ')],
  ['flow map in list', (t) => t.replace(/^data:/m, 'decisions: [{a: 1}]\ndata:')],
  ['deep nesting', (t) => t.replace(/^data:/m, 'decisions: ' + '['.repeat(60) + ']'.repeat(60) + '\ndata:')],
];

// Valid YAML that the browser port deliberately does not read. It reports the front matter as "not checked here"
// instead of failing it, so on these the two give different answers, and that is documented in the README.
const DOCUMENTED = new Set(['tag !!str', 'anchor', 'alias', 'complex key', 'document start comment', 'flow key', 'single-line complex key', 'unknown tag', 'undefined alias', 'document start with text on the first line', 'dashes glued to a key on the first line', 'escape past U+10FFFF']);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icr-compare-'));

// Write every variant to a file and run the reference linter once over all of them (it takes many files).
const variants = [];
for (const f of fs.readdirSync(TEMPLATES).filter((n) => n.endsWith('.md'))) {
  const base = fs.readFileSync(path.join(TEMPLATES, f), 'utf8').replace(/\r\n/g, '\n');
  for (const [name, fn] of MUTATIONS) {
    let text;
    try { text = fn(base); } catch { continue; }
    const file = `v${variants.length}.md`; // a short relative name: 500 absolute temp paths overflow the Windows command line
    fs.writeFileSync(path.join(dir, file), text);
    variants.push({ f, name, text, file });
  }
}
const run = spawnSync(process.execPath, [path.resolve(LINTER), ...variants.map((v) => v.file)], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: dir });
if (!run.stdout) { console.error(`The reference linter printed nothing: ${(run.stderr || 'is the path right?').trim().split(/\r?\n/)[0]}`); process.exit(2); }
const wanted = new Map();
let current = null;
for (const line of run.stdout.split('\n')) {
  if (line.startsWith('ok   ')) { current = line.slice(5); wanted.set(current, []); }
  else if (line.startsWith('FAIL ')) { current = line.slice(5); wanted.set(current, []); }
  else if (line.startsWith('  - ') && current) wanted.get(current).push(line.slice(4));
}

const different = [];
const documented = [];
for (const v of variants) {
  const want = wanted.get(v.file);
  if (!want) { different.push({ ...v, want: ['(the reference linter printed nothing)'], got: lint(v.text) }); continue; }
  const got = lint(v.text);
  // The two YAML readers word a syntax error differently; whether the front matter is invalid is what must agree.
  const norm = (list) => list.map((m) => (m.startsWith('front matter is not valid YAML') ? 'front matter is not valid YAML' : m)).sort();
  const same = JSON.stringify(norm(want)) === JSON.stringify(norm(got));
  if (!same && DOCUMENTED.has(v.name)) documented.push(`${v.f} / ${v.name}`);
  else if (!same) different.push({ ...v, want, got });
  else if (!want.concat(got).some((m) => m.startsWith('front matter is not valid YAML')) && JSON.stringify(want) !== JSON.stringify(got)) console.log(`order differs (same findings): ${v.f} / ${v.name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${variants.length} variants compared, ${different.length} different, ${documented.length} documented differences (unsupported YAML: anchors, aliases, tags, complex keys, a document start marker).`);
for (const d of different) console.log(`\n${d.f} / ${d.name}\n  linter : ${JSON.stringify(d.want)}\n  browser: ${JSON.stringify(d.got)}`);
process.exit(different.length ? 1 : 0);

// Every "carried" shape: a flow collection or quoted value that goes over several lines and closes on a later line, followed at
// once (on the closing line) by another entry, which may itself go over lines. js-yaml reads that entry as the next one of the
// block around; tests/data/carried-expected.json holds what js-yaml 4.3.2 reads for each text, in this order (null: it refuses).
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

// the first value; the second piece is on the next line (without the context's indent) and ends with the closing bracket or quote
const OPENERS = [
  ['["a', 'b  #"]'], ['["a', 'b #c"]'], ['{a: "b', 'c  #"}'], ['"a', 'b  #"'], ["'a", "b  #'"], ['["x', 'y"]'], ['[a,', 'b]'], ['{a: 1,', 'b: 2}'],
  ['["a' + BS, 'b"]'], ['"a' + BS, 'b"'], ['[a,', 'b] # c'], ['["a #b', 'c"]'],
  // a tab among the blanks that begin a line inside a quoted value: js-yaml refuses the entry that follows the closing bracket
  ["['a", TAB + "b']"], ['["a', TAB + 'b"]'], ["{x: 'a", TAB + "b'}"], ['"a', TAB + 'b"'], ["'a", ' ' + TAB + "b'"], ['["a', ' ' + TAB + ' b"]'],
];
// what follows the closing bracket or quote on the same line: the next entry (further lines go under the context's indent)
const ENTRIES = [
  ['m: c'], ['m: c # x'], ['m: c#d'], ['m: "a #b"'], ["m: 'a #b'"],
  ['m: ["c' + BS, ' d"]'], ['m: ["c' + BS + ' ', ' d"]'], ['m: ["c' + BS + TAB, ' d"]'], ['m: ["c ' + BS, ' d"]'], ['m: [c', ' d]'],
  ['m: "c' + BS, ' d"'], ['m: "c' + BS + ' ', ' d"'], ["m: 'c", " d'"], ['m: "c  ', ' d"'], ['m: [c, # x', ' d]'],
  ['m: {a: "c' + BS, ' d"}'], ['m: |', '  t'], ['m: >-', '  t'], ['m: [a, b] # c'], ['m: {a: b}'], ['m: c', '  d'], ['m: ["c"] # x', 'n: 1'],
  ['m: [', ' "c' + BS, ' d"]'],
];
const CONTEXTS = [
  { first: '', pad: '' }, // the top level
  { first: 'a:' + NL + '  ', pad: '  ' }, // under a key
  { first: 'a:' + NL + '  - ', pad: '    ' }, // in a list under a key
];

export function carriedCases() {
  const out = [];
  for (const ctx of CONTEXTS) {
    for (const [open, close] of OPENERS) {
      for (const entry of ENTRIES) {
        const lines = [`${ctx.first}k: ${open}`, `${ctx.pad}${close}${entry[0]}`];
        for (let i = 1; i < entry.length; i++) lines.push(ctx.pad + entry[i]);
        out.push(lines.join(NL));
        out.push(lines.join(NL) + NL + ctx.pad + 'z: 1');
      }
    }
  }
  return out;
}

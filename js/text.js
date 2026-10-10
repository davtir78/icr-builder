// Small text helpers that read a line in one pass.
//
// A regular expression such as /\s+$/ or /^#[ \t]+(.+?)[ \t]*$/ looks harmless, but when the line holds a long run of
// spaces followed by something else, the engine starts again at every space and the work grows with the square of the
// run: one 256 KB line took minutes. Everything that trims or splits a line of unknown length uses these instead.

/** Removes trailing spaces and tabs only (what /[ \t]+$/ removes), in one pass. */
export function trimBlanksEnd(s) {
  let end = s.length;
  while (end > 0 && (s[end - 1] === ' ' || s[end - 1] === '\t')) end--;
  return end === s.length ? s : s.slice(0, end);
}

/**
 * An ATX heading's text without its closing "#" run: "Title ##" is "Title". The run only counts when whitespace
 * precedes it, and the trailing whitespace goes either way. `blank` says which characters are whitespace.
 */
export function stripClosingHashes(text, blank = /\s/) {
  const t = blank.source === '\s' ? text.trimEnd() : trimBlanksEnd(text);
  let i = t.length;
  while (i > 0 && t[i - 1] === '#') i--;
  if (i < t.length && i > 0 && blank.test(t[i - 1])) return blank.source === '\s' ? t.slice(0, i).trimEnd() : trimBlanksEnd(t.slice(0, i));
  return t;
}

/**
 * An ATX heading line ("## Title"): { level, text } or null. `indent` is how many leading spaces may precede the
 * marker, `maxLevel` the deepest marker accepted. The marker must be followed by a space or a tab; `text` is what
 * follows that blank run, untrimmed at the end.
 */
export function atxHeading(line, { indent = 0, maxLevel = 6 } = {}) {
  let i = 0;
  while (i < indent && line[i] === ' ') i++;
  let n = 0;
  while (line[i + n] === '#') n++;
  if (n < 1 || n > maxLevel) return null;
  const after = line[i + n];
  if (after !== ' ' && after !== '\t') return null;
  let j = i + n;
  while (line[j] === ' ' || line[j] === '\t') j++;
  return { level: n, text: line.slice(j) };
}

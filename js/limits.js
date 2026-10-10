// How large a record may be. An ICR is a few tens of KB; the worked examples are 12 to 19 KB. The limit keeps a
// hostile or mistaken file from making the page slow, and is far above anything a real record needs.
export const MAX_RECORD_BYTES = 256 * 1024;

/** The size of a text in bytes, as it would be saved (UTF-8), so a text is measured the way a file is. */
export const byteLength = (text) => new TextEncoder().encode(text).length;

// How long one line of a record may be. Real lines (a table row, a long sentence, a one-line JSON example) are a few
// hundred characters; the longest in the bundled examples is under 700. A line of tens of thousands of characters is
// a pasted blob or a crafted file, and the readers should not be asked to scan it with patterns that can backtrack.
export const MAX_LINE_CHARS = 20000;

/** The first line longer than the limit, as { line, length } (line numbers start at 1), or null. One pass, no pattern. */
export function overlongLine(text, max = MAX_LINE_CHARS) {
  let at = 0;
  let line = 1;
  while (at <= text.length) {
    let end = text.indexOf('\n', at);
    if (end < 0) end = text.length;
    if (end - at > max) return { line, length: end - at };
    at = end + 1;
    line++;
  }
  return null;
}

/** The message shown for an over-long line: what it is, where, and what to do. */
export const overlongMessage = ({ line, length }, max = MAX_LINE_CHARS) =>
  `line ${line} is ${length.toLocaleString('en-US')} characters long, and a line may be at most ${max.toLocaleString('en-US')}: break it up or remove it (nothing else was checked)`;

# ICR Builder

A single-page tool, in the browser, for writing an **Integration Contract Record (ICR)**: a short markdown
document that records the agreement behind one integration (why it exists, who owns each end, what data
crosses, how it is secured, what each side promises, how failures behave, how it changes, who to call).

It walks an architect through the record step by step, checks it as they type against the conformance rules of
the ICR specification (v0.2, a draft), and exports markdown that is ready to commit next to the interface
specification.

- **Choose the interaction type** (synchronous request and response, event, message, stream, batch file) and,
  optionally, one of the 33 integration patterns from
  [IT Architecture Patterns](https://www.itarchitecturepatterns.net/patterns). Choosing a pattern names it in the front
  matter, adds the "pattern controls inherited" line, and fills any *empty* Interaction, Security, Service levels and
  Error handling sections with prompts. It sets the interaction type only when the one already chosen does not fit
  the pattern. It never overwrites text you wrote: on a pattern line you have written, only the link is changed (the text of
  that link becomes the pattern's title, and a link inside a code span on the same line is changed too), and a line
  worded some other way is left as it is.
- **Guided front matter and 17 sections.** Each has a short "why this matters", what to write, the
  specification's "common failure", prompts to insert, and an example from a worked ICR.
- **Live conformance checklist.** The six conformance rules (front matter against the schema, required sections
  present, in order and not empty, numbered acceptance criteria, no open issues when agreed or active, a sequence
  diagram with `accTitle` and `accDescr`, a fenced example) applied as you type, plus separate *advice* the rules
  cannot give (prompts left in `<angle brackets>`, criteria with no "Proved by", a volume with no number...).
  A record made only of inserted prompts is shown as "well formed, not finished", not as a success.
- **Live preview and the markdown source**, exactly as exported.
- **Interaction-flow helper.** Builds a starter Mermaid `sequenceDiagram` (with `accTitle` and `accDescr`) and the
  same sequence as numbered steps from the parties you entered, for each interaction type (log-based streams give
  retries and the dead-letter topic to the consumer, and each consumer is drawn reading and committing its offset; a request,
  a message or a file is drawn for the first consumer only). The steps always work; drawing is optional (see Privacy).
- **Export and import.** Download a `.md`, copy to the clipboard, or open an existing ICR to edit.
- **Autosave** in `localStorage` only, with **Clear draft**. "Load the Appointment Booking example (ICR-AB-0001)"
  is a ready starting point; five more worked examples are bundled.
- Light and dark themes (automatic, or your choice), keyboard operable, WCAG 2.2 AA, with a usable tablet layout.

## Run it

There is no build step and no dependency. The page uses ES modules, which browsers do not load from `file://`,
so serve the folder over http:

```bash
node serve.mjs          # http://localhost:8080/   (node serve.mjs 9000 for another port)
# or any static server:
npx serve .
python -m http.server 8080
```

## Privacy

Everything happens in your browser. The draft is saved in `localStorage` on this device as you type, and nothing
is sent anywhere (except the diagram library, fetched from a public CDN only if you choose to draw): no server, no account, no analytics. Files you open are read in the browser and not uploaded.

The page asks the server it came from only for its own files (its pages and scripts, and a worked example from
`templates/` when you choose one), and none of those requests carries your record. The one thing fetched from anywhere
else is the diagram library. **Only when you press a "Draw" button** (once
for each file or example you load), the page loads [Mermaid](https://mermaid.js.org/) 11.16.1 from `cdn.jsdelivr.net`
with a Subresource Integrity hash. Your record is not part of that request. If the library cannot be loaded, the
diagram source and the numbered steps stay on screen.

A record can come from a file, and diagram labels have been an attack surface in Mermaid (for example CVE-2025-54881 in
11.0 to 11.9). So the library is a patched release and it runs in an `<iframe sandbox="allow-scripts">` with no
`allow-same-origin`, under its own Content-Security-Policy (scripts by nonce only, and no fetch or XHR connections, so
the frame cannot post the record anywhere by a request of its own). The drawing stays inside that frame: the page never
takes markup from it, only a height.

Neither the sandbox nor that policy stops the frame from navigating itself to another page (an injected
`<meta http-equiv=refresh>` does that), so there is defence in depth, and it is best effort. Every message from the
frame carries a random token that only its own document knows, and the page answers only the first "ready", accepts a
drawing only after the page asked for it, and treats a second "ready" as a fault. The frame's document sends a heartbeat
every second; if it stops, or never starts, or the frame loads a second time, the frame is removed within a few seconds
(longer where it shares this page's process, as below) and the diagram source stays on screen. A drawing is removed
only when its frame genuinely stops answering: when the page itself was suspended (restored from the back/forward cache, frozen in a background tab, woken from sleep), the frame is
given a fresh wait instead, once per heartbeat: a second late check with no heartbeat between removes it, so a page the
frame was sent to cannot keep it on screen for ever by keeping this page busy. In a browser that gives a sandboxed frame
its own process (Chrome on a computer) such a frame is removed within about 3.5 seconds of its last heartbeat (2.8 to 3.7
seconds measured, whatever the hostile page did). Where it shares this page's process (Safari, Chrome on Android; I
emulated it with Chrome's site isolation switched off), a hostile page can delay that by keeping this page busy: the frame
is removed within about 3.5 seconds of its last heartbeat plus up to two more of the hostile page's busy periods (about four
when each is just under 3.5 seconds). Measured there: 11 seconds for busy periods of 4 seconds, 14 seconds for ones of 3.4
seconds, and 20 to 23 seconds for ones of 10 seconds. This page does not respond at all while it is kept busy. Until then
the navigated page is visible in the frame, and in that setting it runs in this page's process. In Chrome and Edge the
iframe's `csp` attribute also makes the browser refuse a page that does not agree to a policy. What remains: this guards against a page the frame was sent to, not against script
running in the frame's own document (which can read the token), and a navigation is noticed after a few seconds, not
instantly. Reaching that point needs an HTML-injection bypass of the pinned release, and none is known. A test page,
`tests/browser/sandbox-xss.html`, runs the published proof of concept against the vulnerable release and against the
pinned one, checks that nothing reaches the page, and checks that payloads that navigate the frame (one that finishes
loading, and one that never does, served by `tests/browser/hold-server.mjs`) get it removed.

Limits: a record may be up to 256 KB. A draft is analysed before it is saved, a draft of the wrong shape is
discarded, and a draft that stopped the page on the last visit is discarded on the next one.

## The specification

The builder implements the Integration Contract Record specification, version 0.2 (a draft): YAML front matter that
validates against a JSON Schema, then seventeen fixed sections (fourteen required). **The specification and its
command-line linter are not published yet**, so this repository does not link to them; the checklist's rules are the
six conformance rules listed above, and `js/lint.js` is where they are implemented. Worked ICRs in this format, from
the Appointment Booking sample, are public at
[davtir78/architecture-records](https://github.com/davtir78/architecture-records/tree/main/samples/appointment-booking/contracts).

## How the checks compare with the specification's linter

`js/lint.js` ports the specification's `lint-icr.cjs` with the same messages. Two parts are re-implemented because they
must run in a browser with no dependencies: the YAML front matter is read by `js/yaml.js` (the subset front matter
uses, with scalars resolved as js-yaml 4.3's JSON schema does) and checked by a small validator for the JSON Schema
keywords the ICR schema uses, worded as Ajv words them, with the `date` and `uri` formats copied from ajv-formats.

`tools/compare-with-linter.mjs` runs the original linter and this port over the worked examples and 230 broken
variants of each (1,380 in all) and reports any difference. It needs ajv, ajv-formats and **js-yaml 4.3.2** installed outside this
repository (`npm install js-yaml@4.3.2 ajv ajv-formats` in another folder, then `NODE_PATH` set to its `node_modules`), so
it is not part of `npm test`. The answer depends on the js-yaml version (4.1 reads `1_000` as a number and 4.3 as a
string), so the tool stops unless the linter loads 4.3.2, the version this reader was compared with and follows
(`--any-js-yaml` runs it against another version anyway). It reports every difference except the documented ones below. Its last run, against js-yaml 4.3.2, compared 1,380 variants and found no difference other than the documented ones.

Documented differences:

- **Unsupported YAML** (front matter). Anchors, aliases and tags (`&x`, `*x`, `!!str`), wherever they stand, including in
  front of a second or later key (`&a version: 1`); complex keys (`? key` with `: value`, or `? key: value` on one line,
  also inside a flow collection: `[? a]`); a flow collection used as a key (`[a]: x`); a first line that starts with `---`, whatever
  follows it (`--- x`, `---#c`, `---x: 1`); and a `%` directive line (`%YAML 1.2`) are valid YAML (or an error of js-yaml's own)
  that this reader does not read. The front matter is then
  reported as "not checked here" (state "Not fully checked", never a success) and kept as text, unchanged and
  exportable; the form fields are not available for it and it is edited as YAML. It is not reported as invalid. "Unsupported"
  means only that this reader stops there: such a construct may still be invalid YAML (an unknown tag such as `!t`, an alias
  with no anchor such as `*a`, or text after a flow key that makes the line invalid), which the linter then reports and this
  tool does not.
- **Invalid YAML** (front matter) is worded differently (the reason text differs from js-yaml's), and a document written
  for YAML 1.1, for js-yaml 4.1 (numbers written with `_`, such as `1_000`, were numbers there and are strings from 4.3
  on), or for js-yaml 5's stricter JSON schema (`~` or `Null` read as strings) may differ.
- **A document that is only a block scalar with the indentation indicator 1** (`|1` or `>1`, with `-` or `+` before or after
  the digit) differs from js-yaml in its trailing line breaks (`>1`, then `z`: js-yaml `z ` with a blank, here `z` and a line
  break; `|-1` and two blank lines: js-yaml two line breaks, here nothing; `>-1`, then `x`: `x ` against `x`). It is not a
  mapping, so the schema rejects it either way.
- **Empty front matter**, or front matter of only comments, is read by js-yaml as `null` and here as nothing (undefined). The
  check reports "front matter is empty" for both.
- Comments inside the front matter are not kept.
- **Control characters are refused more widely than js-yaml refuses them.** A bell, a form feed or another C0 control
  anywhere in the front matter makes it invalid here, a comment included, where js-yaml ignores a comment. DEL, the C1
  controls, U+FFFE, U+FFFF and an unpaired surrogate are refused here inside a quoted value too, where js-yaml accepts
  them (written as an escape, such as `"\u007f"`, they are fine, and this tool writes them that way). An escape that names
  a code point above U+10FFFF (`"\U00110000"`) is refused here; js-yaml accepts it and reads two unpaired surrogates.
- **Keys.** An empty-key flow entry such as `[x, : ?:]` is reported here as unsupported, and js-yaml says it is invalid.
- **Many unknown or repeated sections.** The linter lists every unknown heading and every duplicate. This tool lists the
  first 20 of each and then one line, "and N more unknown sections" (or "duplicate"), so that a file with thousands of
  stray headings does not stall the page. The finding is the same; the list is shorter.
- **A line over 20,000 characters** is reported as one error, "line N is ... characters long", and nothing else is
  checked; the linter has no such limit. No real record has such a line. A record over 256 KB (counted in bytes) is
  refused on import, as it is by the file picker.

What the checks cannot do, as in the linter: judge whether each statement is testable. That stays a review decision.

## What import keeps

Every front matter value and section, word for word; the heading; comments between the heading and the first section.
Writing a record back out changes only layout: inline lists such as `decisions: [a, b]` become block lists, comments in
the YAML are dropped, and the blank lines between sections are normalised. Two more cases are written differently. A value
nested so deeply that block lines would pass js-yaml's limit of 100 levels is written in flow form. One that js-yaml reads
but that no form written here can hold keeps the whole front matter as text, as unsupported YAML does: a value about 100
levels deep when pairs in a flow list count (as few as 7 pair levels among the list levels is enough), 99 empty list entries
inside each other, or a value that would be longer than the page accepts when written as block lines (many entries at a
deep indent). An edit that makes such a value is undone with a message. And a string value over 4,000 characters, written
in block form, is written as a double-quoted value over several lines, each ending in a backslash, so that it does not come
back as one line over the 20,000 characters the page accepts (a long value that was folded from many lines would). Keys,
and values written in flow form (the deep ones above), are not wrapped: a key over 20,000 characters exports a line that
the page then refuses to load, and such a record is invalid anyway. Of the six bundled examples, the three Appointment
Booking records come back byte for byte; the three specification examples differ only in those ways. A file whose front
matter cannot be read is kept as text, byte for byte (trailing blank lines included; line endings become LF as the whole
file's do), and nothing is corrected on import. The checks of a file that has just been opened are those of the file as
it was opened, so a broken file shows its real failures. Writing a record out is not always neutral for the checks (an
empty optional section is left out, the first line of the text before the first section loses its indent, and closing
`#` marks of a heading are stripped twice, so `## Title ## #` comes back as `## Title ##`; a file with no front matter,
or an empty one, is written with front matter fields, so "no YAML front matter" or "front matter is empty" becomes the
findings about the required properties). Where the file as opened and the file as it would be saved give different
findings, the review and the checks panel say so, say what the file as it will be saved would get ("would conform" or
"would not conform" and the first findings), and go on showing the findings of the file as it was opened until something is
edited; from then on they are those of the record as it will be saved.

## Tests

```bash
npm test        # node --test: no dependencies
```

The tests run the specification's linter test cases against the browser port (all six worked examples must pass,
each broken variant must fail with the same message), round-trip every example, check that every bundled example is
tracked by git, exercise the flow generator, pattern data, prompts, checklist and markdown reader, and feed hostile and
very large input to the analysers. `tests/browser/sandbox-xss.html` is the in-browser check of the diagram sandbox.

## Layout

```
index.html                 the page; loads js/app.js as a module
css/styles.css             styles, light and dark
js/app.js                  boot, shell, host bar, router
js/store.js  js/limits.js  the draft: state, autosave to localStorage, size limit
js/model.js                record <-> markdown
js/lint.js  js/yaml.js  js/schema.js  js/formats.js   the conformance rules, YAML subset, ICR schema, date and uri formats
js/checklist.js  js/advice.js          checklist data and record state; advice beyond the rules
js/scaffold.js             section prompts; what choosing a pattern fills in
js/flow.js  js/mermaid.js  the flow generator; sandboxed diagram drawing
js/markdown.js             safe markdown reader for the preview
js/views/                  start, front matter, section, review, panel
js/data/                   patterns, guidance text, bundled examples
templates/                 the worked examples (.md), loaded on request
tests/                     node:test; tests/browser holds the in-browser sandbox test
tools/compare-with-linter.mjs   cross-check against the specification's linter
serve.mjs                  a zero-dependency static server
```

## Embedding this tool in another site

The builder is static files: `index.html`, `css/`, `js/` and `templates/` (the worked examples, fetched on request). There
is no server code and no build step. To serve it from another site, copy those four to any folder the site serves, for
example `/tools/icr-builder/`.
Keep `LICENSE` and `NOTICE` with the copy (the code is MIT and the bundled records and template-derived text are CC BY 4.0, which both ask for their notice to travel), or show the credit from the NOTICE (section 2) on the page that serves the tool.

- All paths are relative and routing is hash-based (`#/section/...`), so the folder can be anywhere and a `<base href>`
  pointing at it is safe. Serve it with `Cache-Control: no-cache`, so that an update shows without a hard reload.
- To draw a "back to the site" bar across the top, add these tags to the `<head>` of the copied `index.html`. Without
  them there is no bar:

```html
<meta name="tool-host-name" content="Your Site">                        <!-- required -->
<meta name="tool-host-href" content="/">                                 <!-- required: the site's home -->
<meta name="tool-host-link" content="Related page|/path/to/page">        <!-- optional, repeatable -->
```

- If the site sets a Content-Security-Policy, the builder needs `script-src 'self'` for its own modules,
  `https://cdn.jsdelivr.net` among the script sources for the diagram library (only fetched when someone presses a
  "Draw" button), `style-src 'unsafe-inline'` and `img-src data:`. **And it must allow inline scripts**
  (`script-src ... 'unsafe-inline'`). The diagram runs in a `srcdoc` frame, which inherits the host page's policy as well
  as its own; its bootstrap is an inline script that carries a fresh random nonce, and a host policy has no way to name a
  nonce it cannot know, so a host policy without `'unsafe-inline'` (for instance `script-src 'self'
  https://cdn.jsdelivr.net`) blocks the bootstrap and nothing is drawn. A `sandbox` directive on the host page without
  `allow-scripts` stops it too. A host policy that uses a nonce or a hash for its own scripts makes browsers ignore
  `'unsafe-inline'` in that directive, so Draw cannot work under such a policy at all. When it is blocked, the page says after about five seconds that the frame did not start
  and that a Content-Security-Policy on the hosting page is the usual cause; the diagram source and the numbered
  steps are still shown. (A host that cannot allow inline scripts can serve this tool from a page of its own without
  that policy, or leave the diagram unused: everything else works.)
- After copying, open the page, load a worked example, check the checklist shows no problems, and press **Draw the
  diagram** (Interaction flows) and **Draw the diagrams** (Preview): a sequence diagram should appear in each.

## Licence

The code is MIT. Copyright (c) 2026 David Tirabassi. See [LICENSE](LICENSE).

The bundled sample records (everything in `templates/`) and the text derived from the Integration Contract Record specification and template (the guidance in `js/data/guidance.js`, the schema copies in `js/schema.js` and `tests/fixtures/icr.schema.json`, the template copy `tests/fixtures/template.md`, and the section headings and prompt text named in the NOTICE in `js/lint.js` and `js/scaffold.js`) are not MIT. They are licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0), Copyright (c) 2026 David Tirabassi / IT Architecture Patterns. The specification (version 0.2, a draft) is not yet published; its template and schema, and the Appointment Booking sample from which three of the records are copied, are in [architecture-records](https://github.com/davtir78/architecture-records). You may copy, adapt and use them, including commercially, if you give credit and say what you changed. [NOTICE](NOTICE) names each file and string and gives the attribution. Keep `LICENSE` and `NOTICE` with any copy.

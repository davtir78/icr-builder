// Advice beyond the conformance rules.
//
// The six conformance rules (js/lint.js) are the specification's: they say whether the file is
// well formed. They cannot say whether each statement is testable, which the specification leaves
// to review. These checks catch some of the commonest ways a well-formed record is still unfinished.
// They are advice, shown apart from the checklist, and never change whether a record conforms.

import { fences, blank } from './lint.js';
import { diagramsIn, MAX_PARTICIPANTS } from './flow.js';

const KNOWN_TAGS = new Set(['b', 'i', 'u', 'p', 'a', 'br', 'hr', 'em', 'strong', 'code', 'pre', 'ul', 'ol', 'li', 'td', 'tr', 'th', 'table', 'div', 'span', 'details', 'summary', 'sub', 'sup', 'kbd', 'img', 'h1', 'h2', 'h3', 'h4']);
const PLACEHOLDER = /(?<![\w`])<(?![/!?])[^<>\n"=]{1,80}>/g;

/** Placeholders such as <n> or <the system that offers the interface> left in some text. */
export function placeholdersIn(text) {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[0]).filter((p) => !KNOWN_TAGS.has(p.slice(1, -1).trim().toLowerCase()));
}

function walkStrings(value, fn, path = '') {
  if (typeof value === 'string') fn(value, path);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, fn, `${path}/${i}`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walkStrings(v, fn, `${path}/${k}`);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Advice for a record. `analysis` is lint.analyze() of the record's markdown. */
export function advise(analysis) {
  const out = [];
  const add = (id, message, extra = {}) => out.push({ id, message, ...extra });
  const sec = (title) => analysis.sections.find((s) => s.title === title);

  // 1. prompts that were never replaced
  if (analysis.front && typeof analysis.front === 'object') {
    let n = 0;
    walkStrings(analysis.front, (s) => { if (/^<[^<>]*>$/.test(s.trim()) || placeholdersIn(s).length) n++; });
    if (n) add('placeholders', `Front matter: ${plural(n, 'value')} still hold a <placeholder> to replace.`, { field: 'front-matter', count: n });
  }
  for (const s of analysis.sections) {
    const n = placeholdersIn(s.content).length;
    if (n) add('placeholders', `${s.title}: ${plural(n, 'prompt')} in <angle brackets> still to replace.`, { section: s.title, count: n });
  }

  // 2. the flow
  const flows = sec('Interaction flows');
  if (flows?.content) {
    for (const d of diagramsIn(flows.content)) {
      if (d.participants.length > MAX_PARTICIPANTS) add('flow-size', `Interaction flows: a diagram has ${d.participants.length} participants; the specification asks for ${MAX_PARTICIPANTS} or fewer so it stays legible.`, { section: 'Interaction flows' });
    }
    const outside = blank(flows.content, fences(flows.content).map((b) => [b.start, b.end]));
    if (diagramsIn(flows.content).length && !/^[ \t]*\d+[.)][ \t]+\S/m.test(outside)) add('flow-steps', 'Interaction flows: add the same sequence as numbered steps under the diagram, for readers who cannot see it.', { section: 'Interaction flows' });
  }

  // 3. examples
  const examples = sec('Examples');
  if (examples?.content) {
    const n = fences(examples.content).length;
    if (n === 1) add('examples-error', 'Examples: only one example is given; the specification asks for the main exchange and the main error.', { section: 'Examples' });
  }

  // 4. acceptance criteria that do not say how they are proved
  const ac = sec('Acceptance criteria');
  if (ac?.content) {
    const items = ac.content.split('\n').filter((l) => /^[ \t]*\d+[.)][ \t]+\S/.test(l));
    const unproved = items.filter((l) => !/proved by|proof:|verified by/i.test(l)).length;
    if (items.length && unproved) add('criteria-proof', `Acceptance criteria: ${plural(unproved, 'criterion', 'criteria')} of ${items.length} say${unproved === 1 ? 's' : ''} no "Proved by:", so it is not clear how a test or check would show it.`, { section: 'Acceptance criteria' });
  }

  // 5. promises without a measurement point
  const levels = sec('Service levels');
  if (levels?.content && /\d\s*(%|ms\b|s\b|seconds|minutes|requests)/i.test(levels.content) && !/measured|at the (gateway|broker|queue|endpoint)|measurement/i.test(levels.content)) {
    add('service-measure', 'Service levels: an objective with no measurement point cannot be held to account; say where each is measured.', { section: 'Service levels' });
  }

  // 6. volumes with no number
  const interaction = sec('Interaction');
  if (interaction?.content) {
    const volume = interaction.content.split('\n').find((l) => /volume/i.test(l));
    if (volume && !/\d/.test(volume.replace(/<[^<>]*>/g, ''))) add('interaction-volume', 'Interaction: the volume line has no number; "real-time" or "high" cannot be tested.', { section: 'Interaction' });
  }

  // 7. consumers the parties section does not mention
  const parties = sec('Parties and responsibilities');
  if (parties?.content && Array.isArray(analysis.front?.consumers)) {
    const text = parties.content.toLowerCase();
    const missing = analysis.front.consumers.map((c) => c?.system).filter((s) => typeof s === 'string' && s.trim() && !text.includes(s.trim().toLowerCase()));
    if (missing.length) add('parties-missing', `Parties and responsibilities: ${missing.map((m) => `"${m}"`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} a consumer in the front matter but not named here.`, { section: 'Parties and responsibilities' });
  }
  return out;
}

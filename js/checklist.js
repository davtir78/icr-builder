// The conformance checklist: the linter's findings arranged for a person. Pure data, no DOM.
//
//   verdict   { ok, count }                      count = the number of messages the command-line linter would print
//   rules     the six conformance rules of the specification, each pass / fail / todo, with the linter's messages
//   fields    the twelve required front matter fields
//   sections  the 17 sections, in order, each pass / fail / todo / na
//
// "todo" means the rule cannot be judged yet because the section it is about is missing or empty.

import { RULES, SECTIONS } from './lint.js';
import { SECTION_GUIDE } from './data/guidance.js';

export const REQUIRED_FIELDS = [
  ['icr', 'icr (specification version)'], ['id', 'id'], ['title', 'title'], ['status', 'status'], ['version', 'version'], ['date', 'date'],
  ['pattern', 'pattern'], ['interaction', 'interaction'], ['provider', 'provider'], ['consumers', 'consumers'], ['interfaces', 'interfaces'], ['data', 'data'],
];

const PREREQUISITE = { criteria: 'Acceptance criteria', flows: 'Interaction flows', examples: 'Examples' };

export function buildChecklist(analysis) {
  const problems = analysis.problems;
  const sectionOf = (title) => analysis.sections.find((s) => s.title === title);
  const ready = (title) => Boolean(sectionOf(title)?.content);

  const rules = RULES.map((rule) => {
    const messages = problems.filter((p) => p.rule === rule.id).map((p) => p.message);
    let state = messages.length ? 'fail' : 'pass';
    if (!messages.length && PREREQUISITE[rule.id] && !ready(PREREQUISITE[rule.id])) state = 'todo';
    if (!messages.length && rule.id === 'frontmatter' && !analysis.hasFrontMatter) state = 'todo';
    if (!messages.length && rule.id === 'frontmatter' && analysis.unsupported) return { id: rule.id, label: rule.label, state: 'todo', messages: [`not checked here: the front matter uses ${analysis.unsupported}`] };
    return { id: rule.id, label: rule.label, state, messages };
  });

  const fmProblems = problems.filter((p) => p.rule === 'frontmatter');
  const fields = REQUIRED_FIELDS.map(([key, label]) => {
    const mine = fmProblems.filter((p) => p.field === key);
    let state = mine.length ? 'fail' : 'pass';
    if (!mine.length && (!analysis.hasFrontMatter || analysis.yamlError || analysis.front === undefined || analysis.front === null)) state = 'todo';
    return { key, label, state, messages: mine.map((p) => p.message) };
  });

  const sections = SECTIONS.map(([title, required]) => {
    const guide = SECTION_GUIDE.find((g) => g.title === title);
    const found = sectionOf(title);
    const mine = problems.filter((p) => p.section === title).map((p) => p.message);
    let state;
    if (mine.length) state = 'fail';
    else if (!found) state = required ? 'fail' : 'na';
    else if (!found.content) state = required ? 'fail' : 'na';
    else state = 'pass';
    return { title, slug: guide.slug, required, state, messages: mine, present: Boolean(found), empty: Boolean(found) && !found.content };
  });

  return { verdict: { ok: problems.length === 0 && !analysis.unsupported, count: problems.length }, rules, fields, sections };
}

/**
 * The one-line state of a record, used by the header badge, the checklist and the review step.
 *   fail        the linter would report problems
 *   unverified  the front matter uses YAML this tool cannot read, so it was not checked (the sections were)
 *   structural  nothing for the linter to report, but prompts from the builder are still in the text
 *   ok          nothing for the linter to report, and no prompts left
 * Only "ok" is shown as a success: a record made of inserted prompts is well formed, not finished.
 */
export function summarise(analysis, advice = []) {
  const n = analysis.problems.length;
  const prompts = advice.filter((a) => a.id === 'placeholders');
  const promptCount = prompts.reduce((sum, a) => sum + (a.count ?? 1), 0);
  if (n) return { state: 'fail', badge: `${n} ${n === 1 ? 'problem' : 'problems'}`, text: `${n} ${n === 1 ? 'problem' : 'problems'} the linter would report.` };
  if (analysis.unsupported) return { state: 'unverified', badge: 'Not fully checked', text: `The front matter uses YAML this tool cannot read (${analysis.unsupported}), so it was not checked here; the sections were.` };
  if (promptCount) return { state: 'structural', badge: 'Prompts left', text: `Well formed, but not finished: ${promptCount} ${promptCount === 1 ? 'prompt' : 'prompts'} in <angle brackets> across ${prompts.length} ${prompts.length === 1 ? 'section' : 'sections'} still to replace with your own statements.` };
  return { state: 'ok', badge: 'Conforms', text: 'Conforms to ICR v0.2: the linter would report nothing.' };
}

// The last step: what is left to fix, stray headings, and export.

import { h, announce, clear, confirmDialog } from '../ui.js';
import { copyText, downloadText } from '../files.js';
import { fileName, strayHeadings } from '../model.js';
import { sectionByTitle } from '../data/guidance.js';
import { summarise } from '../checklist.js';

export function createReviewView({ store }) {
  const root = h('div.view');
  const summary = h('div');
  const todo = h('div');
  const stray = h('div');

  const exportCard = h('div.card', {},
    h('h3', { text: 'Export' }),
    h('p', { id: 'export-name' }),
    h('div.btn-row', {},
      h('button.btn.btn-primary', { type: 'button', text: 'Download .md', onclick: () => { downloadText(fileName(store.model), store.markdown); announce(`Downloaded ${fileName(store.model)}.`); } }),
      h('button.btn', { type: 'button', text: 'Copy markdown', onclick: async () => announce((await copyText(store.markdown)) ? 'Markdown copied to the clipboard.' : 'Could not copy automatically. Use the Markdown tab and copy from there.') })),
    h('p.hint', { style: 'margin-top:10px', text: 'The file is written in the browser and never uploaded. The checklist applies the conformance rules of the ICR specification (v0.2, a draft).' }));

  root.append(h('h2', { tabindex: '-1', text: 'Review and export' }),
    h('p.lede', { text: 'Everything the linter would report, with a link to where it is fixed. Advice is shown apart: it does not affect whether the record conforms.' }),
    summary, todo, stray, exportCard);

  function linkFor(problem) {
    if (problem.rule === 'frontmatter') return { href: '#/front-matter', text: 'Front matter' };
    if (problem.section) { const g = sectionByTitle(problem.section); return g ? { href: `#/section/${g.slug}`, text: g.title } : null; }
    return null;
  }

  function render() {
    const a = store.analysis;
    clear(summary); clear(todo); clear(stray);
    const sum = summarise(a, store.advice);
    const LABEL = { fail: 'Not yet conforming', unverified: 'Not fully checked', structural: 'Well formed, not finished', ok: 'Conforms to ICR v0.2' };
    const KIND = { fail: 'danger', unverified: 'warn', structural: 'warn', ok: 'ok' };
    if (a.exportNote) summary.append(h('div.callout.warn', {}, h('p.callout-label', { text: 'The saved file will differ from the file you opened' }), h('p', { text: a.exportNote })));
    summary.append(h('div', { class: `callout ${KIND[sum.state]}` },
      h('p.callout-label', { text: LABEL[sum.state] }),
      h('p', { text: sum.state === 'ok' ? `${sum.text} Every required section is present, in order and not empty, the criteria are numbered, and the flow and examples are in place. Whether each statement is testable is for a reviewer to judge.` : sum.text })));
    if (a.problems.length) {
      todo.append(h('h3', { text: 'To fix' }), h('ul', {}, a.problems.map((p) => {
        const l = linkFor(p);
        return h('li', {}, p.message, l ? [' — ', h('a', { href: l.href, text: l.text })] : null);
      })));
    }
    const adv = store.advice;
    if (adv.length) {
      todo.append(h('h3', { text: 'Advice' }), h('ul', {}, adv.map((x) => {
        const g = x.section ? sectionByTitle(x.section) : null;
        return h('li', {}, g ? h('a', { href: `#/section/${g.slug}`, text: x.message }) : x.field === 'front-matter' ? h('a', { href: '#/front-matter', text: x.message }) : x.message);
      })));
    }
    const strays = strayHeadings(store.model).slice(0, 20);
    if (strays.length) {
      stray.append(h('div.callout.warn', {}, h('p.callout-label', { text: 'Headings the specification does not allow' }),
        h('p', { text: 'Level-2 headings must be the standard section names, each used once. Extra material goes under a ### sub-heading of the section it belongs to.' }),
        h('ul', {}, strays.map((s) => h('li', {}, h('code', { text: `## ${s.title}` }), s.duplicate ? ' appears more than once. ' : ' is not a section of the specification. ',
          h('button.btn.btn-sm', { type: 'button', text: `Remove this heading and its text`, 'aria-label': `Remove the heading ${s.title} and its text`, onclick: async () => {
            const ok = await confirmDialog({ title: 'Remove this heading?', body: `This deletes "## ${s.title}" and everything under it from the record. Move any text you want to keep into a section first.`, confirmLabel: 'Remove it', danger: true });
            if (!ok) return;
            store.change((m) => {
              const hit = strayHeadings(m).find((x) => x.title === s.title && x.duplicate === s.duplicate);
              if (hit) m.sections.splice(hit.index, 1);
            });
            announce('Heading removed.');
          } }))))));
    }
    root.querySelector('#export-name').textContent = `File name: ${fileName(store.model)}`;
  }
  render();
  return { el: root, heading: root.querySelector('h2'), update: render };
}

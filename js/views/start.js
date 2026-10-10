// Step 1: the interaction type, an optional pattern, and ways to start from something that exists.

import { h, announce, confirmDialog, uid } from '../ui.js';
import { selectField } from '../fields.js';
import { INTERACTIONS } from '../data/guidance.js';
import { PATTERNS, COMPONENTS, BOUNDARIES, patternById, patternsFor } from '../data/patterns.js';
import { EXAMPLES, FEATURED } from '../data/examples.js';
import { applyPattern, patternNote } from '../scaffold.js';
import { blankModel } from '../model.js';
import { fetchExample, readFile } from '../files.js';

export function createStartView({ store, go }) {
  const root = h('div.view');
  const interactionName = 'interaction';

  // ----- interaction type -----
  const choiceSet = h('fieldset', {},
    h('legend', { text: 'Interaction type' }),
    h('p.hint', { id: 'interaction-hint', text: 'The dominant style of the exchange. A contract does not mix styles: if two systems exchange data in two unrelated ways, write two contracts.' }),
    h('div.choice-grid', { role: 'radiogroup', 'aria-describedby': 'interaction-hint' }, INTERACTIONS.map((it) => {
      const input = h('input', { type: 'radio', name: interactionName, value: it.id, id: `int-${it.id}` });
      input.addEventListener('change', () => {
        if (!store.model.fm) { announce('The front matter could not be read. Fix it on the Front matter step first.'); return; }
        store.change((m) => { m.fm.interaction = it.id; });
        announce(`Interaction type set to ${it.label}.`);
        refreshPatternList();
      });
      return h('label.choice', { for: input.id }, input, h('span.choice-title', { text: it.label }), h('span.choice-text', { text: it.text }), h('span.choice-eg', { text: it.examples }));
    })));

  // ----- pattern -----
  const patternHost = h('div');
  const patternInfo = h('div', { 'aria-live': 'off' });
  let patternField;

  function patternOptions() {
    const current = store.model.fm?.interaction;
    const suggested = current ? patternsFor(current) : [];
    const groups = [];
    if (suggested.length) groups.push(h('optgroup', { label: `Suggested for ${INTERACTIONS.find((i) => i.id === current)?.label ?? current}` }, suggested.map((p) => h('option', { value: p.id, text: p.title }))));
    groups.push(...COMPONENTS.map((c) => h('optgroup', { label: c.name }, PATTERNS.filter((p) => p.component === c.slug).map((p) => h('option', { value: p.id, text: p.title })))));
    return groups;
  }

  function refreshPatternList() {
    const fm = store.model.fm ?? {};
    const value = typeof fm.pattern?.id === 'string' ? fm.pattern.id : '';
    const select = patternField.control;
    select.replaceChildren(h('option', { value: '', text: 'No pattern chosen' }), ...patternOptions());
    if (value && !patternById(value)) select.append(h('option', { value, text: `${value} (not in the list)` }));
    // The suggested group repeats options; the first match wins when the value is set.
    select.value = value;
  }

  patternField = selectField({
    label: 'Integration pattern (optional)', blankLabel: null, options: [],
    hint: 'Choosing a pattern sets the interaction type, names the pattern in the front matter, and fills any empty Interaction, Security, Service levels and Error handling sections with prompts that refer to it. Text you have already written is never replaced.',
    onChange: (id) => {
      if (!store.model.fm) { announce('The front matter could not be read. Fix it on the Front matter step first.'); return; }
      if (!id) {
        store.change((m) => { delete m.fm.pattern; });
        announce('Pattern removed from the front matter.');
        renderPatternInfo();
        return;
      }
      let result;
      store.change((m) => { result = applyPattern(m, id); });
      announce(`${result.pattern.title} chosen. Updated: ${result.changed.join(', ')}.${result.kept.length ? ' Left as you wrote it: ' + result.kept.join('; ') + '.' : ''}${result.stale.length ? ' Still holding prompts written for the previous choice, so check them: ' + result.stale.join(', ') + '.' : ''}`);
      renderPatternInfo();
      syncInteraction();
    },
  });
  patternHost.append(patternField.el, patternInfo);

  function renderPatternInfo() {
    const fm = store.model.fm ?? {};
    const p = typeof fm.pattern?.id === 'string' ? patternById(fm.pattern.id) : null;
    patternInfo.replaceChildren();
    if (!p) return;
    const note = patternNote(p.id);
    patternInfo.append(h('div.pattern-card', {},
      h('p', {}, h('strong', { text: p.title })),
      h('p', { text: `Boundary: ${BOUNDARIES.find((b) => b.id === p.boundary)?.label ?? p.boundary}. Suggested interaction: ${INTERACTIONS.find((i) => i.id === p.interaction)?.label}${p.alsoFits.length ? `; also reasonable: ${p.alsoFits.map((a) => INTERACTIONS.find((i) => i.id === a)?.label).join(', ')}` : ''}.` }),
      note ? h('p', { text: note }) : null,
      h('p', {}, h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Read the pattern page', h('span.sr-only', { text: ' (opens in a new tab)' }), h('span', { 'aria-hidden': 'true', text: ' ↗' })))));
  }

  function syncInteraction() {
    const v = store.model.fm?.interaction;
    root.querySelectorAll(`input[name="${interactionName}"]`).forEach((r) => { r.checked = r.value === v; });
  }

  // ----- start from something -----
  const fileInput = h('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  const exampleSelect = h('select', { id: 'example-select', 'aria-label': 'Other worked examples' }, EXAMPLES.filter((e) => !e.featured).map((e) => h('option', { value: e.file, text: `${e.id}: ${e.label}` })));
  const loadMessage = h('p.hint', { id: 'load-message', 'aria-live': 'polite' });

  async function replaceWith(produce, what) {
    if (!store.isPristine()) {
      const ok = await confirmDialog({
        title: 'Replace the draft?',
        body: ['This replaces the draft saved in this browser with ' + what + '.', 'Use "Download .md" first if you want to keep the current draft.'],
        confirmLabel: 'Replace the draft', danger: true,
      });
      if (!ok) return;
    }
    try {
      const out = await produce();
      loadMessage.textContent = '';
      announce(`Loaded ${what}.${out?.warnings?.length ? ' ' + out.warnings.join(' ') : ''}`);
      if (out?.warnings?.length) loadMessage.textContent = out.warnings.join(' ');
      syncInteraction(); refreshPatternList(); renderPatternInfo();
      if (out?.go) go(out.go);
    } catch (e) {
      const msg = /fetch|Failed to|NetworkError|load/i.test(e.message) && !/limit/.test(e.message)
        ? `Could not load ${what}: ${e.message}. If you opened index.html from disk, serve the folder over http instead (see the README).`
        : `Could not load ${what}: ${e.message}`;
      loadMessage.textContent = msg;
      announce(msg);
    }
  }

  const loadExample = (file, label) => replaceWith(async () => {
    const text = await fetchExample(file);
    return { ...store.loadMarkdown(text), go: 'front-matter' };
  }, label);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    replaceWith(async () => ({ ...store.loadMarkdown(await readFile(file)), go: 'review' }), `the file ${file.name}`);
  });

  const startCard = h('div.card', {},
    h('h3', { text: 'Start from something that exists' }),
    h('p.lede', { text: 'Each of these replaces the draft in this browser, after asking.' }),
    h('div.btn-row', {},
      h('button.btn.btn-primary', { type: 'button', onclick: () => loadExample(FEATURED.file, `the ${FEATURED.id} example (${FEATURED.label})`) }, `Load the Appointment Booking example (${FEATURED.id})`),
      h('button.btn', { type: 'button', onclick: () => fileInput.click() }, 'Open an ICR file…'),
      h('button.btn', { type: 'button', onclick: () => replaceWith(async () => { store.replace(blankModel()); return { go: null }; }, 'a new, empty record') }, 'Start a new empty record')),
    h('div.form-field', { style: 'margin-top:14px' },
      h('label', { for: 'example-select' }, 'Other worked examples'),
      h('div.btn-row', {}, exampleSelect,
        h('button.btn', { type: 'button', onclick: () => { const e = EXAMPLES.find((x) => x.file === exampleSelect.value); loadExample(e.file, `the ${e.id} example (${e.label})`); } }, 'Load the example'))),
    fileInput, loadMessage);

  const privacy = h('div.callout', {},
    h('p.callout-label', { text: 'Your work stays on this page' }),
    h('p.privacy', { text: 'The draft is saved in this browser only (localStorage) as you type. Nothing is sent anywhere: there is no server, no account and no analytics. Opened files are read in the browser and not uploaded. The page asks the server it came from only for its own files (and, when you choose "Load the example" or open a bundled example, for that example from its templates folder), and none of those requests carries your record. The one thing fetched from anywhere else is the Mermaid diagram library, from a public CDN, and only if you press a button to draw a diagram.' }),
    h('div.btn-row', { style: 'margin-top:10px' },
      h('button.btn.btn-danger.btn-sm', { type: 'button', id: 'clear-draft', text: 'Clear draft', onclick: async () => {
        const ok = await confirmDialog({
          title: 'Clear the draft?',
          body: ['This deletes the draft saved in this browser and starts a new, empty record. It cannot be undone.', 'Use "Download .md" first if you want to keep a copy.'],
          confirmLabel: 'Clear the draft', danger: true,
        });
        if (!ok) return;
        store.clearDraft();
        loadMessage.textContent = '';
        announce('Draft cleared. You have a new, empty record.');
        syncInteraction(); refreshPatternList(); renderPatternInfo();
      } })));

  root.append(
    h('h2', { tabindex: '-1', text: 'Start' }),
    h('p.lede', { text: 'An Integration Contract Record (ICR) is a short markdown document recording the agreement behind one integration. Choose how the systems exchange data, optionally pick an integration pattern, then work through the front matter and the 17 sections. The checklist on the right applies the same rules as the ICR linter as you type.' }),
    choiceSet, patternHost, startCard, privacy);

  refreshPatternList();
  renderPatternInfo();
  syncInteraction();

  return {
    el: root,
    heading: root.querySelector('h2'),
    update() {
      // keep the radios and the pattern in step with changes made elsewhere (the front matter step, a loaded file)
      syncInteraction();
      const want = typeof store.model.fm?.pattern?.id === 'string' ? store.model.fm.pattern.id : '';
      if (patternField.control.value !== want) { refreshPatternList(); renderPatternInfo(); }
    },
  };
}

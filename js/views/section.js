// Steps 3 to 19: one section of the ICR. Guidance from the specification, a text area, prompts to
// insert, an example from a worked ICR, and the checks that apply to this section.

import { h, announce, clear, debounce } from '../ui.js';
import { textareaField } from '../fields.js';
import { SECTION_GUIDE } from '../data/guidance.js';
import { INTERACTIONS } from '../data/guidance.js';
import { FEATURED } from '../data/examples.js';
import { getSection, setSection, fromMarkdown, sectionIndex } from '../model.js';
import { scaffoldFor } from '../scaffold.js';
import { fetchExample } from '../files.js';
import { buildFlow, defaultFlowOptions, FLOW_KINDS, MAX_PARTICIPANTS, diagramsIn } from '../flow.js';
import { drawDiagram, mermaidState } from '../mermaid.js';
import { lint } from '../lint.js';

let exampleCache = null;
async function exampleModel() {
  if (!exampleCache) exampleCache = fetchExample(FEATURED.file).then((t) => fromMarkdown(t).model);
  return exampleCache;
}

const PROMPT_LABEL = {
  'Parties and responsibilities': 'Build the table from the parties',
  'Interface specification': 'Build from the specifications',
  'Interaction flows': 'Insert the generated flow',
  'Support and escalation': 'Build the table from the parties',
};

export function createSectionView({ store, slug, go, index }) {
  const guide = SECTION_GUIDE.find((s) => s.slug === slug);
  const root = h('div.view');
  const title = guide.title;
  const stepNo = SECTION_GUIDE.indexOf(guide) + 1;

  const header = h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px' },
    h('p.lede', { style: 'margin:0', text: `Section ${stepNo} of ${SECTION_GUIDE.length}` }),
    h('span', { class: `badge ${guide.required ? 'badge-required' : 'badge-optional'}`, text: guide.required ? 'Required' : 'Optional' }));

  const guideBlock = h('div', {},
    h('div.callout', {}, h('p.callout-label', { text: 'Why this matters' }), h('p', { text: guide.why })),
    h('details.disclosure', { open: true }, h('summary', { text: 'What to write' }), h('div.disclosure-body', {}, h('ul.guide-list', {}, guide.points.map((p) => h('li', { text: p }))),
      guide.failure ? h('p', { style: 'margin:8px 0 0' }, h('strong', { text: 'Common failure: ' }), guide.failure) : null)));

  // ----- the text -----
  const textField = textareaField({
    label: `${title}${guide.required ? '' : ' (optional)'}`, value: getSection(store.model, title), rows: 10, required: guide.required,
    hint: guide.required ? 'Write short, testable statements. If something does not apply, say "Not applicable:" and why.' : 'Leave this empty to leave the section out of the file.',
    onInput: (v) => store.change((m) => setSection(m, title, v)),
  });
  const ta = textField.control;
  let touched = false;
  ta.addEventListener('blur', () => { touched = true; textField.setError(guide.required && !ta.value.trim() ? 'This section is required and is empty. If it does not apply, write "Not applicable:" and why.' : null); });

  const promptBtn = h('button.btn.btn-sm', { type: 'button', text: PROMPT_LABEL[title] ?? 'Insert prompts', onclick: insertPrompts });
  const toolbar = h('div.btn-row', { style: 'margin:-6px 0 12px' }, promptBtn);

  function setText(text, message) {
    ta.value = text;
    textField.fit();
    store.change((m) => setSection(m, title, text));
    ta.focus();
    announce(message);
  }
  function insertPrompts() {
    const fresh = title === 'Interaction flows' ? buildFlow(flowOptions).markdown : scaffoldFor(title, store.model);
    const current = ta.value;
    if (!current.trim()) setText(fresh, `Prompts inserted into ${title}. Replace each <angle-bracket> prompt with your own statement.`);
    else setText(`${current.trimEnd()}\n\n${fresh}`, `Prompts added at the end of ${title}.`);
  }

  // ----- example from a worked ICR -----
  const exampleBody = h('div.disclosure-body', {}, h('p.hint', { text: 'Loading the example…' }));
  const example = h('details.disclosure', {}, h('summary', { text: `See how ${FEATURED.id} (${FEATURED.label}) writes this` }), exampleBody);
  let exampleLoaded = false;
  example.addEventListener('toggle', async () => {
    if (!example.open || exampleLoaded) return;
    exampleLoaded = true;
    try {
      const m = await exampleModel();
      const text = getSection(m, title) || (sectionIndex(m, title) < 0 ? 'The example does not include this optional section.' : '(empty)');
      clear(exampleBody);
      exampleBody.append(h('pre.example-text', { tabindex: '0', role: 'region', 'aria-label': `Example text for ${title}`, text }),
        h('p.hint', { text: 'Fictional content from the Appointment Booking sample. Use it as a model for the style, not to copy.' }));
    } catch (e) {
      exampleLoaded = false;
      clear(exampleBody);
      exampleBody.append(h('p.err-msg', { text: `Could not load the example: ${e.message}. If you opened index.html from disk, serve the folder over http (see the README).` }));
    }
  });

  // ----- special helpers -----
  const extras = [];
  let flowOptions = defaultFlowOptions(store.model.fm, store.model.fm?.interaction);
  if (title === 'Interaction flows') extras.push(createFlowHelper());
  if (title === 'Acceptance criteria') extras.push(createCriteriaHelper());
  if (title === 'Open issues') extras.push(h('div.callout.warn', {}, h('p.callout-label', { text: 'Status rule' }), h('p', { text: 'A record with any open issue cannot have the status "agreed" or "active". Remove this section, or empty it, when nothing is open.' })));

  // ----- checks for this section -----
  const checks = h('div.section-checks', { 'aria-live': 'off' });
  function updateChecks() {
    clear(checks);
    const mine = store.analysis.problems.filter((p) => p.section === title);
    const advice = store.advice.filter((a) => a.section === title);
    const empty = !getSection(store.model, title).trim();
    if (!mine.length && !advice.length) {
      if (guide.required && !empty) checks.append(h('p.ok-msg', { style: 'color:var(--success)' }, '✓ ', 'No problems found in this section.'));
      return;
    }
    checks.append(h('h3', { text: 'Checks for this section', style: 'font-size:14px;margin:0' }),
      h('ul', {},
        mine.map((p) => h('li', {}, h('strong', { style: 'color:var(--danger)', text: 'Must fix: ' }), humanise(p.message))),
        advice.map((a) => h('li', {}, h('strong', { style: 'color:var(--warn)', text: 'Advice: ' }), a.message.replace(/^[^:]+: /, '')))));
  }
  function humanise(message) {
    if (/^required section ".*" is empty$/.test(message)) return `${title} is required and is still empty. If it truly does not apply, write "Not applicable:" and why.`;
    return message[0].toUpperCase() + message.slice(1) + '.';
  }

  // ----- previous / next -----
  const prev = SECTION_GUIDE[stepNo - 2];
  const next = SECTION_GUIDE[stepNo];
  const nav = h('div.step-nav', {},
    h('a.btn', { href: prev ? `#/section/${prev.slug}` : '#/front-matter' }, h('span', { 'aria-hidden': 'true', text: '← ' }), prev ? `Previous: ${prev.title}` : 'Previous: Front matter'),
    h('a.btn.btn-primary', { href: next ? `#/section/${next.slug}` : '#/review' }, next ? `Next: ${next.title}` : 'Next: Review and export', h('span', { 'aria-hidden': 'true', text: ' →' })));

  root.append(header, h('h2', { tabindex: '-1', text: title }), h('p.lede', { text: guide.summary }), guideBlock, textField.el, toolbar, example, ...extras, checks, nav);
  requestAnimationFrame(textField.fit);
  updateChecks();

  // ===== helpers =====

  function createCriteriaHelper() {
    const renumber = h('button.btn.btn-sm', {
      type: 'button', text: 'Number the list 1, 2, 3…',
      onclick: () => {
        let n = 0;
        const out = ta.value.split('\n').map((line) => {
          const m = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/.exec(line);
          return m ? `${m[1]}${++n}. ${m[2]}` : line;
        }).join('\n');
        setText(out, `${n} ${n === 1 ? 'item' : 'items'} numbered.`);
      },
    });
    const add = h('button.btn.btn-sm', {
      type: 'button', text: 'Add a criterion',
      onclick: () => {
        const n = ta.value.split('\n').filter((l) => /^\d+[.)][ \t]/.test(l)).length + 1;
        setText(`${ta.value.trimEnd()}${ta.value.trim() ? '\n' : ''}${n}. <a testable statement>. Proved by: <test, synthetic check or alert>.`, `Criterion ${n} added.`);
      },
    });
    return h('div.btn-row', { style: 'margin:-4px 0 12px' }, add, renumber, h('span.hint', { style: 'margin:0', text: 'The linter requires a numbered list: a bulleted item among numbered ones fails.' }));
  }

  function createFlowHelper() {
    const box = h('details.disclosure', { open: true }, h('summary', { text: 'Flow helper: start a sequence diagram from the parties' }));
    const body = h('div.disclosure-body');
    box.append(body);
    const preview = h('div.diagram', { 'aria-live': 'polite' });
    const steps = h('ol');
    const source = h('pre.example-text', { tabindex: '0', role: 'region', 'aria-label': 'Generated diagram source' });
    const warnings = h('p.err-msg', { hidden: true });
    let drawnEpoch = -1; // drawing needs a click for each record loaded: a loaded file is never drawn on its own

    const ctl = {};
    const mk = (key, label, hint, kind = 'text') => {
      const input = h('input', { id: `flow-${key}`, type: 'text', spellcheck: 'false', autocomplete: 'off' });
      input.value = flowOptions[key] ?? '';
      input.addEventListener('input', () => { flowOptions = { ...flowOptions, [key]: input.value }; refresh(); });
      ctl[key] = input;
      return h('div.form-field', {}, h('label', { for: input.id, text: label }), hint ? h('p.hint', { text: hint }) : null, input);
    };

    const kindSel = h('select', { id: 'flow-kind' }, INTERACTIONS.map((i) => h('option', { value: i.id, text: i.label })));
    kindSel.value = flowOptions.interaction;
    kindSel.addEventListener('change', () => {
      flowOptions = defaultFlowOptions(store.model.fm, kindSel.value);
      for (const k of ['provider', 'via', 'main', 'ok', 'fail']) ctl[k].value = flowOptions[k];
      viaBox.checked = flowOptions.useVia; failBox.checked = flowOptions.failure; logBox.checked = Boolean(flowOptions.logBased); consumersInput.value = flowOptions.consumers.join('\n'); senderSel.value = flowOptions.sender;
      labels();
      refresh();
    });
    const viaBox = h('input', { type: 'checkbox', id: 'flow-via-on' });
    viaBox.checked = flowOptions.useVia;
    viaBox.addEventListener('change', () => { flowOptions = { ...flowOptions, useVia: viaBox.checked }; refresh(); });
    const failBox = h('input', { type: 'checkbox', id: 'flow-fail-on' });
    failBox.checked = flowOptions.failure;
    failBox.addEventListener('change', () => { flowOptions = { ...flowOptions, failure: failBox.checked }; refresh(); });
    const logBox = h('input', { type: 'checkbox', id: 'flow-log-on' });
    logBox.checked = Boolean(flowOptions.logBased);
    logBox.addEventListener('change', () => { flowOptions = { ...flowOptions, logBased: logBox.checked }; refresh(); });
    const logWhy = h('p.hint', { id: 'flow-log-why', hidden: true, text: 'Switched off because no intermediary is drawn: a log-based stream is drawn through its broker. Tick "Show an intermediary" to use it.' });
    const logRow = h('div.form-field', {}, h('label', {}, logBox, ' A log-based stream: consumers read from an offset, and the consumer owns retries and the dead-letter topic'), logWhy);
    // The log-based option has no meaning without the intermediary, so it is disabled then, and says why.
    const syncLog = () => { logBox.disabled = !flowOptions.useVia; logBox.checked = Boolean(flowOptions.logBased) && flowOptions.useVia; /* shown unticked while it is switched off */ logWhy.hidden = flowOptions.useVia; if (logBox.disabled) logBox.setAttribute('aria-describedby', 'flow-log-why'); else logBox.removeAttribute('aria-describedby'); };
    const consumersInput = h('textarea', { id: 'flow-consumers', rows: 2, spellcheck: 'false', style: 'min-height:0;font-family:var(--font)' });
    consumersInput.value = flowOptions.consumers.join('\n');
    consumersInput.addEventListener('input', () => { flowOptions = { ...flowOptions, consumers: consumersInput.value.split('\n').map((s) => s.trim()).filter(Boolean) }; if (!flowOptions.consumers.length) flowOptions.consumers = ['Consumer']; refresh(); });
    const senderSel = h('select', { id: 'flow-sender' }, h('option', { value: 'consumer', text: 'The consumer sends to the provider' }), h('option', { value: 'provider', text: 'The provider sends to the consumer' }));
    senderSel.value = flowOptions.sender;
    senderSel.addEventListener('change', () => { flowOptions = { ...flowOptions, sender: senderSel.value }; refresh(); });
    const labelEls = {};
    const lbl = (key, base) => { labelEls[key] = h('label', { for: `flow-${key}`, text: base }); return labelEls[key]; };
    const labels = () => {
      const k = FLOW_KINDS[kindSel.value];
      labelEls.main.textContent = `${k.main[0]} (the main message)`;
      labelEls.ok.textContent = `${k.ok[0]} (when it works)`;
      labelEls.fail.textContent = `${k.fail[0]} (when it fails)`;
      senderRow.hidden = !['async-message', 'batch-file'].includes(kindSel.value);
      logRow.hidden = kindSel.value !== 'async-event';
    };

    const senderRow = h('div.form-field', {}, h('label', { for: 'flow-sender', text: 'Who sends first' }), senderSel);
    const mkLabeled = (key, base) => {
      const input = h('input', { id: `flow-${key}`, type: 'text', spellcheck: 'false', autocomplete: 'off' });
      input.value = flowOptions[key] ?? '';
      input.addEventListener('input', () => { flowOptions = { ...flowOptions, [key]: input.value }; refresh(); });
      ctl[key] = input;
      return h('div.form-field', {}, lbl(key, base), input);
    };

    body.append(
      h('p.hint', { text: 'Builds a starting diagram for the main exchange and the main failure, using the party names from the front matter, with an accTitle and accDescr and the same sequence in numbered steps. Edit the names below, insert it, then change the text to match your operations, events and errors.' }),
      h('div.form-field', {}, h('label', { for: 'flow-kind', text: 'Interaction' }), kindSel),
      h('div.form-row', {}, mk('provider', 'Provider system'), h('div.form-field', {}, h('label', { for: 'flow-consumers', text: 'Consumer systems (one per line)' }), consumersInput)),
      h('div.form-row', {},
        h('div.form-field', {}, h('label', {}, viaBox, ' Show an intermediary (gateway, broker or queue)'), ),
        mk('via', 'Intermediary name')),
      senderRow,
      mkLabeled('main', 'Main message'), mkLabeled('ok', 'Success'), mkLabeled('fail', 'Failure'),
      h('div.form-field', {}, h('label', {}, failBox, ' Draw the failure as an alt branch')),
      logRow,
      warnings,
      h('div.btn-row', { style: 'margin-bottom:10px' },
        h('button.btn.btn-sm.btn-primary', { type: 'button', text: 'Insert into the section', onclick: () => { const t = buildFlow(flowOptions).markdown; const cur = ta.value; setText(cur.trim() ? `${cur.trimEnd()}\n\n${t}` : t, 'Flow inserted into Interaction flows.'); } }),
        h('button.btn.btn-sm', { type: 'button', text: 'Replace the section with it', onclick: () => setText(buildFlow(flowOptions).markdown, 'Interaction flows replaced by the generated flow.') }),
        h('button.btn.btn-sm', { type: 'button', id: 'draw-flow', text: 'Draw the diagram', onclick: draw })),
      h('h3', { text: 'Steps', style: 'font-size:14px' }), steps,
      h('h3', { text: 'Diagram', style: 'font-size:14px' }), preview,
      h('details.disclosure', {}, h('summary', { text: 'Diagram source' }), h('div.disclosure-body', {}, source)));

    function refresh() {
      syncLog();
      const f = buildFlow(flowOptions);
      clear(steps); f.steps.forEach((s) => steps.append(h('li', { text: s })));
      source.textContent = f.mermaid;
      warnings.hidden = !f.warnings.length;
      warnings.textContent = f.warnings.join(' ');
      if (drawnEpoch === store.epoch) drawSoon(); else { clear(preview); preview.append(h('p.hint', { text: `The steps above always work. "Draw the diagram" fetches the Mermaid library from cdn.jsdelivr.net and draws it in an isolated frame (the record is not sent anywhere else). A diagram has at most ${MAX_PARTICIPANTS} participants.` })); }
    }
    const drawSoon = debounce(() => draw(), 600); // each drawing loads the library into a new frame, so not on every keystroke
    let drawToken = 0;
    async function draw() {
      if (!preview.isConnected) return; // the person has left this step: there is nowhere to draw
      const token = ++drawToken;
      drawnEpoch = store.epoch;
      const f = buildFlow(flowOptions);
      clear(preview);
      // The holder goes into the page BEFORE the drawing starts: a browser loads an iframe only once it is in the
      // document, so a frame drawn into a detached element would never finish.
      const wait = h('p.hint', { text: mermaidState.status === 'ready' ? 'Drawing…' : 'Loading the diagram library…' });
      const holder = h('div');
      preview.append(wait, holder);
      try {
        await drawDiagram(holder, f.mermaid);
        if (token !== drawToken) return;
        wait.remove();
      } catch (e) {
        if (token !== drawToken) return;
        clear(preview); preview.append(h('p.diagram-fail', { text: e.message || 'The diagram could not be drawn.' }));
      }
    }
    labels();
    refresh();
    // keep the flow's party names in step with the front matter until the person edits them here
    box.refreshFromFront = () => {
      if (box.contains(document.activeElement)) return;
      const fresh = defaultFlowOptions(store.model.fm, flowOptions.interaction);
      if (fresh.provider !== flowOptions.provider || fresh.consumers.join() !== flowOptions.consumers.join()) {
        flowOptions = { ...flowOptions, provider: fresh.provider, consumers: fresh.consumers };
        ctl.provider.value = fresh.provider; consumersInput.value = fresh.consumers.join('\n');
        refresh();
      }
    };
    return box;
  }

  return {
    el: root,
    heading: root.querySelector('h2'),
    update() {
      // If the text changed elsewhere (a prompt applied from another step), show it.
      const stored = getSection(store.model, title);
      if (document.activeElement !== ta && ta.value !== stored) { ta.value = stored; textField.fit(); }
      updateChecks();
      // The field itself complains only once the person has been in it and left it empty; the checklist always lists it.
      textField.setError(guide.required && touched && !ta.value.trim() ? 'This section is required and is empty. If it does not apply, write "Not applicable:" and why.' : null);
      extras.forEach((e) => e.refreshFromFront && e.refreshFromFront());
    },
  };
}

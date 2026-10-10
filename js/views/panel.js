// The right-hand panel: the live conformance checklist, the rendered preview, and the markdown source.

import { h, clear, announce, debounce } from '../ui.js';
import { buildChecklist, summarise } from '../checklist.js';
import { splitDocument } from '../lint.js';
import { sectionByTitle } from '../data/guidance.js';
import { parseMarkdown, renderBlocks } from '../markdown.js';
import { copyText, downloadText } from '../files.js';
import { fileName } from '../model.js';
import { drawDiagram, mermaidState } from '../mermaid.js';
import { parseYaml } from '../yaml.js';

const GLYPH = { pass: '✓', fail: '✗', todo: '•', na: '–' };
const WORD = { pass: 'Pass', fail: 'Fail', todo: 'Not yet', na: 'Optional' };

const flatten = (value, prefix = '', out = []) => {
  if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${prefix}[${i + 1}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  else out.push([prefix, value === null ? 'null' : String(value)]);
  return out;
};

export function createPanel({ store }) {
  const root = h('aside.panel', { id: 'panel', 'aria-label': 'Checks, preview and markdown' });
  const tabs = [
    { id: 'checklist', label: 'Checklist' },
    { id: 'preview', label: 'Preview' },
    { id: 'markdown', label: 'Markdown' },
  ];
  let active = 'checklist';

  const verdictBadge = h('span.badge.badge-fail', { text: '' });
  const copyBtn = h('button.btn.btn-sm', { type: 'button', text: 'Copy markdown', onclick: async () => {
    const ok = await copyText(store.markdown);
    announce(ok ? 'Markdown copied to the clipboard.' : 'Could not copy automatically. Select the text in the Markdown tab and copy it.');
  } });
  const dlBtn = h('button.btn.btn-sm.btn-primary', { type: 'button', text: 'Download .md', onclick: () => {
    downloadText(fileName(store.model), store.markdown);
    announce(`Downloaded ${fileName(store.model)}.`);
  } });

  const tablist = h('div.tabs', { role: 'tablist', 'aria-label': 'Panel views' }, tabs.map((t) => h('button.tab', {
    type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'panel-body', 'aria-selected': String(t.id === active), tabindex: t.id === active ? '0' : '-1', text: t.label,
    onclick: () => select(t.id, false),
    onkeydown: (e) => {
      const i = tabs.findIndex((x) => x.id === active);
      let n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      if (n !== null) { e.preventDefault(); select(tabs[n].id, true); }
    },
  })));
  const body = h('div.panel-body', { id: 'panel-body', role: 'tabpanel', 'aria-labelledby': `tab-${active}`, tabindex: '0' });
  root.append(h('div.panel-head', {}, h('div.panel-title-row', {}, h('h2', { text: 'Checks and preview' }), verdictBadge, copyBtn, dlBtn), tablist), body);

  function select(id, focus) {
    active = id;
    tablist.querySelectorAll('.tab').forEach((b) => {
      const on = b.id === `tab-${id}`;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    body.setAttribute('aria-labelledby', `tab-${id}`);
    render();
  }

  // ----- checklist -----
  function renderChecklist() {
    const c = buildChecklist(store.analysis);
    const adviceItems = store.advice;
    const row = (state, content) => h('li', {}, h('span', { class: `check-ico ${state}`, 'aria-hidden': 'true', text: GLYPH[state] }), h('span.sr-only', { text: `${WORD[state]}: ` }), h('span.check-text', {}, content));
    const detail = (messages) => messages.map((m) => h('span.check-detail', { text: m }));

    clear(body);
    const sum = summarise(store.analysis, adviceItems);
    body.append(h('div', { class: `verdict ${sum.state}` },
      h('span', { 'aria-hidden': 'true', text: { ok: '✓', fail: '✗', structural: '!', unverified: '?' }[sum.state] }),
      h('span', { text: sum.text })));

    if (store.analysis.exportNote) body.append(h('p.hint', { text: store.analysis.exportNote }));

    body.append(h('section.check-group', { 'aria-labelledby': 'cg-rules' }, h('h3', { id: 'cg-rules', text: 'The six conformance rules' }),
      h('ul.check-list', {}, c.rules.map((r, i) => row(r.state, [`${i + 1}. ${r.label}`, ...detail(r.messages)])))));

    body.append(h('section.check-group', { 'aria-labelledby': 'cg-fields' }, h('h3', { id: 'cg-fields', text: 'Required front matter' }),
      h('ul.check-list', {}, c.fields.map((f) => row(f.state, [h('a', { href: '#/front-matter', text: f.label }), ...detail(f.messages)])))));

    body.append(h('section.check-group', { 'aria-labelledby': 'cg-sections' }, h('h3', { id: 'cg-sections', text: 'Sections' }),
      h('ul.check-list', {}, c.sections.map((s) => row(s.state, [
        h('a', { href: `#/section/${s.slug}`, text: s.title }), h('span', { class: 'check-detail', style: 'font-family:var(--font)', text: s.required ? ' (required)' : ' (optional)' }),
        ...(s.state === 'fail' && !s.messages.length ? [h('span.check-detail', { text: s.present ? 'present, but empty' : 'missing' })] : []),
        ...detail(s.messages)])))));

    const adv = h('details.disclosure', { open: adviceItems.length > 0 && adviceItems.length <= 12 }, h('summary', { text: `Advice beyond the rules (${adviceItems.length})` }),
      h('div.disclosure-body', {}, adviceItems.length
        ? [h('p.hint', { text: 'The linter cannot judge whether a statement is testable, which the specification leaves to review. These checks are only advice and never affect whether the record conforms.' }),
          h('ul.check-list.advice-list', {}, adviceItems.map((a) => row('todo', [a.section ? h('a', { href: `#/section/${sectionByTitle(a.section)?.slug ?? 'purpose'}`, text: a.message }) : a.field === 'front-matter' ? h('a', { href: '#/front-matter', text: a.message }) : a.message])))]
        : h('p.hint', { text: 'Nothing to add.' })));
    body.append(adv);
  }

  // ----- preview -----
  const previewNow = () => { if (active === 'preview') renderPreview(); };
  const renderPreviewFast = debounce(previewNow, 150);
  const renderPreviewSlow = debounce(previewNow, 700); // while diagrams are drawn, each redraw loads the library again
  const renderPreviewSoon = () => (drawnEpoch === store.epoch ? renderPreviewSlow() : renderPreviewFast());
  let drawing = 0;
  // Diagrams are drawn only after a click, and a click holds for the record that was on screen: loading a
  // file (or clearing the draft) starts a new epoch, so a crafted file is never drawn without its own click.
  let drawnEpoch = -1;
  function renderPreview() {
    const text = store.markdown;
    const doc = splitDocument(text);
    clear(body);
    const bar = h('div.diagram-bar', { style: 'margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
      h('button.btn.btn-sm', { type: 'button', id: 'draw-all', text: 'Draw the diagrams', onclick: () => { drawnEpoch = store.epoch; drawAll(); } }),
      h('span.hint', { id: 'draw-note', style: 'margin:0', text: 'Diagrams show as source until you draw them. Drawing loads the Mermaid library from cdn.jsdelivr.net and runs it in an isolated frame; the record is not sent anywhere.' }));
    const view = h('div.preview');
    body.append(bar, view);
    if (!doc) { view.append(h('p', { text: 'No front matter to show.' })); return; }
    let front;
    try { front = parseYaml(doc.yaml); } catch { front = undefined; }
    if (front && typeof front === 'object') {
      view.append(h('table.front-matter', {}, h('caption', { text: 'Front matter' }),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Field' }), h('th', { scope: 'col', text: 'Value' }))),
        h('tbody', {}, flatten(front).map(([k, v]) => h('tr', {}, h('th', { scope: 'row', text: k }), h('td', { text: v }))))));
    }
    try {
    view.append(renderBlocks(document, parseMarkdown(doc.body), { onCode: (b, pre) => {
      if (b.lang !== 'mermaid') return null;
      const wrap = h('figure.diagram', { style: 'margin:10px 0', 'data-mermaid': '1' }, pre);
      wrap._source = b.text;
      return wrap;
    } }));
    } catch (e) { view.append(h('p.err-msg', { text: 'The preview could not be drawn for this text. The Markdown tab shows it as written.' })); }
    if (drawnEpoch === store.epoch) drawAll();
  }
  async function drawAll() {
    const token = ++drawing;
    const figs = [...body.querySelectorAll('figure.diagram[data-mermaid]')];
    const note = body.querySelector('#draw-note');
    if (!figs.length) { if (note) note.textContent = 'There are no Mermaid diagrams to draw.'; return; }
    if (note) note.textContent = mermaidState.status === 'ready' ? 'Drawing…' : 'Loading the diagram library…';
    for (const fig of figs) {
      // The holder goes into the page BEFORE the drawing starts: a browser loads an iframe only once it is in the
      // document, so a frame drawn into a detached element would never finish. The source stays below while it loads.
      const wait = h('p.hint', { text: 'Drawing this diagram…' });
      const holder = h('div.diagram-holder', {}, wait);
      fig.prepend(holder);
      try {
        await drawDiagram(holder, fig._source);
        if (token !== drawing || !document.contains(fig)) { holder.remove(); return; }
        wait.remove();
        // The frame must not be moved: a browser reloads an iframe that is removed and inserted again, and the
        // drawing would be lost. So only the source is moved, into a disclosure after it.
        const pre = fig.querySelector('pre');
        fig.append(h('details.disclosure', {}, h('summary', { text: 'Diagram source' }), h('div.disclosure-body', {}, pre)));
      } catch (e) {
        holder.remove();
        if (token !== drawing) return;
        if (note) note.textContent = '';
        fig.append(h('p.diagram-fail', { text: e.message || 'This diagram could not be drawn. The source is shown above.' }));
        break;
      }
    }
    if (note && token === drawing) note.textContent = '';
  }

  // ----- markdown -----
  function renderMarkdownTab() {
    clear(body);
    body.append(h('p.hint', { text: 'This is exactly what Download and Copy produce.' }), h('pre.md-source', { tabindex: '0', 'aria-label': 'ICR markdown', text: store.markdown }));
  }

  function render() {
    if (active === 'checklist') renderChecklist();
    else if (active === 'preview') renderPreview();
    else renderMarkdownTab();
  }

  return {
    el: root,
    select,
    render,
    /** Called when the record changes. */
    update() {
      const sum = summarise(store.analysis, store.advice);
      verdictBadge.className = `badge badge-${sum.state}`;
      verdictBadge.textContent = sum.badge;
      if (root.offsetParent === null) return; // hidden (the drawer is closed): drawn when it opens
      if (active === 'preview') renderPreviewSoon(); else render();
    },
    redrawForTheme() { if (active === 'preview' && drawnEpoch === store.epoch) renderPreview(); },
  };
}

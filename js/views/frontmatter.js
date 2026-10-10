// Step 2: the front matter. Every field has a label, a hint saying what belongs there and why, and
// shows the schema's finding for it (in plain words) as soon as the value is wrong.

import { h, announce, clear } from '../ui.js';
import { textField, selectField, textareaField, friendly } from '../fields.js';
import { INTERACTIONS, STATUSES, INTERFACE_TYPES, FIELD_HELP } from '../data/guidance.js';
import { getPath, setPath, FM_ORDER } from '../model.js';
import { dumpYaml, parseYaml } from '../yaml.js';

const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

export function createFrontMatterView({ store }) {
  const root = h('div.view');
  /** [{ path: ['provider','system'], label, field }] so findings can be shown against the field they are about */
  let bound = [];

  const fm = () => store.model.fm;
  const edit = (path, value) => store.change((m) => { if (m.fm) setPath(m.fm, path, value); });
  const reg = (path, label, f) => { bound.push({ path, label, field: f }); return f.el; };

  function problemsFor(path) {
    const target = '/' + path.join('/');
    return store.analysis.problems.filter((p) => p.rule === 'frontmatter' && p.path !== undefined && (p.path === target || (p.keyword === 'required' && `${p.path}/${p.params.missingProperty}` === target)));
  }

  function updateErrors() {
    for (const { path, label, field } of bound) {
      const ps = problemsFor(path);
      field.setError(ps.length ? friendly(ps[0], label) : null);
    }
    const unknown = store.analysis.problems.filter((p) => p.rule === 'frontmatter' && p.keyword === 'additionalProperties');
    extraNote.hidden = !unknown.length;
    extraNote.replaceChildren(...(unknown.length ? [h('p.callout-label', { text: 'Properties the schema does not allow' }), h('p', { text: 'The front matter has a property outside the specification: ' + unknown.map((p) => `${p.params.additionalProperty}${p.path ? ` (in ${p.path})` : ''}`).join(', ') + '. Remove it under "Edit the front matter as YAML".' })] : []));
    const icr = fm()?.icr;
    versionNote.hidden = icr === '0.2' || icr === undefined;
  }

  function repeatRows({ legend, hint, key, template, rowFields, addLabel, minRows = 0, itemName }) {
    const set = h('fieldset', {}, h('legend', { text: legend }), hint ? h('p.hint', { text: hint }) : null);
    const rowsHost = h('div');
    const add = h('button.btn.btn-sm', { type: 'button', text: addLabel });
    function render(focusLast) {
      // drop the registrations that belonged to the rows being replaced
      bound = bound.filter((b) => !(b.path[0] === key));
      clear(rowsHost);
      const list = Array.isArray(fm()?.[key]) ? fm()[key] : [];
      list.forEach((_, i) => {
        const fields = rowFields(i);
        rowsHost.append(h('div.repeat-row', { role: 'group', 'aria-label': `${itemName} ${i + 1}` },
          h('div.row-head', {}, h('span', { text: `${itemName} ${i + 1}` }),
            h('button.btn.btn-sm.btn-ghost', {
              type: 'button', 'aria-label': `Remove ${itemName.toLowerCase()} ${i + 1}`, text: 'Remove',
              onclick: () => {
                store.change((m) => { m.fm[key].splice(i, 1); if (key === 'consumers' && m.fm[key].length === 0) m.fm[key].push({}); });
                render(false);
                add.focus();
                announce(`${itemName} ${i + 1} removed.`);
              },
            })),
          h('div.form-row', {}, fields.map((f) => reg(f.path, f.label, f.field)))));
      });
      if (focusLast) rowsHost.querySelector('.repeat-row:last-child input, .repeat-row:last-child select')?.focus();
      updateErrors();
    }
    add.addEventListener('click', () => { store.change((m) => { if (!Array.isArray(m.fm[key])) m.fm[key] = []; m.fm[key].push(structuredClone(template)); }); render(true); });
    set.append(rowsHost, h('div.btn-row', {}, add));
    return { el: set, render };
  }

  // ----- the pieces -----
  const rawYaml = h('textarea', { id: 'fm-yaml', rows: 12, spellcheck: 'false', 'aria-describedby': 'fm-yaml-hint' });
  const yamlError = h('p.err-msg', { id: 'fm-yaml-err', role: 'alert', hidden: true });
  const extraNote = h('div.callout.danger', { hidden: true });
  const versionNote = h('div.callout.warn', {}, h('p.callout-label', { text: 'Specification version' }), h('p', { text: 'This record says it follows another version of the specification. This tool and the schema accept only ICR 0.2.' }),
    h('p', {}, h('button.btn.btn-sm', { type: 'button', text: 'Set it to 0.2', onclick: () => { edit(['icr'], '0.2'); announce('Specification version set to 0.2.'); } })));
  versionNote.hidden = true;

  function yamlText() { return fm() ? dumpYaml(fm(), { order: FM_ORDER }) : (store.model.fmRaw ?? ''); }
  function loadYaml() { rawYaml.value = yamlText(); yamlError.hidden = true; }
  const applyYaml = () => {
    try {
      const value = parseYaml(rawYaml.value);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('the front matter must be a set of "key: value" lines');
      store.change((m) => { m.fm = value; m.fmRaw = ''; });
      yamlError.hidden = true;
      announce('Front matter replaced from the YAML.');
      build();
    } catch (e) {
      yamlError.textContent = `Not applied: ${e.reason || e.message}`;
      yamlError.hidden = false;
    }
  };

  function build() {
    clear(root);
    bound = [];
    const f = fm();
    root.append(h('h2', { tabindex: '-1', text: 'Front matter' }),
      h('p.lede', { text: 'The facts a tool needs to read the record: who, what, which version, and where the interface is specified. These become the YAML block at the top of the file and are checked against the ICR schema.' }));

    if (!f) {
      root.append(h('div.callout.danger', {}, h('p.callout-label', { text: 'The front matter could not be read' }),
        h('p', { text: 'It is kept as text so nothing is lost. Correct it below, then press "Apply YAML" and the form fields appear.' })));
    } else {
      root.append(versionNote, extraNote);

      // identity
      const identity = h('fieldset', {}, h('legend', { text: 'The record' }),
        h('div.form-row', {},
          reg(['id'], 'The id', textField({ label: 'Id', required: true, value: str(f.id), placeholder: 'ICR-0001', hint: `${FIELD_HELP.id.hint} For example ${FIELD_HELP.id.example}.`, onInput: (v) => edit(['id'], v.trim()) })),
          reg(['version'], 'The version', textField({ label: 'Version of this contract', required: true, value: str(f.version), placeholder: '1.0.0', hint: FIELD_HELP.version.hint, onInput: (v) => edit(['version'], v.trim()) }))),
        reg(['title'], 'The title', textField({ label: 'Title', required: true, value: str(f.title), placeholder: 'Partner booking API', hint: FIELD_HELP.title.hint, onInput: (v) => edit(['title'], v) })),
        h('div.form-row', {},
          reg(['status'], 'The status', selectField({ label: 'Status', required: true, value: str(f.status), options: STATUSES.map((s) => ({ value: s.id, label: `${s.id}: ${s.text}` })), hint: FIELD_HELP.status.hint + ' ' + FIELD_HELP.status.why, onChange: (v) => edit(['status'], v) })),
          reg(['date'], 'The date', textField({ label: 'Date of this version', required: true, value: str(f.date), placeholder: 'YYYY-MM-DD', hint: FIELD_HELP.date.hint, onInput: (v) => edit(['date'], v.trim()) }))));

      // pattern and interaction
      const pattern = h('fieldset', {}, h('legend', { text: 'Pattern and interaction' }),
        h('p.hint', { text: 'Pick a pattern on the Start step to fill these in together with prompts for the sections; they can also be edited here.' }),
        h('div.form-row', {},
          reg(['pattern', 'id'], 'The pattern id', textField({ label: 'Pattern id', required: true, value: str(getPath(f, ['pattern', 'id'])), placeholder: 'int-api-external', hint: FIELD_HELP.pattern.hint, onInput: (v) => edit(['pattern', 'id'], v.trim()) })),
          reg(['pattern', 'url'], 'The pattern link', textField({ label: 'Pattern link', type: 'url', value: str(getPath(f, ['pattern', 'url'])), placeholder: 'https://www.itarchitecturepatterns.net/patterns/int-api-external', hint: 'The page that describes the pattern.', onInput: (v) => edit(['pattern', 'url'], v.trim()) }))),
        reg(['interaction'], 'The interaction', selectField({ label: 'Interaction type', required: true, value: str(f.interaction), options: INTERACTIONS.map((i) => ({ value: i.id, label: `${i.id}: ${i.label}` })), hint: FIELD_HELP.interaction.hint, onChange: (v) => edit(['interaction'], v) })));

      // provider
      const provider = h('fieldset', {}, h('legend', { text: 'Provider (the system that offers the interface)' }),
        h('p.hint', { text: FIELD_HELP.provider.hint }),
        h('div.form-row', {},
          reg(['provider', 'system'], 'The provider system', textField({ label: 'System', required: true, value: str(getPath(f, ['provider', 'system'])), placeholder: 'Reservations Service', onInput: (v) => edit(['provider', 'system'], v) })),
          reg(['provider', 'owner'], 'The provider owner', textField({ label: 'Accountable team', required: true, value: str(getPath(f, ['provider', 'owner'])), placeholder: 'Guest Platforms team', onInput: (v) => edit(['provider', 'owner'], v) })),
          reg(['provider', 'contact'], 'The provider contact', textField({ label: 'Contact', value: str(getPath(f, ['provider', 'contact'])), placeholder: 'guest-platforms@example.org', onInput: (v) => edit(['provider', 'contact'], v) }))));

      // consumers
      const consumers = repeatRows({
        legend: 'Consumers (systems that use the interface)', hint: FIELD_HELP.consumers.hint, key: 'consumers', template: {}, itemName: 'Consumer', addLabel: 'Add a consumer',
        rowFields: (i) => [
          { path: ['consumers', i, 'system'], label: 'The consumer system', field: textField({ label: 'System', required: true, value: str(getPath(f, ['consumers', i, 'system'])), placeholder: 'Online travel agency partners', onInput: (v) => edit(['consumers', i, 'system'], v) }) },
          { path: ['consumers', i, 'owner'], label: 'The consumer owner', field: textField({ label: 'Accountable team', required: true, value: str(getPath(f, ['consumers', i, 'owner'])), placeholder: 'Partner Integrations team', onInput: (v) => edit(['consumers', i, 'owner'], v) }) },
          { path: ['consumers', i, 'contact'], label: 'The consumer contact', field: textField({ label: 'Contact', value: str(getPath(f, ['consumers', i, 'contact'])), placeholder: 'partners@example.org', onInput: (v) => edit(['consumers', i, 'contact'], v) }) },
        ],
      });

      // interfaces
      const interfaces = repeatRows({
        legend: 'Interface specifications', hint: FIELD_HELP.interfaces.hint, key: 'interfaces', template: {}, itemName: 'Specification', addLabel: 'Add a specification',
        rowFields: (i) => [
          { path: ['interfaces', i, 'type'], label: 'The type', field: selectField({ label: 'Type', required: true, value: str(getPath(f, ['interfaces', i, 'type'])), options: INTERFACE_TYPES.map((t) => ({ value: t.id, label: t.text })), onChange: (v) => edit(['interfaces', i, 'type'], v) }) },
          { path: ['interfaces', i, 'ref'], label: 'The location', field: textField({ label: 'Location (path or link)', required: true, value: str(getPath(f, ['interfaces', i, 'ref'])), placeholder: './specs/booking-api.openapi.yaml', onInput: (v) => edit(['interfaces', i, 'ref'], v) }) },
          { path: ['interfaces', i, 'version'], label: 'The version', field: textField({ label: 'Version', value: str(getPath(f, ['interfaces', i, 'version'])), placeholder: '2.3.0', onInput: (v) => edit(['interfaces', i, 'version'], v) }) },
        ],
      });

      // data
      const datalist = h('datalist', { id: 'classification-list' }, ['OFFICIAL', 'OFFICIAL:Sensitive', 'PROTECTED', 'Public', 'Internal', 'Confidential', 'Commercial-in-confidence'].map((c) => h('option', { value: c })));
      const piState = getPath(f, ['data', 'personal-information']);
      const data = h('fieldset', {}, h('legend', { text: 'Data' }), datalist,
        h('div.form-row', {},
          reg(['data', 'classification'], 'The classification', textField({ label: 'Classification', required: true, value: str(getPath(f, ['data', 'classification'])), list: 'classification-list', placeholder: 'OFFICIAL', hint: `${FIELD_HELP.classification.hint} ${FIELD_HELP.classification.why}`, onInput: (v) => edit(['data', 'classification'], v) })),
          reg(['data', 'personal-information'], 'Whether personal information crosses', selectField({
            label: 'Does personal information cross this interface?', required: true, value: piState === true ? 'true' : piState === false ? 'false' : '', hint: FIELD_HELP.personalInformation.why,
            options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], onChange: (v) => edit(['data', 'personal-information'], v === 'true' ? true : v === 'false' ? false : undefined),
          }))));

      // optional
      const decisions = Array.isArray(f.decisions) ? f.decisions.join('\n') : '';
      const optional = h('fieldset', {}, h('legend', { text: 'Optional' }),
        reg(['decisions'], 'The decisions', textareaField({ label: 'Related decisions (one per line)', value: decisions, rows: 3, mono: false, hint: `${FIELD_HELP.decisions.hint} For example ${FIELD_HELP.decisions.example}.`, onInput: (v) => { const list = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean); edit(['decisions'], list.length ? list : undefined); } })),
        h('div.form-row', {},
          reg(['supersedes'], 'Supersedes', textField({ label: 'Supersedes', value: f.supersedes === null ? '' : str(f.supersedes), placeholder: 'ICR-0007', hint: FIELD_HELP.supersedes.hint, onInput: (v) => edit(['supersedes'], v.trim()) })),
          reg(['review-by'], 'The review date', textField({ label: 'Review by', value: str(f['review-by']), placeholder: 'YYYY-MM-DD', hint: FIELD_HELP.reviewBy.hint, onInput: (v) => edit(['review-by'], v.trim()) }))));

      root.append(identity, pattern, provider, consumers.el, interfaces.el, data, optional);
      consumers.render(false);
      interfaces.render(false);
    }

    root.append(h('details.disclosure', { id: 'fm-yaml-details', open: !f },
      h('summary', { text: 'Edit the front matter as YAML' }),
      h('div.disclosure-body', {},
        h('p.hint', { id: 'fm-yaml-hint', text: 'For properties the form does not offer, or to paste YAML. Comments in YAML are not kept.' }),
        h('label.sr-only', { for: 'fm-yaml', text: 'Front matter as YAML' }), rawYaml, yamlError,
        h('div.btn-row', { style: 'margin-top:8px' }, h('button.btn.btn-sm', { type: 'button', text: 'Apply YAML', onclick: applyYaml }), h('button.btn.btn-sm.btn-ghost', { type: 'button', text: 'Discard changes', onclick: loadYaml })))));
    loadYaml();
    updateErrors();
  }

  build();

  return {
    el: root,
    heading: root.querySelector('h2'),
    update() {
      updateErrors();
      // Keep the YAML box in step with the form unless the person is typing in it.
      if (document.activeElement !== rawYaml && yamlError.hidden) rawYaml.value = yamlText();
    },
  };
}

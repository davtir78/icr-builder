// Form field builders: a visible label, a hint, the control and an error line, wired with
// aria-describedby / aria-invalid. Each returns { el, control, setError(message|null) }.

import { h, uid } from './ui.js';

function wire(control, id, hintEl, errEl) {
  const sync = () => {
    const ids = [hintEl && hintEl.id, errEl && !errEl.hidden && errEl.id].filter(Boolean);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' ')); else control.removeAttribute('aria-describedby');
  };
  sync();
  return sync;
}

function build({ id, label, required, hint, control, extra }) {
  const hintEl = hint ? h('p.hint', { id: `${id}-hint`, text: hint }) : null;
  const errEl = h('p.err-msg', { id: `${id}-err`, hidden: true });
  const wrapper = h('div.form-field', {},
    h('label', { for: id }, label, required ? h('span.req', { 'aria-hidden': 'true', text: ' *' }) : null, required ? h('span.sr-only', { text: ' (required)' }) : null),
    hintEl, control, extra ?? null, errEl);
  const sync = wire(control, id, hintEl, errEl);
  return {
    el: wrapper,
    control,
    setError(message) {
      const has = Boolean(message);
      if (has && errEl.textContent !== message) errEl.textContent = message;
      errEl.hidden = !has;
      wrapper.classList.toggle('invalid', has);
      if (has) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
      sync();
    },
  };
}

export function textField({ label, value = '', required, hint, placeholder, type = 'text', list, onInput, autocomplete = 'off', inputmode, id = uid('in') }) {
  const control = h('input', { id, type, value, placeholder, list, autocomplete, inputmode, spellcheck: 'false' });
  control.value = value ?? '';
  if (onInput) control.addEventListener('input', () => onInput(control.value));
  return build({ id, label, required, hint, control });
}

export function selectField({ label, value = '', options, blankLabel = 'Choose…', required, hint, onChange, id = uid('sel') }) {
  const control = h('select', { id }, blankLabel === null ? null : h('option', { value: '', text: blankLabel }), options.map((o) => h('option', { value: o.value, text: o.label })));
  // A value the list does not hold (an imported record) is shown, not hidden.
  if (value && !options.some((o) => o.value === value)) control.append(h('option', { value, text: `${value} (not in the list)` }));
  control.value = value ?? '';
  if (onChange) control.addEventListener('change', () => onChange(control.value));
  return build({ id, label, required, hint, control });
}

export function textareaField({ label, value = '', required, hint, rows = 6, onInput, placeholder, mono = true, id = uid('ta'), extra }) {
  const control = h('textarea', { id, rows, placeholder, class: mono ? '' : 'prose', spellcheck: mono ? 'false' : 'true' });
  control.value = value ?? '';
  const fit = () => { control.style.height = 'auto'; control.style.height = `${Math.min(Math.max(control.scrollHeight + 4, 140), 640)}px`; };
  control.addEventListener('input', () => { fit(); if (onInput) onInput(control.value); });
  const f = build({ id, label, required, hint, control, extra });
  f.fit = fit;
  return f;
}

/** A plain-English version of a schema finding for the field it is about. */
export function friendly(problem, label) {
  switch (problem.keyword) {
    case 'required': return `${label} is required.`;
    case 'minLength': return /fewer than (\d+)/.test(problem.message) ? `Enter at least ${problem.message.match(/fewer than (\d+)/)[1]} characters.` : 'This cannot be empty.';
    case 'enum': return 'Choose one of the listed values.';
    case 'const': return 'This must be "0.2", the version this tool and the schema support.';
    case 'minItems': return 'Add at least one.';
    case 'format': return /"uri"/.test(problem.message) ? 'Use a full link, such as https://www.itarchitecturepatterns.net/patterns/int-api-external.' : 'Use a real date written as year-month-day, for example 2026-09-19.';
    case 'type': return `This ${problem.message.replace(/^must be /, 'must be a ')}.`.replace('a string,null', 'text or null');
    case 'pattern':
      if (/ICR-/.test(problem.message)) return 'Start with ICR- followed by letters, numbers or hyphens, for example ICR-0001.';
      return 'Use a semantic version such as 1.0.0 or 2.3.1-rc.1.';
    default: return problem.message[0].toUpperCase() + problem.message.slice(1) + '.';
  }
}

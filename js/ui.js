// Small DOM helpers: an element builder, status announcements, and an accessible confirm dialog.

/**
 * h("div.card#id", { class: "x", text: "...", onclick, aria-label: "..." , dataset: {a: 1} }, ...children)
 * Attributes: `text` sets textContent; keys starting "on" add listeners; booleans toggle the attribute;
 * null and undefined are skipped. Children may be nodes, strings, arrays or null.
 */
export function h(spec, attrs = {}, ...children) {
  const m = /^([a-z][a-z0-9]*)?((?:[.#][\w-]+)*)$/i.exec(spec);
  const el = document.createElement((m && m[1]) || 'div');
  for (const part of (m && m[2] ? m[2].match(/[.#][\w-]+/g) : []) ?? []) {
    if (part[0] === '#') el.id = part.slice(1);
    else el.classList.add(part.slice(1));
  }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

let counter = 0;
export const uid = (prefix = 'f') => `${prefix}-${++counter}`;

// ---------- status messages ----------

let statusEl = null;
let timer = null;
/** Registers the live region that shows status messages ("Draft saved", "Copied") and announces them. */
export function setStatusRegion(el) { statusEl = el; }

/** Shows a short status message in the live region; it clears itself after a while. */
export function announce(message, { keep = false } = {}) {
  if (!statusEl) return;
  clearTimeout(timer);
  statusEl.textContent = '';
  // A second tick makes a repeated message announce again.
  setTimeout(() => { statusEl.textContent = message; }, 30);
  if (!keep) timer = setTimeout(() => { if (statusEl.textContent === message) statusEl.textContent = ''; }, 8000);
}

// ---------- confirm dialog ----------

/** Resolves true if the person confirms. Uses a native <dialog>, which traps focus and closes on Esc. */
export function confirmDialog({ title, body, confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const titleId = uid('dlg-title');
    const dlg = h('dialog.modal', { 'aria-labelledby': titleId },
      h('div.modal-body', {}, h('h2', { id: titleId, text: title }), ...(Array.isArray(body) ? body : [body]).map((b) => (typeof b === 'string' ? h('p', { text: b }) : b))),
      h('div.modal-foot', {},
        h('button.btn', { type: 'button', text: cancelLabel, onclick: () => dlg.close('cancel') }),
        h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel, onclick: () => dlg.close('ok') })));
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      dlg.remove();
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
      resolve(ok);
    });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('.btn')?.focus(); // the safe choice (Cancel) takes focus first
  });
}

/** Calls fn at most once per short interval (a timer, not requestAnimationFrame, so it also runs in a background tab). */
export function frameThrottle(fn) {
  let queued = false;
  return () => { if (queued) return; queued = true; setTimeout(() => { queued = false; fn(); }, 24); };
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

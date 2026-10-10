// A very small stand-in for the browser's DOM, enough to run the tool's real views under `node --test`
// (the tests have no dependencies, so there is no jsdom).
//
// It models the one behaviour the diagram code depends on and that is easy to get wrong: an <iframe> that is
// not in the document never loads, so its contentWindow is null and it never posts a message. Attach the iframe
// (directly or inside a parent) to the document and it "loads": it posts `ready`, answers a `draw` message with
// `drawn`, and posts `error` instead when `dom.frameBehaviour` is 'error' (or nothing when it is 'silent').
//
//   import { installFakeDom } from './helpers/fake-dom.js';
//   const dom = installFakeDom();   // sets globalThis.document, window, Node, ...; dom.uninstall() puts them back

class FakeNode {
  constructor() { this.parentNode = null; this.childNodes = []; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === n.ownerRoot; }
  contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  removeChild(child) { const i = this.childNodes.indexOf(child); if (i >= 0) { this.childNodes.splice(i, 1); child._detach(); } return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  _attach() { for (const c of this.childNodes) c._attach(); }
  _detach() { this.parentNode = null; this._disconnected(); }
  _disconnected() { for (const c of this.childNodes) c._disconnected(); }
  _insert(nodes, at) {
    const flat = [];
    for (const n of nodes) {
      if (n instanceof FakeFragment) { flat.push(...n.childNodes); n.childNodes = []; } else flat.push(n);
    }
    const items = flat.map((n) => (typeof n === 'string' ? new FakeText(n) : n));
    for (const n of items) { if (n.parentNode) n.parentNode.removeChild(n); }
    this.childNodes.splice(at === undefined ? this.childNodes.length : at, 0, ...items);
    for (const n of items) { n.parentNode = this; if (this.isConnected) n._attach(); }
  }
  append(...nodes) { this._insert(nodes); }
  prepend(...nodes) { this._insert(nodes, 0); }
  replaceChildren(...nodes) { for (const c of [...this.childNodes]) this.removeChild(c); this._insert(nodes); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of [...this.childNodes]) this.removeChild(c); if (v !== '' && v !== null && v !== undefined) this._insert([new FakeText(String(v))]); }
}

class FakeText extends FakeNode {
  constructor(text) { super(); this.data = String(text); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class FakeFragment extends FakeNode {}

const matches = (el, sel) => {
  const m = /^([a-z][a-z0-9]*)?((?:[.#][\w-]+|\[[\w-]+\])*)$/i.exec(sel);
  if (!m) throw new Error(`fake-dom: unsupported selector ${sel}`);
  if (m[1] && el.tagName !== m[1].toLowerCase()) return false;
  for (const part of m[2].match(/[.#][\w-]+|\[[\w-]+\]/g) ?? []) {
    if (part[0] === '.' && !el.classList.contains(part.slice(1))) return false;
    if (part[0] === '#' && el.id !== part.slice(1)) return false;
    if (part[0] === '[' && !el.hasAttribute(part.slice(1, -1))) return false;
  }
  return true;
};

class FakeElement extends FakeNode {
  constructor(tagName, ownerRoot, dom) {
    super();
    this.tagName = tagName.toLowerCase();
    this.ownerRoot = ownerRoot;
    this.dom = dom;
    this.attrs = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = { cssText: '' };
    const classes = new Set();
    this._classes = classes;
    this.classList = {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : force; if (on) classes.add(c); else classes.delete(c); return on; },
    };
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.tabIndex = -1;
    this.scrollHeight = 0;
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this._classes.add(c)); }
  get id() { return this.attrs.get('id') ?? ''; }
  set id(v) { this.attrs.set('id', String(v)); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  dispatch(type, event = {}) { for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ target: this, currentTarget: this, preventDefault() {}, ...event }); }
  click() { this.dispatch('click'); }
  focus() { this.dom.activeElement = this; }
  get children() { return this.childNodes.filter((c) => c instanceof FakeElement); }
  querySelectorAll(selector) {
    const chain = selector.trim().split(/\s+/);
    const out = [];
    const walk = (node, ancestors) => {
      for (const c of node.childNodes) {
        if (!(c instanceof FakeElement)) continue;
        let ok = matches(c, chain[chain.length - 1]);
        if (ok && chain.length > 1) {
          let k = chain.length - 2;
          for (const a of [...ancestors].reverse()) { if (k >= 0 && matches(a, chain[k])) k--; }
          ok = k < 0;
        }
        if (ok) out.push(c);
        walk(c, [...ancestors, c]);
      }
    };
    walk(this, []);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  // an iframe loads when it is put in the document, and only then
  _attach() {
    super._attach();
    if (this.tagName === 'iframe' && !this.contentWindow) this.dom._loadFrame(this);
  }
  _disconnected() {
    super._disconnected();
    if (this.tagName === 'iframe') { this.contentWindow = null; clearInterval(this.heartbeat); }
  }
}

export function installFakeDom({ frameBehaviour = 'draws' } = {}) {
  const saved = {};
  const names = ['document', 'window', 'Node', 'requestAnimationFrame'];
  for (const n of names) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);

  const dom = { activeElement: null, frameBehaviour, frames: [], posted: [], aliveEveryMs: 1000 };
  const windowListeners = new Map();
  const win = {
    addEventListener(type, fn) { if (!windowListeners.has(type)) windowListeners.set(type, new Set()); windowListeners.get(type).add(fn); },
    removeEventListener(type, fn) { windowListeners.get(type)?.delete(fn); },
    matchMedia: () => ({ matches: false }),
  };
  dom.messageListeners = () => windowListeners.get('message')?.size ?? 0;
  const post = (data, source) => { for (const fn of [...(windowListeners.get('message') ?? [])]) fn({ data, source }); };
  const tokenOf = (frame) => /var T = "([0-9a-f]+)"/.exec(frame.srcdoc ?? '')?.[1];
  const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t; };

  /** Has a frame's own document post a message to the page, with the frame's token as the real document does. */
  dom.fromFrame = (frame, data) => post({ ...data, t: tokenOf(frame) }, frame.contentWindow);
  /** Has some other page that the frame was sent to post a message: it does not know the token. */
  dom.fromAttacker = (frame, data, t) => post(t === undefined ? data : { ...data, t }, frame.contentWindow);
  /** The frame's document is replaced (a navigation): its timers stop. With `loaded`, the browser also fires another load event. */
  dom.navigate = (frame, { loaded = true } = {}) => {
    if (!frame.contentWindow) return;
    clearInterval(frame.heartbeat);
    frame.documentReplaced = true;
    if (loaded) frame.dispatch('load');
  };
  dom.tokenOf = tokenOf;
  /** Events of the page, as a browser fires them when it restores or wakes the page. */
  dom.fireWindow = (type) => { for (const fn of [...(windowListeners.get(type) ?? [])]) fn({ type }); };
  dom.fireDocument = (type) => { for (const fn of [...(docListeners.get(type) ?? [])]) fn({ type }); };
  dom.listeners = () => ({ window: [...windowListeners].reduce((n, [, v]) => n + v.size, 0), document: [...docListeners].reduce((n, [, v]) => n + v.size, 0) });

  // What a browser does with an <iframe srcdoc>: nothing until it is in the document; then it loads. The document's own
  // script starts a heartbeat at once, says "ready" when it has loaded, and answers a "draw" message that carries its token.
  // frameBehaviour: 'draws' (the default), 'error' (the drawing fails), 'silent' (alive, but never ready), 'dead' (nothing at all).
  dom._loadFrame = (frame) => {
    const token = tokenOf(frame);
    const contentWindow = {
      postMessage(message) {
        dom.posted.push(message);
        if (!message || message.kind !== 'draw' || message.t !== token || frame.documentReplaced) return;
        setTimeout(() => {
          if (frame.contentWindow !== contentWindow || frame.documentReplaced) return;
          if (dom.frameBehaviour === 'error') post({ kind: 'error', message: 'Mermaid could not draw this diagram: fake', t: token }, contentWindow);
          else post({ kind: 'drawn', height: 240, t: token }, contentWindow);
        }, 0);
      },
    };
    frame.contentWindow = contentWindow;
    frame.documentReplaced = false;
    dom.frames.push(frame);
    if (dom.frameBehaviour === 'dead') return;
    post({ kind: 'alive', t: token }, contentWindow);
    frame.heartbeat = unref(setInterval(() => { if (frame.contentWindow === contentWindow && !frame.documentReplaced) post({ kind: 'alive', t: token }, contentWindow); }, dom.aliveEveryMs));
    // a browser fires the frame's load event when its document has loaded, before that document's own scripts report ready
    setTimeout(() => { if (frame.contentWindow === contentWindow) frame.dispatch('load'); }, 0);
    setTimeout(() => { if (frame.contentWindow === contentWindow && !frame.documentReplaced && dom.frameBehaviour !== 'silent') post({ kind: 'ready', t: token }, contentWindow); }, 1);
  };

  const root = new FakeElement('#document', null, dom);
  root.ownerRoot = root;
  const html = new FakeElement('html', root, dom);
  const body = new FakeElement('body', root, dom);
  root.childNodes.push(html);
  html.parentNode = root;
  html.childNodes.push(body);
  body.parentNode = html;
  const docListeners = new Map();
  const document = {
    documentElement: html,
    body,
    get activeElement() { return dom.activeElement; },
    createElement: (tag) => { const el = new FakeElement(tag, root, dom); if (tag === 'iframe') el.contentWindow = null; return el; },
    createTextNode: (t) => new FakeText(t),
    createDocumentFragment: () => new FakeFragment(),
    contains: (n) => root.contains(n),
    addEventListener(type, fn) { if (!docListeners.has(type)) docListeners.set(type, new Set()); docListeners.get(type).add(fn); },
    removeEventListener(type, fn) { docListeners.get(type)?.delete(fn); },
    getElementById: (id) => body.querySelector(`#${id}`),
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
  };

  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'Node', { value: FakeNode, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { value: (fn) => setTimeout(fn, 0), configurable: true, writable: true });
  dom.document = document;
  dom.window = win;
  dom.uninstall = () => {
    for (const n of names) { if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n]; }
  };
  return dom;
}

/** Resolves when `cond()` is truthy, or rejects after `ms` (the code under test is waiting on a frame that never loads). */
export async function waitFor(cond, ms = 1500, what = 'the condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

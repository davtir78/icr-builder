// ICR Builder: boot, the shell (host bar, header, step navigation, panel) and the hash router.

import { h, clear, setStatusRegion, announce, frameThrottle } from './ui.js';
import { store } from './store.js';
import { buildChecklist, summarise } from './checklist.js';
import { SECTION_GUIDE } from './data/guidance.js';
import { INTERACTIONS } from './data/guidance.js';
import { createStartView } from './views/start.js';
import { createFrontMatterView } from './views/frontmatter.js';
import { createSectionView } from './views/section.js';
import { createReviewView } from './views/review.js';
import { createPanel } from './views/panel.js';

const TOOL_NAME = 'ICR Builder';
const THEME_KEY = 'icr-builder:theme';

// ---------- host bar ----------
// When a site serves the builder as one of its tools, it names itself in "tool-host" meta tags and
// the builder draws a way back to that site across the top, styled as the host's chrome so its
// "<- Site" cannot be mistaken for the builder's own Start step. Served on its own (GitHub Pages,
// a local server) there are no tags and no bar: the builder stays domain-neutral. Tags:
//   <meta name="tool-host-name" content="Site name">          required
//   <meta name="tool-host-href" content="/">                   required: the site's home
//   <meta name="tool-host-link" content="Label|/path">         optional, repeatable
function readHost() {
  const meta = (name) => (document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '').trim();
  const name = meta('tool-host-name');
  const href = meta('tool-host-href');
  if (!name || !href) return null;
  const links = [...document.querySelectorAll('meta[name="tool-host-link"]')]
    .map((m) => (m.getAttribute('content') || '').split('|').map((s) => s.trim()))
    .filter(([label, url]) => label && url)
    .map(([label, url]) => ({ label, href: url }));
  return { name, href, links };
}

function renderHostBar(host) {
  return h('nav.host-bar', { 'aria-label': host.name },
    h('a.host-home', { href: host.href }, h('span', { 'aria-hidden': 'true', text: '← ' }), host.name),
    h('span.host-sep', { 'aria-hidden': 'true', text: '/' }),
    h('span.host-current', { text: TOOL_NAME }),
    host.links.length ? h('span.host-links', {}, host.links.map((l) => h('a.host-link', { href: l.href, text: l.label }))) : null);
}

// ---------- theme ----------
const THEMES = ['auto', 'light', 'dark'];
let theme = 'auto';
function readTheme() { try { const t = localStorage.getItem(THEME_KEY); return THEMES.includes(t) ? t : 'auto'; } catch { return 'auto'; } }
function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
}

// ---------- routes ----------
function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, arg] = hash.split('/');
  if (name === 'section' && SECTION_GUIDE.some((s) => s.slug === arg)) return { name, slug: arg, key: `section/${arg}` };
  if (name === 'front-matter' || name === 'review' || name === 'start') return { name, key: name };
  return { name: 'start', key: 'start' };
}
const go = (key) => { location.hash = `#/${key}`; };

function boot() {
  theme = readTheme();
  applyTheme();
  const restoredState = store.load();
  const restored = restoredState === 'restored';

  const app = document.getElementById('app');
  const host = readHost();

  const status = h('span.save-status', { id: 'live-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  setStatusRegion(status);
  const saveText = h('span.save-status');
  const recId = h('span.rec-id');
  const recTitle = h('span.rec-title');
  const recStatus = h('span.badge.badge-status');
  const conformBadge = h('span.badge');
  const panelToggle = h('button.btn.btn-sm.panel-toggle', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'panel', onclick: () => setPanelOpen(!shell.classList.contains('panel-open')) });
  const themeBtn = h('button.btn.btn-sm.btn-ghost', { type: 'button', id: 'theme-toggle', onclick: () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* the choice just is not remembered */ }
    applyTheme(); syncTheme(); panel.redrawForTheme();
    announce(`Colour theme: ${theme}.`);
  } });
  function syncTheme() { themeBtn.textContent = `Theme: ${theme === 'auto' ? 'auto' : theme}`; themeBtn.setAttribute('aria-label', `Colour theme: ${theme === 'auto' ? 'automatic (follows your system)' : theme}. Activate to change.`); }
  syncTheme();

  const header = h('div.app-header', { role: 'region', 'aria-label': 'Current record and settings' }, h('div.record-summary', {}, recId, recTitle, recStatus),
    h('div.header-actions', {}, themeBtn, panelToggle));
  const brand = h('header.brand', {}, h('span.brand-mark', { 'aria-hidden': 'true', text: '◆' }), h('h1', { text: TOOL_NAME }));

  // ----- navigation -----
  const navLinks = new Map();
  const mkItem = (key, label, num) => {
    const mark = h('span.nav-mark', { 'aria-hidden': 'true' });
    const markText = h('span.sr-only');
    const a = h('a.nav-item', { href: `#/${key}` }, h('span.nav-num', { text: num ?? '' }), h('span.nav-label', { text: label }), mark, markText);
    navLinks.set(key, { a, mark, markText });
    return h('li', {}, a);
  };
  const nav = h('nav.app-nav', { 'aria-label': 'Steps' },
    h('div.nav-heading', { text: 'Set up' }),
    h('ul.nav-group', {}, mkItem('start', 'Start', '1'), mkItem('front-matter', 'Front matter', '2')),
    h('div.nav-heading', { text: 'The 17 sections' }),
    h('ul.nav-group', {}, SECTION_GUIDE.map((s, i) => mkItem(`section/${s.slug}`, s.title, String(i + 1)))),
    h('div.nav-heading', { text: 'Finish' }),
    h('ul.nav-group', {}, mkItem('review', 'Review and export', '✓')),
    h('div.nav-footer', {}, h('div', { text: 'v0.1 · ICR specification v0.2 (draft)' }), h('div', { text: 'The draft is saved in this browser only. Nothing is sent anywhere, except the diagram library, fetched from a public CDN only if you choose to draw.' })));

  const main = h('main.app-main', { id: 'main', tabindex: '-1' });
  const statusBar = h('div.status-bar', {}, saveText, status);
  const viewHost = h('div', { id: 'view-host' });
  main.append(statusBar, viewHost);
  const panel = createPanel({ store });
  const shell = h('div', { class: `app-shell${host ? ' has-host-bar' : ''}` }, host ? renderHostBar(host) : null, brand, header, nav, main, panel.el);
  clear(app);
  app.append(h('a.skip-link', { href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Skip to the editor'), shell);

  const narrow = window.matchMedia('(max-width: 1359px)');
  function setPanelOpen(open) {
    shell.classList.toggle('panel-open', open);
    panelToggle.setAttribute('aria-expanded', String(open));
    if (open) { panel.update(); panel.el.querySelector('.tab[aria-selected="true"]')?.focus(); }
  }
  narrow.addEventListener?.('change', () => setPanelOpen(false));
  // In-page links ("#/start") are handled here, not by the browser. A host site's <base href> would
  // otherwise turn each one into a full page load of the base path instead of a change of step.
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href === '#main') { main.focus(); return; }
    if (!href.startsWith('#/')) return; // an anchor inside the previewed text: it has nowhere to go here, and must not change the step
    if (location.hash === href) route(); else location.hash = href;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && narrow.matches && shell.classList.contains('panel-open') && !document.querySelector('dialog[open]')) { setPanelOpen(false); panelToggle.focus(); }
  });

  // ----- views -----
  let view = null;
  let first = true;
  function route() {
    const r = parseRoute();
    view?.destroy?.();
    clear(viewHost);
    const ctx = { store, go, slug: r.slug };
    view = r.name === 'start' ? createStartView(ctx) : r.name === 'front-matter' ? createFrontMatterView(ctx) : r.name === 'review' ? createReviewView(ctx) : createSectionView(ctx);
    viewHost.append(view.el);
    main.scrollTop = 0;
    const label = r.name === 'section' ? SECTION_GUIDE.find((s) => s.slug === r.slug).title : { start: 'Start', 'front-matter': 'Front matter', review: 'Review and export' }[r.name];
    document.title = `${label} — ${TOOL_NAME}`;
    navLinks.forEach(({ a }, key) => { if (key === r.key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    navLinks.get(r.key)?.a.scrollIntoView?.({ block: 'nearest' });
    if (!first) view.heading?.focus({ preventScroll: true });
    first = false;
    if (narrow.matches) setPanelOpen(false);
    refresh();
  }

  // ----- keeping everything in step -----
  const MARK = { ok: ['✓', 'ok', 'complete'], todo: ['!', 'todo', 'needs work'], optional: ['–', 'optional', 'optional, not started'] };
  function refresh() {
    const m = store.model;
    const fm = m.fm ?? {};
    const a = store.analysis;
    const c = buildChecklist(a);
    recId.textContent = typeof fm.id === 'string' ? fm.id : '';
    recTitle.textContent = typeof fm.title === 'string' && fm.title ? fm.title : 'Untitled integration contract';
    recStatus.textContent = typeof fm.status === 'string' ? fm.status : 'no status';
    const n = a.problems.length;
    const sum = summarise(a, store.advice);
    conformBadge.className = `badge badge-${sum.state}`;
    conformBadge.textContent = sum.badge;
    panelToggle.replaceChildren('Checks and preview ', conformBadge);

    const marks = {
      start: INTERACTIONS.some((i) => i.id === fm.interaction) ? 'ok' : 'todo',
      'front-matter': c.rules[0].state === 'fail' || c.rules[0].state === 'todo' ? 'todo' : 'ok',
      review: sum.state === 'ok' ? 'ok' : 'todo',
    };
    for (const s of c.sections) marks[`section/${s.slug}`] = s.state === 'pass' ? 'ok' : s.state === 'na' ? 'optional' : 'todo';
    navLinks.forEach(({ mark, markText }, key) => {
      const [glyph, cls, word] = MARK[marks[key]] ?? MARK.optional;
      mark.textContent = glyph;
      mark.className = `nav-mark ${cls}`;
      markText.textContent = ` (${word})`;
    });

    const ss = store.saveState;
    saveText.textContent = !ss.available ? 'Not saved: this browser blocks local storage' : ss.at ? `Draft saved in this browser at ${ss.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : restored && !ss.at ? '' : 'Draft saved in this browser as you type';

    panel.update();
    view?.update?.();
  }
  const refreshSoon = frameThrottle(refresh);
  store.subscribe(refreshSoon);

  window.addEventListener('hashchange', route);
  if (!location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#/start`);
  route();
  store.confirmRestored();
  if (restored) announce('Restored your draft from this browser.');
  else if (restoredState === 'invalid') announce('The saved draft was not a record this version can read, so it was discarded and you have a new, empty record.');
  else if (restoredState === 'crashed') announce('The last attempt to open the saved draft did not finish, so the draft was discarded and you have a new, empty record.');
}

boot();

// "Draw the diagrams" (preview panel) and "Draw the diagram" (flow helper), run through the real views against a
// small fake DOM (tests/helpers/fake-dom.js). A browser loads an <iframe> only once it is in the document; the
// fake does the same, so a diagram drawn into an element that is not on the page never finishes, as it did.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeDom, waitFor } from './helpers/fake-dom.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = fs.readFileSync(path.join(HERE, '..', 'templates', '0001-partner-booking-api.md'), 'utf8');

async function setup(options) {
  const dom = installFakeDom(options);
  const { store } = await import('../js/store.js');
  const { mermaidState, drawDiagram } = await import('../js/mermaid.js');
  store.loadMarkdown(EXAMPLE);
  return { dom, store, mermaidState, drawDiagram };
}

test('drawDiagram refuses a container that is not in the document, with a message that does not blame the network', async () => {
  const { dom, drawDiagram } = await setup();
  try {
    const holder = document.createElement('div'); // never attached
    await assert.rejects(() => drawDiagram(holder, 'sequenceDiagram\n A->>B: hi'), (e) => /not on the page/.test(e.message) && !/library|network|CDN/i.test(e.message));
    assert.equal(dom.frames.length, 0, 'no frame was created');
  } finally { dom.uninstall(); }
});

test('"Draw the diagrams" in the preview panel draws the diagram in the page', async () => {
  const { dom, store, mermaidState } = await setup();
  try {
    const { createPanel } = await import('../js/views/panel.js');
    const panel = createPanel({ store });
    document.body.append(panel.el);
    panel.select('preview', false);
    const fig = document.querySelector('figure.diagram');
    assert.ok(fig, 'the preview has a mermaid figure');
    assert.equal(dom.frames.length, 0, 'nothing is loaded before a click');
    document.querySelector('#draw-all').click();
    await waitFor(() => fig.querySelector('iframe') && fig.querySelector('iframe').style.height === '240px', 1500, 'the diagram to be drawn in the preview');
    const frame = fig.querySelector('iframe');
    assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
    assert.ok(frame.isConnected, 'the frame is on the page');
    assert.equal(mermaidState.status, 'ready');
    assert.match(fig.textContent, /Diagram source/, 'the source stays available');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(dom.frames.length, 1, 'the frame was loaded once: moving a frame in the page reloads it and loses the drawing');
    assert.equal(frame.contentWindow !== null, true);
    assert.equal(document.querySelector('#draw-note').textContent, '');
    // a failure is shown, with the source kept
    dom.frameBehaviour = 'error';
    mermaidState.status = 'idle';
    panel.select('checklist', false);
    panel.select('preview', false);
    document.querySelector('#draw-all').click();
    await waitFor(() => document.querySelector('figure.diagram .diagram-fail'), 1500, 'the failure message');
    assert.match(document.querySelector('.diagram-fail').textContent, /could not draw/);
    assert.ok(document.querySelector('figure.diagram pre'), 'the source is still shown');
  } finally { dom.uninstall(); }
});

test('while the preview diagram loads, the page says so', async () => {
  const { dom, store } = await setup({ frameBehaviour: 'silent' });
  try {
    const { createPanel } = await import('../js/views/panel.js');
    const panel = createPanel({ store });
    document.body.append(panel.el);
    panel.select('preview', false);
    document.querySelector('#draw-all').click();
    await waitFor(() => dom.frames.length === 1, 1000, 'the frame to be created on the page');
    assert.match(document.querySelector('#draw-note').textContent, /Loading the diagram library/);
    assert.match(document.querySelector('figure.diagram').textContent, /Drawing this diagram/, 'a placeholder is in the figure');
    dom.fromFrame(dom.frames[0], { kind: 'loaderror', message: 'stop' }); // let the pending drawing finish before the fake page goes
    await waitFor(() => document.querySelector('.diagram-fail'), 1000, 'the drawing to end');
  } finally { dom.uninstall(); }
});

test('"Draw the diagram" in the flow helper draws the diagram in the page', async () => {
  const { dom, store, mermaidState } = await setup();
  try {
    const { createSectionView } = await import('../js/views/section.js');
    const view = createSectionView({ store, slug: 'flows', go() {}, index: 0 });
    document.body.append(view.el);
    assert.equal(dom.frames.length, 0, 'nothing is loaded before a click');
    document.querySelector('#draw-flow').click();
    await waitFor(() => document.querySelector('div.diagram iframe') && document.querySelector('div.diagram iframe').style.height === '240px', 1500, 'the flow diagram to be drawn');
    assert.ok(document.querySelector('div.diagram iframe').isConnected);
    assert.equal(mermaidState.status, 'ready');
    assert.doesNotMatch(document.querySelector('div.diagram').textContent, /Loading the diagram library|Drawing/, 'the placeholder is gone');
    // the diagram that was asked for is the flow's own
    const draw = dom.posted.find((m) => m?.kind === 'draw');
    assert.match(draw.source, /sequenceDiagram/);
    assert.match(draw.source, /accTitle/);
  } finally { dom.uninstall(); }
});

test('a failed flow diagram says why and leaves the steps', async () => {
  const { dom, store } = await setup({ frameBehaviour: 'error' });
  try {
    const { createSectionView } = await import('../js/views/section.js');
    const view = createSectionView({ store, slug: 'flows', go() {}, index: 0 });
    document.body.append(view.el);
    document.querySelector('#draw-flow').click();
    await waitFor(() => document.querySelector('div.diagram .diagram-fail'), 1500, 'the failure message');
    assert.match(document.querySelector('div.diagram .diagram-fail').textContent, /could not draw/);
    assert.ok(document.querySelectorAll('ol li').length > 0, 'the numbered steps are still there');
  } finally { dom.uninstall(); }
});

// ---------- a frame that navigates is removed (N3), a replaced drawing stops at once (N6) ----------

test('a frame that loads a second time before the drawing is reported is removed and the drawing refused', async () => {
  const { dom, mermaidState, drawDiagram } = await setup({ frameBehaviour: 'silent' });
  try {
    const holder = document.createElement('div');
    document.body.append(holder);
    const drawing = drawDiagram(holder, 'sequenceDiagram\n A->>B: hi');
    const settled = drawing.then(() => 'drawn', (e) => e.message);
    await waitFor(() => dom.frames.length === 1 && dom.frames[0].isConnected, 1000, 'the frame');
    await new Promise((r) => setTimeout(r, 10)); // its first load has happened
    dom.navigate(dom.frames[0]); // an injected meta refresh sends it elsewhere
    assert.match(await settled, /another page inside its frame/);
    assert.equal(holder.querySelector('iframe'), null, 'the frame is gone');
    assert.equal(mermaidState.status, 'failed');
    assert.equal(dom.messageListeners(), 0, 'no listener is left behind');
  } finally { dom.uninstall(); }
});

test('a frame that navigates after the drawing is reported is removed too, and the page says so', async () => {
  const { dom, mermaidState, drawDiagram } = await setup();
  try {
    const holder = document.createElement('div');
    document.body.append(holder);
    const frame = await drawDiagram(holder, 'sequenceDiagram\n A->>B: hi');
    assert.equal(mermaidState.status, 'ready');
    assert.ok(frame.isConnected);
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(frame.isConnected, 'its own first load did not remove it');
    dom.navigate(frame);
    assert.equal(holder.querySelector('iframe'), null, 'the frame is gone');
    assert.match(holder.querySelector('.diagram-fail').textContent, /another page inside its frame/);
    assert.equal(mermaidState.status, 'failed');
  } finally { dom.uninstall(); }
});

test('in the preview, a frame that navigates leaves the diagram source and a message', async () => {
  const { dom, store } = await setup();
  try {
    const { createPanel } = await import('../js/views/panel.js');
    const panel = createPanel({ store });
    document.body.append(panel.el);
    panel.select('preview', false);
    document.querySelector('#draw-all').click();
    await waitFor(() => document.querySelector('figure.diagram iframe')?.style.height === '240px', 1500, 'the drawing');
    await new Promise((r) => setTimeout(r, 10));
    dom.navigate(document.querySelector('figure.diagram iframe'));
    assert.equal(document.querySelector('figure.diagram iframe'), null);
    assert.match(document.querySelector('figure.diagram .diagram-fail').textContent, /another page/);
    assert.ok(document.querySelector('figure.diagram pre'), 'the source is still shown');
  } finally { dom.uninstall(); }
});

test('a drawing whose holder was cleared by a newer one stops at once and does not mark the shared state failed', async () => {
  const { dom, mermaidState, drawDiagram } = await setup({ frameBehaviour: 'silent' });
  try {
    const holder = document.createElement('div');
    document.body.append(holder);
    const settled = drawDiagram(holder, 'sequenceDiagram\n A->>B: hi').then(() => 'drawn', (e) => e.message);
    await waitFor(() => dom.frames.length === 1, 1000, 'the frame');
    mermaidState.status = 'loading'; // what the newer drawing sets
    holder.replaceChildren(); // the newer drawing clears the holder
    const t0 = Date.now();
    assert.match(await settled, /replaced by a newer one/);
    assert.ok(Date.now() - t0 < 2000, 'it did not wait 30 seconds');
    assert.equal(mermaidState.status, 'loading', 'the newer drawing owns the state');
    assert.equal(dom.messageListeners(), 0);
  } finally { dom.uninstall(); }
});

test('the log-based option is switched off, with its reason, while no intermediary is drawn (N4)', async () => {
  const { dom, store } = await setup();
  try {
    const { createSectionView } = await import('../js/views/section.js');
    store.change((m) => { m.fm.interaction = 'async-event'; m.fm.pattern = { id: 'int-esp-cloud', url: 'https://www.itarchitecturepatterns.net/patterns/int-esp-cloud' }; });
    const view = createSectionView({ store, slug: 'flows', go() {}, index: 0 });
    document.body.append(view.el);
    const log = document.querySelector('#flow-log-on');
    const via = document.querySelector('#flow-via-on');
    const why = document.querySelector('#flow-log-why');
    assert.equal(log.disabled, false);
    assert.equal(log.checked, true, 'an event-streaming pattern starts with it on');
    assert.equal(why.hidden, true);
    via.checked = false;
    via.dispatch('change');
    assert.equal(log.disabled, true);
    assert.equal(log.checked, false, 'it is not shown ticked next to "switched off"');
    assert.equal(why.hidden, false);
    assert.match(why.textContent, /no intermediary is drawn/);
    assert.equal(log.getAttribute('aria-describedby'), 'flow-log-why');
    via.checked = true;
    via.dispatch('change');
    assert.equal(log.disabled, false);
    assert.equal(log.checked, true, 'and it comes back as it was');
    assert.equal(why.hidden, true);
  } finally { dom.uninstall(); }
});

// ---------- the frame is watched (R3-4, R3-5) ----------
// Short waits, so that the watchdog can be seen working without waiting seconds.
const FAST = { startMs: 300, staleMs: 150, checkMs: 20, aliveEveryMs: 25 };

async function watched(options, fn) {
  const ctx = await setup(options);
  ctx.dom.aliveEveryMs = FAST.aliveEveryMs;
  try {
    const holder = document.createElement('div');
    document.body.append(holder);
    await fn({ ...ctx, holder, draw: (opts = {}) => ctx.drawDiagram(holder, 'sequenceDiagram\n A->>B: hi', { timing: FAST, ...opts }) });
  } finally { ctx.dom.uninstall(); }
}

test('a message without the frame\'s token is ignored: a page the frame was sent to cannot start the drawing', async () => {
  await watched({ frameBehaviour: 'silent' }, async ({ dom, draw }) => {
    const settled = draw().then(() => 'drawn', (e) => e.message);
    await waitFor(() => dom.frames.length === 1, 1000, 'the frame');
    const frame = dom.frames[0];
    dom.fromAttacker(frame, { kind: 'ready' });
    dom.fromAttacker(frame, { kind: 'ready' }, 'not-the-token');
    dom.fromAttacker(frame, { kind: 'drawn', height: 3900 });
    dom.fromAttacker(frame, { kind: 'alive' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(dom.posted.filter((m) => m?.kind === 'draw').length, 0, 'the source was not sent');
    assert.equal(frame.style.height, undefined, 'the height was not taken');
    dom.fromFrame(frame, { kind: 'loaderror', message: 'stop' });
    assert.match(await settled, /stop/);
  });
});

test('the frame is told to draw once, however often it says ready; a second ready removes it', async () => {
  await watched({ frameBehaviour: 'silent' }, async ({ dom, draw, holder }) => {
    const settled = draw().then(() => 'drawn', (e) => e.message);
    await waitFor(() => dom.frames.length === 1, 1000, 'the frame');
    const frame = dom.frames[0];
    dom.fromFrame(frame, { kind: 'ready' });
    assert.equal(dom.posted.filter((m) => m?.kind === 'draw').length, 1);
    dom.fromFrame(frame, { kind: 'ready' });
    assert.match(await settled, /unexpected message/);
    assert.equal(holder.querySelector('iframe'), null);
    assert.equal(dom.posted.filter((m) => m?.kind === 'draw').length, 1, 'no second draw was sent');
  });
});

test('"drawn" and "error" that do not follow a draw the page sent are ignored', async () => {
  await watched({ frameBehaviour: 'silent' }, async ({ dom, draw, mermaidState }) => {
    const settled = draw().then(() => 'drawn', (e) => e.message);
    await waitFor(() => dom.frames.length === 1, 1000, 'the frame');
    const frame = dom.frames[0];
    dom.fromFrame(frame, { kind: 'drawn', height: 500 });
    dom.fromFrame(frame, { kind: 'error', message: 'early' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(frame.style.height, undefined);
    assert.notEqual(mermaidState.status, 'failed');
    dom.fromFrame(frame, { kind: 'ready' });
    dom.fromFrame(frame, { kind: 'drawn', height: 300 });
    assert.equal(await settled, 'drawn');
    assert.equal(frame.style.height, '300px');
    dom.fromFrame(frame, { kind: 'drawn', height: 3900 }); // a second one changes nothing
    assert.equal(frame.style.height, '300px');
  });
});

test('a frame that never starts is removed, and the message points at the hosting page\'s policy rather than the CDN', async () => {
  await watched({ frameBehaviour: 'dead' }, async ({ dom, draw, holder, mermaidState }) => {
    const t0 = Date.now();
    await assert.rejects(draw(), (e) => /did not start/.test(e.message) && /Content-Security-Policy on the page that hosts this tool/.test(e.message) && /https:\/\/cdn\.jsdelivr\.net/.test(e.message) && !/could not be reached/.test(e.message));
    assert.ok(Date.now() - t0 < 2000);
    assert.equal(holder.querySelector('iframe'), null);
    assert.equal(mermaidState.status, 'failed');
    assert.equal(dom.messageListeners(), 0);
  });
});

test('a frame whose heartbeat stops before the drawing is reported is removed (a navigation that never finishes loading)', async () => {
  await watched({ frameBehaviour: 'silent' }, async ({ dom, draw, holder }) => {
    const settled = draw().then(() => 'drawn', (e) => e.message);
    await waitFor(() => dom.frames.length === 1, 1000, 'the frame');
    await new Promise((r) => setTimeout(r, 60));
    dom.navigate(dom.frames[0], { loaded: false }); // no load event, as when the response is held open
    assert.match(await settled, /stopped responding/);
    assert.equal(holder.querySelector('iframe'), null);
  });
});

test('after the drawing is reported, a heartbeat that stops removes the frame and leaves a message; the attacker\'s messages change nothing', async () => {
  await watched({}, async ({ dom, draw, holder, mermaidState }) => {
    const frame = await draw();
    assert.equal(frame.style.height, '240px');
    dom.navigate(frame, { loaded: false });
    dom.fromAttacker(frame, { kind: 'ready' });
    dom.fromAttacker(frame, { kind: 'drawn', height: 3900 });
    assert.equal(frame.style.height, '240px', 'a page the frame was sent to cannot resize it');
    await waitFor(() => holder.querySelector('iframe') === null, 2000, 'the frame to be removed');
    assert.match(holder.querySelector('.diagram-fail').textContent, /stopped responding/);
    assert.equal(mermaidState.status, 'failed');
    assert.equal(dom.messageListeners(), 0, 'no listener is left behind');
    assert.equal(dom.posted.filter((m) => m?.kind === 'draw').length, 1);
  });
});

test('a healthy frame is watched for as long as it is on the page and is left alone', async () => {
  await watched({}, async ({ dom, draw, holder }) => {
    const frame = await draw();
    await new Promise((r) => setTimeout(r, 400)); // many heartbeats and many checks
    assert.ok(frame.isConnected);
    assert.equal(holder.querySelector('.diagram-fail'), null);
    holder.replaceChildren(); // off the page: the watching stops by itself
    await waitFor(() => dom.messageListeners() === 0, 1000, 'the listener to be released');
  });
});

test('the iframe asks any page it navigates to for a policy, unless that is turned off for a test', async () => {
  await watched({}, async ({ draw }) => {
    const frame = await draw();
    assert.match(frame.getAttribute('csp'), /default-src 'none'/);
  });
  await watched({}, async ({ draw }) => {
    const frame = await draw({ embeddedCsp: false });
    assert.equal(frame.getAttribute('csp'), null);
  });
});

// ---------- a suspended page is not a stalled frame (R4-4) ----------

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test('a page that was suspended (frozen tab, back/forward cache, a sleeping laptop) does not remove a healthy frame, but a stalled one still goes', async () => {
  await watched({}, async ({ dom, draw, holder }) => {
    const frame = await draw();
    // the page stops running for much longer than the frame may stay silent: no check, and no heartbeat, happens meanwhile
    clearInterval(frame.heartbeat);
    sleepSync(500);
    await new Promise((r) => setTimeout(r, 60)); // the first check afterwards comes late, and so starts the waits again
    assert.ok(frame.isConnected, 'the frame was not blamed for the page\'s sleep');
    assert.equal(holder.querySelector('.diagram-fail'), null);
    // but the heartbeat really has stopped, so the frame goes once the wait is over
    await waitFor(() => holder.querySelector('iframe') === null, 2000, 'the stalled frame to be removed');
    assert.match(holder.querySelector('.diagram-fail').textContent, /stopped responding/);
    assert.equal(dom.messageListeners(), 0);
  });
});

test('the page showing again, becoming visible or resuming gives the frame a fresh wait; the wait then runs out only if the heartbeat is really gone', async () => {
  for (const [target, type] of [['window', 'pageshow'], ['document', 'visibilitychange'], ['document', 'resume']]) {
    await watched({}, async ({ dom, draw, holder }) => {
      const frame = await draw();
      clearInterval(frame.heartbeat); // silent from now on
      await new Promise((r) => setTimeout(r, 100)); // 100 ms of the 150 allowed
      if (target === 'window') dom.fireWindow(type); else dom.fireDocument(type);
      await new Promise((r) => setTimeout(r, 100)); // 200 ms in all: past the first wait
      assert.ok(frame.isConnected, `${type}: the frame is still there`);
      await waitFor(() => holder.querySelector('iframe') === null, 2000, 'the stalled frame to be removed');
    });
  }
});

test('everything the watching added to the page is taken away again when the frame goes', async () => {
  await watched({}, async ({ dom, draw, holder }) => {
    const before = dom.listeners();
    const frame = await draw();
    assert.ok(dom.listeners().window > before.window && dom.listeners().document > before.document);
    holder.replaceChildren();
    await waitFor(() => JSON.stringify(dom.listeners()) === JSON.stringify(before), 1000, 'the listeners to be released');
  });
});

// ---------- one late check is forgiven per heartbeat (R5-1) ----------

test('two late checks with no heartbeat between them remove the frame: a page kept busy by the frame\'s document cannot keep it alive', async () => {
  await watched({}, async ({ dom, draw, holder }) => {
    const frame = await draw();
    clearInterval(frame.heartbeat); // the frame's own document is gone (and the page that replaced it keeps this one busy)
    sleepSync(500);
    await new Promise((r) => setTimeout(r, 30)); // the first late check is forgiven
    assert.ok(frame.isConnected, 'the first late check is forgiven');
    sleepSync(500); // busy again, and no "alive" came meanwhile
    await new Promise((r) => setTimeout(r, 50)); // the next check is late too and, with nothing since the forgiveness, removes it (otherwise it would be 150 ms more)
    assert.equal(holder.querySelector('iframe'), null, 'the frame was removed by the second late check');
    assert.match(holder.querySelector('.diagram-fail').textContent, /stopped responding/);
    assert.equal(dom.messageListeners(), 0);
  });
});

test('a healthy frame in a page that is suspended again and again is forgiven each time, because it answers in between', async () => {
  await watched({}, async ({ dom, draw, holder }) => {
    const frame = await draw();
    for (let i = 0; i < 4; i++) {
      const beat = frame.heartbeat;
      clearInterval(beat); // asleep with the page
      sleepSync(500);
      await new Promise((r) => setTimeout(r, 10)); // the first check afterwards is late and forgiven
      // the page runs again and the frame says "alive" at once, as the real document does
      dom.fromFrame(frame, { kind: 'alive' });
      await new Promise((r) => setTimeout(r, 60));
      assert.ok(frame.isConnected, `suspension ${i + 1}: the frame is still there`);
    }
    assert.equal(holder.querySelector('.diagram-fail'), null);
  });
});

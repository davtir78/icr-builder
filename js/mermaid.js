// Drawing Mermaid diagrams: only when asked, and only inside a sandbox.
//
// A record can come from a file, and Mermaid has had cross-site-scripting bugs in how it handles diagram
// labels (for example CVE-2025-54881 / GHSA-7rqq-prvp-x9jh, in 11.0.0 to 11.9.x). These layers keep a crafted
// record away from the page that hosts this tool, which may be a site with a signed-in admin:
//
//   1. a patched release is pinned (11.16.1, with its Subresource Integrity hash);
//   2. Mermaid runs in an <iframe sandbox="allow-scripts"> without allow-same-origin, so whatever it runs has an
//      opaque origin: no access to this page's DOM, cookies or storage, and no top-level navigation. The
//      drawing stays inside that frame: this page never receives markup from it, only a height in pixels;
//   3. the frame has its own Content-Security-Policy: scripts only by nonce and no fetch or XHR connections
//      (connect-src 'none'), so an injected inline handler is blocked and the frame cannot post the record anywhere
//      by a request of its own.
//
// What those layers do not do is stop the frame from navigating itself: an injected <meta http-equiv=refresh>, or a
// script that sets its location, can load another site inside it (a phishing or tracking surface; the page is still
// sealed off from it). The sandbox and the CSP do not prevent that, so this file defends in depth, and the defences
// are best effort:
//
//   - every message from the frame carries a random per-frame token that only its own document knows, so a page the
//     frame was sent to cannot pose as it; the host answers the first "ready" only (and sends the diagram source
//     only then), accepts "drawn" and "error" only after that, and treats a second "ready" as a fault;
//   - the frame's document sends a heartbeat every second; when it stops (the document was replaced, even by a
//     page that never finishes loading) or never starts, the frame is removed. A check of this page's own that comes
//     late (the page was suspended, or kept busy) is forgiven once per heartbeat. With the frame in a process of its own it
//     is removed within about 3.5 s of its last heartbeat (2.8 to 3.7 s measured). Where it shares this page's process,
//     a navigated page that keeps this page busy delays that by up to two more of its busy periods (about four when each
//     is just under 3.5 s), and nothing on this page responds while it does: measured 11 s for busy periods of 4 s, 14 s
//     for 3.4 s ones and 20 to 23 s for 10 s ones;
//   - a second "load" event (a navigation that completed) removes the frame at once;
//   - the iframe `csp` attribute (Chrome and Edge only) makes the browser refuse any page the frame navigates to
//     that does not agree to it; other browsers ignore it.
//
// In every case the frame is removed and the diagram source stays on screen. What remains: all of this protects against
// a page the frame was sent to, not against script that runs inside the frame's own document, which can read the token;
// and a navigation is only noticed within a few seconds (longer in a shared process, as above). Getting that far needs an HTML-injection bypass of the pinned
// 11.16.1, which has none known.
//
// Nothing is fetched until a person presses a "Draw" button, and then only the library (the record is never sent
// anywhere but into the frame). If the library cannot be loaded, the diagram source and numbered steps stay on
// screen: the text always works.

export const MERMAID_VERSION = '11.16.1';
export const MERMAID_URL = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`;
export const MERMAID_SRI = 'sha512-1x2SBW7leqTgCFENntMyLJueEcgpJqZ7tHGkbslNKPpWURDr5AtU3p4oxjhDsoQZgiHZJh4D5bpeMR4TuhvFdw==';
export const FRAME_SANDBOX = 'allow-scripts'; // deliberately without allow-same-origin, allow-top-navigation, allow-popups, allow-forms
/** The policy asked of any page the frame navigates to (Chrome and Edge refuse a page that does not agree to it). */
export const FRAME_EMBEDDED_CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data:; font-src data:";
const TIMEOUT_MS = 30000;
const MAX_HEIGHT = 4000;
export const TIMING = { startMs: 5000, aliveEveryMs: 1000, staleMs: 3500, checkMs: 250, now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) }; // what the host waits for, and its clock; tests shorten them

const SHOWN_INSTEAD = 'The diagram source and the numbered steps are shown instead.';
const MESSAGES = {
  navigated: `The diagram tried to load another page inside its frame, so the frame was removed. ${SHOWN_INSTEAD}`,
  stalled: `The diagram frame stopped responding (it may have been sent to another page), so it was removed. ${SHOWN_INSTEAD}`,
  misbehaved: `The diagram frame sent an unexpected message, so it was removed. ${SHOWN_INSTEAD}`,
  noStart: `The diagram frame did not start, so nothing was drawn. A Content-Security-Policy on the page that hosts this tool is the usual cause: the frame inherits it, so it must allow inline scripts and https://cdn.jsdelivr.net (see the README). ${SHOWN_INSTEAD}`,
  timeout: `The diagram took too long to draw: the library could not be reached, or a Content-Security-Policy on the page that hosts this tool is blocking it (see the README). ${SHOWN_INSTEAD}`,
  replaced: 'This drawing was replaced by a newer one.',
};

export const currentTheme = () => {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const mermaidState = { status: 'idle' }; // idle | loading | ready | failed

/** The page that runs inside the frame. Pure text, so it can be tested without a browser. */
export function buildFrameDocument({ nonce, token = 'no-token', theme, url = MERMAID_URL, integrity = MERMAID_SRI, csp = true, aliveEveryMs = TIMING.aliveEveryMs } = {}) {
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  const dark = theme === 'dark';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
${csp ? `<meta http-equiv="Content-Security-Policy" content="${policy}">` : ''}
<style>:root{color-scheme:${dark ? 'dark' : 'light'}}html,body{margin:0;padding:0;background:transparent;color:${dark ? '#e6edf7' : '#0f172a'};font-family:system-ui,sans-serif}#out{padding:4px}#out svg{display:block;max-width:100%;height:auto}html{overflow:hidden}</style>
</head><body><div id="out"></div>
<script nonce="${nonce}">
(function () {
  var T = "${token}";
  var post = function (m) { m.t = T; parent.postMessage(m, '*'); };
  post({ kind: 'alive' });
  setInterval(function () { post({ kind: 'alive' }); }, ${Number(aliveEveryMs)});
  window.addEventListener('error', function (e) {
    if (e.target && e.target.tagName === 'SCRIPT') post({ kind: 'loaderror', message: 'The diagram library (Mermaid, from cdn.jsdelivr.net) could not be loaded.' });
  }, true);
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.kind !== 'draw' || d.t !== T || typeof d.source !== 'string') return;
    var fail = function (err) { post({ kind: 'error', message: 'Mermaid could not draw this diagram: ' + String(err && err.message || err).slice(0, 300) }); };
    try {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: ${dark ? "'dark'" : "'default'"}, fontFamily: 'system-ui, sans-serif' });
      mermaid.render('d' + Date.now(), d.source).then(function (r) {
        document.getElementById('out').innerHTML = r.svg;
        post({ kind: 'drawn', height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.getElementById('out').getBoundingClientRect().height)) + 6 });
      }, fail);
    } catch (err) { fail(err); }
  });
  window.addEventListener('load', function () { post({ kind: 'ready' }); });
})();
</script>
<script nonce="${nonce}" src="${url}" integrity="${integrity}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
</body></html>`;
}

const randomHex = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
};
const unref = (timer) => { if (timer && typeof timer.unref === 'function') timer.unref(); return timer; }; // so a pending timer never keeps a test process alive

/** The accTitle of a diagram, for the frame's title. Blanks only within the line: a pattern that may cross lines is quadratic on a long run of blank lines. */
export function diagramTitle(source) {
  return /^[ \t]*accTitle[ \t]*:[ \t]*(.+)$/m.exec(source)?.[1]?.trim().slice(0, 120);
}

/**
 * Draws `source` in a sandboxed frame appended to `container`, which must already be in the document. Resolves to the iframe, rejects with a message
 * fit to show. The frame's content is never read back: only its reported height is used. The frame is watched for as long as it is on the page
 * (see the notes at the top), and removed, with a message in `container`, if it misbehaves after the drawing was reported.
 * `options.frame` overrides buildFrameDocument's options and `options.timing` the waits (both used only by the tests of the sandbox itself);
 * `options.embeddedCsp === false` leaves out the iframe csp attribute, to test the other defences on their own.
 */
export function drawDiagram(container, source, options = {}) {
  // A browser loads an iframe only once it is in the document, so the container must already be on the page: a
  // frame inside a detached element never loads, never says it is ready, and ends as a timeout. Callers attach
  // the container first (and show a placeholder in it); this refuses a detached one at once instead of waiting.
  if (!container || !container.isConnected) return Promise.reject(new Error('This diagram could not be drawn: the place for it is not on the page. This is a fault in the tool, not in your record; the diagram source and the numbered steps are shown instead.'));
  mermaidState.status = 'loading';
  const timing = { ...TIMING, ...options.timing };
  const win = window; // kept: a timer that fires after the page is gone must not look for it
  const doc = document;
  const token = randomHex();
  const title = diagramTitle(source);
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', FRAME_SANDBOX);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  if (options.embeddedCsp !== false) frame.setAttribute('csp', FRAME_EMBEDDED_CSP);
  frame.setAttribute('title', title ? `Diagram: ${title}` : 'Sequence diagram');
  frame.style.cssText = 'width:100%;height:120px;border:0;display:block;';
  frame.srcdoc = buildFrameDocument({ nonce: randomHex(), token, theme: options.theme ?? currentTheme(), aliveEveryMs: timing.aliveEveryMs, ...options.frame });
  return new Promise((resolve, reject) => {
    const now = timing.now;
    let startedAt = now();
    let lastTick = startedAt;
    let settled = false; // the promise has been resolved or rejected
    let stopped = false; // the frame is gone or off the page: nothing is watched any more
    let loads = 0;
    let lastAlive = 0;
    let lateGraceSpent = false; // a late check has been forgiven and no "alive" has come since
    let readySeen = false;
    let drawSent = false;
    let drawn = false;
    let timeout;
    let watcher;
    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timeout);
      clearInterval(watcher);
      win.removeEventListener('message', onMessage);
      win.removeEventListener('pageshow', grace);
      doc.removeEventListener('visibilitychange', grace);
      doc.removeEventListener('resume', grace);
    }
    /**
     * The page itself was suspended (restored from the back/forward cache, a frozen background tab, a laptop that slept): the
     * frame's heartbeat could not arrive either, which says nothing about the frame. Start the waits again.
     */
    function grace() {
      if (stopped) return;
      const t = now();
      lastTick = t;
      startedAt = t;
      if (lastAlive) lastAlive = t;
      if (!settled) { clearTimeout(timeout); timeout = unref(setTimeout(() => { if (!settled) remove(MESSAGES.timeout); }, TIMEOUT_MS)); }
    }
    const settle = (fn) => { if (settled) return; settled = true; fn(); };
    /** Takes the frame away and says why: by rejecting the drawing, or, once it was reported, by a note where it was. */
    function remove(message) {
      stop();
      frame.remove();
      if (!settled) {
        mermaidState.status = 'failed';
        settle(() => reject(new Error(message)));
      } else {
        mermaidState.status = 'failed';
        const note = document.createElement('p');
        note.className = 'diagram-fail';
        note.textContent = message;
        container.append(note);
      }
    }
    // The first load is the frame's own document; any later one is a navigation away from it.
    frame.addEventListener('load', () => { if (++loads >= 2 && !stopped) remove(MESSAGES.navigated); });
    timeout = unref(setTimeout(() => { if (!settled) remove(MESSAGES.timeout); }, TIMEOUT_MS));
    watcher = setInterval(() => {
      // A newer drawing clears this one's holder: stop at once. The newer drawing owns the shared state.
      if (!frame.isConnected) { stop(); settle(() => reject(new Error(MESSAGES.replaced))); return; }
      const t = now();
      const late = t - lastTick > timing.staleMs; // this check itself came far too late: the page was suspended, not the frame
      lastTick = t;
      if (late) {
        // One late check is forgiven per heartbeat. A page that shares this page's process (Safari, Chrome on Android) can
        // keep this page busy for longer than the allowed silence, over and over; a frame that is really there answers within
        // a second of the page running again, so a second late check with no "alive" in between is the frame's doing.
        if (lateGraceSpent) { remove(lastAlive ? MESSAGES.stalled : MESSAGES.noStart); return; }
        lateGraceSpent = true;
        grace();
        return;
      }
      if (!lastAlive && t - startedAt > timing.startMs) remove(MESSAGES.noStart);
      else if (lastAlive && t - lastAlive > timing.staleMs) remove(MESSAGES.stalled);
    }, timing.checkMs);
    function onMessage(e) {
      if (e.source !== frame.contentWindow) return; // only our frame...
      const d = e.data;
      if (!d || typeof d !== 'object' || d.t !== token) return; // ...and only its own document, which is the one that knows the token
      if (d.kind === 'alive') { lastAlive = now(); lateGraceSpent = false; }
      else if (d.kind === 'loaderror' && !drawSent) remove(typeof d.message === 'string' ? `${d.message.slice(0, 300)} ${SHOWN_INSTEAD}` : 'The diagram could not be drawn.');
      else if (d.kind === 'ready') {
        if (readySeen) { remove(MESSAGES.misbehaved); return; } // it says ready once
        readySeen = true;
        drawSent = true;
        frame.contentWindow.postMessage({ kind: 'draw', source, t: token }, '*');
      } else if (d.kind === 'drawn' && drawSent && !drawn && Number.isFinite(d.height)) {
        drawn = true;
        clearTimeout(timeout);
        mermaidState.status = 'ready';
        frame.style.height = `${Math.min(Math.max(Math.round(d.height), 60), MAX_HEIGHT)}px`;
        settle(() => resolve(frame));
        unref(watcher); // it goes on watching the frame, but a finished drawing does not keep a process alive
      } else if (d.kind === 'error' && drawSent && !drawn) remove(typeof d.message === 'string' ? `${d.message.slice(0, 300)} ${SHOWN_INSTEAD}` : 'The diagram could not be drawn.');
      // anything else (a "drawn" or "error" that does not follow a draw the host sent, a second "drawn") is ignored
    }
    win.addEventListener('message', onMessage);
    win.addEventListener('pageshow', grace);
    doc.addEventListener('visibilitychange', grace);
    doc.addEventListener('resume', grace);
    container.append(frame);
    if (!frame.isConnected) { stop(); settle(() => reject(new Error(MESSAGES.replaced))); } // the container left the page at once
  });
}

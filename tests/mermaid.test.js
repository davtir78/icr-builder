import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrameDocument, FRAME_SANDBOX, MERMAID_URL, MERMAID_SRI, MERMAID_VERSION } from '../js/mermaid.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('a Mermaid release patched against CVE-2025-54881 (11.10.0) or later is pinned, with an integrity hash', () => {
  const [major, minor] = MERMAID_VERSION.split('.').map(Number);
  assert.ok(major > 11 || (major === 11 && minor >= 10), MERMAID_VERSION);
  assert.ok(MERMAID_URL.includes(`mermaid@${MERMAID_VERSION}/`));
  assert.match(MERMAID_SRI, /^sha512-[A-Za-z0-9+/]{86}==$/);
});

test('the diagram frame is sandboxed without same-origin, top navigation, popups or forms', () => {
  assert.equal(FRAME_SANDBOX, 'allow-scripts');
  for (const bad of ['allow-same-origin', 'allow-top-navigation', 'allow-popups', 'allow-forms', 'allow-modals']) assert.ok(!FRAME_SANDBOX.includes(bad));
});

test('the frame document has a CSP with no inline handlers, no network, and loads Mermaid only by nonce with SRI', () => {
  const doc = buildFrameDocument({ nonce: 'abc123', theme: 'light' });
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(doc)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-abc123'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline'[^;]*;.*script|script-src[^;]*unsafe/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(doc, new RegExp(`<script nonce="abc123" src="${MERMAID_URL.replace(/[.*+?^${}()|[\]\/]/g, '\$&')}" integrity="${MERMAID_SRI.replace(/[+/=]/g, '\$&')}" crossorigin="anonymous"`));
  assert.match(doc, /securityLevel: 'strict'/);
});

test('the page never inserts markup received from the frame: no innerHTML or similar outside the frame document', () => {
  for (const f of walk(path.join(ROOT, 'js')).filter((n) => n.endsWith('.js'))) {
    let src = fs.readFileSync(f, 'utf8');
    if (f.endsWith('mermaid.js')) src = src.replace(/return `<!doctype html>[\s\S]*?<\/html>`;/, ''); // the page that runs inside the sandbox
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, path.relative(ROOT, f));
  }
});

test('the page accepts from the frame only messages from that frame, and uses only a height from it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'mermaid.js'), 'utf8');
  assert.match(src, /e\.source !== frame\.contentWindow/);
  assert.match(src, /Number\.isFinite\(d\.height\)/);
});

test('the frame declares its colour scheme, so a transparent frame in a dark page is not painted white', () => {
  assert.match(buildFrameDocument({ nonce: 'n', theme: 'dark' }), /:root\{color-scheme:dark\}/);
  assert.match(buildFrameDocument({ nonce: 'n', theme: 'light' }), /:root\{color-scheme:light\}/);
});

test('the frame document carries a per-frame token on everything it posts, answers only a draw with that token, and keeps a heartbeat', () => {
  const doc = buildFrameDocument({ nonce: 'abc123', token: 'deadbeef0123', theme: 'light', aliveEveryMs: 777 });
  assert.match(doc, /var T = "deadbeef0123";/);
  assert.match(doc, /m\.t = T;/);
  assert.match(doc, /d\.t !== T/);
  assert.match(doc, /setInterval\(function \(\) \{ post\(\{ kind: 'alive' \}\); \}, 777\)/);
  assert.match(doc, /kind: 'loaderror'/);
});

test('the iframe asks any page it navigates to for a policy, the one thing the srcdoc cannot do (Chrome and Edge)', async () => {
  const { FRAME_EMBEDDED_CSP } = await import('../js/mermaid.js');
  assert.match(FRAME_EMBEDDED_CSP, /default-src 'none'/);
  assert.doesNotMatch(FRAME_EMBEDDED_CSP, /connect-src[^;]*\*|allow-same-origin/);
});

test('the comments and the README say what the defences are and are not, and no longer claim the CSP stops navigation or sending', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'mermaid.js'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const text of [src, readme]) {
    assert.doesNotMatch(text, /the frame cannot send the record anywhere\b(?! by a request)/);
    assert.doesNotMatch(text, /no network connections/);
    assert.doesNotMatch(text, /a request to another site is blocked/);
  }
  assert.match(src, /best effort/);
  assert.match(src, /HTML-injection bypass of the pinned/);
  assert.match(readme, /defence in depth/i);
  assert.match(readme, /heartbeat/);
});

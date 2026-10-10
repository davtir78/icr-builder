// A page that never finishes loading, for tests/browser/sandbox-xss.html (scenario H):  node tests/browser/hold-server.mjs [port]
//
// It answers /hold with the start of an HTML page and then keeps the response open for ever, so a frame sent there has
// navigated (the old document is gone) but never fires a load event. The page's script behaves like a hostile one:
// it announces itself to the page that embeds it, claims the frame is ready, and reports back anything it is sent.
import http from 'node:http';

const PORT = Number(process.argv[2] || 8124);
const PAGE = `<!doctype html><meta charset="utf-8"><title>held</title><p>a page that never finishes loading</p>
<script>
var top_ = parent;
top_.postMessage('navigated', String.fromCharCode(42));
window.addEventListener('message', function (e) { top_.postMessage({ sawDraw: e.data && e.data.kind }, String.fromCharCode(42)); });
setInterval(function () {
  top_.postMessage({ kind: 'ready' }, String.fromCharCode(42));
  top_.postMessage({ kind: 'alive' }, String.fromCharCode(42));
  top_.postMessage({ kind: 'drawn', height: 3900 }, String.fromCharCode(42));
}, 300);
</script>
`;

// /spin is the same, and its script also keeps the thread of whatever process it runs in busy for 4 s, rests 2.5 s, and repeats.
const SPIN_PAGE = PAGE.replace('</script>', 'function spin() { var t = Date.now(); while (Date.now() - t < 4000) { /* busy */ } setTimeout(spin, 2500); }\nspin();\n</script>');

http.createServer((req, res) => {
  if (!req.url.startsWith('/hold') && !req.url.startsWith('/spin')) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.write(req.url.startsWith('/spin') ? SPIN_PAGE : PAGE);
  const timer = setInterval(() => res.write(' '), 1000); // never ends
  req.on('close', () => clearInterval(timer));
}).listen(PORT, () => console.log(`holding at http://localhost:${PORT}/hold`));

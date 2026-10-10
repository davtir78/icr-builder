import { MAX_RECORD_BYTES } from './limits.js';
// Getting a record out of the page (download, clipboard) and in (a file the person chooses).
// Everything happens in the browser; nothing is uploaded.

export function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies text to the clipboard. Returns true on success. Falls back to a hidden textarea where the async API is blocked. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the older route */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Reads a chosen file as text, refusing anything over the record limit (an ICR is a few tens of KB). */
export async function readFile(file) {
  if (file.size > MAX_RECORD_BYTES) throw new Error(`That file is ${Math.round(file.size / 1024)} KB; an ICR is a small text file and the limit here is ${MAX_RECORD_BYTES / 1024} KB.`);
  return file.text();
}

/** Fetches a bundled example (a .md file in templates/). */
export async function fetchExample(file) {
  const res = await fetch(`templates/${file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`could not load templates/${file} (${res.status})`);
  return res.text();
}

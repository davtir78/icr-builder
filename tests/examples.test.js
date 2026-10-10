import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXAMPLES } from '../js/data/examples.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every bundled example exists, and is tracked by git (a clean clone must have it)', (t) => {
  let tracked = null;
  try { tracked = new Set(execFileSync('git', ['ls-files', 'templates'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean)); } catch { /* not a git checkout (a zip): only existence can be checked */ }
  for (const e of EXAMPLES) {
    assert.ok(fs.existsSync(path.join(ROOT, 'templates', e.file)), `${e.file} exists`);
    if (tracked) assert.ok(tracked.has(`templates/${e.file}`), `${e.file} is tracked by git (check .gitignore)`);
  }
  if (!tracked) t.diagnostic('not a git checkout: tracking not checked');
});

test('the templates folder holds only listed examples', () => {
  const listed = new Set(EXAMPLES.map((e) => e.file));
  for (const f of fs.readdirSync(path.join(ROOT, 'templates'))) assert.ok(listed.has(f), `${f} is not in js/data/examples.js`);
});

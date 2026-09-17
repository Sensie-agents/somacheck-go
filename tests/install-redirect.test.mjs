import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const html = await readFile(path.join(root, 'install', 'index.html'), 'utf8');

assert.match(html, /<script src="\/world-vibe\/config\.js"><\/script>/, '/install must load the shared install config, not its own copy of the URL');
assert.match(html, /location\.replace\(window\.SOMACHECK_INSTALL_URL\)/, '/install must redirect to the single source of truth, so it updates the moment config.js changes');
assert.doesNotMatch(html, /testflight\.apple\.com|apps\.apple\.com/, '/install must not hardcode either destination — config.js is the only place that literal belongs');

console.log('install-redirect: OK');

// world-vibe/config.js is the single source of the install CTA, shipped by all
// three v3 surfaces (Home, Explore, the share item page). This drives each real
// page, swaps only config.js, and checks every install link follows it. API
// routes are answered from captured rows (tests/helpers/captured.mjs); anything
// else is status-only. Needs Playwright (PLAYWRIGHT_PATH overrides the default).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickAnon, itemRow, feedRow, curators, featuredRow } from './helpers/captured.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/homebrew/lib/node_modules/playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const configJs = await readFile(path.join(root, 'world-vibe', 'config.js'), 'utf8');
const defaultInstallUrl = (configJs.match(/'([^']+)'/) || [])[1];
assert.ok(defaultInstallUrl, 'world-vibe/config.js must define a single quoted install URL literal');
const swappedInstallUrl = 'https://apps.apple.com/app/id6792978184';

// Each surface loads the shared config and reads the URL from it, never its own copy.
const SURFACES = [
  { name: 'home', page: '/world-vibe/', html: 'index.html', link: '#get-app', src: 'home/home.js' },
  { name: 'explore', page: '/world-vibe/explore/', html: 'explore/index.html', link: '#get-app', src: 'explore/explore.js' },
  { name: 'share item', page: '/world-vibe/share/?item=' + itemRow().slug, html: 'share/index.html', link: '#install', src: 'share/item.js' }
];
for (const s of SURFACES) {
  assert.match(await readFile(path.join(root, 'world-vibe', s.html), 'utf8'), /<script src="(?:\/world-vibe|\.\.)\/config\.js"><\/script>/, `${s.name}: must load the shared install config`);
  assert.match(await readFile(path.join(root, 'world-vibe', s.src), 'utf8'), /window\.SOMACHECK_INSTALL_URL/, `${s.name}: must read the shared install config`);
}

let servedConfigJs = configJs;
const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/world-vibe/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(servedConfigJs); return; }
  try {
    const file = path.join(root, decodeURIComponent(p).replace(/^\/+/, ''), p.endsWith('/') ? 'index.html' : '');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const API = 'https://api.test';
const browser = await chromium.launch({ headless: true });

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
async function installHref(surface) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript((api) => { window.SOMACHECK_API_BASE = api; }, API);
  await page.route(API + '/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/v1/public/world-vibe/pick') return json(route, pickAnon.body, pickAnon.status);
    if (u.pathname === '/v1/public/world-vibe/feed') return json(route, { items: [feedRow], next_cursor: null });
    if (u.pathname === '/v1/public/world-vibe/curators') return json(route, { curators });
    if (u.pathname === '/v1/public/world-vibe/featured') return json(route, { featured: featuredRow });
    if (u.pathname.startsWith('/v1/public/world-vibe/items/')) return json(route, itemRow());
    return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(origin + surface.page, { waitUntil: 'networkidle' });
  const href = await page.locator(surface.link).getAttribute('href');
  await page.close();
  return href;
}

try {
  for (const s of SURFACES) assert.equal(await installHref(s), defaultInstallUrl, `${s.name}: install link must equal world-vibe/config.js by default`);

  // Swap only config.js (the App Store cutover): every surface follows with no other file touched.
  servedConfigJs = `window.SOMACHECK_INSTALL_URL = window.SOMACHECK_INSTALL_URL || ${JSON.stringify(swappedInstallUrl)};\n`;
  for (const s of SURFACES) assert.equal(await installHref(s), swappedInstallUrl, `${s.name}: install link must follow a one-line config.js swap`);

  console.log(JSON.stringify({ passed: true, defaultInstallUrl, swappedInstallUrl, surfaces: SURFACES.map((s) => s.name) }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

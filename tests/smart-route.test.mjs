import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/homebrew/lib/node_modules/playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.WVSMART_ROOT || path.resolve(here, '..');
const fallbackPath = path.join(root, '404.html');
const sourcePath = path.join(root, 's', 'index.html');
const qrLibraryPath = path.join(root, 'world-vibe', 'qrcode.min.js');
const token = 'wvsmart-functional-gate';
const statement = 'I trust my gut more than my dashboard';
const expectedUniversalLink = `https://go.somacheck.com/s/${token}`;
const expectedAppLink = `somacheck://s/${token}`;
const expectedInstallLink = 'https://testflight.apple.com/join/C4mAH3zz';

const [fallback, source, qrLibrary] = await Promise.all([
  readFile(fallbackPath, 'utf8'),
  readFile(sourcePath, 'utf8'),
  readFile(qrLibraryPath, 'utf8')
]);

assert.equal(fallback, source, '404.html must stay identical to s/index.html because GitHub Pages serves it for /s/<token>');
assert.match(qrLibrary, /QRCode=function/, 'the local QR renderer must be present');
assert.doesNotMatch(source, /(?:data\.deeplink|data\.app_store_url|\?pt=|somacheck_deferred_token)/, 'stale or misleading routing fields must not return');
assert.doesNotMatch(source, /your body knows|—/i, 'all fallback and social-preview copy must preserve human authority and avoid em dashes');
assert.match(source, /return to this link to open this statement\./, 'no-app flow must state the honest post-TestFlight return step');

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');

  if (url.pathname === `/api/s/${token}` && url.searchParams.get('format') === 'json') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      text: statement,
      status: 'pending'
    }));
    return;
  }

  if (url.pathname.startsWith('/api/s/')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  if (url.pathname === '/world-vibe/qrcode.min.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(qrLibrary);
    return;
  }

  if (url.pathname.startsWith('/s/')) {
    const configuredFallback = fallback.replace(
      '<script src="/world-vibe/qrcode.min.js"></script>',
      `<script>window.SOMACHECK_API_BASE = ${JSON.stringify(`http://127.0.0.1:${address.port}/api`)};</script>\n  <script src="/world-vibe/qrcode.min.js"></script>`
    );
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(configuredFallback);
    return;
  }

  response.writeHead(404);
  response.end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const apiResponse = page.waitForResponse((response) => response.url().includes(`/api/s/${token}?format=json`));
  await page.goto(`${origin}/s/${token}`, { waitUntil: 'networkidle' });
  assert.equal((await apiResponse).status(), 200, 'statement resolver must succeed');

  await assert.doesNotReject(() => page.locator('#statement-text').waitFor({ state: 'visible' }));
  assert.equal(await page.locator('#statement-text').textContent(), statement, 'resolved statement must be shown exactly');
  assert.equal(await page.locator('#open-app').getAttribute('href'), expectedAppLink, 'button must use the installed-app custom scheme');
  assert.equal(await page.locator('#app-store').getAttribute('href'), expectedInstallLink, 'install button must use the real public TestFlight URL');
  assert.equal(await page.locator('#statement-qr').getAttribute('data-payload'), expectedUniversalLink, 'QR payload must be the first-party universal link');
  assert.equal(await page.locator('#statement-qr').getAttribute('title'), expectedUniversalLink, 'rendered QR must encode the same universal link');

  const qr = page.locator('#statement-qr');
  const box = await qr.boundingBox();
  assert.ok(box && box.width >= 210 && box.height >= 210, 'QR must be visibly large enough to scan with a four-module quiet zone');
  assert.equal(await qr.locator('canvas').count(), 1, 'QR renderer must draw a real canvas');
  await qr.screenshot({ path: path.join(process.env.WVSMART_ARTIFACT_DIR || '/tmp', 'wvsmart-qr.png') });

  assert.match(await page.locator('#statement-hint').textContent(), /check-in saves to your account\. Any public World Vibe results appear only in aggregate\./i, 'fallback copy must stay truthful about account linkage and aggregate-only public results');
  assert.match(await page.locator('.install-note').textContent(), /install it through TestFlight, then return to this link/i, 'no-app limitation must be visible');
  assert.equal(await page.locator('#status-badge').textContent(), 'Shared check-in', 'page must reach its loaded state');

  const missing = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await missing.goto(`${origin}/s/not-a-real-token`, { waitUntil: 'networkidle' });
  await missing.locator('#error-msg').waitFor({ state: 'visible' });
  assert.match(await missing.locator('#error-msg').textContent(), /could not be loaded/i, 'invalid token must fail honestly');
  assert.equal(await missing.locator('#statement-qr canvas').count(), 0, 'invalid token must not show a misleading QR');

  console.log(JSON.stringify({
    passed: true,
    statement,
    appLink: expectedAppLink,
    installLink: expectedInstallLink,
    qrPayload: expectedUniversalLink,
    qrArtifact: path.join(process.env.WVSMART_ARTIFACT_DIR || '/tmp', 'wvsmart-qr.png')
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

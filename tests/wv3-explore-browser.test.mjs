// Real-browser checks for Explore: viewport behaviour of the Chrome callout,
// curator click, Following tab network source, and axe. Needs Playwright and
// axe-core (PLAYWRIGHT_PATH, AXE_PATH override the defaults).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/homebrew/lib/node_modules/playwright');
const AXE = process.env.AXE_PATH || '/Users/theagents/.npm/_npx/e003b6b07d062486/node_modules/axe-core/axe.min.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  try {
    const file = path.join(root, p.endsWith('/') ? p + 'index.html' : p);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/world-vibe/explore/';

const browser = await chromium.launch();
let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('ok - ' + name); } catch (e) { failed++; console.log('not ok - ' + name + '\n' + e.message); }
};
async function open(width, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('.post');
  return { page, requests, errors };
}

await check('Chrome callout hidden at 999px, visible at 1000px', async () => {
  const a = await open(999);
  assert.equal(await a.page.locator('#chrome-callout').isVisible(), false);
  assert.equal(await a.page.locator('#chrome-callout').evaluate((e) => getComputedStyle(e).display !== 'none' && e.offsetParent !== null), false);
  await a.page.close();
  const b = await open(1000);
  assert.equal(await b.page.locator('#chrome-callout').isVisible(), true);
  await b.page.close();
});

await check('Chrome callout hidden at 420px', async () => {
  const a = await open(420);
  assert.equal(await a.page.locator('#chrome-callout').isVisible(), false);
  await a.page.close();
});

await check('curator click filters to that curator (strip at 420px, list at 1280px), click again clears', async () => {
  const m = await open(420);
  assert.equal(await m.page.locator('.post').count(), 7);
  await m.page.click('#strip [data-who="Maya K."]');
  assert.equal(await m.page.locator('.post').count(), 2);
  const bylines = await m.page.locator('.post .by b').allTextContents();
  assert.deepEqual(bylines, ['Maya K.', 'Maya K.']);
  assert.equal(await m.page.locator('#filter').isVisible(), true);
  await m.page.click('#clear');
  assert.equal(await m.page.locator('.post').count(), 7);
  await m.page.close();
  const d = await open(1280);
  await d.page.click('#cur-list [data-who="Ana G."]');
  assert.equal(await d.page.locator('.post').count(), 1);
  assert.equal(await d.page.locator('#cur-list [data-who="Ana G."]').getAttribute('aria-pressed'), 'true');
  await d.page.close();
});

await check('Following tab fetches following-feed and shows those rows', async () => {
  const { page, requests } = await open(420);
  assert.ok(requests.some((u) => u.endsWith('fixtures/feed-v3.json')));
  await page.click('#tab-following');
  assert.ok(requests.some((u) => u.endsWith('fixtures/following-feed.json')));
  assert.equal(await page.locator('.post').count(), 2);
  assert.equal(await page.locator('#tab-following').getAttribute('aria-selected'), 'true');
  await page.close();
});

await check('public-signal card never shows the curator name in the DOM', async () => {
  const { page } = await open(1280);
  const body = await page.content();
  assert.ok(!body.includes('Should Never Render'));
  assert.ok(body.includes('Shown publicly by choice'));
  await page.close();
});

await check('Check in sheet opens with the exact statement and closes on Escape', async () => {
  const { page } = await open(420);
  await page.locator('.post').first().locator('[data-check]').click();
  assert.equal(await page.locator('#sheet-line').textContent(), 'I think AI is creating more jobs than it is destroying.');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#scrim').isHidden(), true);
  await page.close();
});

for (const [name, width, act] of [
  ['mobile 420', 420, null], ['mobile 420 following', 420, '#tab-following'], ['mobile 420 curator filter', 420, '#strip [data-who="Sam R."]'],
  ['desktop 1280', 1280, null], ['desktop 1280 curator filter', 1280, '#cur-list [data-who="Maya K."]']
]) {
  await check('axe 0 serious/critical: ' + name, async () => {
    const { page, errors } = await open(width);
    if (act) await page.click(act);
    await page.addScriptTag({ path: AXE });
    const res = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
    const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    assert.deepEqual(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | ')), []);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

await browser.close();
server.close();
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all browser checks passed');

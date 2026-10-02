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

// The page talks to the live routes; the browser tests answer them with
// envelopes built from the captured contract fixtures.
const fx = async (n) => JSON.parse(await readFile(path.join(root, 'world-vibe', 'explore', 'fixtures', n), 'utf8'));
const REAL = { feed: await fx('wv3_explore_feed.json'), item: await fx('wv3_explore_item.json'), curators: await fx('wv3_explore_curators.json'), featured: await fx('wv3_explore_featured.json'), following: await fx('wv3_explore_following.json') };
const [A, B] = REAL.curators.map((c) => c.curator_id);
const row = (o) => ({ ...REAL.feed, ...o });
const FEED = [
  row({ slug: 'a-1', curator_id: A, statement: 'I think the first line is mine.' }),
  row({ slug: 'b-1', curator_id: B, statement: 'I think the second line is theirs.' }),
  row({ slug: 'a-2', curator_id: A, contributor_count: 7, aligned: null, unaligned: null, lean: 'mixed' }),
  { ...REAL.item, curator_id: A, curator_name: 'Should Never Render' }
];
const API = 'https://api.test';
const respond = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

const browser = await chromium.launch();
let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('ok - ' + name); } catch (e) { failed++; console.log('not ok - ' + name + '\n' + e.message); }
};
async function open(width, height = 900, opts = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(API + '/**', (route) => {
    const u = route.request().url();
    if (u.includes('/world-vibe/feed')) return respond(route, { items: FEED, next_cursor: null });
    if (u.includes('/world-vibe/curators')) return respond(route, { curators: REAL.curators });
    if (u.includes('/world-vibe/featured')) return respond(route, { featured: opts.noFeatured ? null : REAL.featured });
    if (u.includes('/following-feed')) return respond(route, { items: [REAL.following] });
    return route.fulfill({ status: 404 });
  });
  await page.addInitScript((api) => { window.SOMACHECK_API_BASE = api; }, API);
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

await check('curator click filters by curator_id (two curators both named Alex), click again clears', async () => {
  const m = await open(420);
  assert.equal(await m.page.locator('.post').count(), 4);
  await m.page.click('#strip [data-who="' + A + '"]');
  assert.deepEqual(await m.page.locator('.post').evaluateAll((els) => els.map((e) => e.dataset.slug)), ['a-1', 'a-2']);
  assert.equal(await m.page.locator('#filter').isVisible(), true);
  assert.equal(await m.page.locator('#filter-text').textContent(), 'Lines from Alex');
  await m.page.click('#clear');
  assert.equal(await m.page.locator('.post').count(), 4);
  await m.page.close();
  const d = await open(1280);
  await d.page.click('#cur-list [data-who="' + B + '"]');
  assert.deepEqual(await d.page.locator('.post').evaluateAll((els) => els.map((e) => e.dataset.slug)), ['b-1']);
  assert.equal(await d.page.locator('#cur-list [data-who="' + B + '"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await d.page.locator('#cur-list [data-who="' + A + '"]').getAttribute('aria-pressed'), 'false');
  await d.page.close();
});

await check('Topic of the Week hero renders from /featured and is hidden when there is none', async () => {
  const a = await open(420);
  assert.ok(a.requests.some((u) => u.endsWith('/v1/public/world-vibe/featured?slot=topic_of_week')));
  assert.equal(await a.page.locator('#hero .totw').isVisible(), true);
  assert.equal(await a.page.locator('#hero h2').textContent(), 'I feel ready for this');
  await a.page.locator('#hero [data-check]').click();
  assert.equal(await a.page.locator('#sheet-line').textContent(), 'I feel ready for this');
  await a.page.close();
  const b = await open(420, 900, { noFeatured: true });
  assert.equal(await b.page.locator('#hero').isHidden(), true);
  await b.page.close();
});

await check('Following tab fetches the following-feed route and shows curator name and category', async () => {
  const { page, requests } = await open(420);
  assert.ok(requests.some((u) => u.endsWith('/v1/public/world-vibe/feed')));
  assert.ok(!requests.some((u) => u.includes('following-feed')));
  await page.click('#tab-following');
  await page.waitForSelector('.post');
  assert.ok(requests.some((u) => u.endsWith('/v1/me/world-vibe/following-feed')));
  assert.equal(await page.locator('.post').count(), 1);
  assert.equal(await page.locator('.post .by b').textContent(), 'Alex');
  assert.equal(await page.locator('.post .cat').textContent(), 'Politics');
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
  assert.equal(await page.locator('#sheet-line').textContent(), 'I think the first line is mine.');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#scrim').isHidden(), true);
  await page.close();
});

for (const [name, width, act] of [
  ['mobile 420', 420, null], ['mobile 420 following', 420, '#tab-following'], ['mobile 420 curator filter', 420, '#strip [data-who="' + B + '"]'],
  ['desktop 1280', 1280, null], ['desktop 1280 curator filter', 1280, '#cur-list [data-who="' + A + '"]']
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

// Real-browser checks for the v3 home, the web session and the consent toggle.
// The routes are answered with stand-ins built around the captured contract rows
// (tests/helpers/captured.mjs). Needs Playwright and axe-core (PLAYWRIGHT_PATH,
// AXE_PATH override the defaults).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickAnon, progressLocked, progressLean, progressExact, pickEnvelope, progressEnvelope, consentBody, phoneBody, itemRow, sendOk, sendLinkRequired, draftsCreate, draftsConsentRequired, privateAsk, pickEmpty, refusal, emptyPick, feedRow, curators, featuredRow } from './helpers/captured.mjs';

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
const ORIGIN = 'http://127.0.0.1:' + server.address().port;

const API = 'https://api.test';
const SB = 'https://sb.test';
const KEY = 'sb_publishable_browser_test';
const RECEIPT = sendOk.body.request_id;
const DRAFT = draftsCreate.body.drafts[0].id;
const LINES = draftsCreate.body.drafts.map((d) => d.statement);
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
// A refusal is replayed from its capture: status and body unchanged.
const refuse = (route, name) => { const c = refusal(name); return json(route, c.body, c.status); };
// status-only stub for a 5xx (transport): no invented body
const bare = (route, status) => route.fulfill({ status, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
const PICKS = [
  pickEnvelope('shared_link', { slug: 'pick-one', statement: 'I trust my gut over my dashboard.' }),
  pickEnvelope('closest_to_unlock', { slug: 'pick-two', statement: 'I feel ready for Monday.', contributor_count: 2, aligned: null, unaligned: null, lean: null }),
  pickEnvelope('following', { slug: 'pick-three', statement: 'I am saying yes too often.' })
];

const browser = await chromium.launch();
let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('ok - ' + name); } catch (e) { failed++; console.log('not ok - ' + name + '\n' + e.stack); }
};

// opts: signedIn, intent ({ slug, nonce, user, signin }: seeds wv.send_intent as a link exchange would leave it, and wv.pkce with that request id), key (default KEY; 'default' leaves the shipped config.js key alone; '' serves a config.js without one), linked (phone route, default true), item (item route status or body), link (true: ask succeeds, false: 422), consent (initial), draftsStatus,
//       progress (array of bodies served in order), pageUrl, picks
async function open(width, opts = {}) {
  // opts.context: open this page in that browser context (a second tab sharing storage with its other pages)
  const page = opts.context ? await opts.context.newPage() : await browser.newPage({ viewport: { width, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const log = { api: [], sb: [], pickUrls: [], asks: [], drafts: [], draftAsks: [], progress: [], consentWrites: [], phone: [], items: [], otp: [], logout: [], exchange: [], verify: [] };
  let consent = opts.consent === true;
  log.consentReads = [];
  let progressCalls = 0;
  let pickCalls = 0;
  await page.route(API + '/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const headers = await req.allHeaders();
    log.api.push({ url: u.pathname + u.search, auth: headers.authorization, method: req.method() });
    if (req.method() === 'OPTIONS') return json(route, {});
    if (u.pathname === '/v1/public/world-vibe/pick') { log.pickUrls.push(u.search); const picks = opts.picks || PICKS; return json(route, picks[pickCalls++] || pickEmpty.body, pickEmpty.status); }
    if (u.pathname.endsWith('/progress')) {
      log.progress.push({ url: u.pathname + u.search, auth: headers.authorization });
      const list = opts.progress || [progressEnvelope({ slug: 'pick-one' })];
      return json(route, list[Math.min(progressCalls++, list.length - 1)]);
    }
    if (u.pathname.endsWith('/ask') && u.pathname.startsWith('/v1/me/world-vibe/items/')) {
      log.asks.push({ path: u.pathname, auth: headers.authorization });
      if (opts.link === false) return json(route, sendLinkRequired.body, sendLinkRequired.status);
      return json(route, sendOk.body, sendOk.status);
    }
    if (u.pathname === '/v1/me/vibecheck/drafts') {
      log.drafts.push({ body: JSON.parse(req.postData() || '{}'), auth: headers.authorization });
      if (opts.draftsStatus) return json(route, draftsConsentRequired.body, opts.draftsStatus);
      return json(route, draftsCreate.body);
    }
    if (/^\/v1\/me\/vibecheck\/drafts\/[^/]+\/ask$/.test(u.pathname)) { log.draftAsks.push({ path: u.pathname, auth: headers.authorization }); return json(route, privateAsk.body, privateAsk.status); }
    if (u.pathname === '/v1/me/world-vibe/consent') {
      if (!headers.authorization) return refuse(route, req.method() === 'PUT' ? 'consent_put_401' : 'consent_get_401');
      if (req.method() === 'PUT') { const b = JSON.parse(req.postData()); log.consentWrites.push({ body: b, headers }); consent = b.world_vibe_private; return json(route, consentBody(consent)); }
      log.consentReads.push({ headers });
      return json(route, consentBody(consent));
    }
    if (u.pathname === '/v1/me/world-vibe/phone') {
      log.phone.push(headers.authorization);
      if (!headers.authorization) return refuse(route, 'phone_401');
      return json(route, phoneBody(opts.linked !== false));
    }
    if (u.pathname.startsWith('/v1/public/world-vibe/items/') && !u.pathname.endsWith('/progress')) {
      log.items.push({ path: u.pathname, auth: headers.authorization });
      const it = opts.item;
      if (it === 404) return refuse(route, 'item_404');
      if (typeof it === 'number') return bare(route, it);
      return json(route, it || itemRow({ slug: decodeURIComponent(u.pathname.split('/').pop()) }));
    }
    if (u.pathname === '/v1/public/world-vibe/feed') return json(route, { items: [feedRow], next_cursor: null });
    if (u.pathname === '/v1/public/world-vibe/curators') return json(route, { curators });
    if (u.pathname === '/v1/public/world-vibe/featured') return json(route, { featured: featuredRow });
    return route.fulfill({ status: 404 });
  });
  await page.route(SB + '/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const headers = await req.allHeaders();
    log.sb.push({ url: u.pathname + u.search, auth: headers.authorization, apikey: headers.apikey, method: req.method() });
    if (req.method() === 'OPTIONS') return json(route, {});
    if (u.pathname === '/auth/v1/otp') { log.otp.push({ body: JSON.parse(req.postData()), url: u.search, headers }); return json(route, {}); }
    if (u.pathname === '/auth/v1/token') { log.exchange.push(JSON.parse(req.postData())); return json(route, { access_token: 'tok-new', refresh_token: 'r-new', expires_in: 3600, user: { id: 'u-1', email: 'me@x.test' } }); }
    if (u.pathname === '/auth/v1/logout') { log.logout.push(headers.authorization); return json(route, {}); }
    if (u.pathname === '/auth/v1/verify') {
      const body = JSON.parse(req.postData());
      log.verify.push({ body, headers });
      if (body.token !== '123456') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant' }) });
      return json(route, { access_token: 'tok-code', refresh_token: 'r-code', expires_in: 3600, user: { id: 'u-1', email: 'me@x.test' } });
    }
    return route.fulfill({ status: 404 });
  });
  if (opts.key === '') await page.route(ORIGIN + '/world-vibe/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.SOMACHECK_INSTALL_URL = 'https://testflight.apple.com/join/x';" }));
  await page.addInitScript(({ api, sb, key, signedIn, intent }) => {
    window.SOMACHECK_API_BASE = api;
    window.SOMACHECK_SUPABASE_URL = sb;
    if (key && key !== 'default') window.SOMACHECK_SUPABASE_PUBLISHABLE_KEY = key;
    if (signedIn && !localStorage.getItem('wv.session')) localStorage.setItem('wv.session', JSON.stringify({ access_token: 'tok-abc', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400, user_id: 'u-1', email: 'me@x.test' }));
    if (intent && !localStorage.getItem('wv.send_intent')) {
      localStorage.setItem('wv.send_intent', JSON.stringify(intent));
      // the request the intent came from is still the latest sign-in
      if (intent.signin && !localStorage.getItem('wv.pkce')) localStorage.setItem('wv.pkce', JSON.stringify({ id: intent.signin }));
    }
  }, { api: API, sb: SB, key: opts.key === undefined ? KEY : opts.key, signedIn: opts.signedIn, intent: opts.intent });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const navs = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
  await page.goto(ORIGIN + (opts.pageUrl || '/world-vibe/'));
  if (!opts.noWait) await page.waitForSelector('#slot article');
  return { page, log, errors, navs };
}
const bearers = (log) => [...log.api, ...log.sb].filter((r) => r.auth);
// The PKCE challenge an email request carries, for checking an exchange used that request's verifier.
const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');

await check('signed out: the card shows its reason and no request carries a bearer', async () => {
  const { page, log, errors } = await open(420);
  assert.match(await page.locator('.why').textContent(), /Picked for you · Someone shared this with you\./);
  assert.equal(await page.locator('.line').textContent(), 'I trust my gut over my dashboard.');
  assert.deepEqual(bearers(log), []);
  assert.deepEqual(errors, []);
  assert.match(log.pickUrls[0], /^\?tz=/);
  await page.close();
});

await check('signed in: the pick request carries the bearer', async () => {
  const { page, log } = await open(420, { signedIn: true });
  assert.equal(log.api.find((r) => r.url.startsWith('/v1/public/world-vibe/pick')).auth, 'Bearer tok-abc');
  await page.close();
});

await check('"Not this one" grows the exclude list on each pick', async () => {
  const { page, log } = await open(420);
  await page.locator('[data-act="skip"]').click();
  await page.waitForFunction(() => document.querySelector('.line').textContent.includes('Monday'));
  await page.locator('[data-act="skip"]').click();
  await page.waitForFunction(() => document.querySelector('.line').textContent.includes('yes too often'));
  const ex = log.pickUrls.map((s) => new URLSearchParams(s).get('exclude'));
  assert.deepEqual(ex, [null, 'pick-one', 'pick-one,pick-two']);
  assert.match(await page.locator('.why').textContent(), /From a curator you follow\./);
  await page.close();
});

await check('signed out: the anonymous pick capture renders as a shared link, no bearer', async () => {
  const { page, log, errors } = await open(420, { picks: [pickAnon.body] });
  assert.match(await page.locator('.why').textContent(), /Picked for you · Someone shared this with you\./);
  assert.equal(await page.locator('.line').textContent(), pickAnon.body.item.statement);
  assert.deepEqual(bearers(log), []);
  assert.deepEqual(errors, []);
  await page.close();
});

for (const [name, cap, want] of [['locked', progressLocked, /0 of 3 checked in/], ['lean', progressLean, /Leans aligned · 3 checked in/], ['exact', progressExact, /50% aligned/]]) {
  await check('the ' + name + ' progress capture drives the reveal ladder on the card', async () => {
    const { page } = await open(420, { signedIn: true, progress: [{ ...cap, slug: 'pick-one', your_checkin_counted: true }] });
    await page.locator('[data-act="check"]').click();
    await page.locator('[data-act="send"]').click();
    await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
    await page.locator('[data-act="checked"]').click();
    await page.waitForSelector('.reveal-head');
    assert.match((await page.locator('.meter').textContent()).replace(/\s+/g, ' '), want);
    if (cap !== progressExact) assert.doesNotMatch(await page.locator('.meter').textContent(), /%/);
    await page.close();
  });
}

await check('closest_to_unlock shows the head count and the reveal ladder, not a lean', async () => {
  const { page } = await open(420);
  await page.locator('[data-act="skip"]').click();
  await page.waitForFunction(() => document.querySelector('.line').textContent.includes('Monday'));
  assert.match(await page.locator('.why').textContent(), /2 of 3 have checked in\. Yours could reveal it\./);
  assert.equal(await page.locator('.dots').count(), 1);
  assert.doesNotMatch(await page.locator('.meter').textContent(), /%|Leans/);
  await page.close();
});

await check('an empty pick is an honest state with Start over', async () => {
  const { page, log } = await open(420, { picks: [emptyPick, PICKS[0]] });
  assert.match(await page.locator('#slot').textContent(), /seen everything for now/);
  await page.locator('[data-act="retry"]').click();
  await page.waitForFunction(() => document.querySelector('.line'));
  assert.equal(log.pickUrls.length, 2);
  await page.close();
});

await check('signed out check sheet: QR with the share URL, no Send to my phone, no ask request', async () => {
  const { page, log } = await open(420);
  await page.locator('[data-act="check"]').click();
  assert.equal(await page.locator('#sheet [data-act="send"]').count(), 0);
  const url = await page.locator('#qr').getAttribute('data-qr');
  assert.equal(url, 'https://go.somacheck.com/world-vibe/share/?item=pick-one');
  assert.ok(await page.locator('#qr canvas, #qr img').count() > 0, 'the QR drew');
  assert.equal(await page.locator('#qr img').getAttribute('alt'), 'QR code that opens this line in the SomaCheck app');
  assert.equal(log.asks.length, 0);
  assert.match(await page.locator('#sheet .big').textContent(), /I trust my gut over my dashboard\./);
  await page.close();
});

await check('signed in with a link: Send to my phone posts the ask with the bearer', async () => {
  const { page, log } = await open(420, { signedIn: true });
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="send"]').click();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  assert.deepEqual(log.asks, [{ path: '/v1/me/world-vibe/items/pick-one/ask', auth: 'Bearer tok-abc' }]);
  assert.equal(await page.locator('#sheet [data-act="send"]').count(), 0);
  await page.close();
});

await check('422 link_required: the Send button goes away, the QR stays, and the sheet says why', async () => {
  const { page, log } = await open(420, { signedIn: true, link: false });
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="send"]').click();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('connect an agent'));
  assert.equal(await page.locator('#sheet [data-act="send"]').count(), 0);
  assert.ok(await page.locator('#qr canvas, #qr img').count() > 0);
  assert.equal(log.asks.length, 1);
  // Reopening the sheet for the same card does not offer the dead button again.
  await page.keyboard.press('Escape');
  await page.locator('[data-act="check"]').click();
  assert.equal(await page.locator('#sheet [data-act="send"]').count(), 0);
  await page.close();
});

await check('after a send, progress with the receipt: not yet, then YOU REVEALED IT with only the viewer\'s own reading', async () => {
  const progress = [progressEnvelope({ slug: 'pick-one', your_checkin_counted: false }), progressEnvelope({ slug: 'pick-one', your_checkin_counted: true, revealed_by_you: true, your_reading: 'aligned' })];
  const { page, log } = await open(420, { signedIn: true, progress });
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="send"]').click();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  await page.locator('[data-act="checked"]').click();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Not yet'));
  assert.equal(await page.locator('.reveal-head').count(), 0);
  await page.locator('[data-act="checked"]').click();
  await page.waitForSelector('.reveal-head');
  assert.equal(await page.locator('.reveal-head').textContent(), 'YOU REVEALED IT');
  assert.match(await page.locator('.own').textContent(), /Your reading: Aligned\. Only you see this\./);
  assert.ok(log.progress.every((p) => p.url === '/v1/public/world-vibe/items/pick-one/progress?receipt=' + RECEIPT && p.auth === 'Bearer tok-abc'), JSON.stringify(log.progress));
  assert.equal(await page.locator('#scrim').isHidden(), true);
  await page.close();
});

await check('counted but not the crossing check-in: YOU\'RE IN, and no own reading when the server sent none', async () => {
  const progress = [progressEnvelope({ slug: 'pick-one', your_checkin_counted: true, revealed_by_you: false, your_reading: null })];
  const { page } = await open(420, { signedIn: true, progress });
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="send"]').click();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  await page.locator('[data-act="checked"]').click();
  await page.waitForSelector('.reveal-head');
  assert.match(await page.locator('.reveal-head').textContent(), /YOU'RE IN/);
  assert.equal(await page.locator('.own').count(), 0);
  await page.close();
});

await check('QR path with no receipt: progress is requested without receipt or bearer and the page claims nothing about the person', async () => {
  const { page, log } = await open(420);
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="checked"]').click();
  await page.waitForSelector('.reveal-head');
  assert.equal(await page.locator('.reveal-head').textContent(), 'THE ROOM SO FAR');
  assert.deepEqual(log.progress, [{ url: '/v1/public/world-vibe/items/pick-one/progress', auth: undefined }]);
  assert.equal(await page.locator('.own').count(), 0);
  await page.close();
});

await check('reveal "One more?" excludes the item just checked and loads the next pick', async () => {
  const { page, log } = await open(420, { progress: [progressEnvelope({ slug: 'pick-one' })] });
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="checked"]').click();
  await page.waitForSelector('[data-act="next"]');
  await page.locator('[data-act="next"]').click();
  await page.waitForFunction(() => document.querySelector('.line'));
  assert.equal(new URLSearchParams(log.pickUrls[1]).get('exclude'), 'pick-one');
  await page.close();
});

await check('Bring your own line is the Chrome callout only', async () => {
  const { page } = await open(420);
  await page.locator('[data-open="bring"]').click();
  assert.equal(await page.locator('#sheet .chrome').count(), 1);
  assert.equal(await page.locator('#sheet input, #sheet textarea').count(), 0);
  await page.close();
});

await check('private lane signed out: sign-in prompt, no drafts call, no consent call', async () => {
  const { page, log } = await open(420);
  await page.locator('#tab-private').click();
  assert.equal(await page.locator('[data-act="generate"]').count(), 0);
  assert.equal(await page.locator('#slot [data-open="signin"]').count(), 1);
  assert.equal(log.drafts.length, 0);
  assert.equal(log.consentReads.length + log.phone.length, 0);
  assert.equal(log.sb.length, 0);
  await page.close();
});

await check('private lane, consent off: the agent source is disabled and never calls /vibecheck/drafts; words still writes', async () => {
  const { page, log } = await open(420, { signedIn: true, consent: false });
  const read = page.waitForResponse(/world-vibe\/consent/);
  await page.locator('#tab-private').click();
  await read;
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await page.locator('#consent').isChecked(), false);
  assert.equal(await page.locator('[data-act="generate"]').isDisabled(), true);
  // Even with the DOM forced enabled, the handler itself refuses while consent is not on.
  await page.evaluate(() => { document.querySelector('[data-act="generate"]').disabled = false; });
  await page.locator('[data-act="generate"]').click();
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.locator('[role="alert"]').textContent(), /Turn on the setting below/);
  assert.equal(log.drafts.length, 0, 'the agent source made no request');
  await page.locator('[data-ctx="words"]').click();
  assert.equal(await page.locator('[data-act="generate"]').isDisabled(), false, 'words does not wait for consent');
  await page.locator('#mind').fill('a deadline');
  await page.locator('[data-act="generate"]').click();
  await page.waitForSelector('#slot .line:not(.small)');
  assert.deepEqual(log.drafts, [{ body: { source: 'words', words: 'a deadline' }, auth: 'Bearer tok-abc' }]);
  assert.equal(log.consentWrites.length, 0, 'consent was never switched on');
  await page.close();
});

await check('consent toggle round-trips through the API, then drafts are requested with the bearer', async () => {
  const { page, log } = await open(420, { signedIn: true, consent: false });
  await page.locator('#tab-private').click();
  await page.waitForSelector('#consent');
  await page.locator('#consent').check();
  await page.waitForFunction(() => document.getElementById('consent').checked && !document.querySelector('[data-act="generate"]').disabled);
  assert.equal(log.consentWrites.length, 1);
  assert.deepEqual(log.consentWrites[0].body, { world_vibe_private: true });
  assert.equal(log.consentWrites[0].headers.authorization, 'Bearer tok-abc');
  assert.equal(log.sb.filter((r) => r.url.includes('/rest/v1/')).length, 0, 'consent never goes through PostgREST');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'consent', 'focus stays on the switch');
  await page.locator('[data-act="generate"]').click();
  await page.waitForSelector('#slot .line:not(.small)');
  assert.deepEqual(log.drafts, [{ body: { source: 'agent' }, auth: 'Bearer tok-abc' }]);
  assert.equal(await page.locator('.line').textContent(), LINES[0]);
  assert.match(await page.locator('.private-note').textContent(), /Only you see this line and your reading/);
  // Turning it back off disables the button again and writes false.
  await page.locator('[data-act="rewrite"]').click();
  assert.equal(await page.locator('.line').textContent(), LINES[1]);
  await page.close();
});

await check('consent that is already on reads back as on after a reload of the lane', async () => {
  const { page } = await open(420, { signedIn: true, consent: true });
  await page.locator('#tab-private').click();
  await page.waitForFunction(() => document.getElementById('consent') && document.getElementById('consent').checked);
  assert.equal(await page.locator('[data-act="generate"]').isDisabled(), false);
  await page.close();
});

await check('server 403 consent_required flips the switch off and shows the consent prompt', async () => {
  const { page } = await open(420, { signedIn: true, consent: true, draftsStatus: 403 });
  await page.locator('#tab-private').click();
  await page.waitForFunction(() => document.getElementById('consent') && document.getElementById('consent').checked);
  await page.locator('[data-act="generate"]').click();
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.locator('[role="alert"]').textContent(), /Turn on the setting below/);
  assert.equal(await page.locator('#consent').isChecked(), false);
  assert.equal(await page.locator('[data-act="generate"]').isDisabled(), true);
  await page.close();
});

await check('words source posts the words; an empty box makes no request', async () => {
  const { page, log } = await open(420, { signedIn: true, consent: true });
  await page.locator('#tab-private').click();
  await page.waitForFunction(() => document.getElementById('consent') && document.getElementById('consent').checked);
  await page.locator('[data-ctx="words"]').click();
  await page.locator('[data-act="generate"]').click();
  await page.waitForSelector('[role="alert"]');
  assert.equal(log.drafts.length, 0);
  await page.locator('#mind').fill('a deadline');
  await page.locator('[data-act="generate"]').click();
  await page.waitForSelector('#slot .line:not(.small)');
  assert.deepEqual(log.drafts[0].body, { source: 'words', words: 'a deadline' });
  await page.close();
});

await check('private check-in: no QR and no share URL, and the ask goes to the draft route', async () => {
  const { page, log } = await open(420, { signedIn: true, consent: true });
  await page.locator('#tab-private').click();
  await page.waitForFunction(() => document.getElementById('consent') && document.getElementById('consent').checked);
  await page.locator('[data-act="generate"]').click();
  await page.waitForSelector('#slot .line:not(.small)');
  await page.locator('[data-act="check"]').click();
  assert.equal(await page.locator('#qr').count(), 0);
  assert.doesNotMatch(await page.locator('#sheet').innerHTML(), /go\.somacheck\.com|data-qr/);
  await page.locator('[data-act="send"]').click();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  assert.deepEqual(log.draftAsks, [{ path: '/v1/me/vibecheck/drafts/' + DRAFT + '/ask', auth: 'Bearer tok-abc' }]);
  assert.equal(log.asks.length, 0, 'a private line never hits the public item ask route');
  assert.equal(log.progress.length, 0, 'a private line never touches public progress');
  await page.close();
});

await check('sign in: the magic link request carries the publishable key and no Authorization header', async () => {
  const { page, log } = await open(420);
  await page.locator('#account [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForFunction(() => document.getElementById('si-status').textContent.includes('Check your email'));
  assert.equal(log.otp.length, 1);
  assert.equal(log.otp[0].headers.apikey, KEY);
  assert.equal(log.otp[0].headers.authorization, undefined);
  assert.equal(new URLSearchParams(log.otp[0].url).get('redirect_to'), ORIGIN + '/auth/callback/?web=1&next=%2Fworld-vibe%2F');
  await page.close();
});

await check('sign in with the emailed code: the sheet swaps to the code field, a wrong code is refused, the right one signs in with the publishable key only', async () => {
  const { page, log } = await open(420);
  await page.locator('#account [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  assert.equal(await page.locator('#si-email').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'si-code', 'focus moves to the code field');
  assert.match(await page.locator('#si-status').textContent(), /enter the six-digit code here/);
  await page.route(SB + '/auth/v1/verify', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }), { times: 1 });
  await page.locator('#si-code').fill('000000');
  await page.locator('#code-form button').click();
  await page.waitForFunction(() => document.getElementById('si-status').textContent.includes("Couldn't check the code"));
  await page.locator('#code-form button').click();
  await page.waitForFunction(() => document.getElementById('si-status').textContent.includes("didn't work"));
  assert.equal(await page.evaluate(() => localStorage.getItem('wv.session')), null, 'a refused code leaves the person signed out');
  await page.locator('#si-code').fill('');
  await page.keyboard.insertText('123 456');
  assert.equal(await page.locator('#si-code').inputValue(), '123 456', 'a pasted code with a space is kept whole');
  await page.locator('#code-form button').click();
  await page.waitForFunction(() => document.querySelector('#account .who'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'account', 'focus lands on the account bar, which now shows the address, after sign-in');
  assert.match(await page.locator('#account .who').textContent(), /me@x\.test/);
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), true, 'the sheet closes once signed in');
  assert.equal(log.verify.length, 2);
  assert.deepEqual(log.verify[1].body, { type: 'email', email: 'me@x.test', token: '123456' });
  assert.equal(log.verify[1].headers.apikey, KEY);
  assert.equal(log.verify[1].headers.authorization, undefined);
  assert.equal(log.exchange.length, 0, 'the code path never touches the PKCE exchange');
  assert.equal(log.asks.length, 0, 'a sign-in from the account bar sends nothing to the phone');
  await page.close();
});

await check('sign-in from the check sheet: the emailed link is told to land back on this line, and the code sends it with no further tap', async () => {
  const { page, log } = await open(420);
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  const kept = JSON.parse(await page.evaluate(() => localStorage.getItem('wv.pkce'))).send;
  assert.equal(kept.slug, 'pick-one', 'the line the email was asked for is stored with the pending link');
  assert.match(kept.nonce, /^[\w-]{16,}$/);
  assert.equal(new URLSearchParams(log.otp[0].url).get('redirect_to'), ORIGIN + '/auth/callback/?web=1&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=' + kept.nonce), 'only this email\'s link carries the nonce');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  await page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent'));
  assert.deepEqual(log.phone, ['Bearer tok-code'], 'the phone route is asked once, with the new session');
  assert.deepEqual(log.asks, [{ path: '/v1/me/world-vibe/items/pick-one/ask', auth: 'Bearer tok-code' }]);
  assert.match(await page.locator('#sheet .big').textContent(), /I trust my gut over my dashboard\./);
  assert.equal(await page.locator('#sheet [data-act="send"]').count(), 0);
  assert.equal(await page.locator('#code-form').count(), 0, 'the sign-in sheet is gone');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sent', 'focus lands on the sent notice');
  assert.match(await page.locator('#account .who').textContent(), /me@x\.test/);
  assert.equal(await page.evaluate(() => localStorage.getItem('wv.send_intent')), null, 'nothing is handed to the landing page unless a link is exchanged');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), true);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'check', 'closing the reopened sheet returns focus to the card\'s Check in button');
  await page.close();
});

await check('automatic send cancelled while the phone route is still answering: closing the sheet and reopening it posts nothing', async () => {
  const { page, log } = await open(420);
  const held = [];
  await page.route(API + '/v1/me/world-vibe/phone', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    const outcome = await new Promise((res) => held.push(res));
    return outcome === 500 ? bare(route, 500) : json(route, phoneBody(true));
  });
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  await page.waitForFunction(() => !document.getElementById('code-form') && !document.getElementById('scrim').hidden && document.querySelector('#sheet .big'));
  await page.waitForFunction(() => document.querySelectorAll('#sheet [data-act="send"]').length === 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), true);
  await page.locator('[data-act="check"]').click();
  for (let i = 0; i < 100 && held.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(held.length, 2, 'both phone lookups are waiting');
  // The reopened sheet's own lookup answers first: it offers the button, the cancelled send holds nothing back.
  held[1]();
  await page.waitForSelector('#sheet [data-act="send"]');
  assert.doesNotMatch(await page.locator('#sent').textContent(), /Sending/);
  held[0](500);
  await page.waitForTimeout(200);
  assert.equal(log.asks.length, 0, 'the cancelled automatic send never posts');
  assert.equal(await page.locator('#sheet [data-act="send"]').count(), 1, 'and its late, failed lookup takes nothing away');
  assert.doesNotMatch(await page.locator('#sent').textContent(), /connect an agent/);
  await page.locator('[data-act="send"]').click();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  assert.equal(log.asks.length, 1, 'the person\'s own tap still sends');
  await page.close();
});

await check('sign-in from the check sheet with no agent link: the sheet says to connect one, keeps the QR, and posts nothing', async () => {
  const { page, log } = await open(420, { linked: false });
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  await page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('connect an agent'));
  assert.equal(log.asks.length, 0);
  assert.equal(await page.locator('#sheet [data-act="send"]').count(), 0);
  assert.ok(await page.locator('#qr canvas, #qr img').count() > 0);
  await page.close();
});

await check('sign-in sheet closed before the code: a later sign-in from the account bar sends nothing', async () => {
  const { page, log } = await open(420);
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.keyboard.press('Escape');
  await page.locator('#account [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  assert.equal(new URLSearchParams(log.otp[0].url).get('redirect_to'), ORIGIN + '/auth/callback/?web=1&next=%2Fworld-vibe%2F');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  await page.waitForFunction(() => document.querySelector('#account .who'));
  assert.equal(log.asks.length, 0);
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('wv.send_intent')), null, 'no email was asked for from the check sheet, so nothing was kept');
  await page.close();
});

await check('back from the emailed link (?arrived_from=slug&send=nonce), signed in: the line goes to the phone once and the address is cleaned', async () => {
  const { page, log } = await open(420, { signedIn: true, intent: { slug: 'pick-one', nonce: 'n1', user: 'u-1', signin: 'sid-1' }, pageUrl: '/world-vibe/?arrived_from=pick-one&send=n1' });
  await page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent'));
  assert.match(log.pickUrls[0], /arrived_from=pick-one/);
  assert.deepEqual(log.asks, [{ path: '/v1/me/world-vibe/items/pick-one/ask', auth: 'Bearer tok-abc' }]);
  assert.equal(await page.evaluate(() => location.search), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('wv.send_intent')), null, 'the intent is single-use');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'check');
  await page.reload();
  await page.waitForSelector('#slot article');
  assert.equal(log.asks.length, 1, 'a reload does not send again');
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), true);
  await page.close();
});

await check('a ?send= address alone is not consent: signed in without a kept intent, with one for another line, or with another nonce, nothing is sent', async () => {
  const bare = await open(420, { signedIn: true, pageUrl: '/world-vibe/?arrived_from=pick-one&send=n1' });
  assert.equal(await bare.page.evaluate(() => location.search), '');
  assert.equal(bare.log.asks.length, 0);
  assert.equal(bare.log.phone.length, 0);
  assert.equal(await bare.page.evaluate(() => document.getElementById('scrim').hidden), true);
  await bare.page.close();
  const other = await open(420, { signedIn: true, intent: { slug: 'pick-two', nonce: 'n1', user: 'u-1' }, pageUrl: '/world-vibe/?arrived_from=pick-one&send=n1' });
  assert.equal(other.log.asks.length, 0);
  assert.equal(await other.page.evaluate(() => localStorage.getItem('wv.send_intent')), '{"slug":"pick-two","nonce":"n1","user":"u-1"}', 'a mismatched intent is left for its own link');
  await other.page.close();
  const older = await open(420, { signedIn: true, intent: { slug: 'pick-one', nonce: 'n2', user: 'u-1' }, pageUrl: '/world-vibe/?arrived_from=pick-one&send=n1' });
  assert.equal(older.log.asks.length, 0, 'the link of an older attempt does not send');
  assert.equal(await older.page.evaluate(() => localStorage.getItem('wv.send_intent')), '{"slug":"pick-one","nonce":"n2","user":"u-1"}', 'and leaves the newer attempt waiting');
  await older.page.close();
  const unbound = await open(420, { signedIn: true, intent: { slug: 'pick-one', nonce: 'n1' }, pageUrl: '/world-vibe/?arrived_from=pick-one&send=n1' });
  assert.equal(unbound.log.asks.length, 0, 'an intent no callback bound to an account does not send');
  assert.equal(await unbound.page.evaluate(() => localStorage.getItem('wv.send_intent')), null, 'but the matching attempt is used up');
  await unbound.page.close();
  const elsewhere = await open(420, { signedIn: true, intent: { slug: 'pick-one', nonce: 'n1', user: 'u-b', signin: 'sid-1' }, pageUrl: '/world-vibe/?arrived_from=pick-one&send=n1' });
  assert.equal(elsewhere.log.asks.length, 0, 'an intent bound to another account does not send');
  assert.equal(await elsewhere.page.evaluate(() => localStorage.getItem('wv.send_intent')), null);
  await elsewhere.page.close();
  const overtaken = await open(420, { signedIn: true, intent: { slug: 'pick-one', nonce: 'n1', user: 'u-1', signin: 'sid-1' }, pageUrl: '/world-vibe/?arrived_from=pick-one&send=n1', noWait: true });
  await overtaken.page.evaluate(() => localStorage.setItem('wv.pkce', JSON.stringify({ id: 'sid-2' })));
  await overtaken.page.goto(ORIGIN + '/world-vibe/?arrived_from=pick-one&send=n1');
  await overtaken.page.waitForSelector('#slot article');
  assert.equal(overtaken.log.asks.length, 0, 'an intent from a request that is no longer the latest sign-in does not send');
  assert.equal(await overtaken.page.evaluate(() => localStorage.getItem('wv.send_intent')), null);
  await overtaken.page.close();
  const plain = await open(420, { signedIn: true, intent: { slug: 'pick-one', nonce: 'n1' } });
  assert.equal(plain.log.asks.length, 0, 'an ordinary arrival sends nothing');
  assert.equal(await plain.page.evaluate(() => localStorage.getItem('wv.send_intent')), '{"slug":"pick-one","nonce":"n1"}', 'and leaves an attempt another tab may still be waiting on');
  await plain.page.close();
  const out = await open(420, { intent: { slug: 'pick-one', nonce: 'n1' } });
  assert.equal(await out.page.evaluate(() => localStorage.getItem('wv.send_intent')), '{"slug":"pick-one","nonce":"n1"}', 'signed out, the attempt keeps waiting for its link');
  await out.page.close();
  const signedOut = await open(420, { signedIn: true });
  await signedOut.page.evaluate(() => localStorage.setItem('wv.send_intent', JSON.stringify({ slug: 'pick-one', nonce: 'n1' })));
  await signedOut.page.locator('[data-act="signout"]').click();
  await signedOut.page.waitForSelector('#account [data-open="signin"]');
  // the clear runs under the cross-tab lock, right after the local sign-out
  await signedOut.page.waitForFunction(() => localStorage.getItem('wv.send_intent') === null);
  assert.equal(await signedOut.page.evaluate(() => localStorage.getItem('wv.pkce')), null, 'signing out drops the kept intent and the pending record');
  await signedOut.page.close();
});

await check('an email asked for from the check sheet, then a different sign-in through the account bar and its link: the first link cannot send under the second account', async () => {
  const { page, log } = await open(420);
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('first@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  const kept = JSON.parse(await page.evaluate(() => localStorage.getItem('wv.pkce'))).send;
  assert.equal(kept.slug, 'pick-one');
  await page.keyboard.press('Escape');
  await page.locator('#account [data-open="signin"]').click();
  await page.locator('#si-email').fill('second@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('wv.pkce'))).send, undefined, 'the later, ordinary email takes over the pending sign-in: the earlier link can no longer be exchanged');
  assert.equal(new URLSearchParams(log.otp[1].url).get('redirect_to'), ORIGIN + '/auth/callback/?web=1&next=%2Fworld-vibe%2F');
  // The second email's link, through the callback, lands on the plain home signed in.
  await page.goto(ORIGIN + '/auth/callback/?web=1&code=abc&next=%2Fworld-vibe%2F');
  await page.waitForURL(ORIGIN + '/world-vibe/');
  await page.waitForSelector('#account .who');
  assert.equal(log.asks.length, 0);
  // The first email's landing address, opened afterwards while signed in as the second account.
  await page.goto(ORIGIN + '/world-vibe/?arrived_from=pick-one&send=' + kept.nonce);
  await page.waitForSelector('#slot article');
  await page.waitForTimeout(200);
  assert.equal(log.asks.length, 0, 'no callback bound that attempt to an account, so it never sends');
  assert.equal(log.phone.length, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('wv.send_intent')), null, 'and it is used up');
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), true);
  await page.close();
});

await check('two tabs: the emailed link lands as A while its pick loads, another tab signs in as B meanwhile: nothing is sent as B', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const held = [];
  // Opened on a neutral page first, so the held pick route is in place before the landing load.
  const a = await open(420, { context: ctx, signedIn: true, intent: { slug: 'pick-one', nonce: 'n1', user: 'u-1', signin: 'sid-1' }, pageUrl: '/world-vibe/chrome/', noWait: true, picks: [PICKS[0], PICKS[0]] });
  await a.page.route(API + '/v1/public/world-vibe/pick?*', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => held.push(res));
    return json(route, PICKS[0]);
  });
  await a.page.goto(ORIGIN + '/world-vibe/?arrived_from=pick-one&send=n1', { waitUntil: 'commit' });
  for (let i = 0; i < 100 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(held.length, 1, "A's pick is waiting");
  const b = await ctx.newPage();
  await b.goto(ORIGIN + '/world-vibe/chrome/');
  await b.evaluate(() => localStorage.setItem('wv.session', JSON.stringify({ access_token: 'tok-b', refresh_token: 'r-b', expires_at: Math.floor(Date.now() / 1000) + 86400, user_id: 'u-b', email: 'b@x.test' })));
  await a.page.waitForFunction(() => /b@x\.test/.test((document.querySelector('#account .who') || {}).textContent || ''));
  held[0]();
  await a.page.waitForSelector('#slot article');
  await a.page.waitForTimeout(300);
  assert.equal(a.log.asks.length, 0, 'the line is not sent as B');
  assert.equal(await a.page.evaluate(() => localStorage.getItem('wv.send_intent')), null, 'the link was used up');
  await ctx.close();
});

await check('two tabs: an account-bar code completed in one tab leaves the intent another tab is waiting on, and that tab\'s link still sends', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const one = await open(420, { context: ctx });
  await one.page.locator('#account [data-open="signin"]').click();
  await one.page.locator('#si-email').fill('me@x.test');
  await one.page.locator('#signin-form button').click();
  await one.page.waitForSelector('#code-form');
  const two = await open(420, { context: ctx, picks: [PICKS[0], PICKS[0]] });
  await two.page.locator('[data-act="check"]').click();
  await two.page.locator('#sheet [data-open="signin"]').click();
  await two.page.locator('#si-email').fill('me@x.test');
  await two.page.locator('#signin-form button').click();
  await two.page.waitForSelector('#code-form');
  const kept = JSON.parse(await two.page.evaluate(() => localStorage.getItem('wv.pkce'))).send;
  assert.equal(kept.slug, 'pick-one');
  await one.page.locator('#si-code').fill('123456');
  await one.page.locator('#code-form button').click();
  await one.page.waitForSelector('#account .who');
  assert.equal(one.log.asks.length, 0);
  assert.deepEqual(JSON.parse(await one.page.evaluate(() => localStorage.getItem('wv.pkce'))).send, kept, 'the other tab\'s attempt is left waiting for its link');
  await two.page.goto(ORIGIN + '/auth/callback/?web=1&code=abc&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=' + kept.nonce));
  await two.page.waitForURL(ORIGIN + '/world-vibe/');
  await two.page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent'));
  assert.equal(two.log.asks.length, 1);
  await ctx.close();
});

await check('a code answered late, after its sheet closed and a check-sheet sign-in opened: it signs in without touching the newer sheet, whose own code then sends', async () => {
  const { page, log } = await open(420, { picks: [PICKS[0], PICKS[0]] });
  const held = {};
  await page.route(SB + '/auth/v1/verify', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    const email = JSON.parse(route.request().postData()).email;
    await new Promise((res) => { held[email] = res; });
    const who = email === 'a@x.test' ? { token: 'tok-a', id: 'u-a' } : { token: 'tok-b', id: 'u-b' };
    return json(route, { access_token: who.token, refresh_token: 'r', expires_in: 3600, user: { id: who.id, email } });
  });
  await page.locator('#account [data-open="signin"]').click();
  await page.locator('#si-email').fill('a@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  for (let i = 0; i < 100 && !held['a@x.test']; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(held['a@x.test'], "A's verification is waiting");
  await page.keyboard.press('Escape');
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('b@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  const kept = JSON.parse(await page.evaluate(() => localStorage.getItem('wv.pkce'))).send;
  assert.equal(kept.slug, 'pick-one');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  for (let i = 0; i < 100 && !held['b@x.test']; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(held['b@x.test'], "B's verification is waiting too");
  held['a@x.test']();
  await page.waitForFunction(() => /a@x\.test/.test((document.querySelector('#account .who') || {}).textContent || ''));
  await page.waitForTimeout(200);
  assert.equal(log.asks.length, 0, "the earlier sign-in does not adopt the newer sheet's line");
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), false, 'the newer sign-in sheet is left as it is');
  assert.equal(await page.locator('#code-form').count(), 1);
  held['b@x.test']();
  await page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent'));
  assert.deepEqual(log.asks, [{ path: '/v1/me/world-vibe/items/pick-one/ask', auth: 'Bearer tok-b' }], "B's own code, the latest request, sends as B");
  await page.close();
});
await check('two overlapping email submits: only the newest sends an email, and it owns the intent and the verifier its link needs', async () => {
  const { page, log } = await open(420, { picks: [PICKS[0], PICKS[0]] });
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  // Two submits in the same task, as a double tap lands before the sheet can swap.
  await page.evaluate(() => { const f = document.getElementById('signin-form'); f.requestSubmit(); f.requestSubmit(); });
  await page.waitForSelector('#code-form');
  await page.waitForTimeout(200);
  assert.equal(log.otp.length, 1, 'the overtaken request sends no email');
  const nonce = new URLSearchParams(new URL(new URLSearchParams(log.otp[0].url).get('redirect_to')).search).get('next').split('send=')[1];
  const kept = JSON.parse(await page.evaluate(() => localStorage.getItem('wv.pkce'))).send;
  assert.equal(kept.nonce, nonce, 'the email that went out carries the kept nonce');
  await page.goto(ORIGIN + '/auth/callback/?web=1&code=abc&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=' + nonce));
  await page.waitForURL(ORIGIN + '/world-vibe/');
  await page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent'));
  assert.equal(challengeOf(log.exchange[0].code_verifier), log.otp[0].body.code_challenge, 'the exchange used that email\'s verifier');
  assert.equal(log.asks.length, 1);
  await page.close();
});

await check('a code refused late, after its sheet closed and another sign-in sheet opened: the replacement sheet shows no status for it', async () => {
  const { page } = await open(420);
  const held = [];
  await page.route(SB + '/auth/v1/verify', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => held.push(res));
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant' }) });
  });
  await page.locator('#account [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  await page.locator('#si-code').fill('000000');
  await page.locator('#code-form button').click();
  for (let i = 0; i < 100 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  await page.keyboard.press('Escape');
  await page.locator('#account [data-open="signin"]').click();
  held[0]();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#si-status').textContent(), '', 'no stale refusal lands on the new sheet');
  assert.equal(await page.locator('#si-email').count(), 1);
  await page.close();
});

await check('a code for account A answered late, after a check-sheet sign-in as B started its send: the line is never sent as A', async () => {
  const { page, log } = await open(420);
  const heldVerify = [], heldPhone = [], phoneAuth = [];
  await page.route(SB + '/auth/v1/verify', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    const body = JSON.parse(route.request().postData());
    if (body.email === 'a@x.test') {
      await new Promise((res) => heldVerify.push(res));
      return json(route, { access_token: 'tok-a', refresh_token: 'r-a', expires_in: 3600, user: { id: 'u-a', email: 'a@x.test' } });
    }
    return json(route, { access_token: 'tok-b', refresh_token: 'r-b', expires_in: 3600, user: { id: 'u-b', email: 'b@x.test' } });
  });
  await page.route(API + '/v1/me/world-vibe/phone', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    phoneAuth.push((await route.request().allHeaders()).authorization);
    await new Promise((res) => heldPhone.push(res));
    return json(route, phoneBody(true));
  });
  await page.locator('#account [data-open="signin"]').click();
  await page.locator('#si-email').fill('a@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  for (let i = 0; i < 100 && heldVerify.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(heldVerify.length, 1);
  await page.keyboard.press('Escape');
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('b@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  for (let i = 0; i < 100 && heldPhone.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(heldPhone.length, 1, "B's send is waiting on the phone route");
  assert.deepEqual(phoneAuth, ['Bearer tok-b'], 'the lookup ran as B');
  heldVerify[0]();
  await page.waitForFunction(() => /a@x\.test/.test((document.querySelector('#account .who') || {}).textContent || ''));
  heldPhone[0]();
  await page.waitForTimeout(300);
  assert.equal(log.asks.length, 0, 'the line is not sent as A');
  await page.close();
});

await check('a code answered late while an unrelated sheet is open: focus stays inside that sheet and Escape still closes it', async () => {
  const { page } = await open(420);
  const held = [];
  await page.route(SB + '/auth/v1/verify', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => held.push(res));
    return json(route, { access_token: 'tok-code', refresh_token: 'r-code', expires_in: 3600, user: { id: 'u-1', email: 'me@x.test' } });
  });
  await page.locator('#account [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  for (let i = 0; i < 100 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  await page.keyboard.press('Escape');
  await page.locator('[data-open="how"]').click();
  await page.waitForFunction(() => document.getElementById('sheet-title').textContent === 'How it works');
  held[0]();
  await page.waitForSelector('#account .who');
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), false, 'the unrelated sheet stays open');
  assert.equal(await page.evaluate(() => document.getElementById('sheet').contains(document.activeElement)), true, 'focus stays inside it');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), true, 'Escape still closes it');
  await page.close();
});

await check('an email request answered late, after its sheet closed and another opened: the replacement sheet stays on its email field and no intent is kept', async () => {
  const { page } = await open(420);
  const held = [];
  await page.route(SB + '/auth/v1/otp?*', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => held.push(res));
    return json(route, {});
  });
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  for (let i = 0; i < 100 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(held.length, 1);
  await page.keyboard.press('Escape');
  await page.locator('#account [data-open="signin"]').click();
  held[0]();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#code-form').count(), 0);
  assert.equal(await page.locator('#si-email').count(), 1);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('wv.pkce'))).send.slug, 'pick-one', 'the email went out, so its own link may still send');
  await page.close();
});

await check('two tabs: the callback signs in as A, the home document is held, another tab signs in as B before it loads: nothing is sent as B', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const a = await open(420, { context: ctx, picks: [PICKS[0], PICKS[0]] });
  await a.page.evaluate(() => localStorage.setItem('wv.pkce', JSON.stringify({ id: 'sid-a', verifier: 'verifier-xyz', send: { slug: 'pick-one', nonce: 'n1' } })));
  const held = [];
  await a.page.route((u) => u.pathname === '/world-vibe/' && u.searchParams.get('send') === 'n1', async (route) => { await new Promise((res) => held.push(res)); return route.continue(); });
  await a.page.goto(ORIGIN + '/auth/callback/?web=1&code=abc&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=n1'), { waitUntil: 'commit' });
  for (let i = 0; i < 150 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(held.length, 1, 'the home document after the callback is waiting');
  const b = await ctx.newPage();
  await b.goto(ORIGIN + '/world-vibe/chrome/');
  assert.deepEqual(JSON.parse(await b.evaluate(() => localStorage.getItem('wv.send_intent'))), { slug: 'pick-one', nonce: 'n1', user: 'u-1', signin: 'sid-a' }, 'the exchange bound the attempt to the account it signed in and the request it came from');
  await b.evaluate(() => localStorage.setItem('wv.session', JSON.stringify({ access_token: 'tok-b', refresh_token: 'r-b', expires_at: Math.floor(Date.now() / 1000) + 86400, user_id: 'u-b', email: 'b@x.test' })));
  held[0]();
  await a.page.waitForSelector('#slot article');
  await a.page.waitForTimeout(300);
  assert.equal(a.log.asks.length, 0, 'the line is not sent as B');
  assert.match(await a.page.locator('#account .who').textContent(), /b@x\.test/);
  assert.equal(await a.page.evaluate(() => localStorage.getItem('wv.send_intent')), null, 'the link was used up');
  await ctx.close();
});

await check('two tabs: a check-sheet code signs in, and while its phone lookup is answering another tab makes an ordinary sign-in: nothing is sent', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  // The other tab already has its sign-in sheet open from before anyone signed in.
  const two = await open(420, { context: ctx });
  await two.page.locator('#account [data-open="signin"]').click();
  await two.page.locator('#si-email').fill('me@x.test');
  const one = await open(420, { context: ctx });
  const heldPhone = [];
  await one.page.route(API + '/v1/me/world-vibe/phone', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => heldPhone.push(res));
    return json(route, phoneBody(true));
  });
  await one.page.locator('[data-act="check"]').click();
  await one.page.locator('#sheet [data-open="signin"]').click();
  await one.page.locator('#si-email').fill('me@x.test');
  await one.page.locator('#signin-form button').click();
  await one.page.waitForSelector('#code-form');
  await one.page.locator('#si-code').fill('123456');
  await one.page.locator('#code-form button').click();
  for (let i = 0; i < 100 && heldPhone.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(heldPhone.length, 1, 'the send is waiting on the phone route');
  await two.page.locator('#signin-form button').click();
  await two.page.waitForSelector('#code-form');
  await two.page.locator('#si-code').fill('123456');
  await two.page.locator('#code-form button').click();
  await two.page.waitForSelector('#account .who');
  heldPhone[0]();
  await one.page.waitForSelector('#sheet [data-act="send"]');
  await one.page.waitForTimeout(200);
  assert.equal(one.log.asks.length, 0, 'the newer sign-in took the pending sign-in over, so the earlier one sends nothing');
  assert.equal(two.log.asks.length, 0);
  await ctx.close();
});

// A check-sheet email request in `page`, then its link through the callback, with the landing navigation held.
async function landLinkHeld(page, held) {
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  const nonce = JSON.parse(await page.evaluate(() => localStorage.getItem('wv.pkce'))).send.nonce;
  await page.keyboard.press('Escape');
  await page.goto(ORIGIN + '/auth/callback/?web=1&code=abc&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=' + nonce), { waitUntil: 'commit' });
  for (let i = 0; i < 150 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(held.length, 1, 'the landing is waiting');
}

await check('two tabs: the emailed link lands and its pick is loading; another tab makes an ordinary sign-in with a code for the same account: nothing is sent', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const two = await open(420, { context: ctx });
  await two.page.locator('#account [data-open="signin"]').click();
  await two.page.locator('#si-email').fill('me@x.test');
  const one = await open(420, { context: ctx, picks: [PICKS[0], PICKS[0]] });
  const held = [];
  await one.page.route(API + '/v1/public/world-vibe/pick?*', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    if (!route.request().url().includes('arrived_from=')) return json(route, PICKS[0]);
    await new Promise((res) => held.push(res));
    return json(route, PICKS[0]);
  });
  await landLinkHeld(one.page, held);
  await two.page.locator('#signin-form button').click();
  await two.page.waitForSelector('#code-form');
  await two.page.locator('#si-code').fill('123456');
  await two.page.locator('#code-form button').click();
  // A closed sheet keeps its last markup; the scrim going hidden is the sign-in landing.
  await two.page.waitForFunction(() => document.getElementById('scrim').hidden || /didn't work|Couldn't/.test(document.getElementById('si-status').textContent));
  assert.equal(await two.page.evaluate(() => document.getElementById('scrim').hidden), true, 'the other tab signed in with its code');
  held[0]();
  await one.page.waitForSelector('#slot article');
  await one.page.waitForTimeout(300);
  assert.equal(one.log.asks.length, 0, 'a newer sign-in request means the link\'s send is dropped');
  assert.equal(await one.page.evaluate(() => localStorage.getItem('wv.send_intent')), null, 'and the link is used up');
  await ctx.close();
});

await check('two tabs: the emailed link lands and its phone lookup is answering; another tab makes an ordinary sign-in and completes its own link: nothing is sent', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const two = await open(420, { context: ctx });
  await two.page.locator('#account [data-open="signin"]').click();
  await two.page.locator('#si-email').fill('me@x.test');
  const one = await open(420, { context: ctx, picks: [PICKS[0], PICKS[0]] });
  const heldPhone = [];
  await one.page.route(API + '/v1/me/world-vibe/phone', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => heldPhone.push(res));
    return json(route, phoneBody(true));
  });
  await landLinkHeld(one.page, heldPhone);
  await two.page.locator('#signin-form button').click();
  await two.page.waitForSelector('#code-form');
  await two.page.goto(ORIGIN + '/auth/callback/?web=1&code=abc&next=%2Fworld-vibe%2F');
  await two.page.waitForURL(ORIGIN + '/world-vibe/');
  await two.page.waitForSelector('#account .who');
  heldPhone[0]();
  await one.page.waitForSelector('#sheet [data-act="send"]');
  await one.page.waitForTimeout(200);
  assert.equal(one.log.asks.length, 0, 'the newer request, exchanged and gone, still means the older send is dropped');
  await ctx.close();
});

await check('two tabs: the landing claim waits for the cross-tab lock another tab holds, then sends once', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const holder = await ctx.newPage();
  await holder.goto(ORIGIN + '/world-vibe/chrome/');
  // Opened before the hold: page start itself reads the session under the lock.
  const a = await open(420, { context: ctx, signedIn: true, intent: { slug: 'pick-one', nonce: 'n1', user: 'u-1', signin: 'sid-1' }, pageUrl: '/world-vibe/chrome/', noWait: true });
  await holder.evaluate(() => { navigator.locks.request('wv.signin', () => new Promise((r) => { window.__release = r; })); });
  await a.page.goto(ORIGIN + '/world-vibe/?arrived_from=pick-one&send=n1', { waitUntil: 'commit' });
  await a.page.waitForTimeout(600);
  assert.equal(a.log.asks.length, 0, 'nothing is claimed while another tab holds the lock');
  assert.equal(await a.page.evaluate(() => localStorage.getItem('wv.send_intent') !== null), true);
  await holder.evaluate(() => window.__release());
  await a.page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent'));
  assert.deepEqual(a.log.asks, [{ path: '/v1/me/world-vibe/items/pick-one/ask', auth: 'Bearer tok-abc' }]);
  await ctx.close();
});

await check('two tabs: a send queued on the lock is cancelled by closing the sheet and moving to another line before the lock is released', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const holder = await ctx.newPage();
  await holder.goto(ORIGIN + '/world-vibe/chrome/');
  const one = await open(420, { context: ctx });
  const heldPhone = [];
  await one.page.route(API + '/v1/me/world-vibe/phone', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => heldPhone.push(res));
    return json(route, phoneBody(true));
  });
  await one.page.locator('[data-act="check"]').click();
  await one.page.locator('#sheet [data-open="signin"]').click();
  await one.page.locator('#si-email').fill('me@x.test');
  await one.page.locator('#signin-form button').click();
  await one.page.waitForSelector('#code-form');
  await one.page.locator('#si-code').fill('123456');
  await one.page.locator('#code-form button').click();
  for (let i = 0; i < 100 && heldPhone.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(heldPhone.length, 1, 'signed in; the send is waiting on the phone route');
  // from here another tab holds the lock; the phone route answers and the send queues behind it
  await holder.evaluate(() => { navigator.locks.request('wv.signin', () => new Promise((r) => { window.__release = r; })); });
  heldPhone[0]();
  await one.page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sending'));
  assert.equal(await one.page.locator('#sheet [data-act="send"]').count(), 0, 'no button while the automatic send is on its way');
  await one.page.waitForTimeout(300);
  assert.equal(one.log.asks.length, 0);
  await one.page.keyboard.press('Escape');
  await one.page.locator('[data-act="skip"]').click();
  await one.page.waitForFunction(() => document.querySelector('.line') && document.querySelector('.line').textContent.includes('Monday'));
  await holder.evaluate(() => window.__release());
  await one.page.waitForTimeout(400);
  assert.equal(one.log.asks.length, 0, 'the queued send noticed the sheet closed and the card moved on');
  await ctx.close();
});

await check('two tabs: a sign-out queued on the lock ahead of a send empties the session first, so nothing is sent', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const holder = await ctx.newPage();
  await holder.goto(ORIGIN + '/world-vibe/chrome/');
  const one = await open(420, { context: ctx });
  const heldPhone = [];
  await one.page.route(API + '/v1/me/world-vibe/phone', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => heldPhone.push(res));
    return json(route, phoneBody(true));
  });
  await one.page.locator('[data-act="check"]').click();
  await one.page.locator('#sheet [data-open="signin"]').click();
  await one.page.locator('#si-email').fill('me@x.test');
  await one.page.locator('#signin-form button').click();
  await one.page.waitForSelector('#code-form');
  await one.page.locator('#si-code').fill('123456');
  await one.page.locator('#code-form button').click();
  for (let i = 0; i < 100 && heldPhone.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(heldPhone.length, 1, 'signed in; the send is waiting on the phone route');
  // Another tab, signed in through shared storage, opened before the hold.
  const three = await open(420, { context: ctx });
  await three.page.waitForSelector('[data-act="signout"]');
  // from here another tab holds the lock; the sign-out queues on it before the send does
  await holder.evaluate(() => { navigator.locks.request('wv.signin', () => new Promise((r) => { window.__release = r; })); });
  await three.page.locator('[data-act="signout"]').click();
  await three.page.waitForTimeout(200);
  assert.equal(await three.page.evaluate(() => localStorage.getItem('wv.session') !== null), true, 'the sign-out is waiting for the lock');
  heldPhone[0]();
  await one.page.waitForTimeout(200);
  await holder.evaluate(() => window.__release());
  await three.page.waitForSelector('#account [data-open="signin"]');
  await one.page.waitForSelector('#account [data-open="signin"]');
  await one.page.waitForTimeout(300);
  assert.equal(one.log.asks.length, 0, 'the send found no session');
  await ctx.close();
});

await check('two tabs: while the automatic send waits for the lock, or while its ask is in flight, there is no Send button, and exactly one ask goes out', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const holder = await ctx.newPage();
  await holder.goto(ORIGIN + '/world-vibe/chrome/');
  const one = await open(420, { context: ctx });
  const heldPhone = [], heldAsk = [];
  await one.page.route(API + '/v1/me/world-vibe/phone', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => heldPhone.push(res));
    return json(route, phoneBody(true));
  });
  await one.page.route(API + '/v1/me/world-vibe/items/pick-one/ask', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    one.log.asks.push({ path: '/v1/me/world-vibe/items/pick-one/ask', auth: (await route.request().allHeaders()).authorization });
    await new Promise((res) => heldAsk.push(res));
    return json(route, sendOk.body, sendOk.status);
  });
  await one.page.locator('[data-act="check"]').click();
  await one.page.locator('#sheet [data-open="signin"]').click();
  await one.page.locator('#si-email').fill('me@x.test');
  await one.page.locator('#signin-form button').click();
  await one.page.waitForSelector('#code-form');
  await one.page.locator('#si-code').fill('123456');
  await one.page.locator('#code-form button').click();
  for (let i = 0; i < 100 && heldPhone.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  await holder.evaluate(() => { navigator.locks.request('wv.signin', () => new Promise((r) => { window.__release = r; })); });
  heldPhone[0]();
  await one.page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sending'));
  assert.equal(await one.page.locator('#sheet [data-act="send"]').count(), 0, 'no button while waiting for the lock');
  await holder.evaluate(() => window.__release());
  for (let i = 0; i < 100 && heldAsk.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(heldAsk.length, 1, 'the automatic ask is in flight');
  assert.equal(await one.page.locator('#sheet [data-act="send"]').count(), 0, 'no button while the ask is in flight');
  heldAsk[0]();
  await one.page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  await one.page.waitForTimeout(200);
  assert.equal(one.log.asks.length, 1, 'exactly one ask');
  assert.equal(await one.page.locator('#sheet [data-act="send"]').count(), 0);
  await ctx.close();
});

await check('an ask still in flight when the person closes the sheet and signs out does not stop the next sign-in\'s automatic send', async () => {
  const { page, log } = await open(420, { signedIn: true, picks: [PICKS[0], PICKS[0], PICKS[0]] });
  const heldAsk = [];
  await page.route(API + '/v1/me/world-vibe/items/pick-one/ask', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    log.asks.push({ path: '/v1/me/world-vibe/items/pick-one/ask', auth: (await route.request().allHeaders()).authorization });
    await new Promise((res) => heldAsk.push(res));
    return json(route, sendOk.body, sendOk.status);
  });
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="send"]').click();
  for (let i = 0; i < 100 && heldAsk.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(heldAsk.length, 1, 'the first ask is in flight');
  await page.keyboard.press('Escape');
  await page.locator('[data-act="signout"]').click();
  await page.waitForSelector('#account [data-open="signin"]');
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  for (let i = 0; i < 150 && heldAsk.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(heldAsk.length, 2, 'the new sign-in\'s automatic send goes out while the old ask is still in flight');
  assert.equal(log.asks[1].auth, 'Bearer tok-code');
  heldAsk[0]();
  await page.waitForTimeout(200);
  assert.match(await page.locator('#sent').textContent(), /Sending/, 'the old response landing late changes nothing');
  heldAsk[1]();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  await page.close();
});

await check('back on the same line after Not this one: the earlier ask, still in flight, neither blocks the new send nor shows its late failure', async () => {
  const { page, log } = await open(420, { signedIn: true, picks: [PICKS[0], PICKS[0]] });
  const held = [];
  await page.route(API + '/v1/me/world-vibe/items/pick-one/ask', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    log.asks.push({ path: '/v1/me/world-vibe/items/pick-one/ask', auth: (await route.request().allHeaders()).authorization });
    const outcome = await new Promise((res) => held.push(res));
    return outcome === 500 ? bare(route, 500) : json(route, sendOk.body, sendOk.status);
  });
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="send"]').click();
  for (let i = 0; i < 100 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  await page.keyboard.press('Escape');
  await page.locator('[data-act="skip"]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.line').textContent(), 'I trust my gut over my dashboard.', 'the same line came back');
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="send"]').click();
  for (let i = 0; i < 100 && held.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(held.length, 2, 'the new visit sends');
  await page.locator('[data-act="send"]').click();
  await page.waitForTimeout(100);
  assert.equal(held.length, 2, 'a second tap while the ask is in flight makes no further ask');
  held[0](500);
  await page.waitForTimeout(200);
  assert.doesNotMatch(await page.locator('#sent').textContent(), /Couldn't/, 'the earlier visit\'s failure is not this visit\'s');
  await page.locator('[data-act="send"]').click();
  await page.waitForTimeout(100);
  assert.equal(held.length, 2, 'and the late failure does not reopen the way to a third ask');
  held[1](200);
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  assert.equal(log.asks.length, 2);
  await page.close();
});

await check('a shared ask in flight does not hide a private line\'s Send button', async () => {
  const { page, log } = await open(420, { signedIn: true, consent: true });
  const held = [];
  await page.route(API + '/v1/me/world-vibe/items/pick-one/ask', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => held.push(res));
    return json(route, sendOk.body, sendOk.status);
  });
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="send"]').click();
  for (let i = 0; i < 100 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  await page.keyboard.press('Escape');
  await page.locator('#tab-private').click();
  await page.waitForFunction(() => document.getElementById('consent') && document.getElementById('consent').checked);
  await page.locator('[data-act="generate"]').click();
  await page.waitForSelector('#slot .line:not(.small)');
  await page.locator('[data-act="check"]').click();
  await page.waitForSelector('#sheet [data-act="send"]');
  assert.doesNotMatch(await page.locator('#sent').textContent(), /Sending/);
  held[0]();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#sheet [data-act="send"]').count(), 1, 'the private sheet is untouched by the shared response');
  assert.equal(log.draftAsks.length, 0);
  await page.close();
});

await check('Check in opened while the next pick loads: the sheet closes when the new line lands, and a sign-in started from it sends nothing for the line that moved on', async () => {
  const { page, log } = await open(420);
  const held = [];
  let next = 1;
  await page.route(API + '/v1/public/world-vibe/pick?*', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    if (!route.request().url().includes('exclude=')) return json(route, PICKS[0]);
    await new Promise((res) => held.push(res));
    return json(route, PICKS[next++]);   // pick-two, then pick-three
  });
  await page.locator('[data-act="skip"]').click();
  for (let i = 0; i < 100 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  await page.locator('[data-act="check"]').click();
  assert.match(await page.locator('#sheet .big').textContent(), /I trust my gut over my dashboard\./, 'the sheet shows the line still on the card');
  held[0]();
  await page.waitForFunction(() => document.querySelector('.line') && document.querySelector('.line').textContent.includes('Monday'));
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), true, 'the sheet for the old line closed when the new one landed');
  assert.equal(await page.evaluate(() => document.getElementById('slot').contains(document.activeElement)), true, 'focus moved to the new card');
  // The same, but the sign-in is started from the stale sheet before the new line lands.
  await page.locator('[data-act="skip"]').click();
  for (let i = 0; i < 100 && held.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  await page.locator('[data-act="check"]').click();
  await page.locator('#sheet [data-open="signin"]').click();
  await page.locator('#si-email').fill('me@x.test');
  await page.locator('#signin-form button').click();
  await page.waitForSelector('#code-form');
  held[1]();
  await page.waitForFunction(() => document.querySelector('.line') && document.querySelector('.line').textContent.includes('yes too often'));
  await page.locator('#si-code').fill('123456');
  await page.locator('#code-form button').click();
  await page.waitForSelector('#account .who');
  await page.waitForTimeout(300);
  assert.equal(log.asks.length, 0, 'nothing is sent: the line the sign-in was for is no longer the one on the card');
  assert.equal(log.phone.length, 0);
  assert.equal(await page.evaluate(() => document.getElementById('scrim').hidden), true);
  await page.close();
});

await check('two tabs: an older account-bar sign-in as A lands first, then the check-sheet code for B is entered: B\'s own sign-in sends its line as B', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const one = await open(420, { context: ctx });
  const heldA = [];
  await one.page.route(SB + '/auth/v1/verify', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => heldA.push(res));
    return json(route, { access_token: 'tok-a', refresh_token: 'r-a', expires_in: 3600, user: { id: 'u-a', email: 'a@x.test' } });
  });
  await one.page.locator('#account [data-open="signin"]').click();
  await one.page.locator('#si-email').fill('a@x.test');
  await one.page.locator('#signin-form button').click();
  await one.page.waitForSelector('#code-form');
  await one.page.locator('#si-code').fill('123456');
  await one.page.locator('#code-form button').click();
  for (let i = 0; i < 100 && heldA.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  const two = await open(420, { context: ctx });
  await two.page.route(SB + '/auth/v1/verify', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    return json(route, { access_token: 'tok-b', refresh_token: 'r-b', expires_in: 3600, user: { id: 'u-b', email: 'b@x.test' } });
  });
  await two.page.locator('[data-act="check"]').click();
  await two.page.locator('#sheet [data-open="signin"]').click();
  await two.page.locator('#si-email').fill('b@x.test');
  await two.page.locator('#signin-form button').click();
  await two.page.waitForSelector('#code-form');
  heldA[0]();
  await one.page.waitForFunction(() => /a@x\.test/.test((document.querySelector('#account .who') || {}).textContent || ''));
  await two.page.locator('#si-code').fill('123456');
  await two.page.locator('#code-form button').click();
  await two.page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent'));
  assert.deepEqual(two.log.asks, [{ path: '/v1/me/world-vibe/items/pick-one/ask', auth: 'Bearer tok-b' }], 'B\'s own sign-in, the latest request, sends as B');
  assert.equal(one.log.asks.length, 0);
  await ctx.close();
});

await check('two tabs landing on the same emailed link address at once: one handoff, one send', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const held = [];
  const hold = async (page) => page.route(API + '/v1/public/world-vibe/pick?*', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => held.push(res));
    return json(route, PICKS[0]);
  });
  const a = await open(420, { context: ctx, signedIn: true, intent: { slug: 'pick-one', nonce: 'n1', user: 'u-1', signin: 'sid-1' }, pageUrl: '/world-vibe/chrome/', noWait: true });
  const b = await open(420, { context: ctx, pageUrl: '/world-vibe/chrome/', noWait: true });
  await hold(a.page); await hold(b.page);
  await a.page.goto(ORIGIN + '/world-vibe/?arrived_from=pick-one&send=n1', { waitUntil: 'commit' });
  await b.page.goto(ORIGIN + '/world-vibe/?arrived_from=pick-one&send=n1', { waitUntil: 'commit' });
  for (let i = 0; i < 150 && held.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(held.length, 2, 'both landings are waiting on their pick');
  held.forEach((res) => res());
  await a.page.waitForSelector('#slot article');
  await b.page.waitForSelector('#slot article');
  await a.page.waitForTimeout(500);
  assert.equal(a.log.asks.length + b.log.asks.length, 1, 'exactly one tab claimed the handoff and sent');
  assert.equal(await a.page.evaluate(() => localStorage.getItem('wv.send_intent')), null);
  await ctx.close();
});

await check('two tabs: an account-bar email answered after another tab\'s check-sheet email leaves that intent, and its link sends', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const one = await open(420, { context: ctx });
  const held = [];
  await one.page.route(SB + '/auth/v1/otp?*', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => held.push(res));
    return json(route, {});
  });
  await one.page.locator('#account [data-open="signin"]').click();
  await one.page.locator('#si-email').fill('me@x.test');
  await one.page.locator('#signin-form button').click();
  for (let i = 0; i < 100 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  const two = await open(420, { context: ctx, picks: [PICKS[0], PICKS[0]] });
  await two.page.locator('[data-act="check"]').click();
  await two.page.locator('#sheet [data-open="signin"]').click();
  await two.page.locator('#si-email').fill('me@x.test');
  await two.page.locator('#signin-form button').click();
  await two.page.waitForSelector('#code-form');
  const kept = JSON.parse(await two.page.evaluate(() => localStorage.getItem('wv.pkce'))).send;
  held[0]();
  await one.page.waitForSelector('#code-form');
  assert.deepEqual(JSON.parse(await one.page.evaluate(() => localStorage.getItem('wv.pkce'))).send, kept, 'the late ordinary response leaves the other tab\'s attempt');
  await two.page.goto(ORIGIN + '/auth/callback/?web=1&code=abc&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=' + kept.nonce));
  await two.page.waitForURL(ORIGIN + '/world-vibe/');
  await two.page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent'));
  assert.equal(challengeOf(two.log.exchange[0].code_verifier), two.log.otp[0].body.code_challenge, 'the exchange used the newer request\'s verifier');
  assert.equal(two.log.asks.length, 1);
  await ctx.close();
});

await check('two tabs: two check-sheet emails, the older answered last: the newer request owns the intent and its link sends', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const one = await open(420, { context: ctx });
  const held = [];
  await one.page.route(SB + '/auth/v1/otp?*', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    await new Promise((res) => held.push(res));
    return json(route, {});
  });
  await one.page.locator('[data-act="check"]').click();
  await one.page.locator('#sheet [data-open="signin"]').click();
  await one.page.locator('#si-email').fill('me@x.test');
  await one.page.locator('#signin-form button').click();
  for (let i = 0; i < 100 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(await one.page.evaluate(() => localStorage.getItem('wv.pkce'))).send;
  assert.equal(first.slug, 'pick-one', 'the intent is kept before the request is answered');
  const two = await open(420, { context: ctx, picks: [PICKS[0], PICKS[0]] });
  await two.page.locator('[data-act="check"]').click();
  await two.page.locator('#sheet [data-open="signin"]').click();
  await two.page.locator('#si-email').fill('me@x.test');
  await two.page.locator('#signin-form button').click();
  await two.page.waitForSelector('#code-form');
  const kept = JSON.parse(await two.page.evaluate(() => localStorage.getItem('wv.pkce'))).send;
  assert.notEqual(kept.nonce, first.nonce);
  held[0]();
  await one.page.waitForSelector('#code-form');
  assert.deepEqual(JSON.parse(await one.page.evaluate(() => localStorage.getItem('wv.pkce'))).send, kept, 'the older response does not take the intent back');
  await two.page.goto(ORIGIN + '/auth/callback/?web=1&code=abc&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=' + kept.nonce));
  await two.page.waitForURL(ORIGIN + '/world-vibe/');
  await two.page.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent'));
  assert.equal(challengeOf(two.log.exchange[0].code_verifier), two.log.otp[0].body.code_challenge, 'the exchange used the newer request\'s verifier');
  assert.equal(two.log.asks.length, 1);
  await ctx.close();
});

await check('back from the emailed link signed out, or when the pick is a different line: nothing is sent', async () => {
  const out = await open(420, { intent: { slug: 'pick-one', nonce: 'n1' }, pageUrl: '/world-vibe/?arrived_from=pick-one&send=n1' });
  assert.equal(await out.page.evaluate(() => location.search), '');
  assert.equal(out.log.asks.length, 0);
  assert.equal(out.log.phone.length, 0);
  assert.equal(await out.page.evaluate(() => document.getElementById('scrim').hidden), true);
  await out.page.close();
  // The stub serves pick-one whatever arrived_from says, so this lands on another line.
  const other = await open(420, { signedIn: true, intent: { slug: 'pick-nine', nonce: 'n1', user: 'u-1', signin: 'sid-1' }, pageUrl: '/world-vibe/?arrived_from=pick-nine&send=n1' });
  assert.equal(other.log.asks.length, 0);
  assert.equal(await other.page.evaluate(() => document.getElementById('scrim').hidden), true);
  await other.page.close();
});

await check('the shipped config carries the publishable key: Sign in shows without any override', async () => {
  const { page } = await open(420, { key: 'default' });
  assert.equal(await page.evaluate(() => window.SOMACHECK_SUPABASE_PUBLISHABLE_KEY), 'sb_publishable_af-lUNI2FqEcb-oGy-4uxQ_cnm6kY85');
  assert.equal(await page.locator('#account [data-open="signin"]').count(), 1);
  await page.close();
});

await check('the Sign in control is hidden while no publishable key is configured', async () => {
  const { page } = await open(420, { key: '' });
  assert.equal(await page.locator('#account').innerHTML(), '');
  await page.close();
});

await check('sign out clears the session: no bearer afterwards, token gone from storage, server revoke sent', async () => {
  const { page, log } = await open(420, { signedIn: true });
  assert.match(await page.locator('#account .who').textContent(), /me@x\.test/);
  await page.locator('[data-act="signout"]').click();
  await page.waitForFunction(() => !localStorage.getItem('wv.session'));
  await page.waitForSelector('#account [data-open="signin"]');
  for (let i = 0; i < 100 && log.logout.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(log.logout, ['Bearer tok-abc']);
  const before = log.api.length;
  await page.locator('[data-act="skip"]').click();
  await page.waitForFunction(() => document.querySelector('.line').textContent.includes('Monday'));
  assert.deepEqual(log.api.slice(before).filter((r) => r.auth), []);
  await page.close();
});

await check('sign out removes the own reading from the page and drops a progress answer that arrives later', async () => {
  const progress = [progressEnvelope({ slug: 'pick-one', your_checkin_counted: true, revealed_by_you: true, your_reading: 'aligned' })];
  const { page } = await open(420, { signedIn: true, progress });
  await page.locator('[data-act="check"]').click();
  await page.locator('[data-act="send"]').click();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  await page.locator('[data-act="checked"]').click();
  await page.waitForSelector('.own');
  await page.locator('[data-act="signout"]').click();
  await page.waitForSelector('#account [data-open="signin"]');
  assert.equal(await page.locator('.own').count(), 0);
  assert.doesNotMatch(await page.locator('#slot').textContent(), /Your reading|YOU REVEALED/);
  assert.equal(await page.locator('#slot [data-act="check"]').count(), 1);
  await page.close();
});

await check('callback from a web sign-in exchanges the code, stores the session and lands on World Vibe without opening the app', async () => {
  const { page, log, navs } = await open(420, { pageUrl: '/world-vibe/', noWait: true });
  await page.evaluate(() => localStorage.setItem('wv.pkce', JSON.stringify({ verifier: 'verifier-xyz' })));
  await page.goto(ORIGIN + '/auth/callback/?web=1&code=abc&next=%2Fworld-vibe%2F');
  await page.waitForURL(ORIGIN + '/world-vibe/');
  assert.deepEqual(log.exchange, [{ auth_code: 'abc', code_verifier: 'verifier-xyz' }]);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('wv.session'))).access_token, 'tok-new');
  assert.ok(!navs.some((u) => u.startsWith('somacheck:')));
  await page.close();
});

await check('callback web link opened without the pending verifier shows an error and never deep-links', async () => {
  const { page, log } = await open(420, { pageUrl: '/auth/callback/?web=1&code=abc', noWait: true });
  await page.waitForFunction(() => document.getElementById('title').textContent.includes('snag'));
  assert.equal(log.exchange.length, 0);
  assert.equal(await page.locator('#open-app').isHidden(), true);
  await page.close();
});

await check('callback from the app (no web=1) still deep-links to the app and exchanges nothing', async () => {
  const page = await browser.newPage();
  const exchanged = [];
  await page.route(SB + '/**', (r) => { exchanged.push(r.request().url()); return r.abort(); });
  await page.route('somacheck://**', (r) => r.abort()).catch(() => {});
  await page.goto(ORIGIN + '/auth/callback/?code=abc', { waitUntil: 'commit' }).catch(() => {});
  await page.waitForSelector('#open-app', { state: 'attached' });
  assert.equal(await page.locator('#open-app').getAttribute('href'), 'somacheck://auth/callback?code=abc');
  assert.deepEqual(exchanged, []);
  await page.close();
});

await check('the old feed is reachable at /world-vibe/legacy/ and ?t= links on the home go there', async () => {
  const legacy = await browser.newPage();
  const errs = [];
  legacy.on('pageerror', (e) => errs.push(e.message));
  await legacy.route(/fonts\.(googleapis|gstatic)\.com|supabase\.co/, (r) => r.abort());
  await legacy.goto(ORIGIN + '/world-vibe/legacy/');
  assert.match(await legacy.title(), /World Vibe - SomaCheck/);
  await legacy.close();
  const { page } = await open(420, { pageUrl: '/world-vibe/?t=ai-at-work', noWait: true });
  await page.waitForURL(ORIGIN + '/world-vibe/legacy/?t=ai-at-work');
  await page.close();
});

await check('Explore: the Following sign-in state links to the home sign-in, and its sheet sends for a signed-in account', async () => {
  const { page, log } = await open(420, { pageUrl: '/world-vibe/explore/', noWait: true, signedIn: true });
  await page.waitForSelector('.post');
  assert.equal(log.api.find((r) => r.url.includes('/feed')).auth, undefined, 'public feed carries no bearer');
  await page.locator('.post [data-check]').first().click();
  await page.locator('#sheet-body [data-act="send"]').click();
  await page.waitForFunction(() => document.getElementById('sent').textContent.includes('Sent'));
  assert.equal(log.asks.length, 1);
  assert.equal(log.asks[0].auth, 'Bearer tok-abc');
  await page.close();
  const out = await open(420, { pageUrl: '/world-vibe/explore/', noWait: true });
  await out.page.waitForSelector('.post');
  await out.page.locator('.post [data-check]').first().click();
  assert.equal(await out.page.locator('#sheet-body [data-act="send"]').count(), 0);
  assert.ok(await out.page.locator('#qr canvas, #qr img').count() > 0);
  await out.page.locator('[data-open="signin"]').click();
  await out.page.waitForURL(ORIGIN + '/world-vibe/?signin=1');
  await out.page.close();
});

await check('QR landing: the item, its ladder progress, an app link and an install fallback', async () => {
  const { page, log, errors } = await open(420, { pageUrl: '/world-vibe/share/?item=wv3-r2-public', noWait: true, item: itemRow({ contributor_count: 5, aligned: null, unaligned: null, lean: 'mixed', public_signals: false, unlock_threshold: 3 }) });
  await page.waitForSelector('[data-state="item"]:not([hidden])');
  assert.equal(await page.locator('#line').textContent(), itemRow().statement);
  assert.equal(await page.locator('#headline').textContent(), 'Mixed so far');
  assert.equal(await page.locator('#detail').textContent(), '5 checked in');
  assert.equal(await page.locator('#open').getAttribute('href'), 'https://go.somacheck.com/world-vibe/share/?item=wv3-r2-public');
  assert.match(await page.locator('#install').getAttribute('href'), /^https:\/\/testflight\.apple\.com\//);
  assert.deepEqual(log.items, [{ path: '/v1/public/world-vibe/items/wv3-r2-public', auth: undefined }]);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('[data-state="missing"]').isHidden(), true);
  await page.close();
});

await check('QR landing: unknown slug is "not found", malformed slug makes no request, server failure is "unavailable"', async () => {
  const gone = await open(420, { pageUrl: '/world-vibe/share/?item=no-such-item', noWait: true, item: 404 });
  await gone.page.waitForSelector('[data-state="missing"]:not([hidden])');
  assert.match(await gone.page.locator('[data-state="missing"]').textContent(), /couldn't find that line/);
  assert.equal(await gone.page.locator('[data-state="item"]').isHidden(), true);
  await gone.page.close();
  const bad = await open(420, { pageUrl: '/world-vibe/share/?item=Not%20A%20Slug', noWait: true });
  await bad.page.waitForSelector('[data-state="missing"]:not([hidden])');
  assert.equal(bad.log.items.length, 0);
  await bad.page.close();
  const none = await open(420, { pageUrl: '/world-vibe/share/', noWait: true });
  await none.page.waitForSelector('[data-state="missing"]:not([hidden])');
  await none.page.close();
  const down = await open(420, { pageUrl: '/world-vibe/share/?item=x-1', noWait: true, item: 500 });
  await down.page.waitForSelector('[data-state="unavailable"]:not([hidden])');
  await down.page.close();
});

await check('the Chrome install page exists and the Bring sheet links to it', async () => {
  const { page } = await open(420);
  await page.locator('[data-open="bring"]').click();
  assert.equal(await page.locator('#sheet .chrome a').getAttribute('href'), '/world-vibe/chrome/');
  await page.goto(ORIGIN + '/world-vibe/chrome/');
  assert.match(await page.locator('h1').textContent(), /World Vibe for Chrome/);
  assert.match(await page.locator('main').textContent(), /Load unpacked/);
  await page.close();
});

await check('check sheet shows the universal link next to the QR and it is keyboard reachable', async () => {
  const { page } = await open(420, { signedIn: true });
  await page.locator('[data-act="check"]').click();
  await page.waitForSelector('#sheet [data-act="send"]');
  const link = page.locator('#sheet a.open-link');
  assert.equal(await link.getAttribute('href'), 'https://go.somacheck.com/world-vibe/share/?item=pick-one');
  await link.focus();
  assert.equal(await page.evaluate(() => document.activeElement.className), 'open-link');
  await page.close();
});

await check('Send to my phone is not offered until the phone route says linked, and not at all when it says not linked', async () => {
  const unlinked = await open(420, { signedIn: true, linked: false });
  await unlinked.page.locator('[data-act="check"]').click();
  await unlinked.page.waitForFunction(() => document.getElementById('sent').textContent.includes('connect an agent'));
  assert.equal(await unlinked.page.locator('#sheet [data-act="send"]').count(), 0);
  assert.ok(await unlinked.page.locator('#qr canvas, #qr img').count() > 0);
  assert.equal(unlinked.log.asks.length, 0);
  await unlinked.page.close();
  const out = await open(420);
  await out.page.locator('[data-act="check"]').click();
  assert.equal(out.log.phone.length, 0, 'signed out never asks the phone route');
  await out.page.close();
});

async function axeCheck(name, setup, opts = {}) {
  await check('axe 0 serious/critical: ' + name, async () => {
    const { page } = await open(opts.width || 420, opts.open || {});
    // Entrance animations start near-transparent; axe would measure them mid-fade.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page);
    await page.addScriptTag({ path: AXE });
    const res = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
    const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    assert.deepEqual(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', ')), []);
    await page.close();
  });
}
const consentOn = async (page) => { await page.locator('#tab-private').click(); await page.waitForFunction(() => document.getElementById('consent') && document.getElementById('consent').checked); };
await axeCheck('home card mobile 420', async () => {});
await axeCheck('home card desktop 1280', async () => {}, { width: 1280 });
await axeCheck('home signed in', async () => {}, { open: { signedIn: true } });
await axeCheck('check sheet with QR', async (p) => { await p.locator('[data-act="check"]').click(); await p.waitForSelector('#qr img', { state: 'attached' }); });
await axeCheck('check sheet signed in after link_required', async (p) => { await p.locator('[data-act="check"]').click(); await p.locator('[data-act="send"]').click(); await p.waitForFunction(() => document.getElementById('sent').textContent.includes('connect an agent')); }, { open: { signedIn: true, link: false } });
await axeCheck('sign-in sheet', async (p) => { await p.locator('#account [data-open="signin"]').click(); });
await axeCheck('check sheet sent right after a sign-in from it', async (p) => { await p.locator('[data-act="check"]').click(); await p.locator('#sheet [data-open="signin"]').click(); await p.locator('#si-email').fill('me@x.test'); await p.locator('#signin-form button').click(); await p.waitForSelector('#code-form'); await p.locator('#si-code').fill('123456'); await p.locator('#code-form button').click(); await p.waitForFunction(() => document.getElementById('sent') && document.getElementById('sent').textContent.includes('Sent')); });
await axeCheck('sign-in sheet, code stage', async (p) => { await p.locator('#account [data-open="signin"]').click(); await p.locator('#si-email').fill('me@x.test'); await p.locator('#signin-form button').click(); await p.waitForSelector('#code-form'); });
await axeCheck('bring your own line sheet', async (p) => { await p.locator('[data-open="bring"]').click(); });
await axeCheck('private lane signed out', async (p) => { await p.locator('#tab-private').click(); });
await axeCheck('private lane consent off', async (p) => { await p.locator('#tab-private').click(); await p.waitForSelector('#consent'); }, { open: { signedIn: true, consent: false } });
await axeCheck('private lane consent on, words', async (p) => { await consentOn(p); await p.locator('[data-ctx="words"]').click(); }, { open: { signedIn: true, consent: true } });
await axeCheck('private line written', async (p) => { await consentOn(p); await p.locator('[data-act="generate"]').click(); await p.waitForSelector('#slot .line:not(.small)'); }, { open: { signedIn: true, consent: true } });
await axeCheck('private check sheet', async (p) => { await consentOn(p); await p.locator('[data-act="generate"]').click(); await p.waitForSelector('#slot .line:not(.small)'); await p.locator('[data-act="check"]').click(); }, { open: { signedIn: true, consent: true } });
await axeCheck('reveal', async (p) => { await p.locator('[data-act="check"]').click(); await p.locator('[data-act="checked"]').click(); await p.waitForSelector('.reveal-head'); }, { open: { progress: [progressEnvelope({ slug: 'pick-one', revealed_by_you: true, your_reading: 'aligned' })], signedIn: true } });
await axeCheck('empty state', async () => {}, { open: { picks: [emptyPick], noWait: false } });
await axeCheck('QR landing item', async (p) => { await p.waitForSelector('[data-state="item"]:not([hidden])'); }, { open: { pageUrl: '/world-vibe/share/?item=wv3-r2-public', noWait: true } });
await axeCheck('QR landing not found', async (p) => { await p.waitForSelector('[data-state="missing"]:not([hidden])'); }, { open: { pageUrl: '/world-vibe/share/?item=nope', noWait: true, item: 404 } });
await axeCheck('Chrome install page', async () => {}, { open: { pageUrl: '/world-vibe/chrome/', noWait: true } });
await axeCheck('how it works sheet', async (p) => { await p.locator('[data-open="how"]').click(); });

await browser.close();
server.close();
if (failed) { console.log(failed + ' browser check(s) failed'); process.exit(1); }
console.log('all browser checks passed');

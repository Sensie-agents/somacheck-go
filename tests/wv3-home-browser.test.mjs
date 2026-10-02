// Real-browser checks for the v3 home, the web session and the consent toggle.
// The routes are answered with stand-ins built around the captured contract rows
// (tests/helpers/captured.mjs). Needs Playwright and axe-core (PLAYWRIGHT_PATH,
// AXE_PATH override the defaults).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickEnvelope, progressEnvelope } from './helpers/captured.mjs';

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
const RECEIPT = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const LINES = ['I need a real break before the next deadline.', 'I am carrying Friday into this week.', 'My body wants a slower morning.'];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
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

// opts: signedIn, key (default KEY), link (true: ask succeeds, false: 422), consent (initial), draftsStatus,
//       progress (array of bodies served in order), pageUrl, picks
async function open(width, opts = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const log = { api: [], sb: [], pickUrls: [], asks: [], drafts: [], draftAsks: [], progress: [], consentWrites: [], otp: [], logout: [], exchange: [] };
  let consent = opts.consent === true;
  let progressCalls = 0;
  let pickCalls = 0;
  await page.route(API + '/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const headers = await req.allHeaders();
    log.api.push({ url: u.pathname + u.search, auth: headers.authorization, method: req.method() });
    if (req.method() === 'OPTIONS') return json(route, {});
    if (u.pathname === '/v1/public/world-vibe/pick') { log.pickUrls.push(u.search); const picks = opts.picks || PICKS; return json(route, picks[pickCalls++] || { item: null, reason: null }); }
    if (u.pathname.endsWith('/progress')) {
      log.progress.push({ url: u.pathname + u.search, auth: headers.authorization });
      const list = opts.progress || [progressEnvelope({ slug: 'pick-one' })];
      return json(route, list[Math.min(progressCalls++, list.length - 1)]);
    }
    if (u.pathname.endsWith('/ask') && u.pathname.startsWith('/v1/me/world-vibe/items/')) {
      log.asks.push({ path: u.pathname, auth: headers.authorization });
      if (opts.link === false) return json(route, { error: 'link_required', message: 'Link an agent before sending this item to your phone.' }, 422);
      return json(route, { request_id: RECEIPT, question: 'q', delivery: 'app_push', replayed: false }, 201);
    }
    if (u.pathname === '/v1/me/vibecheck/drafts') {
      log.drafts.push({ body: JSON.parse(req.postData() || '{}'), auth: headers.authorization });
      if (opts.draftsStatus) return json(route, { error: 'consent_required' }, opts.draftsStatus);
      return json(route, { drafts: LINES.map((statement, i) => ({ id: i === 0 ? DRAFT : '55555555-5555-4555-8555-55555555555' + i, statement })) });
    }
    if (/^\/v1\/me\/vibecheck\/drafts\/[^/]+\/ask$/.test(u.pathname)) { log.draftAsks.push({ path: u.pathname, auth: headers.authorization }); return json(route, { request_id: 'rq-private', source: 'world_vibe_private', status: 'pending' }, 201); }
    if (u.pathname === '/v1/public/world-vibe/feed') return json(route, { items: [pickEnvelope('x', { slug: 'f-1' }).item], next_cursor: null });
    if (u.pathname === '/v1/public/world-vibe/curators') return json(route, { curators: [] });
    if (u.pathname === '/v1/public/world-vibe/featured') return json(route, { featured: null });
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
    if (u.pathname === '/rest/v1/user_context_consent') {
      if (req.method() === 'POST') { const b = JSON.parse(req.postData()); log.consentWrites.push({ body: b, headers }); consent = b.world_vibe_private; return json(route, [{ world_vibe_private: consent }], 201); }
      return json(route, [{ world_vibe_private: consent }]);
    }
    return route.fulfill({ status: 404 });
  });
  await page.addInitScript(({ api, sb, key, signedIn }) => {
    window.SOMACHECK_API_BASE = api;
    window.SOMACHECK_SUPABASE_URL = sb;
    if (key) window.SOMACHECK_SUPABASE_PUBLISHABLE_KEY = key;
    if (signedIn && !localStorage.getItem('wv.session')) localStorage.setItem('wv.session', JSON.stringify({ access_token: 'tok-abc', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400, user_id: 'u-1', email: 'me@x.test' }));
  }, { api: API, sb: SB, key: opts.key === undefined ? KEY : opts.key, signedIn: opts.signedIn });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const navs = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
  await page.goto(ORIGIN + (opts.pageUrl || '/world-vibe/'));
  if (!opts.noWait) await page.waitForSelector('#slot article');
  return { page, log, errors, navs };
}
const bearers = (log) => [...log.api, ...log.sb].filter((r) => r.auth);

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
  const { page, log } = await open(420, { picks: [{ item: null, reason: null }, PICKS[0]] });
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
  assert.equal(log.sb.filter((r) => r.url.includes('user_context_consent')).length, 0);
  await page.close();
});

await check('private lane, consent off: Write my line is disabled and the page never calls /vibecheck/drafts', async () => {
  const { page, log } = await open(420, { signedIn: true, consent: false });
  const read = page.waitForResponse(/user_context_consent/);
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
  await page.locator('[data-ctx="words"]').click();
  await page.locator('#mind').fill('a deadline');
  await page.evaluate(() => { document.querySelector('[data-act="generate"]').disabled = false; });
  await page.locator('[data-act="generate"]').click();
  await page.waitForSelector('[role="alert"]');
  assert.equal(log.drafts.length, 0);
  await page.close();
});

await check('consent toggle round-trips through the API, then drafts are requested with the bearer', async () => {
  const { page, log } = await open(420, { signedIn: true, consent: false });
  await page.locator('#tab-private').click();
  await page.waitForSelector('#consent');
  await page.locator('#consent').check();
  await page.waitForFunction(() => document.getElementById('consent').checked && !document.querySelector('[data-act="generate"]').disabled);
  assert.equal(log.consentWrites.length, 1);
  assert.equal(log.consentWrites[0].body.world_vibe_private, true);
  assert.equal(log.consentWrites[0].body.user_id, 'u-1');
  assert.equal(log.consentWrites[0].headers.apikey, KEY);
  assert.equal(log.consentWrites[0].headers.authorization, 'Bearer tok-abc');
  assert.equal(log.consentWrites[0].headers['content-profile'], 'somacheck_engine');
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
  assert.deepEqual(log.logout, ['Bearer tok-abc']);
  const before = log.api.length;
  await page.locator('[data-act="skip"]').click();
  await page.waitForFunction(() => document.querySelector('.line').textContent.includes('Monday'));
  assert.deepEqual(log.api.slice(before).filter((r) => r.auth), []);
  await page.close();
});

await check('callback from a web sign-in exchanges the code, stores the session and lands on World Vibe without opening the app', async () => {
  const { page, log, navs } = await open(420, { pageUrl: '/world-vibe/', noWait: true });
  await page.evaluate(() => localStorage.setItem('wv.pkce', 'verifier-xyz'));
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
await axeCheck('bring your own line sheet', async (p) => { await p.locator('[data-open="bring"]').click(); });
await axeCheck('private lane signed out', async (p) => { await p.locator('#tab-private').click(); });
await axeCheck('private lane consent off', async (p) => { await p.locator('#tab-private').click(); await p.waitForSelector('#consent'); }, { open: { signedIn: true, consent: false } });
await axeCheck('private lane consent on, words', async (p) => { await consentOn(p); await p.locator('[data-ctx="words"]').click(); }, { open: { signedIn: true, consent: true } });
await axeCheck('private line written', async (p) => { await consentOn(p); await p.locator('[data-act="generate"]').click(); await p.waitForSelector('#slot .line:not(.small)'); }, { open: { signedIn: true, consent: true } });
await axeCheck('private check sheet', async (p) => { await consentOn(p); await p.locator('[data-act="generate"]').click(); await p.waitForSelector('#slot .line:not(.small)'); await p.locator('[data-act="check"]').click(); }, { open: { signedIn: true, consent: true } });
await axeCheck('reveal', async (p) => { await p.locator('[data-act="check"]').click(); await p.locator('[data-act="checked"]').click(); await p.waitForSelector('.reveal-head'); }, { open: { progress: [progressEnvelope({ slug: 'pick-one', revealed_by_you: true, your_reading: 'aligned' })], signedIn: true } });
await axeCheck('empty state', async () => {}, { open: { picks: [{ item: null, reason: null }] , noWait: false } });
await axeCheck('how it works sheet', async (p) => { await p.locator('[data-open="how"]').click(); });

await browser.close();
server.close();
if (failed) { console.log(failed + ' browser check(s) failed'); process.exit(1); }
console.log('all browser checks passed');

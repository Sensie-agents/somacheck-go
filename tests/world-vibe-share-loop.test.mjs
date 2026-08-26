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
const sourcePath = path.join(root, 'world-vibe', 'index.html');
const topicsPath = path.join(root, 'world-vibe', 'topics.json');

const [source, topicsJson] = await Promise.all([
  readFile(sourcePath, 'utf8'),
  readFile(topicsPath, 'utf8')
]);

assert.doesNotMatch(source, /No tracking|Your answer is anonymous|Share this topic|Test it against your own body|Be one of the first 5/i, 'portal source must not regress to the retired copy');
assert.match(source, /Share this World Vibe/, 'portal must expose the concise share CTA');
assert.match(source, /setInterval\(function\(\) \{[\s\S]*POLL_MS\);/, 'portal must poll on a 5 to 10 second timer');

const branchBase = 'https://link.somacheck.test';
const installUrl = 'https://apps.apple.com/app/id6747758187';
const initialTime = '2026-08-26T13:00:00.000Z';
const firstRefreshTime = '2026-08-26T13:01:00.000Z';
const unlockedTime = '2026-08-26T13:03:00.000Z';
const expectedInitialTimestamp = `Last check-in ${new Date(initialTime).toLocaleString()}`;
const expectedUnlockedTimestamp = `Last check-in ${new Date(unlockedTime).toLocaleString()}`;
const expectedStableRoute = `${branchBase}/world-vibe/share/gut-vs-dashboard`;
const expectedPersonalAppRoute = 'somacheck://s/personal-gut-token';
const joinBodies = [];
const joinRequests = [];
const progressHits = new Map();
const requestLog = [];

const progressSeries = {
  'ai-at-work': [
    {
      contributor_count: 0,
      threshold: 5,
      remaining_count: 5,
      unlocked: false,
      aggregate_revision: 0,
      last_completed_at: null
    }
  ],
  'gut-vs-dashboard': [
    {
      contributor_count: 1,
      threshold: 5,
      remaining_count: 4,
      unlocked: false,
      aggregate_revision: 1,
      last_completed_at: initialTime
    },
    {
      contributor_count: 3,
      threshold: 5,
      remaining_count: 2,
      unlocked: false,
      aggregate_revision: 3,
      last_completed_at: firstRefreshTime
    },
    {
      contributor_count: 5,
      threshold: 5,
      remaining_count: 0,
      unlocked: true,
      aggregate_revision: 5,
      last_completed_at: unlockedTime,
      aligned_total: 3,
      unaligned_total: 2
    }
  ],
  'present-leadership': [
    {
      contributor_count: 0,
      threshold: 5,
      remaining_count: 5,
      unlocked: false,
      aggregate_revision: 0,
      last_completed_at: null
    }
  ]
};

function withInjectedConfig(html, origin) {
  const injected = [
    `<script>window.SOMACHECK_API_BASE = ${JSON.stringify(`${origin}/api`)};`,
    `window.SOMACHECK_BRANCH_ROUTE_BASE = ${JSON.stringify(branchBase)};`,
    `window.SOMACHECK_INSTALL_URL = ${JSON.stringify(installUrl)};`,
    'window.__wvIntervals = [];',
    'const __wvNativeSetInterval = window.setInterval.bind(window);',
    'window.setInterval = function(fn, ms) {',
    '  if (ms === 7000) {',
    '    window.__worldVibePoll = fn;',
    '    window.__wvIntervals.push({ fn: fn, ms: ms });',
    '    return 1;',
    '  }',
    '  return __wvNativeSetInterval(fn, ms);',
    '};',
    '</script>'
  ].join('');
  return html.replace('</head>', `${injected}\n</head>`);
}

function nextProgress(slug) {
  const series = progressSeries[slug];
  const count = progressHits.get(slug) || 0;
  progressHits.set(slug, count + 1);
  return series[Math.min(count, series.length - 1)];
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requestLog.push({ method: request.method, pathname: url.pathname });

  if (url.pathname === '/api/v1/public/world-vibe/topics') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(topicsJson);
    return;
  }

  if (url.pathname.match(/^\/api\/v1\/public\/world-vibe\/topics\/[^/]+\/progress$/)) {
    const slug = decodeURIComponent(url.pathname.split('/')[6]);
    const payload = nextProgress(slug);
    response.writeHead(200, {
      'content-type': 'application/json',
      etag: `"${slug}-${payload.aggregate_revision}"`
    });
    response.end(JSON.stringify(payload));
    return;
  }

  if (url.pathname === '/api/v1/public/world-vibe/topics/gut-vs-dashboard/join' && request.method === 'POST') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      joinRequests.push(url.pathname);
      joinBodies.push(JSON.parse(body));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        statement_id: 'stmt_gut_001',
        link_url: 'https://go.somacheck.com/s/personal-gut-token',
        app_url: expectedPersonalAppRoute,
        receipt: {
          save_state: 'counted',
          counted_as_new_contributor: true,
          first_position: 2,
          contributor_count: 2,
          unlock_threshold: 5,
          unlocked: false,
          aggregate_revision: 2
        }
      }));
    });
    return;
  }

  if (url.pathname === '/world-vibe/topics.json') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(topicsJson);
    return;
  }

  if (url.pathname === '/world-vibe/' || url.pathname === '/world-vibe') {
    const configured = withInjectedConfig(source, `http://127.0.0.1:${address.port}`);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(configured);
    return;
  }

  response.writeHead(404);
  response.end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

async function runMutationProof() {
  const mutated = source.replace('Share this World Vibe', 'Share this topic');
  const mutationServer = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/v1/public/world-vibe/topics') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(topicsJson);
      return;
    }
    if (url.pathname.match(/^\/api\/v1\/public\/world-vibe\/topics\/[^/]+\/progress$/)) {
      const slug = decodeURIComponent(url.pathname.split('/')[6]);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(progressSeries[slug][0]));
      return;
    }
    if (url.pathname === '/world-vibe/' || url.pathname === '/world-vibe') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(withInjectedConfig(mutated, `http://127.0.0.1:${mutationAddress.port}`));
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });

  await new Promise((resolve) => mutationServer.listen(0, '127.0.0.1', resolve));
  const mutationAddress = mutationServer.address();
  const mutationOrigin = `http://127.0.0.1:${mutationAddress.port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    await page.goto(`${mutationOrigin}/world-vibe/`, { waitUntil: 'networkidle' });
    await page.locator('#topic-gut-vs-dashboard').waitFor({ state: 'visible' });
    let failedAsExpected = false;
    try {
      await page.locator('text=Share this World Vibe').waitFor({ state: 'visible', timeout: 500 });
    } catch (error) {
      failedAsExpected = /Timeout/.test(String(error));
    }
    assert.equal(failedAsExpected, true, 'mutation proof must show the share CTA assertion breaks when the label regresses');
    return { failedAsExpected };
  } finally {
    await page.close();
    await new Promise((resolve, reject) => mutationServer.close((error) => error ? reject(error) : resolve()));
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.goto(`${origin}/world-vibe/?t=gut-vs-dashboard`, { waitUntil: 'networkidle' });

  await page.locator('#topic-gut-vs-dashboard').waitFor({ state: 'visible' });
  assert.equal(joinRequests.length, 0, 'page load must not issue a join request');
  assert.equal(requestLog.filter((entry) => entry.pathname.endsWith('/join')).length, 0, 'refresh and initial load must not create a statement');

  const aggregate = page.locator('#topic-gut-vs-dashboard [data-role="aggregate"]');
  await assert.doesNotReject(() => aggregate.waitFor({ state: 'visible' }));
  assert.match(await aggregate.textContent(), /1 of 5/i, 'locked public progress must show the truthful count');
  assert.doesNotMatch(await aggregate.textContent(), /Aligned|Unaligned/i, 'split must remain hidden before unlock');

  const qr = page.locator('#topic-gut-vs-dashboard [data-role="qr"]');
  assert.equal(await qr.getAttribute('data-payload'), expectedStableRoute, 'QR payload must stay on the stable public topic route');
  await page.evaluate(() => {
    document.querySelector('#topic-gut-vs-dashboard [data-role="qr"]').setAttribute('data-marker', 'kept');
  });

  const routeNote = page.locator('#topic-gut-vs-dashboard .route-note');
  assert.equal(await routeNote.getAttribute('data-install-url'), installUrl, 'route seam must carry the configured install target');
  assert.match(await page.locator('#topic-gut-vs-dashboard .privacy-line').first().textContent(), /limited routing data may be used/i, 'privacy disclosure must describe the install-return behavior');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .share-btn').textContent(), 'Share this World Vibe', 'share CTA label must stay concise');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').textContent(), 'Start your check-in', 'join CTA must be explicit instead of auto-issuing');
  assert.equal(await page.locator('#last-updated').textContent(), expectedInitialTimestamp, 'timestamp must use the last actual completion time, not fetch time');

  await page.locator('#topic-gut-vs-dashboard .answer-btn').click();
  await page.waitForFunction(() => document.querySelector('#topic-gut-vs-dashboard .answer-btn').tagName === 'A');
  assert.equal(joinRequests.length, 1, 'explicit action must issue exactly one join request');
  assert.match(JSON.stringify(joinBodies[0]), /idempotency_nonce/, 'join request must include an idempotency nonce');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').getAttribute('href'), expectedPersonalAppRoute, 'personal app route must be preserved after join');
  assert.match(await page.locator('#topic-gut-vs-dashboard [data-role="receipt"]').textContent(), /You're check-in 2 of 5\./, 'owner receipt must expose first position only after the confirmed join');
  assert.match(await page.locator('#topic-gut-vs-dashboard [data-role="receipt"]').textContent(), /3 more check-ins unlock the World Vibe\./, 'pre-unlock share loop must show the remaining count');

  await page.evaluate(() => window.__worldVibePoll());
  await page.waitForFunction(() => document.querySelector('#topic-gut-vs-dashboard [data-role="aggregate"]').textContent.includes('3 of 5'));
  assert.equal(await qr.getAttribute('data-payload'), expectedStableRoute, 'refresh must not replace the stable QR payload');
  assert.equal(await qr.getAttribute('data-marker'), 'kept', 'refresh must update in place instead of replacing the QR node');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').getAttribute('href'), expectedPersonalAppRoute, 'refresh must not destroy the personal route');

  await page.evaluate(() => window.__worldVibePoll());
  await page.waitForFunction(() => document.querySelector('#topic-gut-vs-dashboard [data-role="aggregate"]').textContent.includes('Aligned'));
  const unlockedAggregate = await aggregate.textContent();
  assert.match(unlockedAggregate, /Aligned/i, 'split must appear after unlock');
  assert.match(unlockedAggregate, /Unaligned/i, 'split must show both sides after unlock');
  assert.match(unlockedAggregate, /5check-ins|5 check-ins/i, 'unlocked aggregate must still show the full contributor count');
  assert.equal(await page.locator('#last-updated').textContent(), expectedUnlockedTimestamp, 'later refreshes must move to the newest actual completion time');
  assert.equal(await qr.getAttribute('data-payload'), expectedStableRoute, 'stable route must survive multiple refresh cycles');
  assert.equal(await qr.getAttribute('data-marker'), 'kept', 'second refresh must still avoid replacing the QR node');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').getAttribute('href'), expectedPersonalAppRoute, 'personal route must still be available after unlock');

  const mutationProof = await runMutationProof();

  console.log(JSON.stringify({
    passed: true,
    joinRequests: joinRequests.length,
    firstJoinNoncePresent: Boolean(joinBodies[0] && joinBodies[0].idempotency_nonce),
    stableRoute: expectedStableRoute,
    personalRoute: expectedPersonalAppRoute,
    lastActualCompletion: expectedUnlockedTimestamp,
    mutationProof
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

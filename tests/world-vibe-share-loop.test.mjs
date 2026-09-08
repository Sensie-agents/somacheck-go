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
assert.doesNotMatch(source, /data-role="receipt"|You're check-in|first_position|counted_as_new_contributor|idempotency_nonce/i, 'public web must not handle owner receipt state');
assert.match(source, /prompt_id/, 'join flow must send prompt_id');
assert.match(source, /client_nonce/, 'join flow must send client_nonce');
assert.match(source, /session_nonce/, 'join flow must send session_nonce');
assert.match(source, /sessionStorage/, 'session nonce must be scoped to sessionStorage');
assert.doesNotMatch(source, /localStorage|document\.cookie/, 'session nonce must not use persistent browser tracking storage');
assert.match(source, /Share this World Vibe/, 'portal must expose the concise share CTA');
assert.match(source, /setInterval\(function\(\) \{[\s\S]*POLL_MS\);/, 'portal must poll on a 5 to 10 second timer');
assert.match(source, /route_url/, 'one-tap flow must read the public topic route_url');
assert.match(source, /window\.location\.assign\(topic\.smartRouteUrl\)/, 'one-tap flow must navigate the current tab to the validated smart route');
assert.doesNotMatch(source, /window\.open\(|target="_blank"/, 'one-tap flow must not open a new tab or window');
assert.match(source, /var SMART_ROUTE_ORIGIN = 'https:\/\/link\.somacheck\.com';/, 'production must pin the approved Branch smart-link origin');
assert.doesNotMatch(source, /SOMACHECK_BRANCH_ROUTE_BASE/, 'production must not depend on runtime Branch-origin injection');
assert.doesNotMatch(source, /—/, 'portal copy must avoid em dashes');
const topicRouteUrlSource = source.match(/function topicRouteUrl\(topic\) \{[\s\S]*?\n\s*\}\n/);
assert.ok(topicRouteUrlSource, 'portal must define topicRouteUrl');
assert.doesNotMatch(topicRouteUrlSource[0], /BRANCH_ROUTE_BASE/, 'the stable share route must never derive from the Branch smart-link origin');
assert.match(topicRouteUrlSource[0], /absolute\(shareUrl\(topic\)\)/, 'the stable share route must fall back to the current page origin share path');

// Topology: the Branch smart-link origin is pinned on the page but is a different host
// from the public web origin that serves the portal and the stable share route.
const branchBase = 'https://link.somacheck.com';
// The stable public share route lives on the web origin (go.somacheck.com in production,
// the backend STATEMENT_LINK_BASE_URL), never on the Branch host. The real public topics
// RPC returns no link_url, so the portal derives it from its own origin.
const publicShareBase = 'https://go.somacheck.com';
function stableShareRoute(origin, slug) { return `${origin}/world-vibe/share/${slug}`; }
// App Store id6792978184 is the post-publication cutover target.
const installUrl = 'https://testflight.apple.com/join/C4mAH3zz';
const initialTime = '2026-08-26T13:00:00.000Z';
const firstRefreshTime = '2026-08-26T13:01:00.000Z';
const unlockedTime = '2026-08-26T13:03:00.000Z';
const expectedActivityStatus = '';
// A raw stable link_url already on the public web origin is kept without substitution.
const expectedStableRoute = stableShareRoute(publicShareBase, 'gut-vs-dashboard');
const expectedPersonalAppRoute = 'somacheck://s/personal-gut-token';
const joinBodies = [];
const joinRequests = [];
const joinTopics = [];
const progressHits = new Map();
const requestLog = [];

const publicTopicsPayload = {
  topics: [
    {
      topic_slug: 'ai-at-work',
      prompt_id: 'prompt_ai_001',
      statement_text: 'I feel hopeful about AI at work',
      link_url: stableShareRoute(publicShareBase, 'ai-at-work'),
      contributor_count: 0,
      unlock_threshold: 5,
      remaining_count: 5,
      unlocked: false,
      aggregate_revision: 0,
      last_completed_at: null,
      aligned: null,
      unaligned: null
    },
    {
      topic_slug: 'gut-vs-dashboard',
      prompt_id: 'prompt_gut_001',
      statement_text: 'I trust my gut more than my dashboard',
      link_url: expectedStableRoute,
      contributor_count: 1,
      unlock_threshold: 5,
      remaining_count: 4,
      unlocked: false,
      aggregate_revision: 1,
      last_completed_at: initialTime,
      aligned: null,
      unaligned: null
    },
    {
      topic_slug: 'present-leadership',
      prompt_id: 'prompt_present_001',
      statement_text: 'I am fully present with the people I lead',
      link_url: stableShareRoute(publicShareBase, 'present-leadership'),
      contributor_count: 0,
      unlock_threshold: 5,
      remaining_count: 5,
      unlocked: false,
      aggregate_revision: 0,
      last_completed_at: null,
      aligned: null,
      unaligned: null
    }
  ]
};

const progressSeries = {
  'ai-at-work': [
    {
      contributor_count: 0,
      unlock_threshold: 5,
      remaining_count: 5,
      unlocked: false,
      aggregate_revision: 0,
      last_completed_at: null,
      aligned: null,
      unaligned: null
    }
  ],
  'gut-vs-dashboard': [
    {
      contributor_count: 1,
      unlock_threshold: 5,
      remaining_count: 4,
      unlocked: false,
      aggregate_revision: 1,
      last_completed_at: initialTime,
      aligned: null,
      unaligned: null
    },
    {
      contributor_count: 3,
      unlock_threshold: 5,
      remaining_count: 2,
      unlocked: false,
      aggregate_revision: 3,
      last_completed_at: firstRefreshTime,
      aligned: null,
      unaligned: null
    },
    {
      contributor_count: 5,
      unlock_threshold: 5,
      remaining_count: 0,
      unlocked: true,
      aggregate_revision: 5,
      last_completed_at: unlockedTime,
      aligned: 3,
      unaligned: 2
    }
  ],
  'present-leadership': [
    {
      contributor_count: 0,
      unlock_threshold: 5,
      remaining_count: 5,
      unlocked: false,
      aggregate_revision: 0,
      last_completed_at: null,
      aligned: null,
      unaligned: null
    }
  ]
};

function withInjectedConfig(html, origin) {
  const injected = [
    `<script>window.SOMACHECK_API_BASE = ${JSON.stringify(`${origin}/api`)};`,
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

function nextProgress(slug, seriesMap) {
  const series = seriesMap[slug] || [lockedProgress];
  const count = progressHits.get(slug) || 0;
  progressHits.set(slug, count + 1);
  return series[Math.min(count, series.length - 1)];
}

async function startPortalServer(options) {
  const html = options.source ?? source;
  const topicsStatus = options.topicsStatus ?? 200;
  const topicsBody = options.topicsBody ?? publicTopicsPayload;
  const joinHandler = options.joinHandler ?? null;
  const joinStatus = options.joinStatus ?? 200;
  const joinResponse = options.joinResponse ?? {
    statement_id: 'stmt_gut_001',
    link_url: 'https://go.somacheck.com/s/personal-gut-token',
    app_url: expectedPersonalAppRoute
  };
  const seriesMap = options.progressSeries ?? progressSeries;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requestLog.push({ method: request.method, pathname: url.pathname });

    if (url.pathname === '/api/v1/public/world-vibe/topics') {
      const payload = typeof topicsBody === 'function' ? topicsBody(`http://127.0.0.1:${server.address().port}`) : topicsBody;
      response.writeHead(topicsStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
      return;
    }

    if (url.pathname.match(/^\/api\/v1\/public\/world-vibe\/topics\/[^/]+\/progress$/)) {
      const slug = decodeURIComponent(url.pathname.split('/')[6]);
      const payload = nextProgress(slug, seriesMap);
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: `"${slug}-${payload.aggregate_revision}"`
      });
      response.end(JSON.stringify(payload));
      return;
    }

    if (url.pathname.match(/^\/api\/v1\/public\/world-vibe\/topics\/[^/]+\/join$/) && request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const topicSlug = decodeURIComponent(url.pathname.split('/')[6]);
        joinRequests.push(url.pathname);
        joinTopics.push(topicSlug);
        joinBodies.push(JSON.parse(body));
        if (joinHandler) {
          joinHandler(topicSlug, request, response);
          return;
        }
        response.writeHead(joinStatus, { 'content-type': 'application/json' });
        if (typeof joinResponse === 'function') {
          response.end(JSON.stringify(joinResponse(topicSlug)));
          return;
        }
        response.end(JSON.stringify(joinResponse));
      });
      return;
    }

    if (url.pathname === '/world-vibe/topics.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(topicsJson);
      return;
    }

    if (url.pathname === '/world-vibe/' || url.pathname === '/world-vibe') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(withInjectedConfig(html, `http://127.0.0.1:${server.address().port}`));
      return;
    }

    response.writeHead(404);
    response.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function runFixtureFallbackProof(browser) {
  progressHits.clear();
  const fallbackServer = await startPortalServer({
    topicsStatus: 503,
    topicsBody: { error: 'unavailable' },
    progressSeries: {
      'ai-at-work': [
        {
          contributor_count: 0,
          unlock_threshold: 5,
          remaining_count: 5,
          unlocked: false,
          aggregate_revision: 0,
          last_completed_at: null,
          aligned: null,
          unaligned: null
        }
      ],
      'gut-vs-dashboard': [
        {
          contributor_count: 0,
          unlock_threshold: 5,
          remaining_count: 5,
          unlocked: false,
          aggregate_revision: 0,
          last_completed_at: null,
          aligned: null,
          unaligned: null
        }
      ],
      'present-leadership': [
        {
          contributor_count: 0,
          unlock_threshold: 5,
          remaining_count: 5,
          unlocked: false,
          aggregate_revision: 0,
          last_completed_at: null,
          aligned: null,
          unaligned: null
        }
      ]
    }
  });
  const origin = `http://127.0.0.1:${fallbackServer.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  try {
    await page.goto(`${origin}/world-vibe/?t=ai-at-work`, { waitUntil: 'networkidle' });
    await page.locator('#topic-ai-at-work').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#topic-ai-at-work .statement').textContent(), 'I feel hopeful about AI at work', 'static fixture array must still normalize into portal statements');
    assert.equal(await page.locator('#topic-ai-at-work [data-role="qr"]').getAttribute('data-payload'), stableShareRoute(origin, 'ai-at-work'), 'static fixture topics must derive the stable share route on the page origin when no public link_url is provided');
    return { fallbackNormalized: true };
  } finally {
    await page.close();
    await closeServer(fallbackServer);
  }
}

async function runMutationProof(browser) {
  progressHits.clear();
  const mutated = source.replace('Share this World Vibe', 'Share this topic');
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/v1/public/world-vibe/topics') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(publicTopicsPayload));
      return;
    }
    if (url.pathname.match(/^\/api\/v1\/public\/world-vibe\/topics\/[^/]+\/progress$/)) {
      const slug = decodeURIComponent(url.pathname.split('/')[6]);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(progressSeries[slug][0]));
      return;
    }
    if (url.pathname === '/world-vibe/topics.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(topicsJson);
      return;
    }
    if (url.pathname === '/world-vibe/' || url.pathname === '/world-vibe') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(withInjectedConfig(mutated, `http://127.0.0.1:${server.address().port}`));
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  try {
    await page.goto(`${origin}/world-vibe/`, { waitUntil: 'networkidle' });
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
    await closeServer(server);
  }
}

async function runChallengeRequiredProof(browser) {
  progressHits.clear();
  const joinStart = joinRequests.length;
  const requestStart = requestLog.length;
  const challengeServer = await startPortalServer({
    joinStatus: 429,
    joinResponse: function() {
      return { error: 'challenge_required', retry_after_seconds: 45 };
    }
  });
  const origin = `http://127.0.0.1:${challengeServer.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const track = await trackPage(page);

  try {
    await page.goto(`${origin}/world-vibe/?t=gut-vs-dashboard`, { waitUntil: 'networkidle' });
    await page.locator('#topic-gut-vs-dashboard').waitFor({ state: 'visible' });
    const navigationsBefore = track.navigations.length;
    await page.locator('#topic-gut-vs-dashboard .answer-btn').click();
    await page.waitForFunction(function() {
      var statusEl = document.querySelector('#topic-gut-vs-dashboard [data-role="status"]');
      return statusEl && statusEl.textContent === 'This World Vibe is busy. Try again in about 45 seconds.';
    });
    await page.waitForTimeout(350);

    const joinDelta = joinRequests.length - joinStart;
    const requestDelta = requestLog.slice(requestStart).filter(function(entry) {
      return entry.pathname.endsWith('/join');
    }).length;
    assert.equal(joinDelta, 1, 'legacy challenge response must trigger exactly one join attempt');
    assert.equal(requestDelta, 1, 'legacy challenge response must not be retried automatically');
    assert.deepEqual(track.navigations.slice(navigationsBefore), [], 'legacy challenge response must not navigate anywhere');
    assert.deepEqual(track.scriptNavigations, [], 'legacy challenge response must not start any script navigation');
    assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').evaluate(function(node) { return node.tagName; }), 'BUTTON', 'legacy challenge response must fail closed without issuing a statement link');
    assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').textContent(), 'Open in SomaCheck', 'legacy challenge response must preserve the explicit app handoff action');
    assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').isDisabled(), false, 'legacy challenge response should allow a later manual retry');
    assert.equal(await page.locator('#topic-gut-vs-dashboard [data-role="status"]').textContent(), 'This World Vibe is busy. Try again in about 45 seconds.', 'legacy challenge response must collapse to the retryable busy state');
    assert.equal(await page.locator('#topic-gut-vs-dashboard [data-role="qr"]').getAttribute('data-payload'), expectedStableRoute, 'legacy challenge response must not replace the stable topic route');
    return { recognized: true, joinDelta: joinDelta, requestDelta: requestDelta };
  } finally {
    await page.close();
    await closeServer(challengeServer);
  }
}

const smartRouteHost = 'link.somacheck.com';
const smartRoutePath = '/a/key_test_public';
const lockedProgress = {
  contributor_count: 0,
  unlock_threshold: 5,
  remaining_count: 5,
  unlocked: false,
  aggregate_revision: 0,
  last_completed_at: null,
  aligned: null,
  unaligned: null
};

// Mirrors buildWorldVibeBranchRoute in the backend lane: a cross-origin Branch long
// link whose query holds exactly nine keys: route_version, topic_slug, prompt_id, the
// stable public share route (the web origin, never the Branch host) as $canonical_url
// and $fallback_url, the configured install route as $ios_url, and the three Branch
// privacy controls. The backend emits no userinfo and no fragment.
// `mutate` lets a rejection variant break exactly one invariant of the canonical link.
function smartRoute(slug, promptId, stableRoute, base, mutate) {
  const url = new URL((base ?? branchBase) + smartRoutePath);
  url.searchParams.set('route_version', '1');
  url.searchParams.set('topic_slug', slug);
  if (promptId !== null) url.searchParams.set('prompt_id', promptId);
  url.searchParams.set('$canonical_url', stableRoute);
  url.searchParams.set('$fallback_url', stableRoute);
  url.searchParams.set('$ios_url', installUrl);
  url.searchParams.set('$ios_nativelink', 'true');
  url.searchParams.set('$deeplink_no_attribution', 'true');
  url.searchParams.set('$do_not_process', 'true');
  if (mutate) mutate(url);
  return url.toString();
}

function brokenSmartRoute(slug, origin, mutate) {
  return smartRoute(slug, `prompt_${slug}`, stableShareRoute(origin, slug), undefined, mutate);
}

// The realistic production shape: the Branch host carries the route, and its canonical
// and fallback targets are the exact share path on the origin serving this page.
function expectedSmartRoute(origin) {
  return smartRoute('gut-vs-dashboard', 'prompt_gut_001', stableShareRoute(origin, 'gut-vs-dashboard'));
}

function topicRow(slug, promptId, extra) {
  return Object.assign({
    topic_slug: slug,
    prompt_id: promptId,
    statement_text: `Statement for ${slug}`
  }, lockedProgress, extra || {});
}

async function trackPage(page) {
  const record = { navigations: [], scriptNavigations: [], smartHostRequests: [], externalRequests: [] };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) record.navigations.push(request.url());
    if (url.hostname === smartRouteHost) record.smartHostRequests.push({ method: request.method(), url: request.url(), navigation: request.isNavigationRequest() });
    if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1' && !/googleapis|gstatic/.test(url.hostname)) record.externalRequests.push(request.url());
  });
  // Second observer through CDP: fires for custom-scheme and blocked attempts too, and
  // records the disposition so a same-tab claim is proven rather than assumed.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  const rootFrameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
  cdp.on('Page.frameRequestedNavigation', (event) => {
    if (event.frameId === rootFrameId && event.reason === 'scriptInitiated') record.scriptNavigations.push(`${event.disposition}:${event.url}`);
  });
  return record;
}

async function interceptExternal(page) {
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (/googleapis|gstatic/.test(host)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body data-landing="smart-route">landed</body></html>' });
  });
}

function joinCount(slug) {
  return joinTopics.filter((topic) => topic === slug).length;
}

function joinRequestLogCount(start) {
  return requestLog.slice(start).filter((entry) => entry.pathname.endsWith('/join')).length;
}

async function runSmartRouteProof(browser) {
  progressHits.clear();
  const joinStart = joinRequests.length;
  const requestStart = requestLog.length;
  // Realistic public topics shape: no link_url on any row (the public RPC returns none),
  // route_url on the Branch host with canonical and fallback on the page origin.
  const server = await startPortalServer({
    topicsBody: (pageOrigin) => ({
      topics: [
        topicRow('ai-at-work', 'prompt_ai_001', { statement_text: 'I feel hopeful about AI at work', route_url: smartRoute('ai-at-work', 'prompt_ai_001', stableShareRoute(pageOrigin, 'ai-at-work')) }),
        topicRow('gut-vs-dashboard', 'prompt_gut_001', {
          statement_text: 'I trust my gut more than my dashboard',
          route_url: expectedSmartRoute(pageOrigin),
          contributor_count: 1,
          remaining_count: 4,
          aggregate_revision: 1,
          last_completed_at: initialTime
        }),
        topicRow('present-leadership', 'prompt_present_001', { statement_text: 'I am fully present with the people I lead' })
      ]
    })
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const portalUrl = `${origin}/world-vibe/?t=gut-vs-dashboard`;
  const expectedStable = stableShareRoute(origin, 'gut-vs-dashboard');
  const expectedSmart = expectedSmartRoute(origin);
  const smartParams = new URL(expectedSmart).searchParams;
  assert.notEqual(origin, branchBase, 'topology: the public share origin and the Branch origin must differ');
  assert.equal(new URL(expectedSmart).origin, branchBase, 'topology: route_url must be on the Branch host');
  assert.equal(new URL(expectedStable).origin, origin, 'topology: the stable share route must be on the page origin');
  assert.equal(smartParams.get('$canonical_url'), expectedStable, 'topology: $canonical_url must be the exact current-origin share path');
  assert.equal(smartParams.get('$fallback_url'), expectedStable, 'topology: $fallback_url must be the exact current-origin share path');
  assert.equal(smartParams.get('$ios_url'), installUrl, 'topology: $ios_url must be the configured install route');
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const track = await trackPage(page);
  await interceptExternal(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: function(data) { window.__wvShared = data; return Promise.resolve(); }
    });
  });

  try {
    await page.goto(portalUrl, { waitUntil: 'networkidle' });
    await page.locator('#topic-gut-vs-dashboard').waitFor({ state: 'visible' });
    const button = page.locator('#topic-gut-vs-dashboard .answer-btn');
    assert.equal(await button.evaluate((node) => node.tagName), 'BUTTON', 'smart route must not pre-render a personal link on load');
    assert.equal(await button.textContent(), 'Open in SomaCheck', 'smart route keeps the explicit app handoff CTA');
    assert.equal(await page.locator('#topic-gut-vs-dashboard [data-role="status"]').textContent(), '', 'smart route must not claim any personal status before the tap');
    assert.equal(await page.locator('#topic-gut-vs-dashboard [data-role="qr"]').getAttribute('data-payload'), expectedStable, 'QR must be the current-origin stable topic route even when a smart route_url exists');
    assert.equal(await page.locator('#topic-ai-at-work [data-role="qr"]').getAttribute('data-payload'), stableShareRoute(origin, 'ai-at-work'), 'a topic with only route_url must still derive the current-origin stable share route for its QR');
    assert.equal(new URL(await page.locator('#topic-gut-vs-dashboard [data-role="qr"]').getAttribute('data-payload')).origin, origin, 'QR payload must never move to the Branch origin');
    assert.equal(await page.locator('#topic-ai-at-work .route-note').getAttribute('data-install-url'), installUrl, 'install fallback seam must be unchanged on the smart path');
    assert.match(await page.locator('#topic-gut-vs-dashboard .privacy-line').textContent(), /limited routing data may be used/i, 'privacy disclosure must remain on the smart path');
    assert.match(await page.locator('#topic-gut-vs-dashboard [data-role="aggregate"]').textContent(), /1 of 5/, 'locked aggregate must render on the smart path');

    await page.locator('#topic-gut-vs-dashboard .share-btn').click();
    const shared = await page.evaluate(() => window.__wvShared);
    assert.equal(shared.url, expectedStable, 'share must use the current-origin stable topic route, never the smart or personal route');
    assert.equal(new URL(shared.url).origin, origin, 'navigator.share url must stay on the page origin, not the Branch origin');
    assert.doesNotMatch(shared.text, /key_test_public|prompt_id/, 'share text must not leak the Branch smart route');
    assert.doesNotMatch(shared.text, new RegExp(branchBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'share text must not mention the Branch origin');

    // Passive activity: poll, scroll, refresh. None of it may join or navigate.
    await page.evaluate(() => window.__worldVibePoll());
    await page.waitForFunction(() => document.querySelector('#topic-gut-vs-dashboard [data-role="aggregate"]').textContent.includes('3 of 5'));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(250);
    const navigationsBeforeReload = track.navigations.length;
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#topic-gut-vs-dashboard').waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    assert.deepEqual(track.navigations.slice(navigationsBeforeReload), [portalUrl], 'refresh must be the only navigation during passive activity');
    assert.equal(joinRequests.length - joinStart, 0, 'load, poll, scroll, and refresh must never issue a join');
    assert.equal(joinRequestLogCount(requestStart), 0, 'no join request may reach the server passively');
    assert.deepEqual(track.scriptNavigations, [], 'passive activity must not start any script navigation');
    assert.deepEqual(track.smartHostRequests, [], 'passive activity must not touch the smart route host');
    assert.deepEqual(track.externalRequests, [], 'passive activity must not contact any external host');
    const storageBefore = await page.evaluate(() => ({
      localStorageKeys: Object.keys(window.localStorage),
      sessionKeys: Object.keys(window.sessionStorage),
      cookie: document.cookie
    }));
    assert.deepEqual(storageBefore, { localStorageKeys: [], sessionKeys: [], cookie: '' }, 'smart path must not write any storage before the tap');

    // The one tap: exactly one same-tab navigation to the exact smart route, zero joins.
    const navigationsBeforeTap = track.navigations.length;
    const scriptNavigationsBeforeTap = track.scriptNavigations.length;
    await Promise.all([
      page.waitForURL((url) => url.href === expectedSmart, { timeout: 5000 }),
      page.locator('#topic-gut-vs-dashboard .answer-btn').click()
    ]);
    await page.waitForTimeout(350);
    const tapNavigations = track.navigations.slice(navigationsBeforeTap);
    assert.deepEqual(tapNavigations, [expectedSmart], 'first tap must perform exactly one navigation to the exact smart route_url');
    assert.deepEqual(track.scriptNavigations.slice(scriptNavigationsBeforeTap), [`currentTab:${expectedSmart}`], 'the tap must be exactly one script-initiated same-tab navigation');
    assert.equal(page.url(), expectedSmart, 'the tab itself must land on the smart route');
    assert.equal(track.smartHostRequests.length, 1, 'exactly one request may reach the smart route host');
    assert.equal(track.smartHostRequests[0].method, 'GET', 'the smart route must be opened by a plain navigation');
    assert.equal(track.smartHostRequests[0].navigation, true, 'the smart route request must be the main-frame navigation');
    assert.equal(joinRequests.length - joinStart, 0, 'the smart path must issue zero browser join requests');
    assert.equal(joinRequestLogCount(requestStart), 0, 'no join request may reach the server on the smart path');
    const landed = new URL(page.url());
    assert.notEqual(landed.origin, origin, 'smart route must be cross-origin from the portal');
    assert.equal(landed.origin, branchBase, 'smart route must be on the configured Branch domain');
    assert.equal(landed.searchParams.get('topic_slug'), 'gut-vs-dashboard', 'smart route must carry the exact topic_slug');
    assert.equal(landed.searchParams.get('prompt_id'), 'prompt_gut_001', 'smart route must carry the exact prompt_id');
    assert.equal(landed.searchParams.get('$canonical_url'), expectedStable, 'the landed route must carry the current-origin share path as $canonical_url');
    assert.equal(landed.searchParams.get('$fallback_url'), expectedStable, 'the landed route must carry the current-origin share path as $fallback_url');
    assert.equal(await page.locator('body').getAttribute('data-landing'), 'smart-route', 'navigation must complete in the same tab');
    return { navigations: tapNavigations, joinRequests: joinRequests.length - joinStart, smartHostRequests: track.smartHostRequests.length, sharedUrl: shared.url, stableRoute: expectedStable, smartRoute: expectedSmart };
  } finally {
    await page.close();
    await closeServer(server);
  }
}

async function exerciseFallbackJoin(page, track, slug, expectedAppRoute) {
  const joinStart = joinRequests.length;
  const navigationsBefore = track.navigations.length;
  const smartBefore = track.smartHostRequests.length;
  const scriptBefore = track.scriptNavigations.length;
  const bodyIndex = joinBodies.length;
  await page.locator(`#topic-${slug} .answer-btn`).click();
  await page.waitForFunction((id) => document.querySelector(`#topic-${id} .answer-btn`).tagName === 'A', slug);
  await page.waitForTimeout(250);
  assert.equal(joinRequests.length - joinStart, 1, `${slug}: fallback must issue exactly one join`);
  assert.equal(joinCount(slug), 1, `${slug}: the join must target this topic`);
  assert.deepEqual(Object.keys(joinBodies[bodyIndex]).sort(), ['client_nonce', 'prompt_id', 'session_nonce'], `${slug}: fallback join body must keep exactly three keys`);
  assert.equal(joinBodies[bodyIndex].prompt_id, `prompt_${slug}`, `${slug}: fallback join must send the exact prompt_id`);
  assert.deepEqual(track.navigations.slice(navigationsBefore), [], `${slug}: fallback join must not navigate automatically`);
  assert.deepEqual(track.scriptNavigations.slice(scriptBefore), [], `${slug}: fallback join must not start a script navigation`);
  assert.equal(track.smartHostRequests.length - smartBefore, 0, `${slug}: fallback must not touch the smart route host`);
  const anchor = page.locator(`#topic-${slug} .answer-btn`);
  assert.equal(await anchor.textContent(), 'Open your check-in', `${slug}: fallback must show the manual personal link`);
  assert.equal(await anchor.getAttribute('href'), expectedAppRoute, `${slug}: manual link must be the returned personal route`);
  assert.equal(await page.locator(`#topic-${slug} [data-role="status"]`).textContent(), 'Your check-in is ready in SomaCheck.', `${slug}: fallback status stays neutral`);
}

async function runSmartRouteRejectionProof(browser) {
  progressHits.clear();
  const variants = (origin) => ([
    ['wv-absent', {}],
    ['wv-malformed', { route_url: 'not a url' }],
    ['wv-custom-scheme', { route_url: 'somacheck://world-vibe?topic_slug=wv-custom-scheme&prompt_id=prompt_wv-custom-scheme' }],
    ['wv-plain-http', { route_url: smartRoute('wv-plain-http', 'prompt_wv-plain-http', stableShareRoute(origin, 'wv-plain-http'), 'http://link.somacheck.test') }],
    ['wv-same-origin', { route_url: smartRoute('wv-same-origin', 'prompt_wv-same-origin', stableShareRoute(origin, 'wv-same-origin'), origin) }],
    ['wv-unconfigured-domain', { route_url: smartRoute('wv-unconfigured-domain', 'prompt_wv-unconfigured-domain', stableShareRoute(origin, 'wv-unconfigured-domain'), 'https://other.somacheck.test') }],
    ['wv-wrong-topic', { route_url: smartRoute('gut-vs-dashboard', 'prompt_wv-wrong-topic', stableShareRoute(origin, 'wv-wrong-topic')) }],
    ['wv-wrong-prompt', { route_url: smartRoute('wv-wrong-prompt', 'prompt_other_999', stableShareRoute(origin, 'wv-wrong-prompt')) }],
    ['wv-missing-prompt', { route_url: smartRoute('wv-missing-prompt', null, stableShareRoute(origin, 'wv-missing-prompt')) }],
    ['wv-stable-share-as-route', { route_url: `${branchBase}/world-vibe/share/wv-stable-share-as-route` }],
    ['wv-link-url-only', { link_url: smartRoute('wv-link-url-only', 'prompt_wv-link-url-only', stableShareRoute(origin, 'wv-link-url-only')) }],
    // Each backend/frozen invariant independently: the control missing, and present but wrong.
    ['wv-version-missing', { route_url: brokenSmartRoute('wv-version-missing', origin, (url) => url.searchParams.delete('route_version')) }],
    ['wv-version-wrong', { route_url: brokenSmartRoute('wv-version-wrong', origin, (url) => url.searchParams.set('route_version', '2')) }],
    ['wv-version-false', { route_url: brokenSmartRoute('wv-version-false', origin, (url) => url.searchParams.set('route_version', 'false')) }],
    ['wv-nativelink-missing', { route_url: brokenSmartRoute('wv-nativelink-missing', origin, (url) => url.searchParams.delete('$ios_nativelink')) }],
    ['wv-nativelink-false', { route_url: brokenSmartRoute('wv-nativelink-false', origin, (url) => url.searchParams.set('$ios_nativelink', 'false')) }],
    ['wv-no-attribution-missing', { route_url: brokenSmartRoute('wv-no-attribution-missing', origin, (url) => url.searchParams.delete('$deeplink_no_attribution')) }],
    ['wv-no-attribution-false', { route_url: brokenSmartRoute('wv-no-attribution-false', origin, (url) => url.searchParams.set('$deeplink_no_attribution', 'false')) }],
    ['wv-do-not-process-missing', { route_url: brokenSmartRoute('wv-do-not-process-missing', origin, (url) => url.searchParams.delete('$do_not_process')) }],
    ['wv-do-not-process-false', { route_url: brokenSmartRoute('wv-do-not-process-false', origin, (url) => url.searchParams.set('$do_not_process', 'false')) }],
    ['wv-control-duplicated', { route_url: brokenSmartRoute('wv-control-duplicated', origin, (url) => url.searchParams.append('$do_not_process', 'false')) }],
    // Backend builder targets: canonical, fallback, and install routes must be exact.
    ['wv-canonical-missing', { route_url: brokenSmartRoute('wv-canonical-missing', origin, (url) => url.searchParams.delete('$canonical_url')) }],
    ['wv-canonical-wrong', { route_url: brokenSmartRoute('wv-canonical-wrong', origin, (url) => url.searchParams.set('$canonical_url', 'https://tracker.somacheck.test/world-vibe/share/wv-canonical-wrong')) }],
    ['wv-fallback-missing', { route_url: brokenSmartRoute('wv-fallback-missing', origin, (url) => url.searchParams.delete('$fallback_url')) }],
    ['wv-fallback-wrong', { route_url: brokenSmartRoute('wv-fallback-wrong', origin, (url) => url.searchParams.set('$fallback_url', stableShareRoute(origin, 'gut-vs-dashboard'))) }],
    ['wv-ios-url-missing', { route_url: brokenSmartRoute('wv-ios-url-missing', origin, (url) => url.searchParams.delete('$ios_url')) }],
    ['wv-ios-url-wrong', { route_url: brokenSmartRoute('wv-ios-url-wrong', origin, (url) => url.searchParams.set('$ios_url', 'https://apps.apple.com/app/id6792978184')) }],
    // Topology mismatch: canonical and fallback on the Branch origin instead of the
    // public share origin is a misbuilt route and must fall back to the web join.
    ['wv-branch-origin-canonical', { route_url: smartRoute('wv-branch-origin-canonical', 'prompt_wv-branch-origin-canonical', `${branchBase}/world-vibe/share/wv-branch-origin-canonical`) }],
    // Allowlisted payload only: any extra key is a tracking or misconfigured route.
    ['wv-extra-campaign', { route_url: brokenSmartRoute('wv-extra-campaign', origin, (url) => url.searchParams.append('~campaign', 'world-vibe-launch')) }],
    ['wv-extra-channel', { route_url: brokenSmartRoute('wv-extra-channel', origin, (url) => url.searchParams.append('~channel', 'sms')) }],
    ['wv-extra-customer-id', { route_url: brokenSmartRoute('wv-extra-customer-id', origin, (url) => url.searchParams.append('customer_id', 'cust_12345')) }],
    ['wv-extra-account-id', { route_url: brokenSmartRoute('wv-extra-account-id', origin, (url) => url.searchParams.append('account_id', 'acct_12345')) }],
    // Exact backend shape: the builder never emits userinfo or a fragment, and either can
    // smuggle an identity or tracking token past a query-only allowlist.
    ['wv-userinfo-username', { route_url: brokenSmartRoute('wv-userinfo-username', origin, (url) => { url.username = 'cust_12345'; }) }],
    ['wv-userinfo-credentials', { route_url: brokenSmartRoute('wv-userinfo-credentials', origin, (url) => { url.username = 'cust_12345'; url.password = 'secret'; }) }],
    ['wv-fragment-identity', { route_url: brokenSmartRoute('wv-fragment-identity', origin, (url) => { url.hash = '#customer_id=cust_12345'; }) }],
    // Long-link path shape: must be /a/<public key> with the backend BRANCH_KEY shape.
    ['wv-non-a-path', { route_url: brokenSmartRoute('wv-non-a-path', origin, (url) => { url.pathname = '/l/key_test_public'; }) }],
    ['wv-missing-public-key', { route_url: brokenSmartRoute('wv-missing-public-key', origin, (url) => { url.pathname = '/a/'; }) }],
    ['wv-malformed-key', { route_url: brokenSmartRoute('wv-malformed-key', origin, (url) => { url.pathname = '/a/not-a-branch-key'; }) }],
    ['wv-non-public-key', { route_url: brokenSmartRoute('wv-non-public-key', origin, (url) => { url.pathname = '/a/key_secret_abc123'; }) }],
    ['wv-key-trailing-path', { route_url: brokenSmartRoute('wv-key-trailing-path', origin, (url) => { url.pathname = '/a/key_test_public/extra'; }) }]
  ]);
  const server = await startPortalServer({
    topicsBody: (origin) => ({ topics: variants(origin).map(([slug, extra]) => topicRow(slug, `prompt_${slug}`, extra)) }),
    joinResponse: (slug) => ({ statement_id: `stmt_${slug}`, link_url: `https://go.somacheck.com/s/personal-${slug}`, app_url: `somacheck://s/personal-${slug}` })
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const track = await trackPage(page);
  await interceptExternal(page);
  const rejected = [];

  try {
    await page.goto(`${origin}/world-vibe/`, { waitUntil: 'networkidle' });
    for (const [slug, extra] of variants(origin)) {
      await page.locator(`#topic-${slug}`).waitFor({ state: 'visible' });
      const expectedQr = extra.link_url || stableShareRoute(origin, slug);
      assert.equal(await page.locator(`#topic-${slug} [data-role="qr"]`).getAttribute('data-payload'), expectedQr, `${slug}: QR must never become the rejected route_url`);
      await exerciseFallbackJoin(page, track, slug, `somacheck://s/personal-${slug}`);
      rejected.push(slug);
    }
    assert.deepEqual(track.externalRequests, [], 'rejected smart routes must never contact an external host');
  } finally {
    await page.close();
    await closeServer(server);
  }

  return { rejected };
}

async function runFallbackStatusProof(browser) {
  progressHits.clear();
  const cases = {
    'wv-created-201': { status: 201, body: { statement_id: 'stmt_201', link_url: 'https://go.somacheck.com/s/personal-201', app_url: 'somacheck://s/personal-201' }, expectStatus: 'Your check-in is ready in SomaCheck.', link: true },
    'wv-challenge-200': { status: 200, body: { error: 'challenge_required', retry_after_seconds: 30 }, expectStatus: 'This World Vibe is busy. Try again in about 30 seconds.' },
    'wv-rate-limit-429': { status: 429, body: { error: 'rate_limit_exceeded', retry_after_seconds: 45 }, expectStatus: 'This World Vibe is busy. Try again in about 45 seconds.' },
    'wv-retired-404': { status: 404, body: { error: 'not_found' }, expectStatus: 'This topic has been retired.' },
    'wv-server-500': { status: 500, body: { error: 'internal' }, expectStatus: 'Something went wrong. Please try again.' },
    'wv-malformed-200': { status: 200, raw: 'not-json{', expectStatus: 'Something went wrong. Please try again.' },
    'wv-network-drop': { drop: true, expectStatus: 'Something went wrong. Please try again.' }
  };
  const server = await startPortalServer({
    topicsBody: { topics: Object.keys(cases).map((slug) => topicRow(slug, `prompt_${slug}`)) },
    joinHandler: (slug, request, response) => {
      const spec = cases[slug];
      response.writeHead(spec.status, { 'content-type': 'application/json' });
      response.end(spec.raw !== undefined ? spec.raw : JSON.stringify(spec.body));
    }
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const portalUrl = `${origin}/world-vibe/`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const track = await trackPage(page);
  await interceptExternal(page);
  const droppedJoins = [];
  await page.route((url) => url.pathname.endsWith('/wv-network-drop/join'), (route) => {
    droppedJoins.push(route.request().postDataJSON());
    route.abort('connectionfailed');
  });
  const outcomes = {};

  try {
    await page.goto(portalUrl, { waitUntil: 'networkidle' });
    for (const [slug, spec] of Object.entries(cases)) {
      await page.locator(`#topic-${slug}`).waitFor({ state: 'visible' });
      const navigationsBefore = track.navigations.length;
      const scriptBefore = track.scriptNavigations.length;
      const bodyIndex = joinBodies.length;
      await page.locator(`#topic-${slug} .answer-btn`).click();
      await page.waitForFunction(([id, expected]) => {
        const statusEl = document.querySelector(`#topic-${id} [data-role="status"]`);
        return statusEl && statusEl.textContent === expected;
      }, [slug, spec.expectStatus]);
      await page.waitForTimeout(350);
      const attempts = spec.drop ? droppedJoins.length : joinCount(slug);
      const sentBody = spec.drop ? droppedJoins[0] : joinBodies[bodyIndex];
      assert.equal(attempts, 1, `${slug}: exactly one join attempt, never an automatic retry`);
      assert.deepEqual(Object.keys(sentBody).sort(), ['client_nonce', 'prompt_id', 'session_nonce'], `${slug}: join body keeps exactly three keys`);
      assert.deepEqual(track.navigations.slice(navigationsBefore), [], `${slug}: no automatic navigation`);
      assert.deepEqual(track.scriptNavigations.slice(scriptBefore), [], `${slug}: no script-initiated navigation attempt`);
      assert.equal(await page.locator(`#topic-${slug} [data-role="qr"]`).getAttribute('data-payload'), stableShareRoute(origin, slug), `${slug}: QR stays the current-origin stable topic route`);
      const control = page.locator(`#topic-${slug} .answer-btn`);
      if (spec.link) {
        assert.equal(await control.evaluate((node) => node.tagName), 'A', `${slug}: created response must yield the manual personal link`);
        assert.equal(await control.getAttribute('href'), spec.body.app_url, `${slug}: manual link must carry the returned personal route`);
      } else {
        assert.equal(await control.evaluate((node) => node.tagName), 'BUTTON', `${slug}: failure must not fabricate a personal link`);
        assert.equal(await control.textContent(), 'Open in SomaCheck', `${slug}: failure keeps the explicit app handoff CTA`);
        assert.equal(await control.isDisabled(), false, `${slug}: failure leaves a manual retry available`);
      }
      outcomes[slug] = { joins: attempts, navigations: track.navigations.length - navigationsBefore, status: spec.expectStatus };
    }

    // Blocked manual navigation: the custom-scheme tap cannot complete in this browser,
    // and the visible personal link must survive it untouched.
    const anchor = page.locator('#topic-wv-created-201 .answer-btn');
    const joinsBeforeManualTap = joinRequests.length;
    const navigationsBeforeManualTap = track.navigations.length;
    await anchor.click();
    await page.waitForTimeout(350);
    assert.deepEqual(track.navigations.slice(navigationsBeforeManualTap), ['somacheck://s/personal-201'], 'the manual tap is the only navigation attempt');
    assert.equal(page.url(), portalUrl, 'a blocked personal navigation must leave the portal in place');
    assert.equal(await anchor.count(), 1, 'blocked navigation must retain the manual personal link');
    assert.equal(await anchor.textContent(), 'Open your check-in', 'blocked navigation must keep the manual link label');
    assert.equal(await anchor.getAttribute('href'), 'somacheck://s/personal-201', 'blocked navigation must keep the personal route');
    assert.equal(joinRequests.length - joinsBeforeManualTap, 0, 'a blocked manual tap must not re-join');
    assert.deepEqual(track.externalRequests, [], 'fallback paths must never contact an external host');
    return { outcomes, blockedNavigationRetainsLink: true };
  } finally {
    await page.close();
    await closeServer(server);
  }
}

async function runSmartMutationProof(browser) {
  progressHits.clear();
  const oneTapBlock = /\n\s*if \(topic\.smartRouteUrl\) \{[\s\S]*?window\.location\.assign\(topic\.smartRouteUrl\);\s*return;\s*\}/;
  assert.match(source, oneTapBlock, 'mutation proof needs the one-tap branch to exist in the source');
  const mutated = source.replace(oneTapBlock, '');
  assert.notEqual(mutated, source, 'mutation must remove the one-tap branch');
  const joinStart = joinRequests.length;
  // Same realistic fixture the positive one-tap proof accepts: no link_url, Branch route_url.
  const server = await startPortalServer({
    source: mutated,
    topicsBody: (pageOrigin) => ({ topics: [topicRow('gut-vs-dashboard', 'prompt_gut_001', { route_url: expectedSmartRoute(pageOrigin) })] })
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const track = await trackPage(page);
  await interceptExternal(page);

  try {
    await page.goto(`${origin}/world-vibe/`, { waitUntil: 'networkidle' });
    await page.locator('#topic-gut-vs-dashboard').waitFor({ state: 'visible' });
    const navigationsBefore = track.navigations.length;
    await page.locator('#topic-gut-vs-dashboard .answer-btn').click();
    await page.waitForFunction(() => document.querySelector('#topic-gut-vs-dashboard .answer-btn').tagName === 'A');
    await page.waitForTimeout(350);
    const joinDelta = joinRequests.length - joinStart;
    const tapNavigations = track.navigations.slice(navigationsBefore);
    const failedAsExpected = joinDelta === 1 && tapNavigations.length === 0 && page.url() !== expectedSmartRoute(origin);
    assert.equal(failedAsExpected, true, 'the two-tap implementation must fail the one-tap gate: it joins in the browser and never navigates to the smart route');
    return { failedAsExpected, joinDelta, navigations: tapNavigations };
  } finally {
    await page.close();
    await closeServer(server);
  }
}

const browser = await chromium.launch({ headless: true });
const portalServer = await startPortalServer({
  joinResponse: function(topicSlug) {
    if (topicSlug === 'gut-vs-dashboard') {
      return {
        statement_id: 'stmt_gut_001',
        link_url: 'https://go.somacheck.com/s/personal-gut-token',
        app_url: expectedPersonalAppRoute,
        receipt: {
          first_position: 2,
          counted_as_new_contributor: true
        }
      };
    }
    return {
      statement_id: 'stmt_ai_001',
      link_url: 'https://go.somacheck.com/s/personal-ai-token',
      app_url: 'somacheck://s/personal-ai-token'
    };
  }
});

try {
  progressHits.clear();
  const origin = `http://127.0.0.1:${portalServer.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  await page.goto(`${origin}/world-vibe/?t=gut-vs-dashboard`, { waitUntil: 'networkidle' });
  await page.locator('#topic-gut-vs-dashboard').waitFor({ state: 'visible' });

  assert.equal(joinRequests.length, 0, 'page load must not issue a join request');
  assert.equal(requestLog.filter((entry) => entry.pathname.endsWith('/join')).length, 0, 'refresh and initial load must not create a statement');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .statement').textContent(), 'I trust my gut more than my dashboard', 'statement_text from the public topics endpoint must render exactly');

  const aggregate = page.locator('#topic-gut-vs-dashboard [data-role="aggregate"]');
  await assert.doesNotReject(() => aggregate.waitFor({ state: 'visible' }));
  assert.match(await aggregate.textContent(), /1 of 5/i, 'locked public progress must show the truthful count from contributor_count and unlock_threshold');
  assert.doesNotMatch(await aggregate.textContent(), /Aligned|Unaligned/i, 'split must remain hidden before unlock');

  const qr = page.locator('#topic-gut-vs-dashboard [data-role="qr"]');
  assert.equal(await qr.getAttribute('data-payload'), expectedStableRoute, 'public link_url must become the stable QR payload without substitution');
  await page.evaluate(() => {
    document.querySelector('#topic-gut-vs-dashboard [data-role="qr"]').setAttribute('data-marker', 'kept');
  });

  const routeNote = page.locator('#topic-gut-vs-dashboard .route-note');
  assert.equal(await routeNote.getAttribute('data-install-url'), installUrl, 'route seam must carry the configured current public fallback target');
  assert.match(await page.locator('#topic-gut-vs-dashboard .privacy-line').textContent(), /limited routing data may be used/i, 'privacy disclosure must describe the install-return behavior');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .share-btn').textContent(), 'Share this World Vibe', 'share CTA label must stay concise');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').textContent(), 'Open in SomaCheck', 'join CTA must name the app handoff');
  assert.equal(await page.locator('#last-updated').textContent(), expectedActivityStatus, 'public activity status must not expose a precise participant timestamp');
  assert.doesNotMatch(await aggregate.textContent(), /Last check-in|\d{1,2}:\d{2}/, 'small-cohort progress must not expose precise participant timing');
  assert.equal(await page.locator('#topic-gut-vs-dashboard [data-role=\"status\"]').textContent(), '', 'initial state must not claim a personal status');
  assert.equal(await page.locator('#topic-gut-vs-dashboard [data-role=\"receipt\"]').count(), 0, 'public web must not render an owner receipt area');

  await page.locator('#topic-gut-vs-dashboard .answer-btn').click();
  await page.waitForFunction(() => document.querySelector('#topic-gut-vs-dashboard .answer-btn').tagName === 'A');
  assert.equal(joinRequests.length, 1, 'explicit action must issue exactly one join request');
  assert.deepEqual(Object.keys(joinBodies[0]).sort(), ['client_nonce', 'prompt_id', 'session_nonce'], 'join request body must contain only the abuse-reviewed contract keys');
  assert.equal(joinBodies[0].prompt_id, 'prompt_gut_001', 'join request must send the exact prompt_id from the public topics contract');
  assert.equal(typeof joinBodies[0].client_nonce, 'string', 'join request must send a client_nonce string');
  assert.ok(joinBodies[0].client_nonce.length > 8, 'client_nonce must be non-trivial');
  assert.equal(typeof joinBodies[0].session_nonce, 'string', 'join request must send a session_nonce string');
  assert.ok(joinBodies[0].session_nonce.length > 8, 'session_nonce must be non-trivial');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').getAttribute('href'), expectedPersonalAppRoute, 'personal app route must be preserved after join');
  assert.equal(await page.locator('#topic-gut-vs-dashboard [data-role=\"status\"]').textContent(), 'Your check-in is ready in SomaCheck.', 'post-join status must stay neutral');
  assert.doesNotMatch(await page.locator('#topic-gut-vs-dashboard').textContent(), /You're check-in|first position|2 of 5\./i, 'public web must not claim a personal position after join even if stray receipt data appears');

  await page.locator('#topic-ai-at-work .answer-btn').click();
  await page.waitForFunction(() => document.querySelector('#topic-ai-at-work .answer-btn').tagName === 'A');
  assert.equal(joinRequests.length, 2, 'second distinct join intent in the same browser session must also post');
  assert.deepEqual(Object.keys(joinBodies[1]).sort(), ['client_nonce', 'prompt_id', 'session_nonce'], 'every join request must keep the exact three-key contract');
  assert.equal(joinBodies[1].prompt_id, 'prompt_ai_001', 'second join must use the second topic prompt_id');
  assert.notEqual(joinBodies[1].client_nonce, joinBodies[0].client_nonce, 'client_nonce must remain unique per join intent');
  assert.equal(joinBodies[1].session_nonce, joinBodies[0].session_nonce, 'session_nonce must stay stable across join intents in one browser session');
  assert.deepEqual(joinTopics, ['gut-vs-dashboard', 'ai-at-work'], 'two separate join intents should be captured in request order');
  const storageSnapshot = await page.evaluate(() => ({
    localStorageKeys: Object.keys(window.localStorage),
    cookie: document.cookie,
    sessionKeys: Object.keys(window.sessionStorage),
    sessionNonce: window.sessionStorage.getItem('world-vibe-session-nonce')
  }));
  assert.deepEqual(storageSnapshot.localStorageKeys, [], 'no persistent localStorage tracking keys may be written');
  assert.equal(storageSnapshot.cookie, '', 'join flow must not create tracking cookies');
  assert.deepEqual(storageSnapshot.sessionKeys, ['world-vibe-session-nonce'], 'only the session nonce may be stored for this tab session');
  assert.equal(storageSnapshot.sessionNonce, joinBodies[0].session_nonce, 'sessionStorage nonce must match the posted session_nonce');

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
  assert.match(unlockedAggregate, /60%/, 'aligned count must normalize from the frozen aligned field');
  assert.match(unlockedAggregate, /40%/, 'unaligned count must normalize from the frozen unaligned field');
  assert.equal(await page.locator('#last-updated').textContent(), expectedActivityStatus, 'later refreshes must retain the coarse public activity status');
  assert.equal(await qr.getAttribute('data-payload'), expectedStableRoute, 'stable route must survive multiple refresh cycles');
  assert.equal(await qr.getAttribute('data-marker'), 'kept', 'second refresh must still avoid replacing the QR node');
  assert.equal(await page.locator('#topic-gut-vs-dashboard .answer-btn').getAttribute('href'), expectedPersonalAppRoute, 'personal route must still be available after unlock');

  const fixtureFallback = await runFixtureFallbackProof(browser);
  const challengeRequired = await runChallengeRequiredProof(browser);
  const mutationProof = await runMutationProof(browser);
  const smartRouteProof = await runSmartRouteProof(browser);
  const smartRouteRejections = await runSmartRouteRejectionProof(browser);
  const fallbackStatuses = await runFallbackStatusProof(browser);
  const smartMutationProof = await runSmartMutationProof(browser);

  console.log(JSON.stringify({
    passed: true,
    exactJoinBody: joinBodies[0],
    secondJoinBody: joinBodies[1],
    stableRoute: expectedStableRoute,
    derivedStableRoute: smartRouteProof.stableRoute,
    publicActivityStatus: expectedActivityStatus,
    fixtureFallback,
    challengeRequired,
    mutationProof,
    smartRoute: smartRouteProof.smartRoute,
    smartRouteProof,
    smartRouteRejections,
    fallbackStatuses,
    smartMutationProof
  }, null, 2));

  await page.close();
} finally {
  await browser.close();
  await closeServer(portalServer);
}

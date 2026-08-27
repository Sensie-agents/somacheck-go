import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/homebrew/lib/node_modules/playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const topics = [
  {
    slug: 'gut-vs-dashboard',
    prompt: 'e30c374c-e658-4f1f-86ba-4ffb1e2d57f3',
    statement: 'I trust my gut more than my dashboard',
    count: 2,
    completed: '2026-08-26T20:32:40.610Z'
  },
  {
    slug: 'ai-at-work',
    prompt: 'fbaf572e-5e6a-4f8d-ae73-cfae6d873cc5',
    statement: 'I feel hopeful about AI at work',
    count: 0,
    completed: null
  },
  {
    slug: 'present-leadership',
    prompt: 'bd36480f-2d92-4f1f-870f-482016b0d1f1',
    statement: 'I am fully present with the people I lead',
    count: 0,
    completed: null
  }
];

const [script, style, ...pages] = await Promise.all([
  readFile(path.join(root, 'world-vibe/share/topic.js'), 'utf8'),
  readFile(path.join(root, 'world-vibe/share/topic.css'), 'utf8'),
  ...topics.map((topic) => readFile(path.join(root, `world-vibe/share/${topic.slug}/index.html`), 'utf8'))
]);

assert.doesNotMatch(script, /world-vibe\/topics\/[^'"\s]+\/join|method:\s*['"]POST['"]|localStorage|document\.cookie/i, 'stable share runtime must never join, post, or create persistent browser identity');
assert.match(script, /method:\s*'GET'/, 'stable share runtime may read public topic progress only');
assert.match(script, /SMART_ROUTE_KEYS/, 'stable share runtime must validate the frozen Branch route shape');
assert.doesNotMatch(script + style + pages.join(''), /—|Your answer is anonymous|No tracking/i, 'stable share source must preserve approved copy boundaries');
for (const [index, html] of pages.entries()) {
  assert.doesNotMatch(html, /Preparing your check-in\.\.\.[\s\S]*fetch\(|\/v0\/public\/topics\/join/i, `${topics[index].slug}: page source must not mint on load`);
  assert.match(html, new RegExp(`qr-${topics[index].slug}\\.png`), `${topics[index].slug}: stable QR asset must remain visible`);
}

const requests = [];
let invalidRoute = false;

function stableUrl(topic) {
  return `https://go.somacheck.com/world-vibe/share/${topic.slug}`;
}

function smartRoute(topic) {
  const url = new URL('https://link.somacheck.com/a/key_test_public');
  url.searchParams.set('route_version', '1');
  url.searchParams.set('topic_slug', topic.slug);
  url.searchParams.set('prompt_id', topic.prompt);
  url.searchParams.set('$canonical_url', stableUrl(topic));
  url.searchParams.set('$fallback_url', stableUrl(topic));
  url.searchParams.set('$ios_url', 'https://testflight.apple.com/join/C4mAH3zz');
  url.searchParams.set('$ios_nativelink', 'true');
  url.searchParams.set('$deeplink_no_attribution', 'true');
  url.searchParams.set('$do_not_process', 'true');
  if (invalidRoute) url.searchParams.set('~campaign', 'must-reject');
  return url.href;
}

function topicPayload(topic) {
  return {
    topic_slug: topic.slug,
    prompt_id: topic.prompt,
    statement_text: topic.statement,
    contributor_count: topic.count,
    unlock_threshold: 5,
    remaining_count: 5 - topic.count,
    unlocked: false,
    aggregate_revision: topic.count,
    last_completed_at: topic.completed,
    aligned: null,
    unaligned: null,
    route_url: smartRoute(topic)
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push({ method: request.method, path: url.pathname });

  if (url.pathname === '/api/v1/public/world-vibe/topics') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ topics: topics.map(topicPayload) }));
    return;
  }

  const progressMatch = url.pathname.match(/^\/api\/v1\/public\/world-vibe\/topics\/([^/]+)\/progress$/);
  if (progressMatch) {
    const topic = topics.find((candidate) => candidate.slug === decodeURIComponent(progressMatch[1]));
    response.writeHead(topic ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(topic ? topicPayload(topic) : { error: 'not_found' }));
    return;
  }

  if (url.pathname === '/world-vibe/share/topic.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(script);
    return;
  }
  if (url.pathname === '/world-vibe/share/topic.css') {
    response.writeHead(200, { 'content-type': 'text/css' });
    response.end(style);
    return;
  }
  if (url.pathname.startsWith('/world-vibe/assets/qr-')) {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end('qr');
    return;
  }

  const pageMatch = url.pathname.match(/^\/world-vibe\/share\/([^/]+)\/?$/);
  if (pageMatch) {
    const index = topics.findIndex((topic) => topic.slug === pageMatch[1]);
    if (index >= 0) {
      const configured = pages[index].replace(
        '<script src="/world-vibe/share/topic.js" defer></script>',
        `<script>window.SOMACHECK_API_BASE = ${JSON.stringify(`http://127.0.0.1:${server.address().port}/api`)};</script>\n  <script src="/world-vibe/share/topic.js" defer></script>`
      );
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(configured);
      return;
    }
  }

  response.writeHead(404);
  response.end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

try {
  for (const topic of topics) {
    requests.length = 0;
    invalidRoute = false;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (payload) => { window.__sharedWorldVibe = payload; }
      });
    });
    let branchRequest = null;
    await page.route('https://link.somacheck.com/**', async (route) => {
      branchRequest = route.request().url();
      await route.abort();
    });

    await page.goto(`${origin}/world-vibe/share/${topic.slug}/`, { waitUntil: 'networkidle' });
    await page.locator('#start-check-in[data-route-ready="true"]').waitFor();
    assert.equal(page.url(), `${origin}/world-vibe/share/${topic.slug}/`, `${topic.slug}: passive load must stay on the stable page`);
    assert.equal(requests.some((request) => request.method !== 'GET'), false, `${topic.slug}: passive activity must be GET-only`);
    assert.equal(requests.some((request) => request.path.includes('/join')), false, `${topic.slug}: passive activity must never join`);
    assert.match(await page.locator('#progress').textContent(), new RegExp(`${topic.count} of 5 check-ins`), `${topic.slug}: real locked progress must render`);
    assert.doesNotMatch(await page.locator('#progress').textContent(), /%|Aligned|Unaligned/, `${topic.slug}: split must stay hidden below five`);
    assert.match(await page.locator('.qr').getAttribute('src'), new RegExp(`qr-${topic.slug}\\.png$`), `${topic.slug}: QR must remain the stable topic asset`);
    assert.equal(await page.locator('#start-check-in').getAttribute('href'), smartRoute(topic), `${topic.slug}: explicit CTA must hold the exact smart route`);

    await page.locator('#share-topic').click();
    const shared = await page.evaluate(() => window.__sharedWorldVibe);
    assert.equal(shared.url, stableUrl(topic), `${topic.slug}: sharing must retain the stable topic URL`);
    assert.doesNotMatch(shared.text, /key_test|prompt_id/, `${topic.slug}: share copy must not expose Branch route data`);

    await page.locator('#start-check-in').click();
    await page.waitForTimeout(100);
    assert.equal(branchRequest, smartRoute(topic), `${topic.slug}: one explicit tap must request the exact smart route`);
    assert.equal(requests.some((request) => request.path.includes('/join')), false, `${topic.slug}: smart-route tap must not create a browser join`);
    await page.close();
  }

  invalidRoute = true;
  requests.length = 0;
  const fallback = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await fallback.goto(`${origin}/world-vibe/share/gut-vs-dashboard/`, { waitUntil: 'networkidle' });
  await fallback.locator('#start-check-in').waitFor();
  assert.equal(await fallback.locator('#start-check-in').getAttribute('href'), '/world-vibe/?t=gut-vs-dashboard', 'invalid smart route must fail closed to the portal');
  assert.equal(requests.some((request) => request.path.includes('/join')), false, 'invalid smart route must not join on load');
  await fallback.close();

  console.log(JSON.stringify({ passed: true, pages: topics.length, passiveJoins: 0, explicitSmartNavigations: topics.length }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

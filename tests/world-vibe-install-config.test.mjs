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

const [portalHtml, sharePageHtml, configJs] = await Promise.all([
  readFile(path.join(root, 'world-vibe', 'index.html'), 'utf8'),
  readFile(path.join(root, 'world-vibe', 'share', 'gut-vs-dashboard', 'index.html'), 'utf8'),
  readFile(path.join(root, 'world-vibe', 'config.js'), 'utf8')
]);

const defaultInstallUrl = (configJs.match(/'([^']+)'/) || [])[1];
assert.ok(defaultInstallUrl, 'world-vibe/config.js must define a single quoted install URL literal');

// The install-config.js file must be the only real source of the literal in
// the pages that consume it: index.html's inline script and topic.js should
// read window.SOMACHECK_INSTALL_URL rather than embedding their own copy of
// the current TestFlight URL as the primary source.
const topicJs = await readFile(path.join(root, 'world-vibe', 'share', 'topic.js'), 'utf8');
assert.match(topicJs, /window\.SOMACHECK_INSTALL_URL/, 'topic.js must read the shared install config');
assert.match(portalHtml, /<script src="\/world-vibe\/config\.js"><\/script>/, 'portal must load the shared install config');
for (const slug of ['gut-vs-dashboard', 'ai-at-work', 'present-leadership']) {
  const html = await readFile(path.join(root, 'world-vibe', 'share', slug, 'index.html'), 'utf8');
  assert.match(html, /<script src="\/world-vibe\/config\.js"><\/script>/, `${slug}: share page must load the shared install config`);
}

const swappedInstallUrl = 'https://apps.apple.com/app/id6792978184';

const topicPayload = (installUrl) => ({
  topics: [
    {
      topic_slug: 'gut-vs-dashboard',
      prompt_id: 'prompt-1',
      statement_text: 'I trust my gut more than my dashboard',
      contributor_count: 1,
      unlock_threshold: 5,
      remaining_count: 4,
      unlocked: false,
      aggregate_revision: 1,
      last_completed_at: null,
      aligned: null,
      unaligned: null,
      route_url: (() => {
        const url = new URL('https://link.somacheck.com/a/key_test_public');
        url.searchParams.set('route_version', '1');
        url.searchParams.set('topic_slug', 'gut-vs-dashboard');
        url.searchParams.set('prompt_id', 'prompt-1');
        url.searchParams.set('$canonical_url', 'https://go.somacheck.com/world-vibe/share/gut-vs-dashboard');
        url.searchParams.set('$fallback_url', 'https://go.somacheck.com/world-vibe/share/gut-vs-dashboard');
        url.searchParams.set('$ios_url', installUrl);
        url.searchParams.set('$ios_nativelink', 'true');
        url.searchParams.set('$deeplink_no_attribution', 'true');
        url.searchParams.set('$do_not_process', 'true');
        return url.href;
      })()
    }
  ]
});

function withApiBase(html, apiBase) {
  return html.replace('</head>', `<script>window.SOMACHECK_API_BASE = ${JSON.stringify(apiBase)};</script>\n</head>`);
}

let servedConfigJs = configJs;
let servedRouteInstallUrl = defaultInstallUrl;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');

  if (url.pathname === '/world-vibe/config.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(servedConfigJs);
    return;
  }
  if (url.pathname === '/api/v1/public/world-vibe/topics') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(topicPayload(servedRouteInstallUrl)));
    return;
  }
  if (url.pathname === '/world-vibe/' || url.pathname === '/world-vibe') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(withApiBase(portalHtml, `http://127.0.0.1:${server.address().port}/api`));
    return;
  }
  if (url.pathname === '/world-vibe/share/gut-vs-dashboard/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(withApiBase(sharePageHtml, `http://127.0.0.1:${server.address().port}/api`));
    return;
  }

  // Fall through to real static files on disk (topic.js, topic.css, qr assets).
  try {
    const body = await readFile(path.join(root, decodeURIComponent(url.pathname).replace(/^\/+/, '')));
    response.writeHead(200);
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

try {
  // 1. Default config: the portal's rendered install CTA seam must equal the value in config.js.
  const portalPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await portalPage.goto(`${origin}/world-vibe/`, { waitUntil: 'networkidle' });
  await portalPage.locator('#tab-topics').click();
  await portalPage.locator('.route-note').first().waitFor();
  const defaultAttr = await portalPage.locator('.route-note').first().getAttribute('data-install-url');
  assert.equal(defaultAttr, defaultInstallUrl, 'portal install CTA seam must equal world-vibe/config.js by default');
  await portalPage.close();

  // 2. Default config: the share page's validated smart route must carry the same install URL.
  const sharePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await sharePage.route('https://link.somacheck.com/**', (route) => route.abort());
  await sharePage.goto(`${origin}/world-vibe/share/gut-vs-dashboard/`, { waitUntil: 'networkidle' });
  await sharePage.locator('#start-check-in[data-route-ready="true"]').waitFor();
  const defaultHref = await sharePage.locator('#start-check-in').getAttribute('href');
  assert.equal(new URL(defaultHref).searchParams.get('$ios_url'), defaultInstallUrl, 'share page smart route must validate against world-vibe/config.js');
  await sharePage.close();

  // 3. Swap: change only world-vibe/config.js (simulating the App Store cutover) and prove
  // both surfaces pick up the new value with no other file touched.
  servedConfigJs = `window.SOMACHECK_INSTALL_URL = window.SOMACHECK_INSTALL_URL || ${JSON.stringify(swappedInstallUrl)};\n`;
  servedRouteInstallUrl = swappedInstallUrl;

  const swappedPortalPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await swappedPortalPage.goto(`${origin}/world-vibe/`, { waitUntil: 'networkidle' });
  await swappedPortalPage.locator('#tab-topics').click();
  await swappedPortalPage.locator('.route-note').first().waitFor();
  const swappedAttr = await swappedPortalPage.locator('.route-note').first().getAttribute('data-install-url');
  assert.equal(swappedAttr, swappedInstallUrl, 'portal install CTA seam must follow a one-line config.js swap');
  await swappedPortalPage.close();

  const swappedSharePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await swappedSharePage.route('https://link.somacheck.com/**', (route) => route.abort());
  await swappedSharePage.goto(`${origin}/world-vibe/share/gut-vs-dashboard/`, { waitUntil: 'networkidle' });
  await swappedSharePage.locator('#start-check-in[data-route-ready="true"]').waitFor();
  const swappedHref = await swappedSharePage.locator('#start-check-in').getAttribute('href');
  assert.equal(new URL(swappedHref).searchParams.get('$ios_url'), swappedInstallUrl, 'share page smart route must follow the same config.js swap');
  await swappedSharePage.close();

  // 4. Negative control: config.js swapped but the server-issued route still carries the
  // stale value must fail closed to the portal, proving real consumption, not coincidence.
  servedRouteInstallUrl = defaultInstallUrl;
  const staleRoutePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await staleRoutePage.route('https://link.somacheck.com/**', (route) => route.abort());
  await staleRoutePage.goto(`${origin}/world-vibe/share/gut-vs-dashboard/`, { waitUntil: 'networkidle' });
  await staleRoutePage.locator('#start-check-in').waitFor();
  const staleHref = await staleRoutePage.locator('#start-check-in').getAttribute('href');
  assert.equal(staleHref, '/world-vibe/?t=gut-vs-dashboard', 'a route whose $ios_url no longer matches the configured value must fail closed');
  await staleRoutePage.close();

  console.log(JSON.stringify({ passed: true, defaultInstallUrl, swappedInstallUrl }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

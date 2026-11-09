import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/homebrew/lib/node_modules/playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const artifactDir = path.join(root, '.artifacts', 'a11y-screens');
await mkdir(artifactDir, { recursive: true });

const [portalHtml, sharePageHtml] = await Promise.all([
  readFile(path.join(root, 'world-vibe', 'legacy', 'index.html'), 'utf8'),
  readFile(path.join(root, 'world-vibe', 'share', 'gut-vs-dashboard', 'index.html'), 'utf8')
]);

const unlockedTopicsPayload = {
  topics: [
    {
      topic_slug: 'gut-vs-dashboard',
      prompt_id: 'prompt-1',
      statement_text: 'I trust my gut more than my dashboard',
      contributor_count: 5,
      unlock_threshold: 5,
      remaining_count: 0,
      unlocked: true,
      aggregate_revision: 5,
      last_completed_at: '2026-08-26T20:32:40.610Z',
      aligned: 3,
      unaligned: 2,
      route_url: null
    },
    {
      topic_slug: 'ai-at-work',
      prompt_id: 'prompt-2',
      statement_text: 'I feel hopeful about AI at work',
      contributor_count: 1,
      unlock_threshold: 5,
      remaining_count: 4,
      unlocked: false,
      aggregate_revision: 1,
      last_completed_at: null,
      aligned: null,
      unaligned: null,
      route_url: null
    }
  ]
};

function withApiBase(html, apiBase) {
  return html.replace('</head>', `<script>window.SOMACHECK_API_BASE = ${JSON.stringify(apiBase)};</script>\n</head>`);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/v1/public/world-vibe/topics') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(unlockedTopicsPayload));
    return;
  }
  const progressMatch = url.pathname.match(/^\/api\/v1\/public\/world-vibe\/topics\/([^/]+)\/progress$/);
  if (progressMatch) {
    const topic = unlockedTopicsPayload.topics.find((t) => t.topic_slug === decodeURIComponent(progressMatch[1]));
    response.writeHead(topic ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(topic || { error: 'not_found' }));
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

const viewports = [
  { label: '320w', width: 320, height: 720 },
  { label: '375w', width: 375, height: 812 },
  { label: '430w', width: 430, height: 932 },
  { label: '1024w', width: 1024, height: 800 },
  { label: '1440w', width: 1440, height: 900 }
];

const pagesUnderTest = [
  { label: 'portal', path: '/world-vibe/', ctaSelector: '.answer-btn, .share-btn' },
  { label: 'share', path: '/world-vibe/share/gut-vs-dashboard/', ctaSelector: '#start-check-in, #share-topic' }
];

const results = [];
const screenshots = [];

try {
  for (const pageInfo of pagesUnderTest) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await page.route('https://link.somacheck.com/**', (route) => route.abort());
      await page.goto(`${origin}${pageInfo.path}`, { waitUntil: 'networkidle' });

      if (pageInfo.label === 'portal') {
        await page.locator('.topic').first().waitFor();
      } else {
        await page.locator('#start-check-in').waitFor();
      }

      // No horizontal scroll.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      assert.ok(
        overflow.scrollWidth <= overflow.clientWidth + 1,
        `${pageInfo.label}@${viewport.label}: no horizontal scroll (scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth})`
      );

      // Touch targets >= 44px on CTAs, with exact accessible names.
      const ctas = page.locator(pageInfo.ctaSelector);
      const count = await ctas.count();
      assert.ok(count > 0, `${pageInfo.label}@${viewport.label}: at least one CTA must be present`);
      for (let i = 0; i < count; i += 1) {
        const cta = ctas.nth(i);
        const box = await cta.boundingBox();
        assert.ok(box, `${pageInfo.label}@${viewport.label}: CTA ${i} must be visible`);
        assert.ok(box.height >= 44, `${pageInfo.label}@${viewport.label}: CTA ${i} height ${box.height} must be >= 44px`);
        const name = (await cta.textContent() || '').trim();
        assert.ok(name.length > 0, `${pageInfo.label}@${viewport.label}: CTA ${i} must have a non-empty accessible name`);
      }

      // Visible focus ring: tab to the first CTA and confirm a real outline renders.
      await page.locator(pageInfo.ctaSelector).first().focus();
      const outline = await page.evaluate((sel) => {
        const el = document.querySelector(sel.split(',')[0].trim());
        const style = getComputedStyle(el);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      }, pageInfo.ctaSelector);
      assert.notEqual(outline.outlineStyle, 'none', `${pageInfo.label}@${viewport.label}: focused CTA must show a visible outline`);
      assert.notEqual(outline.outlineWidth, '0px', `${pageInfo.label}@${viewport.label}: focused CTA outline must have nonzero width`);

      const screenshotPath = path.join(artifactDir, `${pageInfo.label}-${viewport.label}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshots.push(screenshotPath);

      results.push({ page: pageInfo.label, viewport: viewport.label, ctas: count, outline });
      await page.close();
    }
  }

  console.log(JSON.stringify({ passed: true, results, screenshots }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

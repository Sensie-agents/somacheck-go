// Design review harness for the World Vibe vibe-indicator redesign.
//
// Serves the portal (this worktree's repo root) over a local static HTTP
// server, stubs the feed endpoint with five items covering all three privacy
// phases, then uses Playwright to screenshot the feed page and the
// single-item share page at phone and desktop widths. Also asserts that no
// digit ever appears in a lean-phase (3 to 9 check-ins) indicator, since that
// is the specific leak the design must not introduce.
//
// Usage: node design-review/screenshot.mjs

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/homebrew/lib/node_modules/playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(here, 'screenshots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// Five items, one per state Mike asked to see verified:
//   1. progress phase (1 of 3 checked in)
//   2. lean phase, aligned (3 checked in, at the unlock threshold)
//   3. lean phase, mixed (6 checked in)
//   4. lean phase, unaligned (9 checked in)
//   5. split phase, exact numbers (12 checked in, 8 aligned / 4 unaligned = 67% / 33%)
const STUB_ITEMS = [
  {
    slug: 'demo-progress-1',
    quote: 'We shipped the whole quarter on vibes and a spreadsheet.',
    statement: 'This team runs on gut calls, not process.',
    domain: 'example.com',
    source_url: 'https://example.com/progress',
    contributor_count: 1,
    unlock_threshold: 3,
    lean: null,
    aligned: null,
    unaligned: null
  },
  {
    slug: 'demo-lean-aligned',
    quote: 'Nobody reads the roadmap, they just ask me what is next.',
    statement: 'Planning docs are theater once a team trusts its lead.',
    domain: 'example.com',
    source_url: 'https://example.com/lean-aligned',
    contributor_count: 3,
    unlock_threshold: 3,
    lean: 'aligned',
    aligned: null,
    unaligned: null
  },
  {
    slug: 'demo-lean-mixed',
    quote: 'Half the team wants a rewrite, half wants to ship the patch.',
    statement: 'A rewrite is the right call here.',
    domain: 'example.com',
    source_url: 'https://example.com/lean-mixed',
    contributor_count: 6,
    unlock_threshold: 3,
    lean: 'mixed',
    aligned: null,
    unaligned: null
  },
  {
    slug: 'demo-lean-unaligned',
    quote: 'The all-hands ran two hours over and decided nothing.',
    statement: 'Long meetings are how this org makes real decisions.',
    domain: 'example.com',
    source_url: 'https://example.com/lean-unaligned',
    contributor_count: 9,
    unlock_threshold: 3,
    lean: 'unaligned',
    aligned: null,
    unaligned: null
  },
  {
    slug: 'demo-exact-split',
    quote: 'Twelve people watched the outage channel and nobody paged anyone.',
    statement: 'This org has a healthy on-call culture.',
    domain: 'example.com',
    source_url: 'https://example.com/exact-split',
    contributor_count: 12,
    unlock_threshold: 3,
    lean: null,
    aligned: 8,
    unaligned: 4
  }
];

function injectConfig(html, origin) {
  const script = `<script>window.SOMACHECK_API_BASE = ${JSON.stringify(origin)};</script>`;
  return html.replace('</head>', `${script}\n</head>`);
}

async function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/v1/public/world-vibe/feed') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: STUB_ITEMS, next_cursor: null }));
      return;
    }

    let filePath = url.pathname;
    if (filePath.endsWith('/')) filePath += 'index.html';
    const absPath = path.join(root, filePath);
    if (!absPath.startsWith(root) || !existsSync(absPath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    const ext = path.extname(absPath);
    const contentType = MIME[ext] || 'application/octet-stream';
    const origin = `http://127.0.0.1:${server.address().port}`;

    if (ext === '.html') {
      const html = await readFile(absPath, 'utf8');
      res.writeHead(200, { 'content-type': contentType });
      res.end(injectConfig(html, origin));
      return;
    }

    const body = await readFile(absPath);
    res.writeHead(200, { 'content-type': contentType });
    res.end(body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

const VIEWPORTS = {
  mobile: { width: 390, height: 900 },
  desktop: { width: 1440, height: 1000 }
};

async function assertNoDigitsInLeanPhase(page, scopeSelector, label, failures) {
  const indicators = await page.locator(`${scopeSelector} [data-phase="lean"]`).all();
  for (const indicator of indicators) {
    const text = (await indicator.textContent()) || '';
    if (/\d/.test(text)) {
      failures.push(`${label}: lean-phase indicator contains a digit: "${text.trim()}"`);
    }
  }
  return indicators.length;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  let leanChecks = 0;

  try {
    // Feed page: all five states stack in one page load.
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      const page = await browser.newPage({ viewport });
      await page.goto(`${origin}/world-vibe/`, { waitUntil: 'networkidle' });
      await page.locator('#feed-list .feed-card').first().waitFor({ state: 'visible' });
      const cardCount = await page.locator('#feed-list .feed-card').count();
      if (cardCount !== STUB_ITEMS.length) {
        failures.push(`feed (${name}): expected ${STUB_ITEMS.length} cards, found ${cardCount}`);
      }
      leanChecks += await assertNoDigitsInLeanPhase(page, '#feed-list', `feed (${name})`, failures);
      await page.screenshot({ path: path.join(outDir, `feed-${name}.png`), fullPage: true });
      await page.close();
    }

    // Share item page: one load per slug, since it only ever shows one item.
    for (const item of STUB_ITEMS) {
      for (const [name, viewport] of Object.entries(VIEWPORTS)) {
        const page = await browser.newPage({ viewport });
        await page.goto(`${origin}/world-vibe/share/?item=${encodeURIComponent(item.slug)}`, { waitUntil: 'networkidle' });
        await page.locator('#start-check-in').waitFor({ state: 'visible' });
        leanChecks += await assertNoDigitsInLeanPhase(page, 'main', `share/${item.slug} (${name})`, failures);
        await page.screenshot({ path: path.join(outDir, `share-${item.slug}-${name}.png`), fullPage: true });
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(JSON.stringify({
    screenshotsDir: outDir,
    itemsCovered: STUB_ITEMS.map((i) => ({ slug: i.slug, contributor_count: i.contributor_count, lean: i.lean, aligned: i.aligned, unaligned: i.unaligned })),
    leanPhaseIndicatorsChecked: leanChecks,
    failures
  }, null, 2));

  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectItems, renderFeed, renderPost, renderCuratorList, renderStrip, renderFilterText, renderHero, PUBLIC_SIGNAL_LABEL } from '../world-vibe/explore/explore-render.js';
import { loadFeed, loadCurators, loadFeatured, loadFollowing } from '../world-vibe/explore/explore-data.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'world-vibe', 'explore');
const read = (n) => readFileSync(path.join(dir, n), 'utf8');
const fx = (n) => JSON.parse(read('fixtures/' + n));
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
const slugs = (html) => [...html.matchAll(/data-slug="([^"]+)"/g)].map((m) => m[1]);

// Captured real responses (EXPLORE-API clone gate). Feed, item, featured and
// following are single RPC rows; curators is the RPC row array.
const REAL = { feed: fx('wv3_explore_feed.json'), item: fx('wv3_explore_item.json'), curators: fx('wv3_explore_curators.json'), featured: fx('wv3_explore_featured.json'), following: fx('wv3_explore_following.json') };
const A = REAL.curators[0].curator_id;
const B = REAL.curators[1].curator_id;
// Variants are spreads of captured rows, never hand-typed shapes.
const row = (over) => ({ ...REAL.feed, ...over });
const feedRows = [
  row({ slug: 'a-1', curator_id: A }),
  row({ slug: 'b-1', curator_id: B }),
  row({ slug: 'a-2', curator_id: A, contributor_count: 7, aligned: null, unaligned: null, lean: 'mixed' }),
  { ...REAL.item, slug: 'pub-1', curator_id: A, curator_name: 'Should Never Render' }
];
const data = { feed: feedRows, following: [REAL.following], curators: REAL.curators };

const FIXTURE_SHA = {
  'wv3_explore_curators.json': '84ceb1e56ccba2995d8d2ee3845e600e379319cb4bdac5fc4f289e018a746b8b',
  'wv3_explore_featured.json': '0f00cf7b529ee4c58d3fe96ee871443250d26cd2792c48c9c7cc43ed4174ba33',
  'wv3_explore_feed.json': '314903a724c726d9a79162a1aa5321f38e2b3e1669dd13341f488ad46265601e',
  'wv3_explore_following.json': 'e5be16dcd242c539939ede36e2a61eea756526305e8d67f3dc253296991ef1e2',
  'wv3_explore_item.json': '6b77f6027c729b9a1f340a1a3e5a3be081b793032008d478bab361a9d80845fe',
  'wv3_explore_v2_golden.json': 'f03776f66c3fce246cc80613176b6255bed145c3b8e03ee1ccf3324d42e83392'
};
const SOURCE = '/Volumes/SensieSSD/agent_tmp/worktrees/wv3-explore-sol/supabase/functions/statement-api/fixtures/';

// A fetch double that records urls and answers with the real route envelopes.
function fakeFetch(routes) {
  const urls = [];
  const fn = async (url) => {
    urls.push(url);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    const r = hit ? routes[hit] : { status: 404, body: {} };
    const status = r.status || 200;
    return { ok: status < 400, status, json: async () => r.body };
  };
  fn.urls = urls;
  return fn;
}

test('contract fixtures are byte-identical to the captured EXPLORE-API files', () => {
  for (const [name, sha] of Object.entries(FIXTURE_SHA)) {
    const buf = readFileSync(path.join(dir, 'fixtures', name));
    assert.equal(createHash('sha256').update(buf).digest('hex'), sha, name);
    if (existsSync(SOURCE + name)) assert.ok(buf.equals(readFileSync(SOURCE + name)), name + ' differs from source');
  }
});

test('loaders call the real routes and unwrap their envelopes', async () => {
  const f = fakeFetch({
    '/v1/public/world-vibe/feed': { body: { items: [REAL.feed], next_cursor: null } },
    '/v1/public/world-vibe/curators': { body: { curators: REAL.curators } },
    '/v1/public/world-vibe/featured': { body: { featured: REAL.featured } },
    '/v1/me/world-vibe/following-feed': { body: { items: [REAL.following] } }
  });
  assert.deepEqual(await loadFeed(f, 'https://api.test'), [REAL.feed]);
  assert.deepEqual(await loadCurators(f, 'https://api.test'), REAL.curators);
  assert.deepEqual(await loadFeatured(f, 'https://api.test'), REAL.featured);
  assert.deepEqual(await loadFollowing(f, 'https://api.test'), { items: [REAL.following], error: null });
  assert.deepEqual(f.urls, [
    'https://api.test/v1/public/world-vibe/feed',
    'https://api.test/v1/public/world-vibe/curators',
    'https://api.test/v1/public/world-vibe/featured?slot=topic_of_week',
    'https://api.test/v1/me/world-vibe/following-feed'
  ]);
});

test('feed follows next_cursor and stops when it is null', async () => {
  const pages = [{ items: [row({ slug: 'p1' })], next_cursor: 'c1' }, { items: [row({ slug: 'p2' })], next_cursor: null }];
  let n = 0;
  const f = async (url) => ({ ok: true, status: 200, json: async () => pages[n++] , url });
  assert.deepEqual((await loadFeed(f, 'x')).map((i) => i.slug), ['p1', 'p2']);
  assert.equal(n, 2);
});

test('featured null is a normal state; following 401 reads as signed out', async () => {
  assert.equal(await loadFeatured(fakeFetch({ '/featured': { body: { featured: null } } }), 'x'), null);
  assert.deepEqual(await loadFollowing(fakeFetch({ '/following-feed': { status: 401, body: {} } }), 'x'), { items: [], error: 'auth' });
  assert.deepEqual(await loadFollowing(fakeFetch({ '/following-feed': { status: 500, body: {} } }), 'x'), { items: [], error: 'unavailable' });
});

test('curator filter is keyed on curator_id: two curators named Alex never merge', () => {
  assert.equal(REAL.curators[0].display_name, REAL.curators[1].display_name);
  assert.deepEqual(slugs(renderFeed({ tab: 'all', curator: A }, data)), ['a-1', 'a-2']);
  assert.deepEqual(slugs(renderFeed({ tab: 'all', curator: B }, data)), ['b-1']);
  assert.deepEqual(slugs(renderFeed({ tab: 'all', curator: null }, data)), feedRows.map((i) => i.slug));
});

test('a public_signals row never matches a curator filter, even if it leaks a curator_id', () => {
  assert.ok(!selectItems({ tab: 'all', curator: A }, data).some((i) => i.slug === 'pub-1'));
  assert.doesNotMatch(renderFeed({ tab: 'all', curator: A }, data), /Should Never Render/);
});

test('curator controls carry curator_id, one per curator, only the selected one pressed', () => {
  for (const html of [renderCuratorList(REAL.curators, { curator: A }), renderStrip(REAL.curators, { curator: A })]) {
    assert.equal((html.match(/data-who="/g) || []).length, 2);
    assert.match(html, new RegExp('data-who="' + A + '" aria-pressed="true"'));
    assert.match(html, new RegExp('data-who="' + B + '" aria-pressed="false"'));
  }
  assert.match(text(renderCuratorList(REAL.curators, { curator: null })), /1 line · sparked 12 check-ins/);
});

test('filter text names the curator looked up by id', () => {
  assert.equal(renderFilterText({ curator: A }, REAL.curators), 'Lines from Alex');
  assert.equal(renderFilterText({ curator: null }, REAL.curators), '');
  assert.equal(renderFilterText({ curator: 'unknown-id' }, REAL.curators), 'Lines from this curator');
});

test('curator stats are activity only: no verdict words next to a curator', () => {
  assert.doesNotMatch(text(renderCuratorList(REAL.curators, { curator: null })), /align|lean|%/i);
});

test('Following rows show curator name and category from the real following row', () => {
  const html = renderFeed({ tab: 'following', curator: null }, data);
  assert.deepEqual(slugs(html), [REAL.following.slug]);
  assert.match(html, /<b>Alex<\/b>/);
  assert.match(html, /<span class="cat">Politics<\/span>/);
  assert.doesNotMatch(html, /Anonymous/);
});

test('Following reveal ladder on the real 12-of-20 row: dots, no lean, no percent', () => {
  const t = text(renderPost(REAL.following));
  assert.match(t, /12 of 20 checked in/);
  assert.doesNotMatch(t, /%|Leans|Mixed/);
});

test('Following empty and signed-out states', () => {
  assert.match(text(renderFeed({ tab: 'following', curator: null }, { ...data, following: [] })), /Follow a curator/);
  assert.match(text(renderFeed({ tab: 'following', curator: null }, { ...data, following: [], followingError: 'auth' })), /Sign in/);
});

test('a curator with no lines shows an empty message; a feed load failure is stated, not blank', () => {
  assert.match(text(renderFeed({ tab: 'all', curator: 'nobody' }, data)), /No lines from this curator/);
  assert.match(text(renderFeed({ tab: 'all', curator: null }, { ...data, feed: [], feedError: true })), /Could not load lines/);
});

test('Topic of the Week hero renders the real /featured payload', () => {
  const html = renderHero(REAL.featured);
  assert.match(html, /TOPIC OF THE WEEK/);
  assert.match(html, /<h2 id="totw-h">I feel ready for this<\/h2>/);
  assert.match(html, new RegExp('data-check="I feel ready for this"'));
  assert.match(html, new RegExp(PUBLIC_SIGNAL_LABEL));
  assert.match(text(html), /100% aligned/);
  assert.equal(renderHero(null), '');
});

test('hero reveal ladder: under threshold only big dots and "n of T", never a lean or a percent', () => {
  const html = renderHero({ ...REAL.featured, public_signals: false, contributor_count: 2, unlock_threshold: 3, aligned: 2, unaligned: 0, lean: 'aligned' });
  assert.match(html, /class="dots big"/);
  assert.equal((html.match(/<i class="on">/g) || []).length, 2);
  assert.match(text(html), /2 of 3 checked in\. You could be the one who reveals it\./);
  assert.doesNotMatch(text(html), /%|Leans|Mixed/);
  assert.doesNotMatch(html, new RegExp(PUBLIC_SIGNAL_LABEL));
});

test('hero reveal ladder: lean without numbers at 3-9, split only at 10+', () => {
  const base = { ...REAL.featured, public_signals: false, unlock_threshold: 3, aligned: null, unaligned: null };
  const lean = text(renderHero({ ...base, contributor_count: 9, lean: 'mixed' }));
  assert.match(lean, /Mixed so far · 9 checked in/);
  assert.doesNotMatch(lean, /%/);
  const leak = text(renderHero({ ...base, contributor_count: 9, lean: 'aligned', aligned: 8, unaligned: 1 }));
  assert.doesNotMatch(leak, /%/);
  assert.match(text(renderHero({ ...base, contributor_count: 10, aligned: 7, unaligned: 3, lean: 'aligned' })), /70% aligned/);
});

test('hero markup in the statement is escaped', () => {
  const html = renderHero({ ...REAL.featured, statement: 'I <img src=x onerror=alert(1)> "q"' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-check="I &lt;img src=x onerror=alert\(1\)&gt; &quot;q&quot;"/);
});

test('real feed row at 10 of 3 renders the exact split; the real public item shows the label and no name', () => {
  assert.match(text(renderPost(REAL.feed)), /100% aligned/);
  assert.match(renderPost(REAL.feed), /<b>Alex<\/b>/);
  const pub = renderPost(REAL.item);
  assert.match(pub, new RegExp(PUBLIC_SIGNAL_LABEL));
  assert.match(pub, /<b>Anonymous<\/b>/);
});

test('reveal ladder on cards: under threshold dots only, lean without numbers, split at 10+', () => {
  const gather = renderPost(row({ contributor_count: 2, aligned: null, unaligned: null, lean: null }));
  assert.match(gather, /class="dots"/);
  assert.match(text(gather), /2 of 3 checked in/);
  assert.doesNotMatch(text(gather), /%/);
  const lean = renderPost(feedRows[2]);
  assert.match(lean, /class="track"/);
  assert.match(text(lean), /Mixed so far · 7 checked in/);
  assert.doesNotMatch(text(lean), /%/);
  assert.match(renderPost(REAL.feed), /class="split"/);
});

test('reveal ladder never leaks counts: lean row with leaked aligned/unaligned shows no percent', () => {
  assert.doesNotMatch(text(renderPost(row({ contributor_count: 9, aligned: 8, unaligned: 1 }))), /%/);
  assert.doesNotMatch(text(renderPost(row({ contributor_count: 2, aligned: 2, unaligned: 0 }))), /%|Leans/);
});

test('explore.js is wired to the live loaders, with the hero, and carries no fixture fetch', () => {
  const js = read('explore.js');
  assert.match(js, /from '\.\/explore-data\.js'/);
  assert.match(js, /loadFeatured\(/);
  assert.match(js, /\$\('hero'\)\.innerHTML = renderHero\(data\.featured\)/);
  assert.match(js, /loadCurators\(/);
  assert.match(js, /loadFollowing\(/);
  assert.doesNotMatch(js, /fixtures\//);
  assert.match(read('index.html'), /id="hero"/);
});

test('Check in button carries the statement byte for byte', () => {
  const row = { ...data.feed[0], statement: 'I say "yes" & <more>' };
  assert.match(renderPost(row), /data-check="I say &quot;yes&quot; &amp; &lt;more&gt;"/);
  assert.match(renderPost(data.feed[0]), new RegExp('data-check="' + data.feed[0].statement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'));
});

test('markup in statements, quotes and curator names is escaped; javascript: source urls are not linked', () => {
  const row = { ...data.feed[0], statement: 'I <img src=x onerror=alert(1)>', quote: '<script>x</script>', curator_name: '<b>Eve</b>', source_url: 'javascript:alert(1)' };
  const html = renderPost(row);
  assert.doesNotMatch(html, /<img|<script|<b>Eve/);
  assert.doesNotMatch(html, /javascript:/);
});

test('Chrome callout: lives in the desktop-only side column, which is display:none below 1000px', () => {
  const html = read('index.html');
  const side = html.match(/<aside class="side"[\s\S]*?<\/aside>/)[0];
  assert.match(side, /id="chrome-callout"/);
  assert.equal((html.match(/chrome-callout/g) || []).length, 1, 'callout appears once, inside the side column');
  const css = read('explore.css');
  assert.match(css, /\.side\{display:none\}/);
  const media = css.match(/@media \(min-width:1000px\)\{[\s\S]*?\n\}/)[0];
  assert.match(media, /\.side\{display:flex/);
  const outside = css.replace(media, '');
  assert.doesNotMatch(outside, /\.side\{display:(flex|block|grid)/);
  assert.doesNotMatch(css, /max-width:\s*999px/);
});

test('How it works exists in both layouts (fold under 1000px, side panel above)', () => {
  const html = read('index.html');
  assert.match(html, /<details class="how-fold">/);
  assert.equal((html.match(/data-steps/g) || []).length, 2);
});

test('no "Prototype only" and no em dashes under world-vibe/explore', () => {
  for (const f of ['index.html', 'explore.js', 'explore-render.js', 'explore-data.js', 'explore.css']) {
    const s = read(f);
    assert.doesNotMatch(s, /Prototype only/i, f);
    assert.ok(!s.includes('\u2014'), 'em dash in ' + f);
  }
});

test('every fixture statement starts with "I " or "My "', () => {
  for (const r of [...data.feed, ...data.following]) assert.match(r.statement, /^(I|My) /);
});

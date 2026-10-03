import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectItems, renderFeed, renderEnd, focusSelector, nextTab, trapTarget, renderPost, renderCuratorList, renderStrip, renderFilterText, renderHero, PUBLIC_SIGNAL_LABEL } from '../world-vibe/explore/explore-render.js';
import { loadFeed, loadFeedInto, retryCursor, loadCurators, loadFeatured, loadFollowing } from '../world-vibe/explore/explore-data.js';
import { refusal } from './helpers/captured.mjs';
import { getAccessToken } from '../world-vibe/session.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'world-vibe', 'explore');
const read = (n) => readFileSync(path.join(dir, n), 'utf8');
const fx = (n) => JSON.parse(read('fixtures/' + n));
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
const slugs = (html) => [...html.matchAll(/data-slug="([^"]+)"/g)].map((m) => m[1]);

// Captured real responses (EXPLORE-API clone gate). Feed, item, featured and
// following are single RPC rows; curators is the RPC row array.
const REAL = { feed: fx('wv3_explore_feed.json'), item: fx('wv3_explore_item.json'), curators: fx('wv3_explore_curators.json'), featured: fx('wv3_explore_featured.json'), following: fx('wv3_explore_following.json') };
const FOLLOWING_401 = fx('wv3_refusal_following_feed_401.json');
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
  'wv3_explore_curators.json': '40be6944f1c2b26bcaf4ae2fafdd1a042bb23f5ce250a3803de0b93939392d09',
  'wv3_explore_featured.json': 'a9d2bdd24039afbf11c74cd7239041d8ce089cbb72d6387ca544ced1a1c768ab',
  'wv3_explore_feed.json': 'ab2f9618dfca8029506970a56edbf4007264b4183185c42535b64f76ed975732',
  'wv3_explore_following.json': '4c9b644763857b4371fdb75fbc301adaef414592347002cf1f5b817d4daa3edd',
  'wv3_explore_item.json': '6c95cc6ec2c5d6ceac3bb6b0a44050f0810692ede3e6ceb3648befb78b77a6c2',
  'wv3_explore_my_follows.json': '1fc99536bc89dc400871364362fabf28a0961a76283869be282accc8842523a1',
  'wv3_explore_v2_golden.json': 'f03776f66c3fce246cc80613176b6255bed145c3b8e03ee1ccf3324d42e83392'
};
const SOURCE = '/Volumes/SensieSSD/agent_tmp/worktrees/wv3-integration/supabase/functions/statement-api/fixtures/';

// A fetch double that records urls and answers with the real route envelopes.
function fakeFetch(routes) {
  const urls = [];
  const fn = async (url, init) => {
    urls.push(url);
    (fn.inits = fn.inits || []).push(init);
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
  assert.deepEqual(await loadFeed(f, 'https://api.test'), { items: [REAL.feed], cursor: null });
  assert.deepEqual(await loadCurators(f, 'https://api.test'), REAL.curators);
  assert.deepEqual(await loadFeatured(f, 'https://api.test'), REAL.featured);
  assert.deepEqual(await loadFollowing(f, 'https://api.test', () => 'tok'), { items: [REAL.following], error: null });
  assert.deepEqual(f.urls, [
    'https://api.test/v1/public/world-vibe/feed',
    'https://api.test/v1/public/world-vibe/curators',
    'https://api.test/v1/public/world-vibe/featured?slot=topic_of_week',
    'https://api.test/v1/me/world-vibe/following-feed'
  ]);
});

// A cursor-addressed fake: a page is only served for the cursor in the URL, so
// dropping or mangling the cursor parameter fails the call.
function pagedFetch(pages, firstCursor = null) {
  const urls = [];
  const fn = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams.get('cursor');
    const page = pages[q === null ? '' : q];
    // A cursor the server did not issue for this order is the captured 422.
    if (!page) { const c = refusal('feed_422_cursor'); return { ok: false, status: c.status, json: async () => c.body }; }
    return { ok: true, status: 200, json: async () => page };
  };
  fn.urls = urls;
  return fn;
}
const chain = (n) => {
  const pages = {};
  for (let i = 1; i <= n; i++) pages[i === 1 ? '' : 'c' + (i - 1)] = { items: [row({ slug: 'p' + i })], next_cursor: i < n ? 'c' + i : null };
  return pages;
};

test('feed forwards the cursor query parameter and stops when it is null', async () => {
  const f = pagedFetch(chain(2));
  const r = await loadFeed(f, 'https://api.test');
  assert.deepEqual(r.items.map((i) => i.slug), ['p1', 'p2']);
  assert.equal(r.cursor, null);
  assert.deepEqual(f.urls, ['https://api.test/v1/public/world-vibe/feed', 'https://api.test/v1/public/world-vibe/feed?cursor=c1']);
});

test('a cursor the server rejects surfaces the captured 422 invalid_cursor and keeps the rows already read', async () => {
  const c = refusal('feed_422_cursor');
  assert.equal(c.status, 422);
  assert.equal(c.body.error, 'invalid_cursor');
  const f = pagedFetch({ '': { items: [row({ slug: 'p1' })], next_cursor: 'stale' } });
  await assert.rejects(() => loadFeed(f, 'https://api.test'), (e) => e.status === 422);
  const state = { feed: [], feedCursor: null, feedError: false };
  await loadFeedInto(state, f, 'https://api.test', null);
  assert.equal(state.feedError, true);
});

test('feed keeps paginating past five pages until the cursor is null', async () => {
  const f = pagedFetch(chain(8));
  const r = await loadFeed(f, 'https://api.test');
  assert.equal(r.items.length, 8);
  assert.equal(r.cursor, null);
});

test('hitting the page cap returns the unread cursor; Load more continues from it', async () => {
  const f = pagedFetch(chain(8));
  const r = await loadFeed(f, 'https://api.test', { maxPages: 3 });
  assert.deepEqual(r.items.map((i) => i.slug), ['p1', 'p2', 'p3']);
  assert.equal(r.cursor, 'c3');
  const more = await loadFeed(f, 'https://api.test', { cursor: r.cursor, maxPages: 3 });
  assert.deepEqual(more.items.map((i) => i.slug), ['p4', 'p5', 'p6']);
  assert.equal(more.cursor, 'c6');
});

test('"all caught up" is shown only when no cursor remains; otherwise Load more', () => {
  const st = { tab: 'all', curator: null };
  assert.match(renderEnd(st, { ...data, feedCursor: 'c3' }), /data-more[^>]*>Load more/);
  assert.doesNotMatch(renderEnd(st, { ...data, feedCursor: 'c3' }), /caught up/);
  assert.equal(renderEnd(st, { ...data, feedCursor: null }), "You're all caught up.");
  // A curator filter over a partly loaded feed must not claim completeness either.
  assert.match(renderEnd({ tab: 'all', curator: 'nobody' }, { ...data, feedCursor: 'c3' }), /Load more/);
  assert.equal(renderEnd({ tab: 'following', curator: null }, { ...data, feedCursor: 'c3' }), "You're all caught up.");
});

test('a failed Load more keeps rows and cursor, shows the error with Try again, never "all caught up"', () => {
  const st = { tab: 'all', curator: null };
  const failed = { ...data, feedCursor: 'c3', feedError: true };
  assert.equal(slugs(renderFeed(st, failed)).length, feedRows.length);
  const end = renderEnd(st, failed);
  assert.match(end, /role="alert"/);
  assert.match(end, /data-retry="more"[^>]*>Try again/);
  assert.doesNotMatch(end, /caught up|data-more/);
  // With the cursor already cleared the failure still must not read as complete.
  assert.doesNotMatch(renderEnd(st, { ...data, feedCursor: null, feedError: true }), /caught up/);
  // Initial-load failure (no rows) keeps its single error in the feed, not a second one here.
  assert.equal(renderEnd(st, { feed: [], feedCursor: null, feedError: true, curators: [] }), '');
});

// Pages 1..n of a feed whose requests can be made to fail from a given call on.
function flakyFeed(failFrom) {
  let n = 0;
  return async (url) => {
    n++;
    if (n >= failFrom) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ items: [{ slug: 'p' + n }], next_cursor: 'c' + n }) };
  };
}

test('a failed continuation keeps rows and cursor, raises the error flag, and Try again resumes from that cursor', async () => {
  // State after a first page that left an unread cursor.
  const state = { feed: [{ slug: 'p1' }], feedCursor: 'c1', feedError: false };
  // Load more fails.
  await loadFeedInto(state, async () => ({ ok: false, status: 503, json: async () => ({}) }), 'https://api.test', state.feedCursor);
  assert.deepEqual(state.feed.map((i) => i.slug), ['p1'], 'rows survive the failure');
  assert.equal(state.feedCursor, 'c1', 'unread cursor survives the failure');
  assert.equal(state.feedError, true, 'error flag is raised');
  const st = { tab: 'all', curator: null };
  assert.match(renderEnd(st, state), /data-retry="more"[^>]*>Try again/);
  assert.doesNotMatch(renderEnd(st, state), /caught up/);
  // Try again requests the page after the preserved cursor, then clears the error.
  assert.equal(retryCursor(state), 'c1');
  const urls = [];
  await loadFeedInto(state, async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ items: [{ slug: 'p2' }], next_cursor: null }) }; }, 'https://api.test', retryCursor(state));
  assert.ok(urls[0].includes('cursor=c1'), urls[0]);
  assert.deepEqual(state.feed.map((i) => i.slug), ['p1', 'p2']);
  assert.equal(state.feedCursor, null);
  assert.equal(state.feedError, false);
});

test('a failed first page has no cursor, so Try again starts over from page one', async () => {
  const state = { feed: [], feedCursor: null, feedError: false };
  await loadFeedInto(state, flakyFeed(1), 'https://api.test', null);
  assert.equal(state.feedError, true);
  assert.equal(retryCursor(state), null);
  assert.match(renderFeed({ tab: 'all', curator: null }, state), /data-retry="feed"/);
});

test('continuation failure under a curator filter with no matching rows retries from the cursor, not page one', () => {
  const failed = { feed: feedRows.filter((r) => r.curator_id === A), feedCursor: 'c3', feedError: true, curators: REAL.curators };
  const html = renderFeed({ tab: 'all', curator: B }, failed);
  assert.match(html, /data-retry="more"/);
  assert.doesNotMatch(html, /data-retry="feed"/);
  assert.doesNotMatch(html, /No lines from this curator/);
  // Without a preserved cursor the same view retries the first page.
  assert.match(renderFeed({ tab: 'all', curator: B }, { ...failed, feedCursor: null }), /data-retry="feed"/);
});

// Minimal element double: closest() resolves through the parent chain like the DOM.
function node(attrs, parent = null) {
  const n = { id: attrs.id || '', dataset: attrs.dataset || {}, parentElement: parent, hasAttribute: (k) => k === 'data-more' && !!attrs.more,
    closest(sel) {
      const want = sel.split(',').map((x) => x.trim());
      for (let e = n; e; e = e.parentElement) {
        if (want.some((w) => (w === '[data-who]' && 'who' in e.dataset) || (w === '[data-more]' && e.isMore) || (w === '[data-retry]' && 'retry' in e.dataset) || (w.startsWith('#') && w.slice(1) === e.id && e.id))) return e;
      }
      return null;
    } };
  n.isMore = !!attrs.more;
  return n;
}

test('focus restore keys on the stable list container, never an id-less parent', () => {
  const feed = node({ id: 'feed' });
  const wrap = node({}, feed);
  assert.equal(focusSelector(node({ dataset: { retry: 'feed' } }, wrap)), '#feed [data-more], #feed [data-retry], #end [data-more], #end [data-retry]');
  const end = node({ id: 'end' });
  assert.equal(focusSelector(node({ dataset: { retry: 'more' } }, end)), '#feed [data-more], #feed [data-retry], #end [data-more], #end [data-retry]');
  assert.equal(focusSelector(node({ more: true }, end)), '#feed [data-more], #feed [data-retry], #end [data-more], #end [data-retry]');
  const strip = node({ id: 'strip' });
  assert.equal(focusSelector(node({ dataset: { who: 'abc' } }, strip)), '#strip [data-who="abc"]');
  assert.equal(focusSelector(node({}, end)), null);
  assert.equal(focusSelector(null), null);
});

// Document double: querySelector understands "#id [data-x], #id [data-y]" over a list of live controls.
function pageWith(...controls) {
  return { querySelector(sel) {
    return controls.find((c) => sel.split(',').some((part) => {
      const m = part.trim().match(/^#(\w+) \[(data-[a-z]+)\]$/);
      return m && c.root === m[1] && c.attr === m[2];
    })) || null;
  } };
}

test('focus moves from Load more to Try again on the first failure, and stays on Try again on later failures', () => {
  const end = node({ id: 'end' });
  const keep = focusSelector(node({ more: true }, end));
  // After the first failure #end holds Try again and no Load more.
  const tryAgain = { root: 'end', attr: 'data-retry' };
  assert.equal(pageWith(tryAgain).querySelector(keep), tryAgain);
  // Activating Try again and failing again re-renders the same control.
  const keep2 = focusSelector(node({ dataset: { retry: 'more' } }, end));
  const tryAgain2 = { root: 'end', attr: 'data-retry' };
  assert.equal(pageWith(tryAgain2).querySelector(keep2), tryAgain2);
  // A retry that succeeds hands focus back to Load more when pages remain.
  const more = { root: 'end', attr: 'data-more' };
  assert.equal(pageWith(more).querySelector(keep2), more);
});

test('first failure with an empty filter renders Try again in #feed: focus still restores', () => {
  const end = node({ id: 'end' });
  const keep = focusSelector(node({ more: true }, end));
  // Load more lived in #end; the failed continuation rendered Try again in #feed.
  const tryAgainInFeed = { root: 'feed', attr: 'data-retry' };
  assert.equal(pageWith(tryAgainInFeed).querySelector(keep), tryAgainInFeed);
});

test('explore.js wires the shared failure handling and the focus restore', () => {
  const src = read('explore.js');
  assert.match(src, /loadFeedInto\(data, call, API, cursor\)/);
  assert.match(src, /loadFeedPages\(retryCursor\(data\)\)/);
  assert.match(src, /focusSelector\(document\.activeElement\)/);
});

test('featured null is a normal state', async () => {
  assert.equal(await loadFeatured(fakeFetch({ '/featured': { body: { featured: null } } }), 'x'), null);
});

test('session: getAccessToken is null when there is no browser session', () => {
  assert.equal(getAccessToken(), null);
});

test('following with a token sends Authorization: Bearer on the following-feed request', async () => {
  const f = fakeFetch({ '/following-feed': { body: { items: [REAL.following] } } });
  await loadFollowing(f, 'https://api.test', () => 'tok-123');
  assert.equal(f.urls.length, 1);
  assert.equal(f.inits[0].headers.Authorization, 'Bearer tok-123');
});

test('following without a token makes no request and reports signin', async () => {
  const f = fakeFetch({ '/following-feed': { body: { items: [REAL.following] } } });
  assert.deepEqual(await loadFollowing(f, 'x', () => null), { items: [], error: 'signin' });
  assert.deepEqual(await loadFollowing(f, 'x'), { items: [], error: 'signin' });
  assert.equal(f.urls.length, 0);
});

test('following 401 reads as auth, 500 and network failure as unavailable', async () => {
  const tok = () => 't';
  assert.deepEqual(await loadFollowing(fakeFetch({ '/following-feed': FOLLOWING_401 }), 'x', tok), { items: [], error: 'auth' });
  assert.deepEqual(await loadFollowing(fakeFetch({ '/following-feed': { status: 500, body: {} } }), 'x', tok), { items: [], error: 'unavailable' });
  assert.deepEqual(await loadFollowing(async () => { throw new TypeError('network'); }, 'x', tok), { items: [], error: 'unavailable' });
});

test('explore.js forwards the fetch init (headers) and passes the session token getter to loadFollowing', () => {
  assert.match(read('explore.js'), /const call = \(url, init\) => fetch\(url, init\);/);
  assert.match(read('explore.js'), /loadFollowing\(call, API, getAccessToken\)/);
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

const followingOf = (over) => renderFeed({ tab: 'following', curator: null }, { ...data, following: [], ...over });

test('Following empty state only when the load succeeded with no rows', () => {
  assert.match(text(followingOf({})), /Follow a curator/);
});

test('Following signed out (no token) or 401 renders the sign-in state with a live Sign in link, never rows', () => {
  for (const followingError of ['signin', 'auth']) {
    const html = followingOf({ followingError, following: [REAL.following] });
    assert.match(text(html), /Sign in to see who you follow/);
    assert.match(html, /<a class="signin" href="\/world-vibe\/\?signin=1">Sign in<\/a>/);
    assert.doesNotMatch(html, /disabled|coming soon/i);
    assert.deepEqual(slugs(html), []);
    assert.doesNotMatch(text(html), /Follow a curator/);
  }
});

test('Following 500 or network failure renders an error with Try again, never "Follow a curator"', () => {
  const html = followingOf({ followingError: 'unavailable' });
  assert.match(text(html), /Couldn't load who you follow/);
  assert.match(html, /data-retry="following"[^>]*>Try again/);
  assert.doesNotMatch(text(html), /Follow a curator|No lines|Sign in/);
});

test('feed failure renders an error before and after a curator filter, never "No lines"', () => {
  for (const curator of [null, A]) {
    const html = renderFeed({ tab: 'all', curator }, { ...data, feed: [], feedError: true });
    assert.match(text(html), /Couldn't load lines/);
    assert.match(html, /data-retry="feed"[^>]*>Try again/);
    assert.doesNotMatch(text(html), /No lines/);
  }
});

test('a curator with no lines shows an empty message when the feed loaded', () => {
  assert.match(text(renderFeed({ tab: 'all', curator: 'nobody' }, data)), /No lines from this curator/);
  assert.match(text(renderFeed({ tab: 'all', curator: null }, { ...data, feed: [] })), /No lines here yet/);
});

test('nextTab follows the ARIA tabs arrow-key pattern', () => {
  assert.equal(nextTab('all', 'ArrowRight'), 'following');
  assert.equal(nextTab('following', 'ArrowRight'), 'all');
  assert.equal(nextTab('all', 'ArrowLeft'), 'following');
  assert.equal(nextTab('following', 'ArrowLeft'), 'all');
  assert.equal(nextTab('following', 'Home'), 'all');
  assert.equal(nextTab('all', 'End'), 'following');
  assert.equal(nextTab('all', 'a'), null);
});

test('tabs start with roving tabindex (selected 0, other -1)', () => {
  const html = read('index.html');
  assert.match(html, /id="tab-all"[^>]*aria-selected="true" tabindex="0"/);
  assert.match(html, /id="tab-following"[^>]*aria-selected="false" tabindex="-1"/);
  assert.match(read('explore.js'), /t\.tabIndex = on \? 0 : -1/);
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

test('the sheet focus trap wraps over every focusable element, the QR universal link included', () => {
  const close = { id: 'close' }, send = { id: 'send' }, link = { id: 'open-link' };
  const all = [send, close, link];
  assert.equal(trapTarget(all, send, true), link);
  assert.equal(trapTarget(all, link, false), send, 'Tab from the link wraps to the first control');
  assert.equal(trapTarget(all, close, false), null, 'Tab from a button is not stolen when the link follows it');
  assert.equal(trapTarget([close], close, false), close);
  assert.equal(trapTarget([], null, false), null);
  const src = read('explore.js');
  assert.match(src, /querySelectorAll\('button, a\[href\]'\)/, 'explore.js collects links as well as buttons');
});

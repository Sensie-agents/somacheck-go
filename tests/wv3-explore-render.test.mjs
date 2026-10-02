import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectItems, renderFeed, renderPost, renderCuratorList, renderStrip, renderFilterText, PUBLIC_SIGNAL_LABEL } from '../world-vibe/explore/explore-render.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'world-vibe', 'explore');
const read = (n) => readFileSync(path.join(dir, n), 'utf8');
const fx = (n) => JSON.parse(read('fixtures/' + n));
const data = { feed: fx('feed-v3.json').items, following: fx('following-feed.json').items, curators: fx('curators.json') };
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
const slugs = (html) => [...html.matchAll(/data-slug="([^"]+)"/g)].map((m) => m[1]);

// The exact columns of the RPCs (supabase/migrations 20260930000000 and 20260929180000).
const FEED_V3 = ['slug', 'quote', 'statement', 'domain', 'source_url', 'contributor_count', 'unlock_threshold', 'aligned', 'unaligned', 'lean', 'last_activity_at', 'public_signals', 'category', 'curator_name'];
const FOLLOWING = FEED_V3.filter((c) => c !== 'category' && c !== 'curator_name');
const CURATORS = ['display_name', 'lines_count', 'checkins_sparked'];

test('fixtures carry the exact RPC columns, public_signals is a boolean on every row', () => {
  for (const r of data.feed) assert.deepEqual(Object.keys(r).sort(), [...FEED_V3].sort());
  for (const r of data.following) assert.deepEqual(Object.keys(r).sort(), [...FOLLOWING].sort());
  for (const r of data.curators) assert.deepEqual(Object.keys(r).sort(), [...CURATORS].sort());
  for (const r of [...data.feed, ...data.following]) assert.equal(typeof r.public_signals, 'boolean');
});

test('curator click filters the feed to that curator only', () => {
  const state = { tab: 'all', curator: 'Maya K.' };
  const html = renderFeed(state, data);
  const expected = data.feed.filter((i) => i.curator_name === 'Maya K.' && !i.public_signals).map((i) => i.slug);
  assert.equal(expected.length, 2);
  assert.deepEqual(slugs(html), expected);
  assert.match(renderFilterText(state), /Lines from Maya K\./);
  assert.equal(renderFilterText({ tab: 'all', curator: null }), '');
  assert.deepEqual(slugs(renderFeed({ tab: 'all', curator: null }, data)), data.feed.map((i) => i.slug));
});

test('curator list and story strip render one pressable control per curator from the curators RPC', () => {
  const state = { tab: 'all', curator: 'Sam R.' };
  for (const html of [renderCuratorList(data.curators, state), renderStrip(data.curators, state)]) {
    assert.equal((html.match(/data-who="/g) || []).length, data.curators.length);
    assert.match(html, /data-who="Sam R\." aria-pressed="true"/);
    assert.match(html, /data-who="Maya K\." aria-pressed="false"/);
  }
  const list = text(renderCuratorList(data.curators, state));
  assert.match(list, /12 lines · sparked 140 check-ins/);
});

test('curator stats are activity only: no verdict words next to a curator', () => {
  const list = text(renderCuratorList(data.curators, { curator: null }));
  assert.doesNotMatch(list, /align|lean|%/i);
});

test('Following tab uses the following-feed rows, not feed_v3', () => {
  const rows = selectItems({ tab: 'following', curator: null }, data);
  assert.deepEqual(rows.map((r) => r.slug), data.following.map((r) => r.slug));
  assert.ok(data.feed.some((f) => !data.following.some((r) => r.slug === f.slug)), 'fixture must differ between feeds');
  const html = renderFeed({ tab: 'following', curator: null }, data);
  assert.deepEqual(slugs(html), data.following.map((r) => r.slug));
  assert.doesNotMatch(html, /fx-sam-phone/);
});

test('Following tab empty and signed-out states', () => {
  assert.match(text(renderFeed({ tab: 'following', curator: null }, { ...data, following: [] })), /Follow a curator/);
  assert.match(text(renderFeed({ tab: 'following', curator: null }, { ...data, following: [], followingError: 'auth' })), /Sign in/);
});

test('a curator with no lines shows an empty message', () => {
  assert.match(text(renderFeed({ tab: 'all', curator: 'Nobody' }, data)), /No lines from this curator/);
});

test('public_signals row: label shown, curator name never rendered, never matched by a curator filter', () => {
  const row = data.feed.find((i) => i.public_signals === true);
  assert.equal(row.curator_name, 'Should Never Render');
  const html = renderPost(row);
  assert.match(html, new RegExp(PUBLIC_SIGNAL_LABEL));
  assert.doesNotMatch(html, /Should Never Render/);
  assert.match(html, /<b>Anonymous<\/b>/);
  assert.deepEqual(selectItems({ tab: 'all', curator: 'Should Never Render' }, data), []);
  assert.doesNotMatch(renderPost({ ...row, public_signals: false, curator_name: null }), new RegExp(PUBLIC_SIGNAL_LABEL));
});

test('curator_name NULL renders Anonymous, a name renders Brought-by style byline', () => {
  const anon = renderPost(data.feed.find((i) => i.slug === 'fx-anon-hurricane'));
  assert.match(anon, /<b>Anonymous<\/b>/);
  const named = renderPost(data.feed.find((i) => i.slug === 'fx-maya-jobs'));
  assert.match(named, /<b>Maya K\.<\/b>/);
});

test('reveal ladder on cards: under threshold dots only, lean without numbers, split at 10+', () => {
  const by = (s) => renderPost(data.feed.find((i) => i.slug === s));
  const gather = by('fx-jordan-ageing');
  assert.match(gather, /class="dots"/);
  assert.match(text(gather), /2 of 3 checked in/);
  assert.doesNotMatch(text(gather), /%/);
  const lean = by('fx-maya-jobs');
  assert.match(lean, /class="track"/);
  assert.match(text(lean), /Mixed so far · 7 checked in/);
  assert.doesNotMatch(text(lean), /%/);
  const split = by('fx-maya-money');
  assert.match(split, /class="split"/);
  assert.match(text(split), /75% aligned/);
  assert.match(text(split), /12 checked in/);
});

test('reveal ladder never leaks counts: lean row with leaked aligned/unaligned shows no percent', () => {
  const row = { ...data.feed.find((i) => i.slug === 'fx-ana-meeting'), aligned: 8, unaligned: 1 };
  assert.doesNotMatch(text(renderPost(row)), /%/);
  const under = { ...data.feed.find((i) => i.slug === 'fx-jordan-ageing'), aligned: 2, unaligned: 0, lean: 'aligned' };
  assert.doesNotMatch(text(renderPost(under)), /%|Leans/);
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
  for (const f of ['index.html', 'explore.js', 'explore-render.js', 'explore.css', 'fixtures/feed-v3.json', 'fixtures/following-feed.json', 'fixtures/curators.json']) {
    const s = read(f);
    assert.doesNotMatch(s, /Prototype only/i, f);
    assert.ok(!s.includes('—'), 'em dash in ' + f);
  }
});

test('every fixture statement starts with "I " or "My "', () => {
  for (const r of [...data.feed, ...data.following]) assert.match(r.statement, /^(I|My) /);
});

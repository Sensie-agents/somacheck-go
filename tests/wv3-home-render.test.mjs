import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSharedCard, renderMeter, renderReveal, renderPrivateCard } from '../world-vibe/home/home-render.js';

const homeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'world-vibe', 'home');
const fx = (n) => JSON.parse(readFileSync(path.join(homeDir, 'fixtures', n), 'utf8'));

test('contributors 2: dots and "2 of 3", no percent', () => {
  const html = renderMeter(fx('item-gather-2.json'));
  assert.match(html, /class="dots"/);
  assert.match(html, /2 of 3 checked in/);
  assert.equal((html.match(/<i class="on">/g) || []).length, 2);
  assert.doesNotMatch(html, /%/);
});

test('lean with aligned=NULL: track, head count, no percentages', () => {
  const item = fx('item-lean-5.json');
  assert.equal(item.aligned, null);
  assert.equal(item.lean, 'mixed');
  const html = renderMeter(item);
  assert.match(html, /class="track"/);
  const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  assert.match(text, /Mixed so far · 5 checked in/);
  assert.doesNotMatch(text, /%/);
  assert.doesNotMatch(text.replace('5 checked in', ''), /\d/);
  assert.doesNotMatch(html, /class="dots"/);
});

test('contributors 12 with counts: percent bar', () => {
  const html = renderMeter(fx('item-split-12.json'));
  assert.match(html, /class="split"/);
  assert.match(html, /75% aligned/);
  assert.match(html, /25% unaligned/);
  assert.match(html, /12 checked in/);
});

test('raw world_vibe_public_feed_v2 row (contributor_count 12, 9/3) renders the split', () => {
  const row = { slug: 'raw', quote: null, statement: 'I am ready.', domain: null, source_url: null, contributor_count: 12, unlock_threshold: 3, aligned: 9, unaligned: 3, lean: 'aligned', last_activity_at: '2026-09-29T12:00:00Z', public_signals: false };
  const html = renderMeter(row);
  assert.match(html, /75% aligned/);
  assert.match(html, /25% unaligned/);
  assert.match(html, /12 checked in/);
});

test('exact-count rule: threshold 20 with 12 contributors shows no split and no lean', () => {
  const item = { contributor_count: 12, unlock_threshold: 20, aligned: 9, unaligned: 3, lean: 'aligned' };
  for (const html of [renderMeter(item), renderReveal({ ...item, statement: 'I am ready.' })]) {
    assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /%/);
    assert.doesNotMatch(html, /class="split"/);
    assert.doesNotMatch(html, /Leans|Mixed so far/);
    assert.match(html, /12 of 20 checked in/);
  }
});

test('curator_name NULL renders no name', () => {
  const pick = { ...fx('pick-trending_in_category.json'), curator_name: null };
  const html = renderSharedCard(pick);
  assert.doesNotMatch(html, /Brought by/);
  assert.doesNotMatch(html, /class="av"/);
  assert.doesNotMatch(html, /Maya/);
  assert.match(renderSharedCard(fx('pick-trending_in_category.json')), /Brought by <b>Maya K\.<\/b>/);
});

const EXPECTED = {
  shared_link: 'Someone shared this with you.',
  topic_of_week: 'It&#39;s the topic of the week.',
  closest_to_unlock: '2 of 3 have checked in. Yours could reveal it.',
  time_of_day: 'It&#39;s morning where you are.',
  trending_in_category: 'Trending in Work &amp; AI today.',
  following: 'From a curator you follow.',
  most_checked: 'Most checked this week.'
};
for (const [reason, sentence] of Object.entries(EXPECTED)) {
  test('reason ' + reason + ' renders its sentence', () => {
    const pick = fx('pick-' + reason + '.json');
    assert.equal(pick.reason, reason);
    const html = renderSharedCard(pick);
    assert.ok(html.includes('Picked for you · ' + sentence), html);
    assert.ok(html.includes(pick.statement.replace(/&/g, '&amp;')) || html.includes('class="line"'));
  });
}

test('public-signal item shows the label and never a curator name', () => {
  const item = fx('item-public-signal.json');
  assert.ok(item.curator_name, 'fixture carries a name to prove suppression');
  const html = renderSharedCard({ ...item, reason: 'most_checked' });
  assert.match(html, /Shown publicly by choice/);
  assert.ok(!html.includes(item.curator_name));
  assert.doesNotMatch(html, /Brought by/);
  const reveal = renderReveal({ ...item, revealed_by_you: false });
  assert.match(reveal, /Shown publicly by choice/);
  assert.ok(!reveal.includes(item.curator_name));
  assert.doesNotMatch(renderReveal({ ...item, public_signals: false }), /Shown publicly by choice/);
});

test('raw v2 public-signal row: consented counts, label on card and reveal, no curator name', () => {
  const row = { slug: 'raw-ps', quote: null, statement: 'I feel calm.', domain: null, source_url: null, contributor_count: 1, unlock_threshold: 1, aligned: 1, unaligned: 0, lean: 'aligned', last_activity_at: null, public_signals: true, reason: 'most_checked', category: 'self', curator_name: 'Should Not Show' };
  const card = renderSharedCard(row);
  assert.match(card, /Shown publicly by choice/);
  assert.match(card, /100%/);
  assert.doesNotMatch(card, /1 of 3/);
  assert.ok(!card.includes('Should Not Show'));
  const reveal = renderReveal({ ...row, contributor_count: 12, aligned: 9, unaligned: 3, revealed_by_you: false });
  assert.match(reveal, /Shown publicly by choice/);
  assert.ok(!reveal.includes('Should Not Show'));
});

test('reveal: revealed_by_you shows YOU REVEALED IT, otherwise YOU\'RE IN', () => {
  const p = fx('progress-revealed.json');
  assert.match(renderReveal(p), /YOU REVEALED IT/);
  assert.match(renderReveal({ ...p, revealed_by_you: false }), /YOU&#39;RE IN|YOU'RE IN/);
  assert.match(renderReveal(p), /Never who|never who/);
});

test('private card: three phases, always says private, no public meter', () => {
  const compose = renderPrivateCard({ phase: 'compose', ctx: 'agent' });
  assert.match(compose, /Write my line/);
  assert.match(renderPrivateCard({ phase: 'compose', ctx: 'words' }), /id="mind"/);
  const written = renderPrivateCard({ phase: 'written', ctx: 'agent', line: 'I am <b>tired</b>.' });
  assert.match(written, /Only you see this line/);
  assert.ok(!written.includes('<b>tired</b>'), 'line is escaped');
  assert.match(renderPrivateCard({ phase: 'done', line: 'x' }), /SAVED TO YOUR BASELINE/);
  assert.doesNotMatch(written, /class="meter"/);
});

test('statement text is escaped in shared cards', () => {
  const html = renderSharedCard({ ...fx('pick-following.json'), statement: 'I <script>x</script>' });
  assert.ok(!html.includes('<script>'));
});

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('no "Prototype only" text under world-vibe/home', () => {
  for (const f of walk(homeDir)) assert.ok(!readFileSync(f, 'utf8').includes('Prototype only'), f);
});

test('no em dashes under world-vibe/home', () => {
  for (const f of walk(homeDir)) assert.ok(!readFileSync(f, 'utf8').includes('—'), f);
});

test('every fixture statement starts with "I " or "My "', () => {
  for (const f of walk(path.join(homeDir, 'fixtures'))) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const lines = Array.isArray(j) ? j : [j.statement];
    for (const l of lines) assert.match(l, /^(I|My)\b/, f);
  }
});

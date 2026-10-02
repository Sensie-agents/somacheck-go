// The QR landing /world-vibe/share/?item=<slug>: reveal ladder, universal link, states, copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemProgress, universalLink } from '../world-vibe/share/item-logic.js';
import { itemRow } from './helpers/captured.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(path.join(root, 'world-vibe', 'share', 'index.html'), 'utf8');
const row = (over) => itemRow({ public_signals: false, ...over });

test('under the threshold: only the head count, no lean and no percent', () => {
  const p = itemProgress(row({ contributor_count: 2, aligned: null, unaligned: null, lean: null, unlock_threshold: 3 }));
  assert.equal(p.headline, '2 of 3 checked in');
  assert.doesNotMatch(p.headline + p.detail, /%|Leans|aligned/i);
});

test('threshold to 9: a lean and the head count, never a percent', () => {
  const p = itemProgress(row({ contributor_count: 5, aligned: null, unaligned: null, lean: 'mixed', unlock_threshold: 3 }));
  assert.deepEqual(p, { headline: 'Mixed so far', detail: '5 checked in' });
  const q = itemProgress(row({ contributor_count: 9, aligned: 6, unaligned: 3, lean: 'aligned', unlock_threshold: 3 }));
  assert.equal(q.headline, 'Leans aligned');
  assert.doesNotMatch(q.headline + q.detail, /%/);
});

test('10 and above with counts: exact split', () => {
  const p = itemProgress(row({ contributor_count: 12, aligned: 9, unaligned: 3, lean: 'aligned', unlock_threshold: 3 }));
  assert.equal(p.headline, '75% aligned, 25% unaligned');
  assert.equal(p.detail, '12 checked in. What participants noticed.');
});

test('10 contributors but a threshold of 20 stays on the head count', () => {
  const p = itemProgress(row({ contributor_count: 12, aligned: 9, unaligned: 3, lean: 'aligned', unlock_threshold: 20 }));
  assert.equal(p.headline, '12 of 20 checked in');
});

test('a consented public-signal item shows what people chose to share, with no curator in the result', () => {
  const p = itemProgress(itemRow({ contributor_count: 1, aligned: 1, unaligned: 0, public_signals: true }));
  assert.deepEqual(p, { headline: '100% aligned', detail: '1 shared by choice' });
  assert.equal(JSON.stringify(p).includes('curator'), false);
});

test('the universal link is the share URL with the encoded slug', () => {
  assert.equal(universalLink('wv3-r2-named'), 'https://go.somacheck.com/world-vibe/share/?item=wv3-r2-named');
});

test('the page has the item, not-found and unavailable states, an app button, an install fallback and no em dash', () => {
  for (const s of ['item', 'missing', 'unavailable']) assert.match(page, new RegExp('data-state="' + s + '"'));
  assert.match(page, /id="open"/);
  assert.match(page, /id="install"[^>]*href="https:\/\/testflight/);
  assert.match(page, /We couldn't find that line/);
  assert.ok(!page.includes('—'));
  assert.match(page, /<meta name="robots" content="noindex">/);
});

test('the page never renders a curator name and loads only the item route', () => {
  const src = readFileSync(path.join(root, 'world-vibe', 'share', 'item.js'), 'utf8');
  assert.doesNotMatch(src, /curator/);
  assert.doesNotMatch(src, /Authorization|getAccessToken/);
});

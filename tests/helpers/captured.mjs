// The captured contract rows (from the Wave 2 integration clone gate) are the
// only source of response data in the WP12 tests. Variants spread a captured row
// and override fields the test is about; no row is written from scratch.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'world-vibe', 'explore', 'fixtures');
const load = (n) => JSON.parse(readFileSync(path.join(fixturesDir, n), 'utf8'));

export const feedRow = load('wv3_explore_feed.json');
export const publicSignalRow = load('wv3_explore_item.json');
export const followingRow = load('wv3_explore_following.json');
export const curators = load('wv3_explore_curators.json');
export const featuredRow = load('wv3_explore_featured.json');

export const row = (over = {}) => ({ ...feedRow, ...over });
// A pick as the pick route returns it: the captured item plus a reason.
export const pickOf = (reason, over = {}) => ({ ...feedRow, reason, ...over });
// The route envelopes, built around captured rows.
export const pickEnvelope = (reason, over = {}) => { const { reason: _r, ...item } = pickOf(reason, over); return { item, reason }; };
export const progressEnvelope = (over = {}) => ({ ...feedRow, your_checkin_counted: true, revealed_by_you: false, your_reading: null, ...over });

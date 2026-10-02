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

// Consent and phone-link responses. The backend lane captures these as
// fixtures/wv3_consent.json and fixtures/wv3_phone.json; until they are dropped
// into world-vibe/explore/fixtures the recorded shape from the route contract is
// used, and the same tests then run against the capture unchanged.
const capture = (name, fallback) => { try { return load(name); } catch { return fallback; } };
export const consentCapture = capture('wv3_consent.json', { world_vibe_private: false, updated_at: '2026-10-02T00:00:00+00:00' });
export const phoneCapture = capture('wv3_phone.json', { linked: true });
export const consentBody = (value) => ({ ...consentCapture, world_vibe_private: value });
export const phoneBody = (linked) => ({ ...phoneCapture, linked });
// The item route returns the same row shape as the feed; the captured item row is the reference.
export const itemRow = (over = {}) => ({ ...publicSignalRow, ...over });

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
// The route captures (status + body), replayed unchanged. Variants spread a
// captured body and override only the fields a test is about.
export const pickAnon = load('wv3_pick_anon.json');
export const createV3 = load('wv3_create_v3.json');
export const pickSignedIn = load('wv3_pick_signed_in.json').body;
export const pickEnvelope = (reason, over = {}) => ({ item: { ...pickSignedIn.item, ...over }, reason });
export const progressCapture = load('wv3_progress_revealed_by_you.json').body;
export const progressEnvelope = (over = {}) => ({ ...progressCapture, ...over });
export const progressLocked = load('wv3_progress_locked.json').body;
export const progressLean = load('wv3_progress_lean.json').body;
export const progressExact = load('wv3_progress_exact.json').body;
export const sendOk = load('wv3_send_ok.json');
export const sendLinkRequired = load('wv3_send_link_required.json');
export const draftsCreate = load('wv3_drafts_create.json');
export const draftsConsentRequired = load('wv3_drafts_consent_required.json');

export const consentCapture = load('wv3_consent.json');
export const consentBody = (value) => ({ ...consentCapture, world_vibe_private: value });
export const phoneLinked = load('wv3_phone.json');
export const phoneUnlinked = load('wv3_phone_unlinked.json');
export const phoneBody = (linked) => (linked ? phoneLinked : phoneUnlinked);

// The private ask (POST /v1/me/vibecheck/drafts/{id}/ask) 201 and the empty pick are captures too
// (integration 4e35e548), replayed with their captured status.
export const privateAsk = load('wv3_private_ask.json');
export const pickEmpty = load('wv3_pick_empty.json');
export const emptyPick = pickEmpty.body;
// Every application refusal is a capture: { status, body } replayed unchanged.
export const refusal = (name) => load(`wv3_refusal_${name}.json`);
// The item route returns the same row shape as the feed; the captured item row is the reference.
export const itemRow = (over = {}) => ({ ...publicSignalRow, ...over });

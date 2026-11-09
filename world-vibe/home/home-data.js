// Live data for the World Vibe v3 home. Routes and envelopes are the ones the
// statement-api serves: pick (WP6), item progress (WP7), send to phone (WP8),
// private drafts (WP9). Every loader takes the fetch function so tests can
// replay recorded responses. Nothing here reads or writes without a person's
// bearer when the route needs one.
import { DEFAULT_API } from '../explore/explore-data.js';

export { DEFAULT_API };
const PUBLIC = '/v1/public/world-vibe';
const CONSENT = '/v1/me/world-vibe/consent';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_EXCLUDES = 100;
// Opens the app directly through the universal link; no agent link needed.
export const SHARE_URL = 'https://go.somacheck.com/world-vibe/share/';

export const shareUrlFor = (slug) => SHARE_URL + '?item=' + encodeURIComponent(slug);

const bearer = (token) => (token ? { headers: { Authorization: 'Bearer ' + token } } : {});
const asJson = (token, body) => ({ method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });

// Keeps the newest MAX_EXCLUDES slugs: the pick route rejects longer lists.
export const extendExcludes = (excludes, slug) => [...excludes.filter((s) => s !== slug), slug].slice(-MAX_EXCLUDES);

// GET /pick -> { item, reason } | { item: null, reason: null }. The card needs
// the reason beside the item, so the two are merged into one pick.
export async function loadPick(fetchFn, base, { exclude = [], tz = 'UTC', arrivedFrom = null, token = null } = {}) {
  const q = new URLSearchParams({ tz });
  if (exclude.length) q.set('exclude', exclude.join(','));
  if (arrivedFrom && arrivedFrom.length <= 100 && SLUG.test(arrivedFrom)) q.set('arrived_from', arrivedFrom);
  try {
    const r = await fetchFn(base + PUBLIC + '/pick?' + q, bearer(token));
    if (!r.ok) return { pick: null, error: 'unavailable' };
    const body = await r.json();
    return body && body.item ? { pick: { ...body.item, reason: body.reason }, error: null } : { pick: null, error: null };
  } catch { return { pick: null, error: 'unavailable' }; }
}

// GET /items/{slug}/progress[?receipt=]. The receipt only counts with a bearer.
export async function loadProgress(fetchFn, base, slug, { receipt = null, token = null } = {}) {
  const q = receipt && token ? '?receipt=' + encodeURIComponent(receipt) : '';
  try {
    const r = await fetchFn(base + PUBLIC + '/items/' + encodeURIComponent(slug) + '/progress' + q, bearer(token));
    return r.ok ? { progress: await r.json(), error: null } : { progress: null, error: r.status === 404 ? 'not_found' : 'unavailable' };
  } catch { return { progress: null, error: 'unavailable' }; }
}

// POST /v1/me/world-vibe/items/{slug}/ask. 422 link_required means this account
// has no active agent link: the QR is then the only phone path.
export async function sendToPhone(fetchFn, base, slug, token) {
  if (!token) return { status: 'signin' };
  try {
    const r = await fetchFn(base + '/v1/me/world-vibe/items/' + encodeURIComponent(slug) + '/ask', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) return { status: 'signin' };
    if (r.status === 422) return { status: 'link_required' };
    if (r.status === 429) return { status: 'rate_limited' };
    if (r.status === 409) return { status: 'pending' };
    if (!r.ok) return { status: 'error' };
    const b = await r.json();
    return { status: 'sent', requestId: b.request_id, replayed: b.replayed === true };
  } catch { return { status: 'error' }; }
}

// POST /v1/me/vibecheck/drafts { source, words? } -> { drafts: [{ id, statement }] }
export async function generateDrafts(fetchFn, base, { source, words }, token) {
  if (!token) return { error: 'signin' };
  try {
    const r = await fetchFn(base + '/v1/me/vibecheck/drafts', asJson(token, source === 'words' ? { source, words } : { source }));
    if (r.status === 401) return { error: 'signin' };
    if (r.status === 403) return { error: 'consent_required' };
    if (r.status === 422) return { error: source === 'agent' ? 'no_context' : 'invalid_words' };
    if (!r.ok) return { error: 'unavailable' };
    const b = await r.json();
    return Array.isArray(b.drafts) && b.drafts.length ? { drafts: b.drafts } : { error: 'unavailable' };
  } catch { return { error: 'unavailable' }; }
}

// POST /v1/me/vibecheck/drafts/{id}/ask -> { request_id, source: 'world_vibe_private' }
export async function askPrivate(fetchFn, base, draftId, token) {
  if (!token) return { status: 'signin' };
  try {
    const r = await fetchFn(base + '/v1/me/vibecheck/drafts/' + encodeURIComponent(draftId) + '/ask', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) return { status: 'signin' };
    if (!r.ok) return { status: 'error' };
    const b = await r.json();
    return { status: 'sent', requestId: b.request_id };
  } catch { return { status: 'error' }; }
}

// "Just for me" consent flag: GET/PUT /v1/me/world-vibe/consent
// { world_vibe_private: boolean, updated_at }. The bearer resolves the person;
// the browser never touches the database directly.
export async function getConsent(fetchFn, base, token) {
  if (!token) return { consent: null, error: 'signin' };
  try {
    const r = await fetchFn(base + CONSENT, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) return { consent: null, error: 'signin' };
    if (!r.ok) return { consent: null, error: 'unavailable' };
    const b = await r.json();
    return typeof b.world_vibe_private === 'boolean' ? { consent: b.world_vibe_private, error: null } : { consent: null, error: 'unavailable' };
  } catch { return { consent: null, error: 'unavailable' }; }
}

export async function setConsent(fetchFn, base, token, value) {
  if (!token) return { consent: null, error: 'signin' };
  try {
    const r = await fetchFn(base + CONSENT, { ...asJson(token, { world_vibe_private: value === true }), method: 'PUT' });
    if (r.status === 401) return { consent: null, error: 'signin' };
    if (!r.ok) return { consent: null, error: 'unavailable' };
    const b = await r.json();
    return typeof b.world_vibe_private === 'boolean' ? { consent: b.world_vibe_private, error: null } : { consent: null, error: 'unavailable' };
  } catch { return { consent: null, error: 'unavailable' }; }
}

// GET /v1/me/world-vibe/phone -> { linked: boolean }. "Send to my phone" is only
// offered when this says true; any other answer keeps the QR as the one path.
export async function loadPhoneLinked(fetchFn, base, token) {
  if (!token) return false;
  try {
    const r = await fetchFn(base + '/v1/me/world-vibe/phone', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return false;
    return (await r.json()).linked === true;
  } catch { return false; }
}

// The slug a QR landing was opened with: exactly one valid `item` value.
export function itemSlugFromSearch(search) {
  const all = new URLSearchParams(search).getAll('item');
  return all.length === 1 && all[0].length <= 100 && SLUG.test(all[0]) ? all[0] : null;
}

// GET /items/{slug} (the v3 item route, same row shape as the feed).
export async function loadItem(fetchFn, base, slug) {
  if (!slug || slug.length > 100 || !SLUG.test(slug)) return { item: null, error: 'not_found' };
  try {
    const r = await fetchFn(base + PUBLIC + '/items/' + encodeURIComponent(slug));
    if (r.status === 404) return { item: null, error: 'not_found' };
    if (!r.ok) return { item: null, error: 'unavailable' };
    const item = await r.json();
    return item && item.slug === slug ? { item, error: null } : { item: null, error: 'unavailable' };
  } catch { return { item: null, error: 'unavailable' }; }
}

// Home data layer against stand-ins for the statement-api routes. Item bodies
// are built around the captured rows (tests/helpers/captured.mjs); the envelope
// shapes follow the route handlers. Contract captures for pick, progress, ask,
// drafts and consent are not in the integration fixtures yet (see receipt), so
// these are behaviour tests, not contract replays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extendExcludes, loadPick, loadProgress, sendToPhone, generateDrafts, askPrivate, getConsent, setConsent, shareUrlFor, MAX_EXCLUDES } from '../world-vibe/home/home-data.js';
import { pickEnvelope, progressEnvelope, feedRow } from './helpers/captured.mjs';

const API = 'https://api.test';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function recorder(handler) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(new URL(url), init, calls.length); };
  f.calls = calls;
  return f;
}
const auth = (c) => (c.init.headers || {}).Authorization;

test('pick: merges the item with its reason and sends tz', async () => {
  const f = recorder(() => res(200, pickEnvelope('following')));
  const r = await loadPick(f, API, { tz: 'America/New_York' });
  assert.equal(r.error, null);
  assert.equal(r.pick.reason, 'following');
  assert.equal(r.pick.slug, feedRow.slug);
  assert.equal(new URL(f.calls[0].url).pathname, '/v1/public/world-vibe/pick');
  assert.equal(new URL(f.calls[0].url).searchParams.get('tz'), 'America/New_York');
});

test('pick: exclude list is comma separated and arrived_from is passed when it is a slug', async () => {
  const f = recorder(() => res(200, pickEnvelope('shared_link')));
  await loadPick(f, API, { exclude: ['a-1', 'b-2'], arrivedFrom: 'wv3-r2-named', tz: 'UTC' });
  const q = new URL(f.calls[0].url).searchParams;
  assert.equal(q.get('exclude'), 'a-1,b-2');
  assert.equal(q.get('arrived_from'), 'wv3-r2-named');
});

test('pick: a bad arrived_from is dropped, never sent (the route would 400 the whole pick)', async () => {
  for (const bad of ['Not A Slug', '../x', 'x'.repeat(101), '']) {
    const f = recorder(() => res(200, pickEnvelope('shared_link')));
    await loadPick(f, API, { arrivedFrom: bad });
    assert.equal(new URL(f.calls[0].url).searchParams.has('arrived_from'), false, JSON.stringify(bad));
  }
});

test('pick: no exclude param when the list is empty', async () => {
  const f = recorder(() => res(200, pickEnvelope('most_checked')));
  await loadPick(f, API, {});
  assert.equal(new URL(f.calls[0].url).searchParams.has('exclude'), false);
});

test('pick: bearer only when signed in', async () => {
  const f = recorder(() => res(200, pickEnvelope('following')));
  await loadPick(f, API, {});
  await loadPick(f, API, { token: 'tok' });
  assert.equal(auth(f.calls[0]), undefined);
  assert.equal(auth(f.calls[1]), 'Bearer tok');
});

test('pick: { item: null } is an empty state, not an error; HTTP failure and network failure are errors', async () => {
  assert.deepEqual(await loadPick(recorder(() => res(200, { item: null, reason: null })), API, {}), { pick: null, error: null });
  assert.deepEqual(await loadPick(recorder(() => res(500, {})), API, {}), { pick: null, error: 'unavailable' });
  assert.deepEqual(await loadPick(async () => { throw new TypeError('offline'); }, API, {}), { pick: null, error: 'unavailable' });
});

test('"Not this one" grows the exclude list in order, once per slug', () => {
  let ex = [];
  for (const s of ['a', 'b', 'c', 'b']) ex = extendExcludes(ex, s);
  assert.deepEqual(ex, ['a', 'c', 'b']);
});

test('the exclude list is capped at the 100 the route accepts, keeping the newest', () => {
  let ex = [];
  for (let i = 0; i < 130; i++) ex = extendExcludes(ex, 'item-' + i);
  assert.equal(ex.length, MAX_EXCLUDES);
  assert.equal(ex[ex.length - 1], 'item-129');
  assert.equal(ex[0], 'item-30');
});

test('progress: receipt is sent only with a bearer; slug is encoded', async () => {
  const f = recorder(() => res(200, progressEnvelope()));
  await loadProgress(f, API, 'wv3-r2-named', { receipt: '11111111-1111-4111-8111-111111111111', token: 'tok' });
  await loadProgress(f, API, 'wv3-r2-named', { receipt: '11111111-1111-4111-8111-111111111111', token: null });
  await loadProgress(f, API, 'wv3-r2-named', {});
  const [a, b, c] = f.calls;
  assert.equal(new URL(a.url).pathname, '/v1/public/world-vibe/items/wv3-r2-named/progress');
  assert.equal(new URL(a.url).searchParams.get('receipt'), '11111111-1111-4111-8111-111111111111');
  assert.equal(auth(a), 'Bearer tok');
  assert.equal(new URL(b.url).searchParams.has('receipt'), false);
  assert.equal(auth(b), undefined);
  assert.equal(new URL(c.url).search, '');
});

test('progress: returns the body with revealed_by_you and your_reading untouched; 404 and failure are errors', async () => {
  const body = progressEnvelope({ revealed_by_you: true, your_reading: 'aligned' });
  const r = await loadProgress(recorder(() => res(200, body)), API, 'x', { token: 't' });
  assert.deepEqual(r.progress, body);
  assert.equal((await loadProgress(recorder(() => res(404, {})), API, 'x', {})).error, 'not_found');
  assert.equal((await loadProgress(recorder(() => res(500, {})), API, 'x', {})).error, 'unavailable');
});

test('send to phone: no token means no request', async () => {
  const f = recorder(() => res(201, {}));
  assert.deepEqual(await sendToPhone(f, API, 'x', null), { status: 'signin' });
  assert.equal(f.calls.length, 0);
});

test('send to phone: POSTs to the item ask route with the bearer', async () => {
  const f = recorder(() => res(201, { request_id: 'rq-1', question: 'I feel ready for this', delivery: 'app_push', replayed: false }));
  const r = await sendToPhone(f, API, 'wv3-r2-named', 'tok');
  assert.deepEqual(r, { status: 'sent', requestId: 'rq-1', replayed: false });
  assert.equal(new URL(f.calls[0].url).pathname, '/v1/me/world-vibe/items/wv3-r2-named/ask');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(auth(f.calls[0]), 'Bearer tok');
});

test('send to phone: a replay (200) still returns the receipt', async () => {
  const r = await sendToPhone(recorder(() => res(200, { request_id: 'rq-1', question: 'q', delivery: 'app_push', replayed: true })), API, 'x', 't');
  assert.deepEqual(r, { status: 'sent', requestId: 'rq-1', replayed: true });
});

test('send to phone: every refusal maps to its own status', async () => {
  const cases = [[401, 'signin'], [422, 'link_required'], [429, 'rate_limited'], [409, 'pending'], [404, 'error'], [500, 'error']];
  for (const [code, status] of cases) assert.deepEqual(await sendToPhone(recorder(() => res(code, { error: 'x' })), API, 'x', 't'), { status }, String(code));
  assert.deepEqual(await sendToPhone(async () => { throw new TypeError('offline'); }, API, 'x', 't'), { status: 'error' });
});

test('share URL is the universal link with the slug', () => {
  assert.equal(shareUrlFor('wv3-r2-named'), 'https://go.somacheck.com/world-vibe/share/?item=wv3-r2-named');
});

const UUID = '22222222-2222-4222-8222-222222222222';
test('drafts: signed out makes no request', async () => {
  const f = recorder(() => res(200, {}));
  assert.deepEqual(await generateDrafts(f, API, { source: 'agent' }, null), { error: 'signin' });
  assert.equal(f.calls.length, 0);
});

test('drafts: agent source sends only the source; words source sends the words', async () => {
  const f = recorder(() => res(200, { drafts: [{ id: UUID, statement: 'I need a real break.' }] }));
  await generateDrafts(f, API, { source: 'agent', words: 'ignored' }, 'tok');
  await generateDrafts(f, API, { source: 'words', words: 'a deadline' }, 'tok');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { source: 'agent' });
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { source: 'words', words: 'a deadline' });
  assert.equal(new URL(f.calls[0].url).pathname, '/v1/me/vibecheck/drafts');
  assert.equal(auth(f.calls[0]), 'Bearer tok');
});

test('drafts: returns the drafts; 403 is consent_required; 422 differs by source; bad bodies are unavailable', async () => {
  const d = [{ id: UUID, statement: 'I need a real break.' }];
  assert.deepEqual(await generateDrafts(recorder(() => res(200, { drafts: d })), API, { source: 'agent' }, 't'), { drafts: d });
  assert.deepEqual(await generateDrafts(recorder(() => res(403, { error: 'consent_required' })), API, { source: 'agent' }, 't'), { error: 'consent_required' });
  assert.deepEqual(await generateDrafts(recorder(() => res(401, {})), API, { source: 'agent' }, 't'), { error: 'signin' });
  assert.deepEqual(await generateDrafts(recorder(() => res(422, {})), API, { source: 'agent' }, 't'), { error: 'no_context' });
  assert.deepEqual(await generateDrafts(recorder(() => res(422, {})), API, { source: 'words', words: 'x' }, 't'), { error: 'invalid_words' });
  assert.deepEqual(await generateDrafts(recorder(() => res(200, { drafts: [] })), API, { source: 'agent' }, 't'), { error: 'unavailable' });
  assert.deepEqual(await generateDrafts(recorder(() => res(502, {})), API, { source: 'agent' }, 't'), { error: 'unavailable' });
});

test('private ask: POSTs the draft id with the bearer; nothing is sent signed out', async () => {
  const f = recorder(() => res(201, { request_id: 'rq-9', source: 'world_vibe_private', status: 'pending' }));
  assert.deepEqual(await askPrivate(f, API, UUID, 'tok'), { status: 'sent', requestId: 'rq-9' });
  assert.equal(new URL(f.calls[0].url).pathname, '/v1/me/vibecheck/drafts/' + UUID + '/ask');
  const g = recorder(() => res(201, {}));
  assert.deepEqual(await askPrivate(g, API, UUID, null), { status: 'signin' });
  assert.equal(g.calls.length, 0);
  assert.deepEqual(await askPrivate(recorder(() => res(409, { error: 'ask_unavailable' })), API, UUID, 't'), { status: 'error' });
});

// A stateful stand-in for the owner-RLS user_context_consent table behind PostgREST.
function consentTable(userId) {
  let row = null;
  const f = recorder(async (u, init) => {
    assert.equal(u.pathname, '/rest/v1/user_context_consent');
    if (init.method === 'POST') {
      const b = JSON.parse(init.body);
      if (b.user_id !== userId) return res(403, {});
      row = { world_vibe_private: b.world_vibe_private };
      return res(201, [row]);
    }
    return res(200, row ? [row] : []);
  });
  return f;
}
const sess = (token = 'tok') => ({ supabaseUrl: 'https://sb.test', publishableKey: 'sb_publishable_k', getAccessToken: () => token, userId: () => 'u-1' });

test('consent toggle round-trips: off by default, on after set, readable back, off again', async () => {
  const f = consentTable('u-1');
  assert.deepEqual(await getConsent(f, sess()), { consent: false, error: null });
  assert.deepEqual(await setConsent(f, sess(), true), { consent: true, error: null });
  assert.deepEqual(await getConsent(f, sess()), { consent: true, error: null });
  assert.deepEqual(await setConsent(f, sess(), false), { consent: false, error: null });
  assert.deepEqual(await getConsent(f, sess()), { consent: false, error: null });
});

test('consent requests carry the publishable key, the bearer and the somacheck_engine profile; the row is upserted by user_id', async () => {
  const f = consentTable('u-1');
  await setConsent(f, sess(), true);
  await getConsent(f, sess());
  const [w, r] = f.calls;
  assert.equal(w.init.headers.apikey, 'sb_publishable_k');
  assert.equal(w.init.headers.Authorization, 'Bearer tok');
  assert.equal(w.init.headers['Content-Profile'], 'somacheck_engine');
  assert.match(w.init.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(new URL(w.url).searchParams.get('on_conflict'), 'user_id');
  assert.deepEqual(Object.keys(JSON.parse(w.init.body)).sort(), ['updated_at', 'user_id', 'world_vibe_private']);
  assert.equal(r.init.headers['Accept-Profile'], 'somacheck_engine');
  assert.equal(new URL(r.url).searchParams.get('select'), 'world_vibe_private');
});

test('consent: signed out makes no request; 401 and failures are reported', async () => {
  const f = consentTable('u-1');
  assert.deepEqual(await getConsent(f, sess(null)), { consent: null, error: 'signin' });
  assert.deepEqual(await setConsent(f, sess(null), true), { consent: null, error: 'signin' });
  assert.equal(f.calls.length, 0);
  assert.equal((await getConsent(recorder(() => res(401, {})), sess())).error, 'signin');
  assert.equal((await setConsent(recorder(() => res(500, {})), sess(), true)).error, 'unavailable');
  assert.equal((await getConsent(async () => { throw new TypeError('offline'); }, sess())).error, 'unavailable');
});

test('consent: a write the table refuses never reads back as on', async () => {
  const f = consentTable('someone-else');
  const r = await setConsent(f, sess(), true);
  assert.equal(r.consent, null);
  assert.equal(r.error, 'unavailable');
});

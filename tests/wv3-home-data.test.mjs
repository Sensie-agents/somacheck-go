// Home data layer against the captured statement-api responses
// (tests/helpers/captured.mjs). Variants spread a captured body and override only
// the field a test is about; refusals with no capture carry only a status.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extendExcludes, loadPick, loadProgress, sendToPhone, generateDrafts, askPrivate, getConsent, setConsent, loadPhoneLinked, loadItem, itemSlugFromSearch, shareUrlFor, MAX_EXCLUDES } from '../world-vibe/home/home-data.js';
import { pickEnvelope, progressEnvelope, feedRow, consentBody, phoneBody, itemRow, pickSignedIn, pickAnon, createV3, sendOk, sendLinkRequired, draftsCreate, draftsConsentRequired, privateAsk, pickEmpty, refusal } from './helpers/captured.mjs';

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
  assert.equal(r.pick.slug, pickSignedIn.item.slug);
  assert.equal(new URL(f.calls[0].url).pathname, '/v1/public/world-vibe/pick');
  assert.equal(new URL(f.calls[0].url).searchParams.get('tz'), 'America/New_York');
});

test('pick: the anonymous capture (shared_link) is merged and sent without a bearer', async () => {
  const f = recorder(() => res(pickAnon.status, pickAnon.body));
  const r = await loadPick(f, API, { arrivedFrom: pickAnon.body.item.slug });
  assert.deepEqual(r, { pick: { ...pickAnon.body.item, reason: 'shared_link' }, error: null });
  assert.equal(auth(f.calls[0]), undefined);
  assert.equal(new URL(f.calls[0].url).searchParams.get('arrived_from'), pickAnon.body.item.slug);
});

test('the created item\'s share_url is the QR landing the home page builds and reads back', () => {
  const { slug, share_url } = createV3.body;
  assert.equal(shareUrlFor(slug), share_url);
  assert.equal(itemSlugFromSearch(new URL(share_url).search), slug);
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
  assert.deepEqual(await loadPick(recorder(() => res(pickEmpty.status, pickEmpty.body)), API, {}), { pick: null, error: null });
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
  const gone = refusal('progress_404');
  assert.equal((await loadProgress(recorder(() => res(gone.status, gone.body)), API, 'x', {})).error, 'not_found');
  assert.equal((await loadProgress(recorder(() => res(500, {})), API, 'x', {})).error, 'unavailable');
});

test('send to phone: no token means no request', async () => {
  const f = recorder(() => res(201, {}));
  assert.deepEqual(await sendToPhone(f, API, 'x', null), { status: 'signin' });
  assert.equal(f.calls.length, 0);
});

test('send to phone: POSTs to the item ask route with the bearer', async () => {
  const f = recorder(() => res(sendOk.status, sendOk.body));
  const r = await sendToPhone(f, API, 'wv3-r2-named', 'tok');
  assert.deepEqual(r, { status: 'sent', requestId: sendOk.body.request_id, replayed: false });
  assert.equal(new URL(f.calls[0].url).pathname, '/v1/me/world-vibe/items/wv3-r2-named/ask');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(auth(f.calls[0]), 'Bearer tok');
});

test('send to phone: a replay (200) still returns the receipt', async () => {
  const r = await sendToPhone(recorder(() => res(200, { ...sendOk.body, replayed: true })), API, 'x', 't');
  assert.deepEqual(r, { status: 'sent', requestId: sendOk.body.request_id, replayed: true });
});

test('send to phone: every refusal maps to its own status', async () => {
  assert.deepEqual(await sendToPhone(recorder(() => res(sendLinkRequired.status, sendLinkRequired.body)), API, 'x', 't'), { status: 'link_required' });
  // 401, 429, 409 and 404 are replayed from their captures (status and body); 500 is transport and carries no body.
  for (const [name, status] of [['ask_401', 'signin'], ['ask_429', 'rate_limited'], ['ask_409', 'pending'], ['ask_404', 'error']]) {
    const c = refusal(name);
    assert.deepEqual(await sendToPhone(recorder(() => res(c.status, c.body)), API, 'x', 't'), { status }, name);
  }
  assert.deepEqual(await sendToPhone(recorder(() => res(500, {})), API, 'x', 't'), { status: 'error' }, '500');
  assert.deepEqual(await sendToPhone(async () => { throw new TypeError('offline'); }, API, 'x', 't'), { status: 'error' });
});

test('share URL is the universal link with the slug', () => {
  assert.equal(shareUrlFor('wv3-r2-named'), 'https://go.somacheck.com/world-vibe/share/?item=wv3-r2-named');
});

test('drafts: signed out makes no request', async () => {
  const f = recorder(() => res(200, {}));
  assert.deepEqual(await generateDrafts(f, API, { source: 'agent' }, null), { error: 'signin' });
  assert.equal(f.calls.length, 0);
});

test('drafts: agent source sends only the source; words source sends the words', async () => {
  const f = recorder(() => res(draftsCreate.status, draftsCreate.body));
  await generateDrafts(f, API, { source: 'agent', words: 'ignored' }, 'tok');
  await generateDrafts(f, API, { source: 'words', words: 'a deadline' }, 'tok');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { source: 'agent' });
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { source: 'words', words: 'a deadline' });
  assert.equal(new URL(f.calls[0].url).pathname, '/v1/me/vibecheck/drafts');
  assert.equal(auth(f.calls[0]), 'Bearer tok');
});

test('drafts: returns the drafts; 403 is consent_required; 422 differs by source; bad bodies are unavailable', async () => {
  const d = draftsCreate.body.drafts;
  assert.deepEqual(await generateDrafts(recorder(() => res(draftsCreate.status, draftsCreate.body)), API, { source: 'agent' }, 't'), { drafts: d });
  assert.deepEqual(await generateDrafts(recorder(() => res(draftsConsentRequired.status, draftsConsentRequired.body)), API, { source: 'agent' }, 't'), { error: 'consent_required' });
  const d401 = refusal('drafts_401'), noCtx = refusal('drafts_422_no_context'), badWords = refusal('drafts_422_invalid_words');
  assert.deepEqual(await generateDrafts(recorder(() => res(d401.status, d401.body)), API, { source: 'agent' }, 't'), { error: 'signin' });
  assert.deepEqual(await generateDrafts(recorder(() => res(noCtx.status, noCtx.body)), API, { source: 'agent' }, 't'), { error: 'no_context' });
  assert.deepEqual(await generateDrafts(recorder(() => res(badWords.status, badWords.body)), API, { source: 'words', words: 'x' }, 't'), { error: 'invalid_words' });
  assert.deepEqual(await generateDrafts(recorder(() => res(200, { ...draftsCreate.body, drafts: [] })), API, { source: 'agent' }, 't'), { error: 'unavailable' });
  assert.deepEqual(await generateDrafts(recorder(() => res(502, {})), API, { source: 'agent' }, 't'), { error: 'unavailable' });
});

const UUID = draftsCreate.body.drafts[0].id;
test('private ask: POSTs the draft id with the bearer; nothing is sent signed out', async () => {
  const f = recorder(() => res(privateAsk.status, privateAsk.body));
  assert.deepEqual(await askPrivate(f, API, UUID, 'tok'), { status: 'sent', requestId: privateAsk.body.request_id });
  assert.equal(privateAsk.status, 201);
  assert.equal(new URL(f.calls[0].url).pathname, '/v1/me/vibecheck/drafts/' + UUID + '/ask');
  const g = recorder(() => res(privateAsk.status, privateAsk.body));
  assert.deepEqual(await askPrivate(g, API, UUID, null), { status: 'signin' });
  assert.equal(g.calls.length, 0);
  for (const name of ['private_ask_409', 'private_ask_404']) {
    const c = refusal(name);
    assert.deepEqual(await askPrivate(recorder(() => res(c.status, c.body)), API, UUID, 't'), { status: 'error' }, name);
  }
  const u = refusal('private_ask_401');
  assert.deepEqual(await askPrivate(recorder(() => res(u.status, u.body)), API, UUID, 't'), { status: 'signin' });
});

// The private ask 201 is a capture, so the replay above is the contract and this is permanent.
test('private ask replay uses its dedicated capture', () => {
  assert.equal(privateAsk.status, 201);
  assert.deepEqual(Object.keys(privateAsk.body).sort(), ['request_id', 'source', 'status']);
});

// A stateful stand-in for the consent route: the flag is per bearer and nobody else's is readable.
function consentRoute() {
  const flags = new Map();
  return recorder(async (u, init) => {
    assert.equal(u.pathname, '/v1/me/world-vibe/consent');
    const who = (init.headers || {}).Authorization;
    if (!who) { const c = refusal('consent_get_401'); return res(c.status, c.body); }
    if (init.method === 'PUT') { flags.set(who, JSON.parse(init.body).world_vibe_private === true); return res(200, consentBody(flags.get(who))); }
    return res(200, consentBody(flags.get(who) === true));
  });
}

test('consent toggle round-trips through the API: off by default, on after PUT, readable back, off again', async () => {
  const f = consentRoute();
  assert.deepEqual(await getConsent(f, API, 'tok'), { consent: false, error: null });
  assert.deepEqual(await setConsent(f, API, 'tok', true), { consent: true, error: null });
  assert.deepEqual(await getConsent(f, API, 'tok'), { consent: true, error: null });
  assert.deepEqual(await setConsent(f, API, 'tok', false), { consent: false, error: null });
  assert.deepEqual(await getConsent(f, API, 'tok'), { consent: false, error: null });
  assert.deepEqual(await getConsent(f, API, 'someone-else'), { consent: false, error: null });
});

test('consent requests: GET and PUT on the consent route with the bearer, a boolean-only body, and no database access', async () => {
  const f = consentRoute();
  await setConsent(f, API, 'tok', true);
  await getConsent(f, API, 'tok');
  const [w, r] = f.calls;
  assert.equal(w.init.method, 'PUT');
  assert.equal(w.url, API + '/v1/me/world-vibe/consent');
  assert.equal(auth(w), 'Bearer tok');
  assert.deepEqual(JSON.parse(w.init.body), { world_vibe_private: true });
  assert.equal(r.url, API + '/v1/me/world-vibe/consent');
  assert.equal(auth(r), 'Bearer tok');
  for (const c of f.calls) {
    assert.doesNotMatch(c.url, /\/rest\/v1|somacheck_engine/);
    assert.equal((c.init.headers || {}).apikey, undefined);
    assert.equal((c.init.headers || {})['Accept-Profile'], undefined);
  }
});

test('consent: signed out makes no request; 401 and failures are reported; a body without the boolean is not a yes', async () => {
  const f = consentRoute();
  assert.deepEqual(await getConsent(f, API, null), { consent: null, error: 'signin' });
  assert.deepEqual(await setConsent(f, API, null, true), { consent: null, error: 'signin' });
  assert.equal(f.calls.length, 0);
  const cg = refusal('consent_get_401'), cp = refusal('consent_put_401');
  assert.equal((await getConsent(recorder(() => res(cg.status, cg.body)), API, 'tok')).error, 'signin');
  assert.equal((await setConsent(recorder(() => res(cp.status, cp.body)), API, 'tok', true)).error, 'signin');
  assert.equal((await setConsent(recorder(() => res(500, {})), API, 'tok', true)).error, 'unavailable');
  assert.equal((await getConsent(async () => { throw new TypeError('offline'); }, API, 'tok')).error, 'unavailable');
  assert.deepEqual(await getConsent(recorder(() => res(200, {})), API, 'tok'), { consent: null, error: 'unavailable' });
  assert.deepEqual(await setConsent(recorder(() => res(200, consentBody('yes'))), API, 'tok', true), { consent: null, error: 'unavailable' });
});

test('phone link: linked only when the route says linked === true; every other answer is not linked; signed out sends nothing', async () => {
  const f = recorder(() => res(200, phoneBody(true)));
  assert.equal(await loadPhoneLinked(f, API, 'tok'), true);
  assert.equal(f.calls[0].url, API + '/v1/me/world-vibe/phone');
  assert.equal(auth(f.calls[0]), 'Bearer tok');
  assert.equal(await loadPhoneLinked(recorder(() => res(200, phoneBody(false))), API, 'tok'), false);
  assert.equal(await loadPhoneLinked(recorder(() => res(200, { ...phoneBody(true), linked: 'true' })), API, 'tok'), false);
  const p401 = refusal('phone_401');
  assert.equal(await loadPhoneLinked(recorder(() => res(p401.status, p401.body)), API, 'tok'), false);
  assert.equal(await loadPhoneLinked(recorder(() => res(500, {})), API, 'tok'), false);
  assert.equal(await loadPhoneLinked(async () => { throw new TypeError('offline'); }, API, 'tok'), false);
  const g = recorder(() => res(200, phoneBody(true)));
  assert.equal(await loadPhoneLinked(g, API, null), false);
  assert.equal(g.calls.length, 0);
});

test('item route: loads the captured item by slug; unknown, malformed or mismatched slugs are an honest not found or unavailable', async () => {
  const body = itemRow();
  const f = recorder(() => res(200, body));
  assert.deepEqual(await loadItem(f, API, body.slug), { item: body, error: null });
  assert.equal(f.calls[0].url, API + '/v1/public/world-vibe/items/' + body.slug);
  assert.equal((f.calls[0].init.headers || {}).Authorization, undefined);
  const i404 = refusal('item_404');
  assert.deepEqual(await loadItem(recorder(() => res(i404.status, i404.body)), API, 'gone-item'), { item: null, error: 'not_found' });
  assert.deepEqual(await loadItem(recorder(() => res(500, {})), API, 'x-1'), { item: null, error: 'unavailable' });
  assert.deepEqual(await loadItem(recorder(() => res(200, body)), API, 'other-slug'), { item: null, error: 'unavailable' });
  for (const bad of [null, '', 'Not A Slug', '../x', 'x'.repeat(101)]) {
    const g = recorder(() => res(200, body));
    assert.deepEqual(await loadItem(g, API, bad), { item: null, error: 'not_found' }, JSON.stringify(bad));
    assert.equal(g.calls.length, 0);
  }
});

test('the QR landing reads exactly one valid item slug from the query', () => {
  assert.equal(itemSlugFromSearch('?item=wv3-r2-named'), 'wv3-r2-named');
  for (const bad of ['', '?item=', '?item=A', '?item=a&item=b', '?x=1', '?item=../x', '?item=' + 'a'.repeat(101)]) assert.equal(itemSlugFromSearch(bad), null, bad);
});

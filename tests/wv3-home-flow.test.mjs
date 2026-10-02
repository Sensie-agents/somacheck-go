// Lifecycle of the home flow with held responses: sign-out, consent scope and
// lane switches while requests are in flight. Bodies are built around the
// captured rows (tests/helpers/captured.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlow } from '../world-vibe/home/home-flow.js';
import { pickEnvelope, progressEnvelope, consentBody, phoneBody } from './helpers/captured.mjs';

const API = 'https://api.test';
const RECEIPT = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A router whose responses can be held and released by hand.
function harness({ routes = {}, signedIn = true } = {}) {
  let token = signedIn ? 'tok' : null;
  const calls = [];
  const held = [];
  const fetchFn = (url, init = {}) => {
    const u = new URL(url);
    const key = (init.method || 'GET') + ' ' + u.pathname;
    calls.push({ key, url: String(url), init });
    const route = routes[key];
    const out = typeof route === 'function' ? route(init, u) : route;
    if (out && out.hold) return new Promise((resolve) => held.push({ key, release: () => resolve(out.hold) }));
    return Promise.resolve(out || res(404, {}));
  };
  const events = [];
  const ui = {
    render: () => events.push('render'), focusCard: () => {}, openCheck: () => events.push('open'), refreshCheck: () => events.push('refresh'),
    closeCheck: () => events.push('closeCheck'), closePersonal: () => events.push('closePersonal'), note: () => {}, focusConsent: () => {},
    signOut: async () => { token = null; flow.signedOut(); }
  };
  const timers = [];
  const flow = createFlow({ api: API, fetchFn, getToken: () => token, ui, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const release = async (key) => { const h = held.filter((x) => x.key === key); h.forEach((x) => x.release()); await new Promise((r) => setTimeout(r, 0)); };
  return { flow, st: flow.st, calls, events, timers, release, signOut: () => { token = null; flow.signedOut(); }, count: (key) => calls.filter((c) => c.key === key).length };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const PICK = pickEnvelope('following', { slug: 'pick-one', statement: 'I trust my gut over my dashboard.' });
const base = { 'GET /v1/public/world-vibe/pick': res(200, PICK) };

test('sign-out clears the own reading, the receipt and every other piece of personal state', async () => {
  const h = harness({ routes: {
    ...base,
    'GET /v1/me/world-vibe/phone': res(200, phoneBody(true)),
    'POST /v1/me/world-vibe/items/pick-one/ask': res(201, { request_id: RECEIPT, question: 'q', delivery: 'app_push', replayed: false }),
    'GET /v1/public/world-vibe/items/pick-one/progress': res(200, progressEnvelope({ slug: 'pick-one', revealed_by_you: true, your_reading: 'aligned' })),
    'GET /v1/me/world-vibe/consent': res(200, consentBody(true))
  } });
  await h.flow.showPick();
  await h.flow.openCheck();
  await h.flow.sendShared();
  assert.equal(h.st.receipt, RECEIPT);
  assert.equal(await h.flow.checkProgress(), true);
  assert.equal(h.st.progress.your_reading, 'aligned');
  h.st.drafts = [{ id: DRAFT, statement: 'I need a real break.' }]; h.st.generated = true;
  await h.flow.loadConsent();
  assert.equal(h.st.consent, true);

  h.signOut();
  assert.equal(h.st.progress, null);
  assert.equal(h.st.phase, 'card');
  assert.equal(h.st.receipt, null);
  assert.deepEqual(h.st.drafts, []);
  assert.equal(h.st.generated, false);
  assert.equal(h.st.consent, null);
  assert.equal(h.st.phoneLinked, null);
  assert.equal(h.st.sent, false);
  assert.ok(h.events.includes('closePersonal'));
});

test('responses that resolve after sign-out are dropped: private drafts, consent, progress, phone link', async () => {
  const h = harness({ routes: {
    ...base,
    'POST /v1/me/vibecheck/drafts': { hold: res(200, { drafts: [{ id: DRAFT, statement: 'I need a real break.' }] }) },
    'GET /v1/me/world-vibe/consent': { hold: res(200, consentBody(true)) },
    'GET /v1/me/world-vibe/phone': { hold: res(200, phoneBody(true)) },
    'GET /v1/public/world-vibe/items/pick-one/progress': { hold: res(200, progressEnvelope({ slug: 'pick-one', revealed_by_you: true, your_reading: 'unaligned' })) }
  } });
  await h.flow.showPick();
  h.flow.selectLane('private');           // starts the consent load
  h.st.consent = true; h.st.pctx = 'words';
  const gen = h.flow.generate('a deadline'); await flush();
  h.flow.selectLane('shared');
  const opened = h.flow.openCheck(); await flush();
  const prog = h.flow.checkProgress(); await flush();
  h.signOut();
  for (const k of ['POST /v1/me/vibecheck/drafts', 'GET /v1/me/world-vibe/consent', 'GET /v1/me/world-vibe/phone', 'GET /v1/public/world-vibe/items/pick-one/progress']) await h.release(k);
  await Promise.all([gen, opened, prog]);
  assert.deepEqual(h.st.drafts, []);
  assert.equal(h.st.generated, false);
  assert.equal(h.st.consent, null);
  assert.equal(h.st.phoneLinked, null);
  assert.equal(h.st.progress, null);
  assert.equal(h.st.phase, 'card');
});

test('consent off: "A few words from me" generates; the agent source never reaches the route', async () => {
  const h = harness({ routes: { ...base, 'POST /v1/me/vibecheck/drafts': res(200, { drafts: [{ id: DRAFT, statement: 'I need a real break.' }] }) } });
  h.st.consent = false;
  h.st.pctx = 'agent';
  await h.flow.generate('');
  assert.equal(h.st.perror, 'consent_required');
  assert.equal(h.count('POST /v1/me/vibecheck/drafts'), 0);
  h.st.pctx = 'words';
  await h.flow.generate('  a deadline  ');
  assert.equal(h.count('POST /v1/me/vibecheck/drafts'), 1);
  assert.deepEqual(JSON.parse(h.calls.find((c) => c.key === 'POST /v1/me/vibecheck/drafts').init.body), { source: 'words', words: 'a deadline' });
  assert.equal(h.st.generated, true);
  assert.equal(h.st.drafts[0].id, DRAFT);
  assert.equal(h.st.perror, null);
});

test('words with nothing typed is not sent, with consent on or off', async () => {
  const h = harness({ routes: base });
  h.st.pctx = 'words';
  for (const consent of [false, true, null]) { h.st.consent = consent; await h.flow.generate('   '); assert.equal(h.st.perror, 'empty_words'); }
  assert.equal(h.count('POST /v1/me/vibecheck/drafts'), 0);
});

test('a 403 consent_required on the agent source turns the local flag off', async () => {
  const h = harness({ routes: { ...base, 'POST /v1/me/vibecheck/drafts': res(403, { error: 'consent_required' }) } });
  h.st.consent = true; h.st.pctx = 'agent';
  await h.flow.generate('');
  assert.equal(h.st.consent, false);
  assert.equal(h.st.perror, 'consent_required');
});

test('lane switch mid-poll: a shared result never labels a private draft as saved', async () => {
  const progressBody = progressEnvelope({ slug: 'pick-one', revealed_by_you: true, your_reading: 'aligned' });
  const h = harness({ routes: {
    ...base,
    'POST /v1/me/world-vibe/items/pick-one/ask': res(201, { request_id: RECEIPT, question: 'q', delivery: 'app_push', replayed: false }),
    'GET /v1/public/world-vibe/items/pick-one/progress': { hold: res(200, progressBody) },
    'POST /v1/me/vibecheck/drafts': res(200, { drafts: [{ id: DRAFT, statement: 'I need a real break.' }] })
  } });
  await h.flow.showPick();
  await h.flow.sendShared();
  assert.equal(h.timers.length, 1);
  const tick = h.timers[0]();               // the poll asks for progress; the answer is held
  await flush();
  h.flow.selectLane('private');
  h.st.consent = true; h.st.pctx = 'words';
  await h.flow.generate('a deadline');
  assert.equal(h.st.generated, true);
  await h.release('GET /v1/public/world-vibe/items/pick-one/progress');
  await tick;
  assert.equal(h.st.lane, 'private');
  assert.equal(h.st.phase, 'card', 'the private card must not be put in the done state');
  assert.equal(h.st.progress, null);
  assert.equal(h.st.drafts[0].id, DRAFT);
});

test('moving to another item mid-poll drops the old item\'s progress', async () => {
  const h = harness({ routes: {
    'GET /v1/public/world-vibe/pick': (init, u) => res(200, u.searchParams.get('exclude') ? pickEnvelope('most_checked', { slug: 'pick-two', statement: 'I feel ready for Monday.' }) : PICK),
    'POST /v1/me/world-vibe/items/pick-one/ask': res(201, { request_id: RECEIPT, question: 'q', delivery: 'app_push', replayed: false }),
    'GET /v1/public/world-vibe/items/pick-one/progress': { hold: res(200, progressEnvelope({ slug: 'pick-one' })) }
  } });
  await h.flow.showPick();
  await h.flow.sendShared();
  const tick = h.timers[0](); await flush();
  await h.flow.skip();
  assert.equal(h.st.pick.slug, 'pick-two');
  await h.release('GET /v1/public/world-vibe/items/pick-one/progress');
  await tick;
  assert.equal(h.st.phase, 'card');
  assert.equal(h.st.progress, null);
  assert.equal(h.st.receipt, null);
});

test('a private ask that resolves after a lane switch does not touch the shared sheet state', async () => {
  const h = harness({ routes: { ...base, ['POST /v1/me/vibecheck/drafts/' + DRAFT + '/ask']: { hold: res(201, { request_id: 'rq-9', source: 'world_vibe_private', status: 'pending' }) } } });
  await h.flow.showPick();
  h.flow.selectLane('private');
  h.st.drafts = [{ id: DRAFT, statement: 'I need a real break.' }]; h.st.generated = true;
  const send = h.flow.sendPrivate(); await flush();
  h.flow.selectLane('shared');
  await h.release('POST /v1/me/vibecheck/drafts/' + DRAFT + '/ask');
  await send;
  assert.equal(h.st.sent, false);
});

test('Send to my phone: a 422 link_required after the route said linked falls back to the QR', async () => {
  const h = harness({ routes: {
    ...base,
    'GET /v1/me/world-vibe/phone': res(200, phoneBody(true)),
    'POST /v1/me/world-vibe/items/pick-one/ask': res(422, { error: 'link_required' })
  } });
  await h.flow.showPick();
  await h.flow.openCheck();
  assert.equal(h.st.phoneLinked, true);
  await h.flow.sendShared();
  assert.equal(h.st.phoneLinked, false);
  assert.equal(h.st.linkRequired, true);
});

test('signed out: nothing personal is requested while opening the check sheet', async () => {
  const h = harness({ routes: base, signedIn: false });
  await h.flow.showPick();
  await h.flow.openCheck();
  assert.equal(h.count('GET /v1/me/world-vibe/phone'), 0);
  assert.equal(h.st.phoneLinked, null);
  assert.ok(h.calls.every((c) => !(c.init.headers || {}).Authorization));
});

// One test per async path for the stale guards (see the mutant table in the
// WP12 receipt): each drops its response when sign-out, the lane, the item or a
// newer request got there first.
const PICK2 = pickEnvelope('most_checked', { slug: 'pick-two', statement: 'I feel ready for Monday.' });
const ASK1 = 'POST /v1/me/world-vibe/items/pick-one/ask';
const PROGRESS1 = 'GET /v1/public/world-vibe/items/pick-one/progress';
const CONSENT_GET = 'GET /v1/me/world-vibe/consent';
const CONSENT_PUT = 'PUT /v1/me/world-vibe/consent';
const DRAFTS = 'POST /v1/me/vibecheck/drafts';
const sent = res(201, { request_id: RECEIPT, question: 'q', delivery: 'app_push', replayed: false });

test('pick: an older pick response arriving after a newer one is dropped', async () => {
  let n = 0;
  const h = harness({ routes: { 'GET /v1/public/world-vibe/pick': () => (++n === 1 ? { hold: res(200, PICK) } : res(200, PICK2)) } });
  const first = h.flow.showPick(); await flush();
  await h.flow.showPick();
  assert.equal(h.st.pick.slug, 'pick-two');
  await h.release('GET /v1/public/world-vibe/pick');
  await first;
  assert.equal(h.st.pick.slug, 'pick-two', 'the stale pick does not replace the newer one');
});

test('pick: a pick that resolves after sign-out is dropped', async () => {
  const h = harness({ routes: { 'GET /v1/public/world-vibe/pick': { hold: res(200, PICK) } } });
  const loading = h.flow.showPick(); await flush();
  h.signOut();
  await h.release('GET /v1/public/world-vibe/pick');
  await loading;
  assert.equal(h.st.pick, null);
});

test('consent read: a delayed GET never overwrites a newer successful PUT', async () => {
  const h = harness({ routes: { ...base, [CONSENT_GET]: { hold: res(200, consentBody(true)) }, [CONSENT_PUT]: res(200, consentBody(false)) } });
  h.st.consent = null;
  h.flow.selectLane('private'); await flush();       // GET in flight, answer will say true
  await h.flow.toggleConsent(false);                 // the person turns it off; the PUT wins
  assert.equal(h.st.consent, false);
  await h.release(CONSENT_GET);
  assert.equal(h.st.consent, false, 'the older read must not switch consent back on');
});

test('consent write: a PUT that resolves after sign-out is dropped', async () => {
  const h = harness({ routes: { ...base, [CONSENT_PUT]: { hold: res(200, consentBody(true)) } } });
  const writing = h.flow.toggleConsent(true); await flush();
  h.signOut();
  await h.release(CONSENT_PUT);
  await writing;
  assert.equal(h.st.consent, null);
});

test('consent write: of two writes the newer one decides, even when the older resolves last', async () => {
  const gates = [];
  const h = harness({ routes: { ...base, [CONSENT_PUT]: () => new Promise((resolve) => gates.push(resolve)) } });
  const a = h.flow.toggleConsent(true); await flush();
  const b = h.flow.toggleConsent(false); await flush();
  gates[1](res(200, consentBody(false))); await flush();   // the newer write answers first
  gates[0](res(200, consentBody(true))); await flush();    // the older one lands late
  await Promise.all([a, b]);
  assert.equal(h.st.consent, false);
});

test('shared send: a send that resolves after the item moved on does not set the receipt or start polling', async () => {
  const h = harness({ routes: {
    'GET /v1/public/world-vibe/pick': (init, u) => res(200, u.searchParams.get('exclude') ? PICK2 : PICK),
    [ASK1]: { hold: sent }
  } });
  await h.flow.showPick();
  const sending = h.flow.sendShared(); await flush();
  await h.flow.skip();
  await h.release(ASK1);
  await sending;
  assert.equal(h.st.receipt, null);
  assert.equal(h.st.sent, false);
  assert.equal(h.timers.length, 0, 'no poll starts for an abandoned item');
});

test('shared send: a send that resolves after sign-out does not set the receipt or start polling', async () => {
  const h = harness({ routes: { ...base, [ASK1]: { hold: sent } } });
  await h.flow.showPick();
  const sending = h.flow.sendShared(); await flush();
  h.signOut();
  await h.release(ASK1);
  await sending;
  assert.equal(h.st.receipt, null);
  assert.equal(h.st.sent, false);
  assert.equal(h.timers.length, 0);
});

test('poll: a tick that fires after sign-out asks for nothing', async () => {
  const h = harness({ routes: { ...base, [ASK1]: sent, [PROGRESS1]: res(200, progressEnvelope({ slug: 'pick-one' })) } });
  await h.flow.showPick();
  await h.flow.sendShared();
  assert.equal(h.timers.length, 1);
  h.signOut();
  await h.timers[0]();
  assert.equal(h.count(PROGRESS1), 0);
  assert.equal(h.timers.length, 1, 'the dead poll does not reschedule');
});

test('progress: a response that resolves after the lane moved to private is dropped', async () => {
  const h = harness({ routes: { ...base, [ASK1]: sent, [PROGRESS1]: { hold: res(200, progressEnvelope({ slug: 'pick-one', revealed_by_you: true, your_reading: 'aligned' })) } } });
  await h.flow.showPick();
  await h.flow.sendShared();
  const checking = h.flow.checkProgress(); await flush();
  h.flow.selectLane('private');
  await h.release(PROGRESS1);
  assert.equal(await checking, false);
  assert.equal(h.st.progress, null);
  assert.equal(h.st.phase, 'card');
});

test('drafts: a generate that resolves after the lane moved on does not store the drafts', async () => {
  const h = harness({ routes: { ...base, [DRAFTS]: { hold: res(200, { drafts: [{ id: DRAFT, statement: 'I need a real break.' }] }) } } });
  await h.flow.showPick();
  h.flow.selectLane('private');
  h.st.consent = true; h.st.pctx = 'words';
  const generating = h.flow.generate('a deadline'); await flush();
  h.flow.selectLane('shared');
  await h.release(DRAFTS);
  await generating;
  assert.deepEqual(h.st.drafts, []);
  assert.equal(h.st.generated, false);
});

test('private ask: an ask that resolves after sign-out does not mark the line sent', async () => {
  const ASK = 'POST /v1/me/vibecheck/drafts/' + DRAFT + '/ask';
  const h = harness({ routes: { ...base, [ASK]: { hold: res(201, { request_id: 'rq-9', source: 'world_vibe_private', status: 'pending' }) } } });
  await h.flow.showPick();
  h.flow.selectLane('private');
  h.st.drafts = [{ id: DRAFT, statement: 'I need a real break.' }]; h.st.generated = true;
  const asking = h.flow.sendPrivate(); await flush();
  h.signOut();
  await h.release(ASK);
  await asking;
  assert.equal(h.st.sent, false);
  assert.equal(h.st.sendError, null);
});

test('poll: a tick that fires after a lane switch ends the poll instead of rescheduling', async () => {
  const h = harness({ routes: { ...base, [ASK1]: sent, [PROGRESS1]: res(200, progressEnvelope({ slug: 'pick-one' })) } });
  await h.flow.showPick();
  await h.flow.sendShared();
  assert.equal(h.timers.length, 1);
  h.flow.selectLane('private');
  await h.timers[0]();
  assert.equal(h.count(PROGRESS1), 0);
  assert.equal(h.timers.length, 1, 'a poll from the shared lane does not keep ticking in the private lane');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, safeNext, SESSION_KEY } from '../world-vibe/session.js';
import { loadFollowing } from '../world-vibe/explore/explore-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'sb_publishable_test_key';
const SB = 'https://sb.test';
const NOW = 1_800_000_000_000;

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
// A GoTrue stand-in that records every request. Responses are the shapes GoTrue documents.
function gotrue({ otp = 200, token = 200, refresh = 200, logout = 204, verify = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    const u = new URL(url);
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u.pathname === '/auth/v1/otp') return json(otp, {});
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'pkce') return json(token, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, user: { id: 'u-1', email: 'me@x.test' } });
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') return json(refresh, { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 });
    if (u.pathname === '/auth/v1/logout') return json(logout, {});
    if (u.pathname === '/auth/v1/verify') return json(verify, { access_token: 'access-c', refresh_token: 'refresh-c', expires_in: 3600, user: { id: 'u-1', email: 'me@x.test' } });
    return json(404, {});
  };
  f.calls = calls;
  return f;
}
const make = (over = {}) => {
  const storage = memory();
  const fetch = over.fetch || gotrue();
  const s = createSession({ fetch, storage, supabaseUrl: SB, publishableKey: KEY, origin: 'https://go.test', crypto: globalThis.crypto, now: () => NOW, ...over });
  return { s, storage, fetch };
};
const signedIn = async (over) => {
  const ctx = make(over);
  await ctx.s.signIn('me@x.test');
  const r = await ctx.s.completeSignIn('?code=abc&next=%2Fworld-vibe%2F');
  assert.equal(r.ok, true);
  return ctx;
};

test('signed out: getAccessToken is null and no request carries a bearer', async () => {
  const { s, fetch } = make();
  assert.equal(s.getAccessToken(), null);
  const calls = [];
  const spy = async (u, i) => { calls.push(i || {}); return { ok: true, status: 200, json: async () => ({ items: [] }) }; };
  await loadFollowing(spy, 'https://api.test', () => s.getAccessToken());
  assert.equal(calls.length, 0, 'following makes no request without a token');
  assert.equal(fetch.calls.length, 0);
});

test('signed in: getAccessToken returns the bearer and following sends it', async () => {
  const { s } = await signedIn();
  assert.equal(s.getAccessToken(), 'access-1');
  const seen = [];
  await loadFollowing(async (u, i) => { seen.push(i.headers.Authorization); return { ok: true, status: 200, json: async () => ({ items: [] }) }; }, 'https://api.test', () => s.getAccessToken());
  assert.deepEqual(seen, ['Bearer access-1']);
});

test('sign-out clears the token, the stored session and the pending verifier, and revokes server side', async () => {
  const ctx = await signedIn();
  await ctx.s.signOut();
  assert.equal(ctx.s.getAccessToken(), null);
  assert.equal(ctx.s.email(), null);
  assert.equal(ctx.storage.getItem(SESSION_KEY), null);
  const logout = ctx.fetch.calls.find((c) => c.url.includes('/auth/v1/logout'));
  assert.equal(logout.init.headers.authorization, 'Bearer access-1');
});

test('sign-out completes locally even if the server revoke fails', async () => {
  const ctx = await signedIn({ fetch: (() => { const g = gotrue(); return async (u, i) => { if (String(u).includes('logout')) throw new TypeError('offline'); return g(u, i); }; })() });
  await ctx.s.signOut();
  assert.equal(ctx.s.getAccessToken(), null);
});

test('sign-in sends the magic link with the publishable key only, never an Authorization header', async () => {
  const { s, fetch } = make();
  const r = await s.signIn(' me@x.test ');
  assert.equal(r.ok, true);
  assert.match(r.id, /^[\w-]{16,}$/, 'the request is named, so a send started for it can tell when a newer one overtakes it');
  const c = fetch.calls[0];
  assert.equal(c.init.headers.apikey, KEY);
  assert.ok(!Object.keys(c.init.headers).some((h) => h.toLowerCase() === 'authorization'));
  assert.equal(c.body.email, 'me@x.test');
  assert.equal(c.body.code_challenge_method, 's256');
  assert.match(c.body.code_challenge, /^[A-Za-z0-9_-]{43}$/);
  const redirect = new URL(c.url).searchParams.get('redirect_to');
  assert.equal(redirect, 'https://go.test/auth/callback/?web=1&next=%2Fworld-vibe%2F');
});

test('the PKCE verifier is kept locally and never sent; the challenge is its SHA-256', async () => {
  const { s, fetch, storage } = make();
  await s.signIn('me@x.test');
  const verifier = JSON.parse(storage.getItem('wv.pkce')).verifier;
  assert.ok(verifier && verifier.length >= 43);
  assert.ok(!fetch.calls[0].init.body.includes(verifier));
  const digest = Buffer.from(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  assert.equal(fetch.calls[0].body.code_challenge, digest);
});

test('sign-in refuses a bad email and an unconfigured key without any request', async () => {
  const a = make();
  assert.deepEqual(await a.s.signIn('not-an-email'), { error: 'invalid_email' });
  assert.equal(a.fetch.calls.length, 0);
  const b = make({ publishableKey: '' });
  assert.equal(b.s.configured(), false);
  assert.deepEqual(await b.s.signIn('me@x.test'), { error: 'not_configured' });
  assert.equal(b.fetch.calls.length, 0);
});

test('sign-in maps 429 and failures to honest errors', async () => {
  assert.deepEqual(await make({ fetch: gotrue({ otp: 429 }) }).s.signIn('me@x.test'), { error: 'rate_limited' });
  assert.deepEqual(await make({ fetch: gotrue({ otp: 500 }) }).s.signIn('me@x.test'), { error: 'unavailable' });
  assert.deepEqual(await make({ fetch: async () => { throw new TypeError('offline'); } }).s.signIn('me@x.test'), { error: 'unavailable' });
});

test('completeSignIn exchanges the code with the stored verifier and keeps only the session', async () => {
  const { s, fetch, storage } = make();
  await s.signIn('me@x.test');
  const verifier = JSON.parse(storage.getItem('wv.pkce')).verifier;
  const r = await s.completeSignIn('?code=abc&web=1&next=%2Fworld-vibe%2Fexplore%2F');
  assert.deepEqual(r, { ok: true, next: '/world-vibe/explore/', user_id: 'u-1' }, 'the callback learns the account the link signed in');
  const ex = fetch.calls.find((c) => c.url.includes('grant_type=pkce'));
  assert.deepEqual(ex.body, { auth_code: 'abc', code_verifier: verifier });
  assert.equal(JSON.parse(storage.getItem('wv.pkce')).verifier, undefined, 'the verifier is gone once used');
  assert.equal(s.email(), 'me@x.test');
  assert.equal(s.userId(), 'u-1');
});

test('an exchange that finishes after a newer email request leaves that request\'s verifier in place', async () => {
  let release;
  const base = gotrue();
  const fetch = async (url, init) => { const r = base(url, init); if (String(url).includes('grant_type=pkce')) await new Promise((res) => { release = res; }); return r; };
  fetch.calls = base.calls;
  const { s, storage } = make({ fetch });
  await s.signIn('me@x.test', { next: '/world-vibe/?arrived_from=pick-one&send=n1', send: { slug: 'pick-one', nonce: 'n1' } });
  const completing = s.completeSignIn('?code=abc&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=n1'));
  for (let i = 0; i < 20 && !release; i++) await new Promise((r) => setImmediate(r));
  assert.ok(release, 'the exchange is in flight');
  assert.equal((await s.signIn('me@x.test')).ok, true, 'a newer, ordinary request, say from the account bar in another tab');
  const newer = storage.getItem('wv.pkce');
  release();
  assert.equal((await completing).ok, true, 'the older link still signs the person in');
  assert.equal(storage.getItem('wv.pkce'), newer, 'the newer link can still be exchanged');
  assert.equal(storage.getItem('wv.send_intent'), null, 'a superseded exchange hands no send over');
});

test('an email request overtaken while its challenge is computed sends no email and leaves the newer request\'s verifier', async () => {
  const held = [];
  let n = 0;
  const crypto = {
    getRandomValues: (a) => globalThis.crypto.getRandomValues(a),
    subtle: { digest: async (alg, data) => { if (n++ === 0) await new Promise((res) => held.push(res)); return globalThis.crypto.subtle.digest(alg, data); } }
  };
  const { s, storage, fetch } = make({ crypto });
  const older = s.signIn('me@x.test');
  await new Promise((r) => setImmediate(r));
  const first = storage.getItem('wv.pkce');
  assert.ok(first, 'the first request stores its record before its challenge is computed');
  assert.equal((await s.signIn('me@x.test')).ok, true);
  const newer = storage.getItem('wv.pkce');
  assert.notEqual(newer, first);
  held[0]();
  assert.deepEqual(await older, { error: 'superseded' });
  assert.equal(fetch.calls.filter((c) => c.url.includes('/auth/v1/otp')).length, 1, 'only the newer email went out');
  assert.equal(storage.getItem('wv.pkce'), newer, 'and its verifier is the one kept');
  const otp = fetch.calls.find((c) => c.url.includes('/auth/v1/otp'));
  const digest = Buffer.from(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.parse(newer).verifier))).toString('base64url');
  assert.equal(otp.body.code_challenge, digest, 'the email that went out carries the challenge of the kept verifier');
});

test('a sign-in asked for a send stores it with the verifier in one write; the exchange hands it to the landing page bound to the account', async () => {
  const { s, storage } = make();
  const writes = [];
  const setItem = storage.setItem;
  storage.setItem = (k, v) => { writes.push(k); return setItem(k, v); };
  assert.equal((await s.signIn('me@x.test', { next: '/world-vibe/?arrived_from=pick-one&send=n1', send: { slug: 'pick-one', nonce: 'n1' } })).ok, true);
  assert.deepEqual(writes.filter((k) => k === 'wv.pkce'), ['wv.pkce'], 'the pending link is stored exactly once');
  const p = JSON.parse(storage.getItem('wv.pkce'));
  assert.deepEqual(Object.keys(p).sort(), ['id', 'send', 'verifier']);
  assert.deepEqual(p.send, { slug: 'pick-one', nonce: 'n1' });
  assert.equal(s.lastSignInId(), p.id);
  assert.equal(storage.getItem('wv.send_intent'), null, 'nothing is handed to the landing page before the exchange');
  const r = await s.completeSignIn('?code=abc&web=1&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=n1'));
  assert.deepEqual(r, { ok: true, next: '/world-vibe/?arrived_from=pick-one&send=n1', user_id: 'u-1' });
  assert.deepEqual(JSON.parse(storage.getItem('wv.send_intent')), { slug: 'pick-one', nonce: 'n1', user: 'u-1', signin: p.id }, 'bound to the account the link signed in and the request it came from');
  assert.deepEqual(JSON.parse(storage.getItem('wv.pkce')), { id: p.id }, 'the verifier is gone, the request id stays the latest');
  assert.equal(s.lastSignInId(), p.id);
  assert.deepEqual(await s.completeSignIn('?code=abc'), { error: 'no_pending_sign_in' }, 'a used link cannot be exchanged again');
  const again = await s.signIn('me@x.test');
  assert.equal(again.ok, true);
  assert.notEqual(again.id, p.id);
  assert.equal(s.lastSignInId(), again.id, 'the next request becomes the latest');
  await s.signOut();
  assert.equal(storage.getItem('wv.send_intent'), null, 'signing out drops it');
  assert.equal(s.lastSignInId(), null);
});

// A stand-in for navigator.locks that really serializes: each request runs after the previous one finished.
function queueLock() {
  let chain = Promise.resolve();
  let depth = 0, acquired = 0;
  return {
    depth: () => depth, acquired: () => acquired,
    request: (name, fn) => {
      assert.equal(name, 'wv.signin');
      const run = chain.then(async () => { acquired++; depth++; try { return await fn(); } finally { depth--; } });
      chain = run.catch(() => {});
      return run;
    }
  };
}

test('the session, the pending record, the handoff and the claim are only ever changed under the cross-tab lock', async () => {
  const locks = queueLock();
  const { s, storage } = make({ locks });
  const setItem = storage.setItem, removeItem = storage.removeItem;
  const guarded = [];
  const watched = (k) => k === 'wv.pkce' || k === 'wv.send_intent' || k === 'wv.session' || k === 'wv.signout_epoch';
  storage.setItem = (k, v) => { if (watched(k)) guarded.push([k, locks.depth() > 0]); return setItem(k, v); };
  storage.removeItem = (k) => { if (watched(k)) guarded.push([k, locks.depth() > 0]); return removeItem(k); };
  assert.equal((await s.signIn('me@x.test', { next: '/world-vibe/?arrived_from=pick-one&send=n1', send: { slug: 'pick-one', nonce: 'n1' } })).ok, true);
  assert.equal((await s.completeSignIn('?code=abc&next=' + encodeURIComponent('/world-vibe/?arrived_from=pick-one&send=n1'))).ok, true);
  assert.equal(await s.claimSend('pick-one', 'n9'), null, 'a handoff for another link is left alone');
  assert.deepEqual(await s.claimSend('pick-one', 'n1'), { slug: 'pick-one', nonce: 'n1', user: 'u-1', signin: s.lastSignInId() });
  assert.equal(await s.claimSend('pick-one', 'n1'), null, 'claimed once');
  assert.deepEqual(await s.verifyCode('me@x.test', '123456'), { ok: true, user_id: 'u-1' });
  setItem('wv.session', JSON.stringify({ ...JSON.parse(storage.getItem('wv.session')), expires_at: Math.floor(NOW / 1000) + 10 }));
  await s.restore();
  assert.equal(JSON.parse(storage.getItem('wv.session')).access_token, 'access-2', 'the refresh was written');
  await s.signOut();
  assert.ok(guarded.some(([k]) => k === 'wv.session') && guarded.some(([k]) => k === 'wv.signout_epoch'), 'sign-out invalidates the session and bumps the epoch under the lock too');
  assert.ok(guarded.filter(([k]) => k === 'wv.session').length >= 4, 'exchange, code, refresh and sign-out each wrote the session: ' + guarded.filter(([k]) => k === 'wv.session').length);
  assert.deepEqual(s.snapshot(), { token: null, user_id: null }, 'signed out: one read says so for both');
  let ran = false;
  await s.locked(() => { assert.equal(locks.depth(), 1, 'locked() runs its work under the same lock'); ran = true; });
  assert.equal(ran, true);
  assert.ok(locks.acquired() >= 8, 'request, exchange, claims, code, refresh, sign-out and locked() each took the lock: ' + locks.acquired());
  assert.deepEqual(guarded.filter(([, held]) => !held), [], 'every write or removal of the session, the record or the handoff happened under the lock');
  assert.ok(guarded.length >= 8);
});

test('the exchange and the refresh read their source and the sign-out epoch in one locked step, so a sign-out cannot slip between them', async () => {
  const locks = queueLock();
  const { s, storage } = make({ locks });
  const getItem = storage.getItem;
  const reads = [];
  storage.getItem = (k) => { if (k === 'wv.pkce' || k === 'wv.session' || k === 'wv.signout_epoch') reads.push([k, locks.depth() > 0]); return getItem(k); };
  await s.signIn('me@x.test');
  reads.length = 0;
  assert.equal((await s.completeSignIn('?code=abc&next=%2Fworld-vibe%2F')).ok, true);
  const firstRecord = reads.find(([k]) => k === 'wv.pkce'), firstEpoch = reads.find(([k]) => k === 'wv.signout_epoch');
  assert.deepEqual([firstRecord, firstEpoch], [['wv.pkce', true], ['wv.signout_epoch', true]], 'the exchange first reads the record and the epoch under the lock');
  getItem('wv.session');
  storage.setItem('wv.session', JSON.stringify({ ...JSON.parse(getItem('wv.session')), expires_at: Math.floor(NOW / 1000) + 10 }));
  reads.length = 0;
  await s.restore();
  const firstSession = reads.find(([k]) => k === 'wv.session'), firstEpoch2 = reads.find(([k]) => k === 'wv.signout_epoch');
  assert.deepEqual([firstSession, firstEpoch2], [['wv.session', true], ['wv.signout_epoch', true]], 'the refresh first reads the session and the epoch under the lock');
  assert.equal(JSON.parse(getItem('wv.session')).access_token, 'access-2');
});

test('a sign-out queued behind the exchange\'s read but ahead of its commit wins: no session is restored', async () => {
  const locks = queueLock();
  let releaseToken;
  const base = gotrue();
  const fetch = async (url, init) => { const r = base(url, init); if (String(url).includes('grant_type=pkce')) await new Promise((res) => { releaseToken = res; }); return r; };
  fetch.calls = base.calls;
  const { s, storage } = make({ fetch, locks });
  await s.signIn('me@x.test');
  const completing = s.completeSignIn('?code=abc&next=%2Fworld-vibe%2F');
  for (let i = 0; i < 20 && !releaseToken; i++) await new Promise((r) => setImmediate(r));
  assert.ok(releaseToken, 'the record and epoch were read; the exchange is in flight');
  await s.signOut();
  releaseToken();
  assert.deepEqual(await completing, { error: 'signed_out' });
  assert.equal(storage.getItem('wv.session'), null, 'the signed-out state stands');
  assert.equal(storage.getItem('wv.pkce'), null, 'and the record cleared by the sign-out stays cleared');
});

test('a sign-out queued behind the refresh\'s read but ahead of its commit wins: no session is restored', async () => {
  const locks = queueLock();
  let releaseRefresh;
  const base = gotrue();
  const fetch = async (url, init) => { const r = base(url, init); if (String(url).includes('grant_type=refresh_token')) await new Promise((res) => { releaseRefresh = res; }); return r; };
  fetch.calls = base.calls;
  const { s, storage } = make({ fetch, locks });
  storage.setItem('wv.session', JSON.stringify({ access_token: 'old', refresh_token: 'r', expires_at: Math.floor(NOW / 1000) + 10, user_id: 'u-1', email: 'me@x.test' }));
  const restoring = s.restore();
  for (let i = 0; i < 20 && !releaseRefresh; i++) await new Promise((r) => setImmediate(r));
  assert.ok(releaseRefresh);
  await s.signOut();
  releaseRefresh();
  await restoring;
  assert.equal(storage.getItem('wv.session'), null, 'the refresh writes nothing after the sign-out');
});

for (const [outcome, status] of [['succeeds', 200], ['fails', 500]]) {
  test('a refresh that ' + outcome + ' after a newer sign-in replaced the session writes nothing over it', async () => {
    const locks = queueLock();
    let releaseRefresh;
    const base = gotrue({ refresh: status });
    const fetch = async (url, init) => { const r = base(url, init); if (String(url).includes('grant_type=refresh_token')) await new Promise((res) => { releaseRefresh = res; }); return r; };
    fetch.calls = base.calls;
    const { s, storage } = make({ fetch, locks });
    storage.setItem('wv.session', JSON.stringify({ access_token: 'old-a', refresh_token: 'r-a', expires_at: Math.floor(NOW / 1000) + 10, user_id: 'u-a', email: 'a@x.test' }));
    const restoring = s.restore();
    for (let i = 0; i < 20 && !releaseRefresh; i++) await new Promise((r) => setImmediate(r));
    assert.ok(releaseRefresh, "A's refresh is in flight");
    assert.deepEqual(await s.verifyCode('b@x.test', '123456'), { ok: true, user_id: 'u-1' }, 'B signs in meanwhile');
    releaseRefresh();
    await restoring;
    assert.equal(JSON.parse(storage.getItem('wv.session')).access_token, 'access-c', "B's session stands");
  });
}

test('a code verified while another tab holds the lock commits only once the lock is free', async () => {
  const locks = queueLock();
  const { s, storage } = make({ locks });
  let release;
  const holding = locks.request('wv.signin', () => new Promise((r) => { release = r; }));
  const verifying = s.verifyCode('me@x.test', '123456');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(storage.getItem('wv.session'), null, 'the verified session waits for the lock');
  release();
  await holding;
  assert.deepEqual(await verifying, { ok: true, user_id: 'u-1' });
  assert.equal(JSON.parse(storage.getItem('wv.session')).access_token, 'access-c');
});

test('a sign-out that takes the lock before a late verification commits wins: the verification writes nothing', async () => {
  const locks = queueLock();
  let releaseVerify;
  const base = gotrue();
  const fetch = async (url, init) => { const r = base(url, init); if (String(url).includes('/auth/v1/verify')) await new Promise((res) => { releaseVerify = res; }); return r; };
  fetch.calls = base.calls;
  const { s, storage } = make({ fetch, locks });
  const verifying = s.verifyCode('me@x.test', '123456');
  for (let i = 0; i < 20 && !releaseVerify; i++) await new Promise((r) => setImmediate(r));
  assert.ok(releaseVerify, 'the verification is in flight');
  await s.signOut();
  releaseVerify();
  assert.deepEqual(await verifying, { error: 'signed_out' });
  assert.equal(storage.getItem('wv.session'), null, 'the cleared session stays cleared');
});

test('an ordinary sign-in stores no send and hands nothing to the landing page; an older pending record shape is not trusted', async () => {
  const { s, storage } = make();
  assert.equal((await s.signIn('me@x.test')).ok, true);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem('wv.pkce'))).sort(), ['id', 'verifier']);
  assert.equal((await s.completeSignIn('?code=abc&next=%2Fworld-vibe%2F')).ok, true);
  assert.equal(storage.getItem('wv.send_intent'), null);
  const old = make();
  old.storage.setItem('wv.pkce', 'plain-verifier-from-before');
  assert.deepEqual(await old.s.completeSignIn('?code=abc'), { error: 'no_pending_sign_in' });
});

test('completeSignIn with no pending sign-in (other browser) or no code makes no exchange', async () => {
  const a = make();
  assert.deepEqual(await a.s.completeSignIn('?code=abc'), { error: 'no_pending_sign_in' });
  assert.equal(a.fetch.calls.length, 0);
  const b = make();
  await b.s.signIn('me@x.test');
  assert.deepEqual(await b.s.completeSignIn('?web=1'), { error: 'no_pending_sign_in' });
  assert.equal(b.fetch.calls.filter((c) => c.url.includes('pkce')).length, 0);
});

test('a failed exchange leaves the person signed out', async () => {
  const { s } = make({ fetch: gotrue({ token: 400 }) });
  await s.signIn('me@x.test');
  assert.deepEqual(await s.completeSignIn('?code=abc'), { error: 'exchange_failed' });
  assert.equal(s.getAccessToken(), null);
});

test('an expired session reads as signed out', async () => {
  const ctx = await signedIn();
  const late = createSession({ fetch: gotrue(), storage: ctx.storage, supabaseUrl: SB, publishableKey: KEY, crypto: globalThis.crypto, now: () => NOW + 3601 * 1000 });
  assert.equal(late.getAccessToken(), null);
});

test('restore refreshes a session that is about to expire, and clears it if the refresh fails', async () => {
  const ctx = await signedIn();
  const soon = () => NOW + 3590 * 1000;
  const ok = createSession({ fetch: gotrue(), storage: ctx.storage, supabaseUrl: SB, publishableKey: KEY, crypto: globalThis.crypto, now: soon });
  await ok.restore();
  assert.equal(ok.getAccessToken(), 'access-2');
  const ctx2 = await signedIn();
  const bad = createSession({ fetch: gotrue({ refresh: 400 }), storage: ctx2.storage, supabaseUrl: SB, publishableKey: KEY, crypto: globalThis.crypto, now: soon });
  await bad.restore();
  assert.equal(bad.getAccessToken(), null);
  assert.equal(ctx2.storage.getItem(SESSION_KEY), null);
});

test('restore leaves a healthy session alone (no network)', async () => {
  const ctx = await signedIn();
  const f = gotrue();
  const again = createSession({ fetch: f, storage: ctx.storage, supabaseUrl: SB, publishableKey: KEY, crypto: globalThis.crypto, now: () => NOW + 60 * 1000 });
  await again.restore();
  assert.equal(f.calls.length, 0);
  assert.equal(again.getAccessToken(), 'access-1');
});

test('onChange fires on sign-in and sign-out', async () => {
  const { s } = make();
  let n = 0;
  s.onChange(() => n++);
  await s.signIn('me@x.test');
  await s.completeSignIn('?code=abc');
  await s.signOut();
  assert.equal(n, 2);
});

test('safeNext only lets same-site paths through', () => {
  assert.equal(safeNext('/world-vibe/explore/'), '/world-vibe/explore/');
  for (const bad of ['//evil.test', 'https://evil.test', 'javascript:alert(1)', null, undefined, '', '/\\evil']) assert.equal(safeNext(bad), '/world-vibe/');
});

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n === '.artifacts' || n === '.git') return [];
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('no service key or secret key is present anywhere in the web files', () => {
  for (const f of walk(path.join(root, 'world-vibe')).concat(walk(path.join(root, 'auth')))) {
    if (!/\.(js|html|json|css)$/.test(f) || f.endsWith('qrcode.min.js')) continue;
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /service_role|sb_secret_|SERVICE_ROLE|supabase_service/i, f);
  }
});

test('session.js reads a publishable key from config and nothing in the repo hard-codes a JWT', () => {
  const cfg = readFileSync(path.join(root, 'world-vibe', 'config.js'), 'utf8');
  assert.match(cfg, /SOMACHECK_SUPABASE_PUBLISHABLE_KEY/);
  for (const f of walk(path.join(root, 'world-vibe')).concat(walk(path.join(root, 'auth')))) {
    if (!/\.(js|html)$/.test(f) || f.endsWith('qrcode.min.js')) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), /eyJ[A-Za-z0-9_-]{20,}\./, f);
  }
});

test('config.js ships the publishable key (public by design) and no secret of any kind', () => {
  const cfg = readFileSync(path.join(root, 'world-vibe', 'config.js'), 'utf8');
  assert.match(cfg, /SOMACHECK_SUPABASE_PUBLISHABLE_KEY = window\.SOMACHECK_SUPABASE_PUBLISHABLE_KEY \|\| 'sb_publishable_af-lUNI2FqEcb-oGy-4uxQ_cnm6kY85'/);
  assert.doesNotMatch(cfg, /sb_secret_|service_role|eyJ[A-Za-z0-9_-]{20,}/);
});

// Held GoTrue: the named grant resolves only when released, so a response can
// land after sign-out.
function heldGotrue(hold) {
  const base = gotrue();
  const waiting = [];
  const f = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === hold) {
      base.calls.push({ url: String(url), init, body: JSON.parse(init.body) });
      return new Promise((resolve) => waiting.push(() => resolve({ ok: true, status: 200, json: async () => ({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600, user: { id: 'u-1', email: 'me@x.test' } }) })));
    }
    return base(url, init);
  };
  f.calls = base.calls;
  f.releaseAll = async () => { waiting.splice(0).forEach((r) => r()); await new Promise((r) => setTimeout(r, 0)); };
  return f;
}
const nearExpiry = async (fetch) => {
  let clock = NOW;
  const ctx = make({ fetch, now: () => clock });
  await ctx.s.signIn('me@x.test');
  await ctx.s.completeSignIn('?code=abc&next=%2Fworld-vibe%2F');
  clock = NOW + 3590 * 1000;   // inside the 60 s refresh window
  return ctx;
};

test('sign-out while a refresh is in flight: the late refresh response restores nothing', async () => {
  const fetch = heldGotrue('refresh_token');
  const { s, storage } = await nearExpiry(fetch);
  const restoring = s.restore();
  await new Promise((r) => setTimeout(r, 0));
  await s.signOut();
  await fetch.releaseAll();
  await restoring;
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(s.getAccessToken(), null);
});

test('a refresh that resolves after sign-out has finished never brings the bearer back', async () => {
  const fetch = heldGotrue('refresh_token');
  const { s, storage } = await nearExpiry(fetch);
  const restoring = s.restore();
  await new Promise((r) => setTimeout(r, 0));
  await s.signOut();
  assert.equal(s.getAccessToken(), null);
  await fetch.releaseAll();
  await restoring;
  assert.equal(s.getAccessToken(), null);
  assert.equal(s.userId(), null);
  assert.equal(storage.getItem(SESSION_KEY), null);
});

test('sign-out while the code exchange is in flight: the late exchange does not sign the person in', async () => {
  const fetch = heldGotrue('pkce');
  const { s, storage } = make({ fetch });
  await s.signIn('me@x.test');
  const completing = s.completeSignIn('?code=abc');
  await new Promise((r) => setTimeout(r, 0));
  await s.signOut();
  await fetch.releaseAll();
  assert.deepEqual(await completing, { error: 'signed_out' });
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(s.getAccessToken(), null);
});

// Two tabs: separate session objects over one shared storage, as with localStorage.
const twoTabs = async (hold) => {
  const storage = memory();
  const clock = { t: NOW };
  const tab = (fetch) => createSession({ fetch, storage, supabaseUrl: SB, publishableKey: KEY, origin: 'https://go.test', crypto: globalThis.crypto, now: () => clock.t });
  const fa = heldGotrue(hold);
  const a = tab(fa);
  const b = tab(gotrue());
  return { a, b, fa, storage, clock };
};

test('sign-out in another tab while this tab\'s refresh is in flight: the late refresh restores nothing', async () => {
  const { a, b, fa, storage, clock } = await twoTabs('refresh_token');
  await a.signIn('me@x.test');
  await a.completeSignIn('?code=abc');
  clock.t = NOW + 3590 * 1000;
  const restoring = a.restore();
  await new Promise((r) => setTimeout(r, 0));
  await b.signOut();
  await fa.releaseAll();
  await restoring;
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(a.getAccessToken(), null);
  assert.equal(b.getAccessToken(), null);
});

test('sign-out in another tab while this tab completes a PKCE sign-in: the late exchange signs nobody in', async () => {
  const { a, b, fa, storage } = await twoTabs('pkce');
  await a.signIn('me@x.test');
  const completing = a.completeSignIn('?code=abc');
  await new Promise((r) => setTimeout(r, 0));
  await b.signOut();
  await fa.releaseAll();
  assert.deepEqual(await completing, { error: 'signed_out' });
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(a.getAccessToken(), null);
});

test('a sign-out that finished before the refresh began does not block it (the marker is compared, not just present)', async () => {
  const { a, b, fa, storage, clock } = await twoTabs('refresh_token');
  await a.signIn('me@x.test');
  await a.completeSignIn('?code=abc');
  await b.signOut();
  await b.signIn('me@x.test');
  await b.completeSignIn('?code=abc');
  clock.t = NOW + 3590 * 1000;
  const restoring = a.restore();
  await new Promise((r) => setTimeout(r, 0));
  await fa.releaseAll();
  await restoring;
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).access_token, 'late-access');
});

test('notify() tells listeners the shared storage changed (the window storage event lands here)', () => {
  const { s } = make();
  let n = 0;
  s.onChange(() => { n++; });
  s.notify();
  assert.equal(n, 1);
});

test('verifyCode: the six-digit code goes to GoTrue verify with the publishable key only, and signs the person in', async () => {
  const { s, fetch, storage } = make();
  await s.signIn('me@x.test');
  const r = await s.verifyCode(' me@x.test ', '123 456');
  assert.deepEqual(r, { ok: true, user_id: 'u-1' }, 'the account the code signed in comes back with the result');
  assert.deepEqual(s.snapshot(), { token: 'access-c', user_id: 'u-1' });
  const v = fetch.calls.find((c) => c.url.includes('/auth/v1/verify'));
  assert.ok(v, 'verify was called');
  assert.equal(v.init.method, 'POST');
  assert.deepEqual(v.body, { type: 'email', email: 'me@x.test', token: '123456' });
  assert.equal(v.init.headers.apikey, KEY);
  assert.ok(!Object.keys(v.init.headers).some((k) => k.toLowerCase() === 'authorization'), 'no Authorization header in any casing');
  assert.equal(s.getAccessToken(), 'access-c');
  assert.equal(s.email(), 'me@x.test');
  assert.notEqual(storage.getItem('wv.pkce'), null, 'the pending link verifier is kept: it may belong to a newer email request than this code');
});

test('verifyCode refuses a malformed code or email without any request', async () => {
  const { s, fetch } = make();
  assert.deepEqual(await s.verifyCode('me@x.test', '12345'), { error: 'invalid_code' });
  assert.deepEqual(await s.verifyCode('me@x.test', 'abcdef'), { error: 'invalid_code' });
  assert.deepEqual(await s.verifyCode('not-an-email', '123456'), { error: 'invalid_email' });
  assert.equal(fetch.calls.length, 0);
  assert.equal(s.getAccessToken(), null);
  const b = make({ publishableKey: '' });
  assert.deepEqual(await b.s.verifyCode('me@x.test', '123456'), { error: 'not_configured' });
});

test('verifyCode maps a rejected code, 429 and failures to honest errors and stays signed out', async () => {
  const a = make({ fetch: gotrue({ verify: 403 }) });
  assert.deepEqual(await a.s.verifyCode('me@x.test', '123456'), { error: 'bad_code' });
  assert.equal(a.s.getAccessToken(), null);
  assert.deepEqual(await make({ fetch: gotrue({ verify: 429 }) }).s.verifyCode('me@x.test', '123456'), { error: 'rate_limited' });
  assert.deepEqual(await make({ fetch: gotrue({ verify: 500 }) }).s.verifyCode('me@x.test', '123456'), { error: 'unavailable' }, 'a server failure is not reported as a wrong code');
  assert.deepEqual(await make({ fetch: async () => { throw new TypeError('offline'); } }).s.verifyCode('me@x.test', '123456'), { error: 'unavailable' });
});

test('a sign-out that lands while the code is being verified wins: no session is written back', async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const base = gotrue();
  const fetch = async (url, init) => {
    if (String(url).includes('/auth/v1/verify')) { await gate; }
    return base(url, init);
  };
  const { s } = make({ fetch });
  const pending = s.verifyCode('me@x.test', '123456');
  await s.signOut();
  release();
  assert.deepEqual(await pending, { error: 'signed_out' });
  assert.equal(s.getAccessToken(), null);
});

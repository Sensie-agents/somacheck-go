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
function gotrue({ otp = 200, token = 200, refresh = 200, logout = 204 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    const u = new URL(url);
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u.pathname === '/auth/v1/otp') return json(otp, {});
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'pkce') return json(token, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, user: { id: 'u-1', email: 'me@x.test' } });
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') return json(refresh, { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 });
    if (u.pathname === '/auth/v1/logout') return json(logout, {});
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
  assert.deepEqual(r, { ok: true });
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
  const verifier = storage.getItem('wv.pkce');
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
  const verifier = storage.getItem('wv.pkce');
  const r = await s.completeSignIn('?code=abc&web=1&next=%2Fworld-vibe%2Fexplore%2F');
  assert.deepEqual(r, { ok: true, next: '/world-vibe/explore/' });
  const ex = fetch.calls.find((c) => c.url.includes('grant_type=pkce'));
  assert.deepEqual(ex.body, { auth_code: 'abc', code_verifier: verifier });
  assert.equal(storage.getItem('wv.pkce'), null);
  assert.equal(s.email(), 'me@x.test');
  assert.equal(s.userId(), 'u-1');
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

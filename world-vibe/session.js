// Web session for World Vibe (home and Explore). Supabase Auth email magic link
// over PKCE, talking to GoTrue directly with the publishable key only. No
// service key exists in this repo or may be added here. getAccessToken() is the
// seam every signed-in call reads: null means signed out, and callers then make
// no request that needs a person.
export const DEFAULT_SUPABASE_URL = 'https://pbldcmniommltbdwuykk.supabase.co';
export const CALLBACK_PATH = '/auth/callback/';
export const SESSION_KEY = 'wv.session';
// The latest email request: { id, verifier, send? }, written in a single
// storage write by signIn so the verifier and what the link is for can never
// belong to different requests, in this tab or another. Its own exchange
// drops the verifier but keeps { id }: the id names the latest request until
// the next one or a sign-out, so a send started for an older request can tell
// it was overtaken even after exchanges came and went.
const VERIFIER_KEY = 'wv.pkce';
// Written only by a successful link exchange: { slug, nonce, user, signin },
// the "send to my phone" that link was asked for, bound to the account it
// signed in and to the request it came from. The page the link lands on uses
// it up.
export const SEND_KEY = 'wv.send_intent';
const EPOCH_KEY = 'wv.signout_epoch';
const REFRESH_WINDOW_SECONDS = 60;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pkceVerifier = (cryptoApi) => b64url(cryptoApi.getRandomValues(new Uint8Array(32)));
async function pkceChallenge(cryptoApi, verifier) {
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

// Only same-site paths survive as a post-sign-in destination.
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : '/world-vibe/';
}

// Every change of the pending record or the handoff runs under one cross-tab
// lock (Web Locks, held by name across every tab of the origin), so a request,
// an exchange, a sign-out or a landing in another tab cannot slip between a
// read and the write that depends on it. Without the API the work just runs.
const LOCK = 'wv.signin';

export function createSession({ fetch: fetchFn, storage, supabaseUrl = DEFAULT_SUPABASE_URL, publishableKey = '', origin = 'https://go.somacheck.com', crypto: cryptoApi, now = () => Date.now(), locks = (typeof navigator !== 'undefined' && navigator.locks) || null }) {
  const listeners = new Set();
  const serialized = (fn) => (locks && typeof locks.request === 'function' ? locks.request(LOCK, fn) : Promise.resolve().then(fn));
  // Email requests from this tab, in the order they were made: an earlier one
  // is overtaken by a later one here before either reaches storage.
  let signInSeq = 0;
  // Bumped by every sign-out and kept in the same storage the session lives in,
  // so a sign-out in another tab counts too. A token exchange or refresh that
  // started before it must not write a session back when its response arrives.
  const epochNow = () => { try { return Number(storage.getItem(EPOCH_KEY)) || 0; } catch { return 0; } };
  const read = () => {
    try { return JSON.parse(storage.getItem(SESSION_KEY)); } catch { return null; }
  };
  const write = (s) => { if (s) storage.setItem(SESSION_KEY, JSON.stringify(s)); else storage.removeItem(SESSION_KEY); listeners.forEach((fn) => fn()); };
  const live = (s) => s && typeof s.access_token === 'string' && s.access_token && s.expires_at * 1000 > now();
  const pending = () => {
    try { const v = JSON.parse(storage.getItem(VERIFIER_KEY)); return v && typeof v === 'object' ? v : null; } catch { return null; }
  };
  const headers = (extra = {}) => ({ 'content-type': 'application/json', apikey: publishableKey, ...extra });

  const api = {
    configured: () => Boolean(publishableKey),
    supabaseUrl,
    publishableKey,
    getAccessToken() {
      const s = read();
      return live(s) ? s.access_token : null;
    },
    userId() { return live(read()) ? read().user_id : null; },
    // Token and account from one read of the session, for a check and a send
    // that must agree with each other.
    snapshot() { const s = read(); return live(s) ? { token: s.access_token, user_id: s.user_id || null } : { token: null, user_id: null }; },
    // Runs fn under the cross-tab lock that orders every sign-in transition,
    // so a final check and what it authorizes cannot be split by a request,
    // an exchange or a sign-out in another tab.
    locked(fn) { return serialized(fn); },
    email() { return live(read()) ? read().email : null; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // The window's `storage` event (another tab changed the session) lands here.
    notify() { listeners.forEach((fn) => fn()); },

    // Id of the latest email request from any tab (null when none since the
    // last sign-out). A send that belongs to an older request stops.
    lastSignInId() { const p = pending(); return p && typeof p.id === 'string' ? p.id : null; },

    // Sends the magic link. Resolves { ok, id } or { error }. `send` ({ slug,
    // nonce }) is what the link is for: it is stored with the verifier and
    // handed to the landing page, bound to the signed-in account, by
    // completeSignIn. `id` names this request for as long as it is the latest.
    async signIn(email, { next = '/world-vibe/', send = null } = {}) {
      if (!api.configured()) return { error: 'not_configured' };
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { error: 'invalid_email' };
      // The record is stored under the cross-tab lock, and this request is
      // numbered in this tab before anything is awaited. A newer request, from
      // this tab or another, that takes over while the challenge is computed
      // wins: this one sends no email and says so.
      const seq = ++signInSeq;
      const verifier = pkceVerifier(cryptoApi);
      const id = pkceVerifier(cryptoApi);
      const mine = send && typeof send.slug === 'string' && typeof send.nonce === 'string' ? { id, verifier, send: { slug: send.slug, nonce: send.nonce } } : { id, verifier };
      await serialized(() => { if (seq === signInSeq) storage.setItem(VERIFIER_KEY, JSON.stringify(mine)); });
      const challenge = await pkceChallenge(cryptoApi, verifier);
      if (seq !== signInSeq || (pending() || {}).verifier !== verifier) return { error: 'superseded' };
      const redirect = origin + CALLBACK_PATH + '?web=1&next=' + encodeURIComponent(safeNext(next));
      try {
        const r = await fetchFn(supabaseUrl + '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), {
          method: 'POST', headers: headers(),
          body: JSON.stringify({ email: email.trim(), code_challenge: challenge, code_challenge_method: 's256' })
        });
        return r.ok ? { ok: true, id } : { error: r.status === 429 ? 'rate_limited' : 'unavailable' };
      } catch { return { error: 'unavailable' }; }
    },

    // Signs in with the six-digit code from the same email, for a person who
    // reads the email on another device or ignores the link. Resolves { ok }
    // or { error }. The code is only ever sent to GoTrue's verify endpoint with
    // the publishable key; a success writes the same session the link would.
    // The stored PKCE verifier is left alone: it belongs to whichever emailed
    // link is still pending, which may be a newer request than this code.
    async verifyCode(email, code) {
      if (!api.configured()) return { error: 'not_configured' };
      const e = typeof email === 'string' ? email.trim() : '';
      const c = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: 'invalid_email' };
      if (!/^\d{6}$/.test(c)) return { error: 'invalid_code' };
      const started = epochNow();
      try {
        const r = await fetchFn(supabaseUrl + '/auth/v1/verify', {
          method: 'POST', headers: headers(), body: JSON.stringify({ type: 'email', email: e, token: c })
        });
        if (!r.ok) return { error: r.status === 429 ? 'rate_limited' : r.status >= 500 ? 'unavailable' : 'bad_code' };
        const t = await r.json();
        // Epoch check and session write as one step under the cross-tab lock:
        // a sign-out elsewhere lands either before (nothing is written) or after.
        const committed = await serialized(() => {
          if (started !== epochNow()) return false;
          write({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at || Math.floor(now() / 1000) + (t.expires_in || 3600), user_id: t.user && t.user.id, email: t.user && t.user.email });
          return true;
        });
        if (!committed) return { error: 'signed_out' };
        // The account this code signed in, so a send that follows is bound to
        // it rather than to whatever the shared session holds later.
        return { ok: true, user_id: (t.user && t.user.id) || null };
      } catch { return { error: 'unavailable' }; }
    },

    // Called by /auth/callback/ for a web-initiated link: trades the PKCE code
    // for a session. Resolves { ok, next, user_id } or { error }. The send the
    // link was asked for, if any, is handed to the landing page under SEND_KEY
    // bound to the account the link signed in.
    async completeSignIn(search) {
      const params = new URLSearchParams(search);
      const code = params.get('code');
      // The pending record and the sign-out epoch are read together under the
      // lock: a sign-out elsewhere lands wholly before or wholly after.
      const { p, started } = await serialized(() => ({ p: pending(), started: epochNow() }));
      if (!code || !p || typeof p.verifier !== 'string') return { error: 'no_pending_sign_in' };
      try {
        const r = await fetchFn(supabaseUrl + '/auth/v1/token?grant_type=pkce', {
          method: 'POST', headers: headers(), body: JSON.stringify({ auth_code: code, code_verifier: p.verifier })
        });
        if (!r.ok) return { error: 'exchange_failed' };
        const t = await r.json();
        const uid = t.user && t.user.id;
        // One step under the cross-tab lock: the epoch check (a sign-out
        // elsewhere wins), then the pending record. A newer email request may
        // have taken the pending sign-in over while the exchange was in flight:
        // then this one still signs in, but neither clears that record nor
        // hands its own send over. Then the session itself.
        const committed = await serialized(() => {
          if (started !== epochNow()) return false;
          if ((pending() || {}).verifier === p.verifier) {
            if (typeof p.id === 'string') storage.setItem(VERIFIER_KEY, JSON.stringify({ id: p.id })); else storage.removeItem(VERIFIER_KEY);
            if (p.send && uid) storage.setItem(SEND_KEY, JSON.stringify({ slug: p.send.slug, nonce: p.send.nonce, user: uid, signin: p.id }));
          }
          write({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at || Math.floor(now() / 1000) + (t.expires_in || 3600), user_id: uid, email: t.user && t.user.email });
          return true;
        });
        if (!committed) return { error: 'signed_out' };
        return { ok: true, next: safeNext(params.get('next')), user_id: uid };
      } catch { return { error: 'exchange_failed' }; }
    },

    // The page an emailed link landed on claims the send that link was asked
    // for: exactly one tab gets it, and a handoff for another line or link is
    // left alone. Resolves the handoff or null.
    async claimSend(slug, nonce) {
      return serialized(() => {
        let v = null;
        try { v = JSON.parse(storage.getItem(SEND_KEY)); } catch { return null; }
        if (!v || v.slug !== slug || v.nonce !== nonce) return null;
        storage.removeItem(SEND_KEY);
        return v;
      });
    },

    // Page start: an expired or nearly expired session is refreshed once, or
    // cleared if the refresh token no longer works.
    async restore() {
      // Session and sign-out epoch read together under the lock, as above.
      const { s, started } = await serialized(() => ({ s: read(), started: epochNow() }));
      if (!s) return;
      if (s.expires_at * 1000 - now() > REFRESH_WINDOW_SECONDS * 1000) return;
      // Every outcome is written under the cross-tab lock, and only if the
      // session being refreshed is still the one stored: a sign-out, or a
      // newer sign-in from anywhere, since the refresh started wins.
      const commit = (next) => serialized(() => {
        const cur = read();
        if (started !== epochNow() || !cur || cur.access_token !== s.access_token || cur.refresh_token !== s.refresh_token) return;
        write(next);
      });
      try {
        const r = await fetchFn(supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', headers: headers(), body: JSON.stringify({ refresh_token: s.refresh_token })
        });
        if (!r.ok) { await commit(null); return; }
        const t = await r.json();
        await commit({ ...s, access_token: t.access_token, refresh_token: t.refresh_token || s.refresh_token, expires_at: t.expires_at || Math.floor(now() / 1000) + (t.expires_in || 3600) });
      } catch { await commit(null); }
    },

    // Local sign-out always completes; the server revoke is best effort.
    // Invalidation and cleanup are one step under the cross-tab lock, so a
    // send finalizing in another tab sees either the live session or nothing.
    async signOut() {
      const token = api.getAccessToken();
      await serialized(() => {
        storage.setItem(EPOCH_KEY, String(epochNow() + 1));
        write(null);
        storage.removeItem(VERIFIER_KEY);
        storage.removeItem(SEND_KEY);
      });
      if (!token) return;
      try { await fetchFn(supabaseUrl + '/auth/v1/logout?scope=local', { method: 'POST', headers: headers({ authorization: 'Bearer ' + token }) }); } catch { /* local sign-out already done */ }
    }
  };
  return api;
}

const w = typeof window === 'undefined' ? null : window;
export const session = w
  ? createSession({
    fetch: (...a) => w.fetch(...a),
    storage: w.localStorage,
    supabaseUrl: w.SOMACHECK_SUPABASE_URL || DEFAULT_SUPABASE_URL,
    publishableKey: w.SOMACHECK_SUPABASE_PUBLISHABLE_KEY || '',
    origin: w.location.origin,
    crypto: w.crypto
  })
  : null;
if (w && session) w.addEventListener('storage', (e) => { if (e.key === SESSION_KEY || e.key === EPOCH_KEY) session.notify(); });

export function getAccessToken() {
  return session ? session.getAccessToken() : null;
}

// Web session for World Vibe (home and Explore). Supabase Auth email magic link
// over PKCE, talking to GoTrue directly with the publishable key only. No
// service key exists in this repo or may be added here. getAccessToken() is the
// seam every signed-in call reads: null means signed out, and callers then make
// no request that needs a person.
export const DEFAULT_SUPABASE_URL = 'https://pbldcmniommltbdwuykk.supabase.co';
export const CALLBACK_PATH = '/auth/callback/';
export const SESSION_KEY = 'wv.session';
const VERIFIER_KEY = 'wv.pkce';
const REFRESH_WINDOW_SECONDS = 60;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pkcePair(cryptoApi) {
  const verifier = b64url(cryptoApi.getRandomValues(new Uint8Array(32)));
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

// Only same-site paths survive as a post-sign-in destination.
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : '/world-vibe/';
}

export function createSession({ fetch: fetchFn, storage, supabaseUrl = DEFAULT_SUPABASE_URL, publishableKey = '', origin = 'https://go.somacheck.com', crypto: cryptoApi, now = () => Date.now() }) {
  const listeners = new Set();
  const read = () => {
    try { return JSON.parse(storage.getItem(SESSION_KEY)); } catch { return null; }
  };
  const write = (s) => { if (s) storage.setItem(SESSION_KEY, JSON.stringify(s)); else storage.removeItem(SESSION_KEY); listeners.forEach((fn) => fn()); };
  const live = (s) => s && typeof s.access_token === 'string' && s.access_token && s.expires_at * 1000 > now();
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
    email() { return live(read()) ? read().email : null; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Sends the magic link. Resolves { ok } or { error }.
    async signIn(email, { next = '/world-vibe/' } = {}) {
      if (!api.configured()) return { error: 'not_configured' };
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { error: 'invalid_email' };
      const { verifier, challenge } = await pkcePair(cryptoApi);
      storage.setItem(VERIFIER_KEY, verifier);
      const redirect = origin + CALLBACK_PATH + '?web=1&next=' + encodeURIComponent(safeNext(next));
      try {
        const r = await fetchFn(supabaseUrl + '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), {
          method: 'POST', headers: headers(),
          body: JSON.stringify({ email: email.trim(), code_challenge: challenge, code_challenge_method: 's256' })
        });
        return r.ok ? { ok: true } : { error: r.status === 429 ? 'rate_limited' : 'unavailable' };
      } catch { return { error: 'unavailable' }; }
    },

    // Called by /auth/callback/ for a web-initiated link: trades the PKCE code
    // for a session. Resolves { ok, next } or { error }.
    async completeSignIn(search) {
      const params = new URLSearchParams(search);
      const code = params.get('code');
      const verifier = storage.getItem(VERIFIER_KEY);
      if (!code || !verifier) return { error: 'no_pending_sign_in' };
      try {
        const r = await fetchFn(supabaseUrl + '/auth/v1/token?grant_type=pkce', {
          method: 'POST', headers: headers(), body: JSON.stringify({ auth_code: code, code_verifier: verifier })
        });
        if (!r.ok) return { error: 'exchange_failed' };
        const t = await r.json();
        storage.removeItem(VERIFIER_KEY);
        write({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at || Math.floor(now() / 1000) + (t.expires_in || 3600), user_id: t.user && t.user.id, email: t.user && t.user.email });
        return { ok: true, next: safeNext(params.get('next')) };
      } catch { return { error: 'exchange_failed' }; }
    },

    // Page start: an expired or nearly expired session is refreshed once, or
    // cleared if the refresh token no longer works.
    async restore() {
      const s = read();
      if (!s) return;
      if (s.expires_at * 1000 - now() > REFRESH_WINDOW_SECONDS * 1000) return;
      try {
        const r = await fetchFn(supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', headers: headers(), body: JSON.stringify({ refresh_token: s.refresh_token })
        });
        if (!r.ok) { write(null); return; }
        const t = await r.json();
        write({ ...s, access_token: t.access_token, refresh_token: t.refresh_token || s.refresh_token, expires_at: t.expires_at || Math.floor(now() / 1000) + (t.expires_in || 3600) });
      } catch { write(null); }
    },

    // Local sign-out always completes; the server revoke is best effort.
    async signOut() {
      const token = api.getAccessToken();
      write(null);
      storage.removeItem(VERIFIER_KEY);
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

export function getAccessToken() {
  return session ? session.getAccessToken() : null;
}

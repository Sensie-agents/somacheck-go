import { renderSharedCard, renderReveal, renderRoom, renderPrivateCard, renderEmpty, renderAccountBar, renderSignInSheet, renderCheckSheet, renderBringSheet, SIGNIN_STATUS } from './home-render.js';
import { DEFAULT_API, shareUrlFor } from './home-data.js';
import { createFlow } from './home-flow.js';
import { session } from '../session.js';
import { drawQr } from './qr.js';

const API = window.SOMACHECK_API_BASE || DEFAULT_API;
const call = (url, init) => fetch(url, init);
const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

const X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5159" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const slot = document.getElementById('slot');
const scrim = document.getElementById('scrim');
const sheet = document.getElementById('sheet');
let lastFocus = null;
// Email the sign-in sheet has already sent a code and link to; null = ask for one.
let signinEmail = null;
// Slug of the shared line whose check sheet opened the sign-in sheet. Once the
// person is signed in, that line goes to their phone without another tap. A
// sign-in from the account bar or the private card sends nothing.
let sendAfterSignIn = null;
// The emailed link lands in this same browser with the send still to do. The
// line and a nonce only that link carries go to session.signIn, which stores
// them with the link's verifier in one write; a successful exchange hands them
// back bound to the account it signed in, and the landing page claims that
// handoff under the cross-tab lock. So neither a bare ?send= address nor the
// link of an older attempt sends, and nothing sends as an account that signed
// in elsewhere meanwhile: only the sign-in this browser started from the check
// sheet, as that account, and only once.
const nonce = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
// What this sheet's own email request was for (null for an ordinary sign-in).
// A code typed here sends only while that request still owns the pending
// sign-in: a newer email request, from any tab, takes it over.
let signinIntent = null;
// Only the newest email request's response counts: two overlapping submits
// must not let the older response overwrite the newer intent and nonce.
let signinReq = 0;
// Bumped whenever the sheet closes: an automatic send still waiting on the
// phone route is dropped, and a sign-in response that lands after the sheet it
// was typed into closed completes the sign-in but sends nothing.
let sendOp = 0;
// The generation of the automatic send that is on its way, from the moment it
// reopens the check sheet until its send has started or been dropped: that
// sheet shows no Send button meanwhile, so a tap cannot post the same line
// twice. A sheet closed and reopened is a new generation, so a cancelled send
// still waiting on the phone route holds nothing back. 0 = none.
let autoSend = 0;

const token = () => session.getAccessToken();

const flow = createFlow({
  api: API, fetchFn: call, getToken: token, tz, arrivedFrom: new URLSearchParams(location.search).get('arrived_from'),
  ui: {
    render: () => render(),
    focusCard: () => focusCard(),
    openCheck: () => openSheet('check'),
    refreshCheck: () => { if (st.sheet === 'check') refreshCheckSheet(); },
    closeCheck: () => { if (st.sheet === 'check') closeSheet(); },
    closePersonal: () => { if (st.sheet && st.sheet !== 'how') closeSheet(); },
    note: (t) => { const n = document.getElementById('sent'); n.textContent = t; n.focus(); },
    focusConsent: () => { const c = document.getElementById('consent'); if (c) c.focus(); },
    signOut: () => session.signOut()
  }
});
const st = flow.st;
const currentLine = flow.currentLine;

function privateState() {
  const phase = !st.generated ? 'compose' : st.phase === 'done' ? 'done' : 'written';
  const line = currentLine();
  return { phase, ctx: st.pctx, line: st.generated && line ? line.statement : '', signedIn: Boolean(token()), consent: st.consent, error: st.perror };
}

function render() {
  document.querySelectorAll('[data-lane]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lane === st.lane)));
  slot.setAttribute('aria-labelledby', 'tab-' + st.lane);
  document.getElementById('account').innerHTML = renderAccountBar({ configured: session.configured(), email: session.email() });
  if (st.lane === 'shared') {
    if (st.phase === 'done' && st.progress) slot.innerHTML = st.mode === 'room' ? renderRoom(st.progress) : renderReveal(st.progress);
    else slot.innerHTML = st.pick ? renderSharedCard(st.pick) : renderEmpty(st.pickError);
  } else {
    slot.innerHTML = renderPrivateCard(privateState());
  }
}

// After a card swap the old focus target is gone; park focus on the new card.
function focusCard() {
  const a = slot.querySelector('article');
  if (a) { a.tabIndex = -1; a.focus(); }
}

function head(t) {
  return '<span class="grab" aria-hidden="true"></span><div class="sheet-head"><h2 id="sheet-title">' + t + '</h2><button class="x" type="button" data-act="close" aria-label="Close">' + X + '</button></div>';
}

function checkContext() {
  const priv = st.lane === 'private';
  return {
    statement: priv ? (currentLine() || {}).statement : st.pick.statement,
    slug: priv ? null : st.pick.slug,
    shareUrl: priv ? null : shareUrlFor(st.pick.slug),
    signedIn: Boolean(token()), phoneLinked: st.phoneLinked, linkRequired: st.linkRequired, sent: st.sent, pending: (autoSend !== 0 && autoSend === sendOp) || flow.sendingNow(), error: st.sendError
  };
}

function sheetHtml(kind) {
  if (kind === 'check') return head('Check in on') + renderCheckSheet(checkContext());
  if (kind === 'bring') return head('Bring your own vibecheck') + renderBringSheet();
  if (kind === 'signin') return head('Sign in') + renderSignInSheet(signinEmail ? 'sent' : undefined, { email: signinEmail || '' });
  const S = [
    ['Capture', 'Highlight any line on the web and write your take in one sentence.', 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'],
    ['Check in', 'Hold your phone for the 3-second gesture. Your body answers, not your thumbs.', 'M7 2.5h10v19H7zM11 18.5h2'],
    ['See the vibe', 'At 3 people a lean appears. At 10, the full split. Never who.', 'M3 12h3l3-7 4 14 3-7h5']
  ];
  return head('How it works') + S.map((s) => '<div class="step"><span class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + s[2] + '"/></svg></span><div><b>' + s[0] + '</b><span>' + s[1] + '</span></div></div>').join('') +
    '<p class="fine left">Lines chosen for you always say why. We pick by relevance and by how close a line is to revealing, never to push a side.</p>';
}

function openSheet(kind) {
  if (scrim.hidden) lastFocus = document.activeElement;
  st.sheet = kind;
  sheet.innerHTML = sheetHtml(kind);
  scrim.hidden = false;
  drawQr();
  const f = sheet.querySelector(kind === 'signin' ? 'input' : '.btn-main,.x');
  if (f) f.focus();
}

// Re-draws the open check sheet after a send result and keeps focus inside it.
function refreshCheckSheet() {
  sheet.innerHTML = sheetHtml('check');
  drawQr();
  const f = sheet.querySelector('.btn-main') || document.getElementById('sent');
  if (f) f.focus();
}

function closeSheet() {
  scrim.hidden = true;
  st.sheet = null;
  signinEmail = null;
  sendAfterSignIn = null;
  signinIntent = null;
  sendOp++;
  if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
}

// Finishes a sign-in that was for a line: reopens the check sheet on that
// line and, once the phone route says linked, sends it. `uid` is the account
// the sign-in verified and `sid` the email request it came from; the send goes
// out only as that account and only while that request is still the latest.
// False when there is nothing to send (ordinary sign-in, signed out, or the
// card moved on), so the caller parks focus instead.
async function sendNow({ slug, uid, sid }) {
  if (!slug || !uid || !sid || !token() || st.lane !== 'shared' || !st.pick || st.pick.slug !== slug) return false;
  const op = ++sendOp;
  // Signing in re-rendered the card, so the saved focus target is gone: the
  // sheet opens from the card's own button and returns focus there on close.
  const b = slot.querySelector('[data-act="check"]');
  if (b) b.focus();
  autoSend = op;
  try {
    await flow.openCheck();
    if (op !== sendOp || st.sheet !== 'check' || st.phoneLinked !== true || !st.pick || st.pick.slug !== slug) return true;
    // Final check and the start of the send as one step under the cross-tab
    // lock, from one read of the session: still the account that asked, and
    // its request still the latest. The ask goes out with exactly that token.
    await session.locked(() => {
      // Waiting for the lock was one more gap: the sheet, the card, the
      // generation and any send already made are checked again here.
      if (op !== sendOp || st.sheet !== 'check' || st.phoneLinked !== true || !st.pick || st.pick.slug !== slug || st.sent || flow.sendingNow()) return;
      const s = session.snapshot();
      if (!s.token || s.user_id !== uid || session.lastSignInId() !== sid) return;
      flow.sendShared({ token: s.token });
    });
  } finally {
    if (autoSend === op) autoSend = 0;
    // Dropped without a send while its sheet is still open: offer the button.
    if (op === sendOp && st.sheet === 'check' && !st.sent && !flow.sendingNow()) refreshCheckSheet();
  }
  return true;
}

document.addEventListener('click', (e) => {
  const l = e.target.closest('[data-lane]');
  if (l) { flow.selectLane(l.dataset.lane === 'private' ? 'private' : 'shared'); return; }
  const o = e.target.closest('[data-open]');
  if (o) {
    if (o.dataset.open === 'signin') sendAfterSignIn = st.sheet === 'check' && st.lane === 'shared' && st.pick ? st.pick.slug : null;
    openSheet(o.dataset.open); return;
  }
  const c = e.target.closest('[data-ctx]');
  if (c) { st.pctx = c.dataset.ctx; st.perror = null; render(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) { if (e.target === scrim) closeSheet(); return; }
  const act = a.dataset.act;
  if (act === 'check') flow.openCheck();
  else if (act === 'close') closeSheet();
  else if (act === 'send') (st.lane === 'private' ? flow.sendPrivate() : flow.sendShared());
  else if (act === 'checked') flow.checkProgress();
  else if (act === 'next' || act === 'skip') flow.skip();
  else if (act === 'retry') flow.retry();
  else if (act === 'generate') flow.generate((document.getElementById('mind') || {}).value);
  else if (act === 'rewrite') { st.didx++; render(); }
  else if (act === 'edit') { st.generated = false; st.pctx = 'words'; render(); }
  else if (act === 'lane-shared') flow.selectLane('shared');
  else if (act === 'signout') session.signOut();
});

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-consent]')) flow.toggleConsent(e.target.checked);
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'signin-form') {
    e.preventDefault();
    const email = String(new FormData(e.target).get('email') || '').trim();
    // Captured before the await: a sheet opened after this one closed is a
    // different attempt and gets neither the code stage nor the intent.
    const op = sendOp, req = ++signinReq;
    const intent = sendAfterSignIn ? { slug: sendAfterSignIn, nonce: nonce() } : null;
    const next = intent ? '/world-vibe/?arrived_from=' + encodeURIComponent(intent.slug) + '&send=' + intent.nonce : '/world-vibe/';
    const r = await session.signIn(email, { next, send: intent });
    if (op !== sendOp || req !== signinReq) return;
    if (r.ok && st.sheet === 'signin') {
      signinIntent = intent ? { ...intent, id: r.id } : null;
      // The code and the link are on their way: swap to the code field.
      signinEmail = email;
      sheet.innerHTML = sheetHtml('signin');
      const c = document.getElementById('si-code');
      if (c) c.focus();
      return;
    }
    const status = document.getElementById('si-status');
    if (status) status.textContent = SIGNIN_STATUS[r.ok ? 'sent' : r.error] || SIGNIN_STATUS.unavailable;
    return;
  }
  if (e.target.id !== 'code-form') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const op = sendOp, want = sendAfterSignIn, attempt = signinIntent;
  const r = await session.verifyCode(String(fd.get('email') || ''), String(fd.get('code') || ''));
  // The sheet this code was typed into may have closed while GoTrue answered:
  // whatever replaced it is a different attempt and gets no send and no status.
  const same = op === sendOp;
  if (r.ok) {
    // Only this code's own sheet closes: a newer sign-in sheet opened since
    // is another attempt, left exactly as it is.
    if (same && st.sheet === 'signin') closeSheet();
    // Sends only while this sheet's request is still the latest sign-in, and
    // only as the account the code signed in.
    const owns = Boolean(attempt) && session.lastSignInId() === attempt.id;
    if (same && owns && await sendNow({ slug: want, uid: r.user_id, sid: attempt.id })) return;
    // A stale success while another sheet is open leaves focus inside it.
    if (!scrim.hidden) return;
    // The control that opened the sheet is gone (the account bar now shows the
    // address), so closeSheet could not restore focus: park it on the card.
    const acct = document.getElementById('account');
    if (acct) { acct.tabIndex = -1; acct.focus(); } else focusCard();
    return;
  }
  if (!same) return;
  const status = document.getElementById('si-status');
  if (status) status.textContent = SIGNIN_STATUS[r.error === 'unavailable' ? 'verify_unavailable' : r.error] || SIGNIN_STATUS.verify_unavailable;
});

// Keep Tab inside the open sheet; Escape closes it.
scrim.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSheet(); return; }
  if (e.key !== 'Tab') return;
  const f = sheet.querySelectorAll('button,a[href],input,textarea');
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// An account change while a send is on its way is caught by the send itself:
// it is bound to the account that asked and checks the session before posting.
session.onChange(() => { if (!session.getAccessToken()) flow.signedOut(); else render(); });

async function load() {
  if (window.SOMACHECK_INSTALL_URL) document.getElementById('get-app').href = window.SOMACHECK_INSTALL_URL;
  await session.restore();
  // The account the emailed link signed in and the latest sign-in request,
  // before the pick is awaited: a sign-in landing in another tab or a newer
  // email request meanwhile must not have the line sent.
  const op = sendOp, uid = session.userId(), sid = session.lastSignInId();
  await flow.showPick();
  const q = new URLSearchParams(location.search);
  if (q.get('signin') === '1' && !token() && session.configured()) openSheet('signin');
  if (q.get('send') && q.get('arrived_from')) {
    // Back from the emailed link: the send that sign-in was for happens now,
    // once, and only for the link the kept intent was made for.
    history.replaceState(null, '', location.pathname);
    // Only the matching handoff is used up, by one tab: another tab's newer
    // one keeps waiting, and a second tab landing here finds nothing.
    const t = await session.claimSend(q.get('arrived_from'), q.get('send'));
    // The exchange bound the handoff to the account its link signed in and to
    // the request the link came from: that account must be the one signed in
    // here, now and when the pick returns, and that request still the latest.
    if (t && op === sendOp && uid && t.user === uid && session.userId() === uid && sid && t.signin === sid && session.lastSignInId() === sid) await sendNow({ slug: t.slug, uid: t.user, sid: t.signin });
  }
}

load();

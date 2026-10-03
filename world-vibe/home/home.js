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
    signedIn: Boolean(token()), phoneLinked: st.phoneLinked, linkRequired: st.linkRequired, sent: st.sent, error: st.sendError
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
  if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
}

document.addEventListener('click', (e) => {
  const l = e.target.closest('[data-lane]');
  if (l) { flow.selectLane(l.dataset.lane === 'private' ? 'private' : 'shared'); return; }
  const o = e.target.closest('[data-open]');
  if (o) { openSheet(o.dataset.open); return; }
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
    const r = await session.signIn(email);
    if (r.ok && st.sheet === 'signin') {
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
  const r = await session.verifyCode(String(fd.get('email') || ''), String(fd.get('code') || ''));
  if (r.ok) {
    if (st.sheet === 'signin') closeSheet();
    // The control that opened the sheet is gone (the account bar now shows the
    // address), so closeSheet could not restore focus: park it on the card.
    const acct = document.getElementById('account');
    if (acct) { acct.tabIndex = -1; acct.focus(); } else focusCard();
    return;
  }
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

session.onChange(() => { if (!session.getAccessToken()) flow.signedOut(); else render(); });

async function load() {
  if (window.SOMACHECK_INSTALL_URL) document.getElementById('get-app').href = window.SOMACHECK_INSTALL_URL;
  await session.restore();
  await flow.showPick();
  if (new URLSearchParams(location.search).get('signin') === '1' && !token() && session.configured()) openSheet('signin');
}

load();

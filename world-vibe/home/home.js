import { renderSharedCard, renderReveal, renderRoom, renderPrivateCard, renderEmpty, renderAccountBar, renderSignInSheet, renderCheckSheet, renderBringSheet, SIGNIN_STATUS } from './home-render.js';
import { DEFAULT_API, extendExcludes, loadPick, loadProgress, sendToPhone, generateDrafts, askPrivate, getConsent, setConsent, shareUrlFor } from './home-data.js';
import { session } from '../session.js';
import { drawQr } from './qr.js';

const API = window.SOMACHECK_API_BASE || DEFAULT_API;
const call = (url, init) => fetch(url, init);
const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const POLL_MS = 4000;
const POLL_MAX = 40;

const X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5159" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const st = {
  lane: 'shared', phase: 'card', pick: null, pickError: false, excludes: [], arrivedFrom: new URLSearchParams(location.search).get('arrived_from'),
  progress: null, mode: 'reveal', receipt: null, linkRequired: false, sent: false, sendError: null,
  pctx: 'agent', drafts: [], didx: 0, generated: false, consent: null, perror: null, sheet: null
};

const slot = document.getElementById('slot');
const scrim = document.getElementById('scrim');
const sheet = document.getElementById('sheet');
let lastFocus = null;
let pollTimer = null;

const token = () => session.getAccessToken();
const currentLine = () => (st.drafts.length ? st.drafts[st.didx % st.drafts.length] : null);

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

async function showPick() {
  const r = await loadPick(call, API, { exclude: st.excludes, tz, arrivedFrom: st.arrivedFrom, token: token() });
  st.arrivedFrom = null;
  st.pick = r.pick;
  st.pickError = Boolean(r.error);
  st.phase = 'card';
  st.sent = false; st.sendError = null; st.receipt = null;
  render();
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
    signedIn: Boolean(token()), linkRequired: st.linkRequired, sent: st.sent, error: st.sendError
  };
}

function sheetHtml(kind) {
  if (kind === 'check') return head('Check in on') + renderCheckSheet(checkContext());
  if (kind === 'bring') return head('Bring your own line') + renderBringSheet();
  if (kind === 'signin') return head('Sign in') + renderSignInSheet();
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
  if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
}

function stopPoll() { clearTimeout(pollTimer); pollTimer = null; }

// The receipt is the ask's request id: only the signed-in person who sent it can
// read their own progress with it. Without one the page can show the room only.
async function checkProgress({ silent = false } = {}) {
  const slug = st.pick && st.pick.slug;
  if (!slug) return false;
  const r = await loadProgress(call, API, slug, { receipt: st.receipt, token: token() });
  if (!r.progress) { if (!silent) { st.sendError = 'error'; refreshCheckSheet(); } return false; }
  if (st.receipt && r.progress.your_checkin_counted !== true) {
    if (!silent) { st.sendError = null; document.getElementById('sent').textContent = 'Not yet. Finish the check-in on your phone first.'; document.getElementById('sent').focus(); }
    return false;
  }
  stopPoll();
  st.progress = r.progress;
  st.mode = st.receipt ? 'reveal' : 'room';
  st.phase = 'done';
  if (st.sheet === 'check') closeSheet();
  render();
  focusCard();
  return true;
}

function startPoll() {
  stopPoll();
  let n = 0;
  const tick = async () => {
    if (st.phase === 'done' || !st.receipt || ++n > POLL_MAX) return;
    if (!(await checkProgress({ silent: true }))) pollTimer = setTimeout(tick, POLL_MS);
  };
  pollTimer = setTimeout(tick, POLL_MS);
}

async function sendShared() {
  const r = await sendToPhone(call, API, st.pick.slug, token());
  st.sendError = null;
  if (r.status === 'sent') { st.sent = true; st.receipt = r.requestId; startPoll(); }
  else if (r.status === 'link_required') st.linkRequired = true;
  else st.sendError = r.status;
  refreshCheckSheet();
}

async function sendPrivate() {
  const line = currentLine();
  const r = line ? await askPrivate(call, API, line.id, token()) : { status: 'error' };
  st.sendError = r.status === 'sent' ? null : r.status;
  st.sent = r.status === 'sent';
  refreshCheckSheet();
}

async function loadConsent() {
  const r = await getConsent(call, session);
  st.consent = r.consent;
  st.perror = r.error && r.error !== 'signin' ? 'consent_unavailable' : null;
  if (st.lane === 'private') render();
}

async function generate() {
  st.perror = null;
  if (st.consent !== true) { st.perror = 'consent_required'; render(); return; }
  const words = st.pctx === 'words' ? (document.getElementById('mind') || {}).value || '' : '';
  if (st.pctx === 'words' && !words.trim()) { st.perror = 'empty_words'; render(); return; }
  const r = await generateDrafts(call, API, { source: st.pctx, words: words.trim() }, token());
  if (r.error === 'signin') { await session.signOut(); st.perror = null; return; }
  if (r.error === 'consent_required') st.consent = false;
  if (r.error) { st.perror = r.error; render(); return; }
  st.drafts = r.drafts; st.didx = 0; st.generated = true; st.phase = 'card';
  render();
  focusCard();
}

function resetPerson() {
  stopPoll();
  st.consent = null; st.drafts = []; st.generated = false; st.linkRequired = false; st.receipt = null; st.sent = false; st.sendError = null; st.perror = null;
  if (st.sheet && st.sheet !== 'how') closeSheet();
  render();
}

function enterPrivate() {
  st.lane = 'private'; st.phase = 'card';
  render();
  if (token() && st.consent === null) loadConsent();
}

document.addEventListener('click', (e) => {
  const l = e.target.closest('[data-lane]');
  if (l) { if (l.dataset.lane === 'private') enterPrivate(); else { st.lane = 'shared'; st.phase = 'card'; render(); } return; }
  const o = e.target.closest('[data-open]');
  if (o) { openSheet(o.dataset.open); return; }
  const c = e.target.closest('[data-ctx]');
  if (c) { st.pctx = c.dataset.ctx; st.perror = null; render(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) { if (e.target === scrim) closeSheet(); return; }
  const act = a.dataset.act;
  if (act === 'check') { st.sent = false; st.sendError = null; openSheet('check'); }
  else if (act === 'close') closeSheet();
  else if (act === 'send') (st.lane === 'private' ? sendPrivate() : sendShared());
  else if (act === 'checked') checkProgress();
  else if (act === 'next' || act === 'skip') { stopPoll(); st.excludes = extendExcludes(st.excludes, st.pick.slug); showPick(); }
  else if (act === 'retry') { if (!st.pickError) st.excludes = []; showPick(); }
  else if (act === 'generate') generate();
  else if (act === 'rewrite') { st.didx++; render(); }
  else if (act === 'edit') { st.generated = false; st.pctx = 'words'; render(); }
  else if (act === 'lane-shared') { st.lane = 'shared'; st.phase = 'card'; render(); }
  else if (act === 'signout') session.signOut();
});

document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-consent]')) return;
  const want = e.target.checked;
  const r = await setConsent(call, session, want);
  if (r.consent === null) { st.perror = r.error === 'signin' ? null : 'consent_unavailable'; if (r.error === 'signin') await session.signOut(); }
  else { st.consent = r.consent; st.perror = null; }
  render();
  const again = document.getElementById('consent');
  if (again) again.focus();
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'signin-form') return;
  e.preventDefault();
  const status = document.getElementById('si-status');
  const r = await session.signIn(new FormData(e.target).get('email'));
  status.textContent = SIGNIN_STATUS[r.ok ? 'sent' : r.error] || SIGNIN_STATUS.unavailable;
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

session.onChange(() => { if (!session.getAccessToken()) resetPerson(); else render(); });

async function load() {
  if (window.SOMACHECK_INSTALL_URL) document.getElementById('get-app').href = window.SOMACHECK_INSTALL_URL;
  await session.restore();
  await showPick();
  if (new URLSearchParams(location.search).get('signin') === '1' && !token() && session.configured()) openSheet('signin');
}

load();

// State and async flow for the World Vibe v3 home, kept free of the DOM so the
// lifecycle (sign-out, lane switches, in-flight responses) can be tested with
// recorded responses. home.js owns rendering and focus; it hands this module
// `ui` callbacks. Every await that can outlive what the person is looking at
// re-checks a scope before it writes state: the sign-out generation, the lane,
// and the item or draft the request started from.
import { extendExcludes, loadPick, loadProgress, sendToPhone, generateDrafts, askPrivate, getConsent, setConsent, loadPhoneLinked } from './home-data.js';

export const POLL_MS = 4000;
export const POLL_MAX = 40;

export function createFlow({ api, fetchFn, getToken, tz = 'UTC', arrivedFrom = null, ui, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const st = {
    lane: 'shared', phase: 'card', pick: null, pickError: false, excludes: [], arrivedFrom,
    progress: null, mode: 'reveal', receipt: null, phoneLinked: null, linkRequired: false, sent: false, sendError: null,
    pctx: 'agent', drafts: [], didx: 0, generated: false, consent: null, perror: null, sheet: null
  };
  let gen = 0;
  let pickSeq = 0;
  // Consent is last-write-wins by WRITE sequence. A read applies only if no write
  // started after it did and it is the newest read; a write's outcome (value,
  // error, or sign-out) always lands unless a newer write superseded it.
  let readSeq = 0;
  let writeSeq = 0;
  let pollTimer = null;

  const currentLine = () => (st.drafts.length ? st.drafts[st.didx % st.drafts.length] : null);
  const scopeKey = () => st.lane + ':' + (st.lane === 'private' ? (currentLine() || {}).id : st.pick && st.pick.slug);
  // Returns a check that is false once the person signed out, switched lane, or
  // moved to another line, so a late response is dropped instead of shown.
  const scoped = () => {
    const g = gen, k = scopeKey();
    return () => g === gen && k === scopeKey();
  };
  const signedGen = () => { const g = gen; return () => g === gen; };

  function stopPoll() { clearTimer(pollTimer); pollTimer = null; }

  async function showPick() {
    const seq = ++pickSeq;
    const still = signedGen();
    const r = await loadPick(fetchFn, api, { exclude: st.excludes, tz, arrivedFrom: st.arrivedFrom, token: getToken() });
    if (seq !== pickSeq || !still()) return;
    st.arrivedFrom = null;
    st.pick = r.pick;
    st.pickError = Boolean(r.error);
    st.phase = 'card';
    st.sent = false; st.sendError = null; st.receipt = null;
    ui.render();
  }

  function selectLane(lane) {
    st.lane = lane; st.phase = 'card';
    ui.render();
    if (lane === 'private' && getToken() && st.consent === null) loadConsent();
  }

  function skip() { stopPoll(); st.excludes = extendExcludes(st.excludes, st.pick.slug); return showPick(); }
  function retry() { if (!st.pickError) st.excludes = []; return showPick(); }

  // Opening the check sheet learns whether "Send to my phone" may be offered.
  async function openCheck() {
    st.sent = false; st.sendError = null;
    ui.openCheck();
    if (getToken() && st.phoneLinked === null) {
      const still = signedGen();
      const linked = await loadPhoneLinked(fetchFn, api, getToken());
      if (!still()) return;
      st.phoneLinked = linked;
      ui.refreshCheck();
    }
  }

  // The receipt is the ask's request id: only the signed-in person who sent it
  // can read their own progress with it. Without one the page shows the room.
  async function checkProgress({ silent = false } = {}) {
    const slug = st.pick && st.pick.slug;
    if (!slug || st.lane !== 'shared') return false;
    const still = scoped();
    const receipt = st.receipt;
    const r = await loadProgress(fetchFn, api, slug, { receipt, token: getToken() });
    if (!still()) return false;
    if (!r.progress) { if (!silent) { st.sendError = 'error'; ui.refreshCheck(); } return false; }
    if (receipt && r.progress.your_checkin_counted !== true) {
      if (!silent) { st.sendError = null; ui.note('Not yet. Finish the check-in on your phone first.'); }
      return false;
    }
    stopPoll();
    st.progress = r.progress;
    st.mode = receipt ? 'reveal' : 'room';
    st.phase = 'done';
    ui.closeCheck();
    ui.render();
    ui.focusCard();
    return true;
  }

  function startPoll() {
    stopPoll();
    const still = scoped();
    let n = 0;
    const tick = async () => {
      if (!still()) { stopPoll(); return; }
      if (st.phase === 'done' || !st.receipt || ++n > POLL_MAX) return;
      if (!(await checkProgress({ silent: true }))) pollTimer = setTimer(tick, POLL_MS);
    };
    pollTimer = setTimer(tick, POLL_MS);
  }

  async function sendShared() {
    const still = scoped();
    const r = await sendToPhone(fetchFn, api, st.pick.slug, getToken());
    if (!still()) return;
    st.sendError = null;
    if (r.status === 'sent') { st.sent = true; st.receipt = r.requestId; startPoll(); }
    else if (r.status === 'link_required') { st.linkRequired = true; st.phoneLinked = false; }
    else st.sendError = r.status;
    ui.refreshCheck();
  }

  async function sendPrivate() {
    const line = currentLine();
    const still = scoped();
    const r = line ? await askPrivate(fetchFn, api, line.id, getToken()) : { status: 'error' };
    if (!still()) return;
    st.sendError = r.status === 'sent' ? null : r.status;
    st.sent = r.status === 'sent';
    ui.refreshCheck();
  }

  async function loadConsent() {
    const still = signedGen();
    const rseq = ++readSeq, wseq = writeSeq;
    const r = await getConsent(fetchFn, api, getToken());
    if (!still() || rseq !== readSeq || wseq !== writeSeq) return;
    st.consent = r.consent;
    st.perror = r.error && r.error !== 'signin' ? 'consent_unavailable' : null;
    if (st.lane === 'private') ui.render();
  }

  async function toggleConsent(want) {
    const still = signedGen();
    const seq = ++writeSeq;
    const r = await setConsent(fetchFn, api, getToken(), want);
    if (!still()) return;
    const expired = r.consent === null && r.error === 'signin';
    if (seq !== writeSeq && !expired) return;
    readSeq++;   // only the latest write's settle makes a read that started during it stale
    if (r.consent === null) {
      st.perror = expired ? null : 'consent_unavailable';
      if (expired) await ui.signOut();
    } else { st.consent = r.consent; st.perror = null; }
    ui.render();
    ui.focusConsent();
  }

  // Only the agent source needs the stored-context consent: the words a person
  // types are theirs to send, so "A few words from me" writes with consent off.
  async function generate(rawWords) {
    st.perror = null;
    const agent = st.pctx === 'agent';
    if (agent && st.consent !== true) { st.perror = 'consent_required'; ui.render(); return; }
    const words = agent ? '' : String(rawWords || '').trim();
    if (!agent && !words) { st.perror = 'empty_words'; ui.render(); return; }
    const still = scoped();
    const r = await generateDrafts(fetchFn, api, { source: st.pctx, words }, getToken());
    if (!still()) return;
    if (r.error === 'signin') { await ui.signOut(); st.perror = null; return; }
    if (r.error === 'consent_required') st.consent = false;
    if (r.error) { st.perror = r.error; ui.render(); return; }
    st.drafts = r.drafts; st.didx = 0; st.generated = true; st.phase = 'card';
    ui.render();
    ui.focusCard();
  }

  // Signing out clears everything personal and invalidates every request that
  // started while signed in: progress (and the own reading in it), drafts,
  // consent, the phone link and any ask receipt.
  function signedOut() {
    gen++;
    stopPoll();
    st.progress = null; st.mode = 'reveal'; st.phase = 'card';
    st.consent = null; st.drafts = []; st.didx = 0; st.generated = false;
    st.phoneLinked = null; st.linkRequired = false; st.receipt = null; st.sent = false; st.sendError = null; st.perror = null;
    ui.closePersonal();
    ui.render();
  }

  return { st, currentLine, showPick, selectLane, skip, retry, openCheck, checkProgress, sendShared, sendPrivate, loadConsent, toggleConsent, generate, signedOut, stopPoll };
}

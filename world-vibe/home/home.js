import { renderSharedCard, renderReveal, renderPrivateCard, esc } from './home-render.js';

// WP5 runs on fixtures. WP6/WP9 replace load() with the real endpoints; the
// render functions do not change.
const PICKS = ['shared_link', 'topic_of_week', 'closest_to_unlock', 'time_of_day', 'trending_in_category', 'following', 'most_checked'];

const X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5159" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const QR = '<svg width="140" height="140" viewBox="0 0 29 29" role="img" aria-label="QR code placeholder" shape-rendering="crispEdges"><rect width="29" height="29" fill="#FFFFFF"/><path fill="#16181B" d="M1 1h7v7H1zM21 1h7v7h-7zM1 21h7v7H1z"/><path fill="#FFFFFF" d="M2 2h5v5H2zM22 2h5v5h-5zM2 22h5v5H2z"/><path fill="#16181B" d="M3 3h3v3H3zM23 3h3v3h-3zM3 23h3v3H3zM10 1h1v1h-1zM12 2h2v1h-2zM10 4h3v1h-3zM15 1h1v3h-1zM17 3h2v2h-2zM11 6h1v2h-1zM14 6h3v1h-3zM1 10h2v1H1zM4 11h3v1H4zM9 10h2v2H9zM12 9h1v3h-1zM15 10h3v1h-3zM19 9h2v2h-2zM23 10h3v1h-3zM2 13h1v2H2zM9 13h4v1H9zM17 13h2v2h-2zM24 13h2v2h-2zM1 17h3v1H1zM9 16h2v1H9zM12 17h3v2h-3zM18 17h3v1h-3zM23 16h1v3h-1zM10 20h1v2h-1zM13 21h2v1h-2zM17 20h1v3h-1zM20 21h3v1h-3zM10 24h3v1h-3zM14 25h1v3h-1zM16 24h2v1h-2zM22 26h3v1h-3zM26 23h2v2h-2z"/><circle cx="14.5" cy="14.5" r="3.4" fill="#FFFFFF"/><circle cx="14.5" cy="14.5" r="2.4" fill="none" stroke="#12A594" stroke-width=".6"/><circle cx="14.5" cy="14.5" r="1.1" fill="#F4B26B"/></svg>';

const getJson = (name) => fetch('fixtures/' + name).then((r) => r.json());

const st = { lane: 'shared', idx: 0, pidx: 0, phase: 'card', pctx: 'agent', pgenerated: false, picks: [], lines: [], progress: null };

const slot = document.getElementById('slot');
const scrim = document.getElementById('scrim');
const sheet = document.getElementById('sheet');
let lastFocus = null;

function currentPick() { return st.picks[st.idx % st.picks.length]; }
function currentLine() { return st.lines[st.pidx % st.lines.length]; }

function privateState() {
  const phase = !st.pgenerated ? 'compose' : st.phase === 'done' ? 'done' : 'written';
  return { phase, ctx: st.pctx, line: st.pgenerated ? currentLine() : '' };
}

function render() {
  document.querySelectorAll('[data-lane]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lane === st.lane)));
  slot.setAttribute('aria-labelledby', 'tab-' + st.lane);
  if (st.lane === 'shared') {
    slot.innerHTML = st.phase === 'done' && st.progress ? renderReveal(st.progress) : renderSharedCard(currentPick());
  } else {
    slot.innerHTML = renderPrivateCard(privateState());
  }
}

function head(t) {
  return '<span class="grab" aria-hidden="true"></span><div class="sheet-head"><h2 id="sheet-title">' + t + '</h2><button class="x" type="button" data-act="close" aria-label="Close">' + X + '</button></div>';
}

function openSheet(kind) {
  lastFocus = document.activeElement;
  let html = '';
  if (kind === 'check') {
    const line = st.lane === 'shared' ? currentPick().statement : currentLine();
    html = head('Check in on') + '<p class="big">' + esc(line) + '</p><button class="btn-main" type="button" data-act="send">Send to my phone</button><div class="fine sent" id="sent" role="status"></div><div class="or">or scan</div><div class="qr">' + QR + 'With your iPhone camera</div><p class="fine">Three seconds. Your body answers, not your thumbs.</p>';
  } else if (kind === 'bring') {
    html = head('Bring your own line') +
      '<div class="chrome"><small>ON A COMPUTER</small><b>Highlight any line on the web and bring it here with one click.</b><a href="#">Add to Chrome</a></div>' +
      '<div class="or">or paste it</div>' +
      '<div class="field"><label for="b-url">Link to the article or post</label><input id="b-url" type="url" placeholder="https://"></div>' +
      '<div class="field"><label for="b-line">Your line</label><textarea id="b-line" rows="2" maxlength="140" placeholder="I think..." aria-describedby="b-hint"></textarea><span class="hint" id="b-hint"><span id="b-msg">Start with I or My. Everyone checks their body against this.</span><span id="b-count">0 / 140</span></span></div>' +
      '<fieldset><legend>Who sees it</legend><label class="radio"><input type="radio" name="vis" id="vis-all" checked>Everyone on World Vibe</label><label class="radio"><input type="radio" name="vis" id="vis-me">Just me</label></fieldset>' +
      '<button class="btn-main" type="button" data-act="bring-send">Send to my phone</button><p class="fine">Your check-in counts first. A shared line appears on World Vibe after your gesture.</p>';
  } else if (kind === 'how') {
    const S = [
      ['Capture', 'Highlight any line on the web and write your take in one sentence.', 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'],
      ['Check in', 'Hold your phone for the 3-second gesture. Your body answers, not your thumbs.', 'M7 2.5h10v19H7zM11 18.5h2'],
      ['See the vibe', 'At 3 people a lean appears. At 10, the full split. Never who.', 'M3 12h3l3-7 4 14 3-7h5']
    ];
    html = head('How it works') + S.map((s) => '<div class="step"><span class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + s[2] + '"/></svg></span><div><b>' + s[0] + '</b><span>' + s[1] + '</span></div></div>').join('') +
      '<p class="fine left">Lines chosen for you always say why. We pick by relevance and by how close a line is to revealing, never to push a side.</p>';
  }
  sheet.innerHTML = html;
  scrim.hidden = false;
  const f = sheet.querySelector('.btn-main,.x');
  if (f) f.focus();
  const bl = document.getElementById('b-line');
  if (bl) {
    bl.addEventListener('input', () => {
      const v = bl.value.trim();
      const ok = /^(I|My)\b/.test(v);
      document.getElementById('b-count').textContent = bl.value.length + ' / 140';
      document.getElementById('b-hint').classList.toggle('bad', !ok && v.length > 0);
      document.getElementById('b-msg').textContent = ok || !v ? 'Start with I or My. Everyone checks their body against this.' : 'Lines start with I or My, so each person checks it against themselves.';
    });
  }
}

function closeSheet() {
  scrim.hidden = true;
  if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
}

document.addEventListener('click', (e) => {
  const l = e.target.closest('[data-lane]');
  if (l) { st.lane = l.dataset.lane; st.phase = 'card'; render(); return; }
  const o = e.target.closest('[data-open]');
  if (o) { openSheet(o.dataset.open); return; }
  const c = e.target.closest('[data-ctx]');
  if (c) { st.pctx = c.dataset.ctx; render(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) { if (e.target === scrim) closeSheet(); return; }
  const act = a.dataset.act;
  if (act === 'check') openSheet('check');
  else if (act === 'close') closeSheet();
  else if (act === 'send') document.getElementById('sent').textContent = 'Sent. Open SomaCheck on your phone.';
  else if (act === 'next') { st.idx++; st.phase = 'card'; render(); }
  else if (act === 'skip') { st.idx++; render(); }
  else if (act === 'generate') { st.pgenerated = true; st.phase = 'card'; render(); }
  else if (act === 'rewrite') { st.pidx++; render(); }
  else if (act === 'edit') { st.pgenerated = false; st.pctx = 'words'; render(); }
  else if (act === 'lane-shared') { st.lane = 'shared'; st.phase = 'card'; render(); }
  else if (act === 'bring-send') a.textContent = 'Sent. Finish on your phone.';
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

async function load() {
  if (window.SOMACHECK_INSTALL_URL) document.getElementById('get-app').href = window.SOMACHECK_INSTALL_URL;
  const [picks, lines] = await Promise.all([
    Promise.all(PICKS.map((r) => getJson('pick-' + r + '.json'))),
    getJson('private-lines.json')
  ]);
  st.picks = picks;
  st.lines = lines;
  // Review hook until real progress polling lands: ?state=revealed shows the
  // post check-in screen from the progress fixture.
  if (new URLSearchParams(location.search).get('state') === 'revealed') {
    st.progress = await getJson('progress-revealed.json');
    st.phase = 'done';
  }
  render();
}

load();

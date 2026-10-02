import { selectItems, renderFeed, renderFilterText, renderCuratorList, renderStrip, renderSteps, renderHero, renderEnd, nextTab, focusSelector } from './explore-render.js';
import { getAccessToken, session } from '../session.js';
import { renderCheckSheet } from '../home/home-render.js';
import { sendToPhone, shareUrlFor } from '../home/home-data.js';
import { drawQr } from '../home/qr.js';
import { DEFAULT_API, loadFeedInto, retryCursor, loadCurators, loadFeatured, loadFollowing } from './explore-data.js';

const API = window.SOMACHECK_API_BASE || DEFAULT_API;
const call = (url, init) => fetch(url, init);

const st = { tab: 'all', curator: null };
const data = { feed: [], feedCursor: null, following: [], curators: [], featured: null, feedError: false, followingError: null };
let followingLoading = false;

const $ = (id) => document.getElementById(id);
let lastFocus = null;

// Re-rendering replaces the lists through innerHTML, which would drop focus
// from the control the user just activated. Remember it and put it back.
function render() {
  const keep = focusSelector(document.activeElement);
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === st.tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  $('feed').setAttribute('aria-labelledby', 'tab-' + st.tab);
  $('feed').innerHTML = renderFeed(st, data);
  $('cur-list').innerHTML = renderCuratorList(data.curators, st);
  $('strip').innerHTML = renderStrip(data.curators, st);
  $('filter').hidden = !st.curator;
  $('filter-text').textContent = renderFilterText(st, data.curators);
  $('hero').innerHTML = renderHero(data.featured);
  $('hero').hidden = !$('hero').innerHTML;
  $('end').innerHTML = renderEnd(st, data);
  $('end').hidden = !$('end').innerHTML;
  if (keep) { const again = document.querySelector(keep); if (again) again.focus(); }
}

function loadFollowingTab() {
  if (followingLoading) return;
  followingLoading = true;
  loadFollowing(call, API, getAccessToken).then((r) => { data.following = r.items; data.followingError = r.error; followingLoading = false; render(); });
}

function selectTab(name) {
  st.tab = name; st.curator = null; render();
  if (name === 'following' && (data.followingError || !data.following.length)) loadFollowingTab();
}

const loadFeedPages = (cursor) => loadFeedInto(data, call, API, cursor);

const sheetState = { line: '', slug: '', linkRequired: false, sent: false, error: null };

// The sheet is the same body as the home's: send to my phone only for a signed-in
// account, the QR otherwise or when the account has no agent link.
function drawSheet() {
  $('sheet-body').innerHTML = renderCheckSheet({
    statement: sheetState.line, slug: sheetState.slug, shareUrl: shareUrlFor(sheetState.slug), signedIn: Boolean(getAccessToken()),
    linkRequired: sheetState.linkRequired, sent: sheetState.sent, error: sheetState.error, omitStatement: true, noProgress: true
  });
  drawQr();
}
function openSheet(line, slug) {
  lastFocus = document.activeElement;
  Object.assign(sheetState, { line, slug, linkRequired: false, sent: false, error: null });
  $('sheet-line').textContent = line;
  drawSheet();
  $('scrim').hidden = false;
  const f = $('sheet-body').querySelector('.btn-main') || $('close');
  f.focus();
}
function closeSheet() {
  $('scrim').hidden = true;
  if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
}

async function sendFromSheet() {
  const r = await sendToPhone(call, API, sheetState.slug, getAccessToken());
  sheetState.error = null;
  if (r.status === 'sent') sheetState.sent = true;
  else if (r.status === 'link_required') sheetState.linkRequired = true;
  else sheetState.error = r.status;
  drawSheet();
  const f = $('sheet-body').querySelector('.btn-main') || $('sent');
  if (f) f.focus();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-check]');
  if (c) { openSheet(c.dataset.check, (c.closest('[data-slug]') || c).dataset.slug); return; }
  if (e.target.closest('#sheet-body [data-act="send"]')) { sendFromSheet(); return; }
  if (e.target.closest('#sheet-body [data-open="signin"]')) { location.href = '/world-vibe/?signin=1'; return; }
  const w = e.target.closest('[data-who]');
  if (w) { st.curator = st.curator === w.dataset.who ? null : w.dataset.who; render(); return; }
  const t = e.target.closest('[data-tab]');
  if (t) { selectTab(t.dataset.tab); return; }
  if (e.target.closest('[data-more]')) { loadFeedPages(data.feedCursor).then(render); return; }
  const rt = e.target.closest('[data-retry]');
  if (rt) {
    if (rt.dataset.retry === 'following') loadFollowingTab();
    else loadFeedPages(retryCursor(data)).then(render);
    return;
  }
  if (e.target === $('scrim')) closeSheet();
});
document.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
  const next = nextTab(st.tab, e.key);
  if (!next) return;
  e.preventDefault();
  selectTab(next);
  $('tab-' + next).focus();
});
$('clear').addEventListener('click', () => { st.curator = null; render(); });
$('close').addEventListener('click', closeSheet);
$('scrim').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSheet(); return; }
  if (e.key !== 'Tab') return;
  const f = $('scrim').querySelectorAll('button');
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

async function load() {
  await session.restore();
  if (window.SOMACHECK_INSTALL_URL) $('get-app').href = window.SOMACHECK_INSTALL_URL;
  document.querySelectorAll('[data-steps]').forEach((el) => { el.innerHTML = renderSteps(); });
  // Each surface fails on its own: a missing hero or curator list never blanks the feed.
  const [, curators, featured] = await Promise.allSettled([loadFeedPages(null), loadCurators(call, API), loadFeatured(call, API)]);
  data.curators = curators.status === 'fulfilled' ? curators.value : [];
  data.featured = featured.status === 'fulfilled' ? featured.value : null;
  render();
}

load();

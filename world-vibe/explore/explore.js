import { selectItems, renderFeed, renderFilterText, renderCuratorList, renderStrip, renderSteps, renderHero, renderEnd, nextTab } from './explore-render.js';
import { getAccessToken } from './session.js';
import { DEFAULT_API, loadFeed, loadCurators, loadFeatured, loadFollowing } from './explore-data.js';

const API = window.SOMACHECK_API_BASE || DEFAULT_API;
const call = (url, init) => fetch(url, init);

const st = { tab: 'all', curator: null };
const data = { feed: [], feedCursor: null, following: [], curators: [], featured: null, feedError: false, followingError: null };
let followingLoading = false;

const $ = (id) => document.getElementById(id);
let lastFocus = null;

// Re-rendering replaces the lists through innerHTML, which would drop focus
// from the control the user just activated. Remember it and put it back.
function focusKey() {
  const el = document.activeElement;
  if (!el || !el.closest) return null;
  const w = el.closest('[data-who]');
  if (w) return { sel: '#' + w.parentElement.id + ' [data-who="' + w.dataset.who + '"]' };
  const m = el.closest('[data-more],[data-retry]');
  if (m) return { sel: '#' + m.parentElement.id + ' ' + (m.hasAttribute('data-more') ? '[data-more]' : '[data-retry]') };
  return null;
}

function render() {
  const keep = focusKey();
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
  if (keep) { const again = document.querySelector(keep.sel); if (again) again.focus(); }
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

function loadFeedPages(cursor) {
  return loadFeed(call, API, { cursor }).then(
    (r) => { data.feed = cursor ? data.feed.concat(r.items) : r.items; data.feedCursor = r.cursor; data.feedError = false; },
    () => { data.feedError = true; }
  );
}

function openSheet(line) {
  lastFocus = document.activeElement;
  $('sheet-line').textContent = line;
  $('status').textContent = '';
  $('scrim').hidden = false;
  $('send').focus();
}
function closeSheet() {
  $('scrim').hidden = true;
  if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-check]');
  if (c) { openSheet(c.dataset.check); return; }
  const w = e.target.closest('[data-who]');
  if (w) { st.curator = st.curator === w.dataset.who ? null : w.dataset.who; render(); return; }
  const t = e.target.closest('[data-tab]');
  if (t) { selectTab(t.dataset.tab); return; }
  if (e.target.closest('[data-more]')) { loadFeedPages(data.feedCursor).then(render); return; }
  const rt = e.target.closest('[data-retry]');
  if (rt) {
    if (rt.dataset.retry === 'following') loadFollowingTab();
    else loadFeedPages(null).then(render);
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
$('send').addEventListener('click', () => { $('status').textContent = 'Sent. Open SomaCheck on your phone.'; });
$('scrim').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSheet(); return; }
  if (e.key !== 'Tab') return;
  const f = $('scrim').querySelectorAll('button');
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

async function load() {
  if (window.SOMACHECK_INSTALL_URL) $('get-app').href = window.SOMACHECK_INSTALL_URL;
  document.querySelectorAll('[data-steps]').forEach((el) => { el.innerHTML = renderSteps(); });
  // Each surface fails on its own: a missing hero or curator list never blanks the feed.
  const [, curators, featured] = await Promise.allSettled([loadFeedPages(null), loadCurators(call, API), loadFeatured(call, API)]);
  data.curators = curators.status === 'fulfilled' ? curators.value : [];
  data.featured = featured.status === 'fulfilled' ? featured.value : null;
  render();
}

load();

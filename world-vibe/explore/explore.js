import { selectItems, renderFeed, renderFilterText, renderCuratorList, renderStrip, renderSteps, renderHero } from './explore-render.js';
import { DEFAULT_API, loadFeed, loadCurators, loadFeatured, loadFollowing } from './explore-data.js';

const API = window.SOMACHECK_API_BASE || DEFAULT_API;
const call = (url) => fetch(url);

const st = { tab: 'all', curator: null };
const data = { feed: [], following: [], curators: [], featured: null, feedError: false, followingError: null };
let followingLoaded = false;

const $ = (id) => document.getElementById(id);
let lastFocus = null;

function render() {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === st.tab)));
  $('feed').setAttribute('aria-labelledby', 'tab-' + st.tab);
  $('feed').innerHTML = renderFeed(st, data);
  $('cur-list').innerHTML = renderCuratorList(data.curators, st);
  $('strip').innerHTML = renderStrip(data.curators, st);
  $('filter').hidden = !st.curator;
  $('filter-text').textContent = renderFilterText(st, data.curators);
  $('hero').innerHTML = renderHero(data.featured);
  $('hero').hidden = !$('hero').innerHTML;
  $('end').hidden = selectItems(st, data).length === 0;
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
  if (t) {
    st.tab = t.dataset.tab; st.curator = null; render();
    if (st.tab === 'following' && !followingLoaded) {
      followingLoaded = true;
      loadFollowing(call, API).then((r) => { data.following = r.items; data.followingError = r.error; render(); });
    }
    return;
  }
  if (e.target === $('scrim')) closeSheet();
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
  const [feed, curators, featured] = await Promise.allSettled([loadFeed(call, API), loadCurators(call, API), loadFeatured(call, API)]);
  data.feedError = feed.status === 'rejected';
  data.feed = feed.status === 'fulfilled' ? feed.value : [];
  data.curators = curators.status === 'fulfilled' ? curators.value : [];
  data.featured = featured.status === 'fulfilled' ? featured.value : null;
  render();
}

load();

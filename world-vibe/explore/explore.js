import { selectItems, renderFeed, renderFilterText, renderCuratorList, renderStrip, renderSteps } from './explore-render.js';

// WP10 runs on fixtures that carry the exact columns of feed_v3, following_feed
// and public_curators. Wiring to live routes replaces load() only.
const getJson = (name) => fetch('fixtures/' + name).then((r) => r.json());

const st = { tab: 'all', curator: null };
const data = { feed: [], following: [], curators: [], followingError: null };

const $ = (id) => document.getElementById(id);
let lastFocus = null;

function render() {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === st.tab)));
  $('feed').setAttribute('aria-labelledby', 'tab-' + st.tab);
  $('feed').innerHTML = renderFeed(st, data);
  $('cur-list').innerHTML = renderCuratorList(data.curators, st);
  $('strip').innerHTML = renderStrip(data.curators, st);
  $('filter').hidden = !st.curator;
  $('filter-text').textContent = renderFilterText(st);
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
  if (t) { st.tab = t.dataset.tab; st.curator = null; render(); return; }
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
  const [feed, following, curators] = await Promise.all([getJson('feed-v3.json'), getJson('following-feed.json'), getJson('curators.json')]);
  data.feed = feed.items;
  data.following = following.items;
  data.curators = curators;
  render();
}

load();

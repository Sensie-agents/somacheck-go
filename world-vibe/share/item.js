import { DEFAULT_API, itemSlugFromSearch, loadItem } from '../home/home-data.js';
import { itemProgress, universalLink } from './item-logic.js';

const API = window.SOMACHECK_API_BASE || DEFAULT_API;
const $ = (id) => document.getElementById(id);
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function show(state) { document.querySelectorAll('[data-state]').forEach((n) => { n.hidden = n.dataset.state !== state; }); }

async function main() {
  $('install').href = window.SOMACHECK_INSTALL_URL || $('install').href;
  const slug = itemSlugFromSearch(location.search);
  const r = await loadItem((u, i) => fetch(u, i), API, slug);
  if (!r.item) { show(r.error === 'not_found' ? 'missing' : 'unavailable'); return; }
  const p = itemProgress(r.item);
  $('line').textContent = r.item.statement;
  $('headline').textContent = p.headline;
  $('detail').textContent = p.detail;
  $('open').href = universalLink(slug);
  show('item');
}
main();

// Pure render + selection functions for World Vibe Explore. Input shapes are the
// columns of world_vibe_public_feed_v3, world_vibe_following_feed and
// world_vibe_public_curators. No DOM, no network. The reveal ladder lives in
// renderMeter (home-render.js) and is reused, never re-implemented.
import { renderMeter, visibleCuratorName, esc, CATEGORY_LABELS, PUBLIC_SIGNAL_LABEL, PHONE } from '../home/home-render.js';

export { visibleCuratorName, PUBLIC_SIGNAL_LABEL };

const TINTS = ['#F6E3C8', '#D5EEE9', '#E4E1F5', '#DCE8F5', '#E3F3F0', '#F3D9D6'];

export const STEPS = [
  ['Capture', 'Highlight any line on the web and write your take in one sentence.', 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'],
  ['Check in', 'Hold your phone for the 3-second gesture. Your body answers, not your thumbs.', 'M7 2.5h10v19H7zM11 18.5h2'],
  ['See the vibe', 'At 3 people a lean appears. At 10, the full split. Never who.', 'M3 12h3l3-7 4 14 3-7h5']
];

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
function tint(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}
const safeHref = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

// Which rows the feed shows. A curator filter always reads feed_v3 (the only
// feed that carries curator_name) and matches the public name exactly, so a
// consented public-signal row, whose name is hidden, can never match.
export function selectItems(state, data) {
  if (state.curator) return (data.feed || []).filter((i) => visibleCuratorName(i) === state.curator);
  if (state.tab === 'following') return data.following || [];
  return data.feed || [];
}

export function renderPost(item) {
  const name = visibleCuratorName(item);
  const href = safeHref(item.source_url);
  const cat = CATEGORY_LABELS[item.category];
  const av = name
    ? '<span class="av" style="background:' + tint(name) + '" aria-hidden="true">' + esc(initials(name)) + '</span>'
    : '<span class="av anon" aria-hidden="true"></span>';
  const who = name ? '<b>' + esc(name) + '</b>' : '<b>Anonymous</b>';
  const label = item.public_signals === true ? '<span class="public-label">' + PUBLIC_SIGNAL_LABEL + '</span>' : '';
  const src = item.quote || item.domain
    ? (href ? '<a class="src" href="' + esc(href) + '" target="_blank" rel="noopener">' : '<span class="src">') +
      (item.domain ? '<em>' + esc(item.domain) + '</em>' : '') + (item.quote ? '<span>' + esc(item.quote) + '</span>' : '') +
      (href ? '</a>' : '</span>')
    : '';
  return '<article class="post" data-slug="' + esc(item.slug) + '">' + av + '<div class="post-body">' +
    '<div class="by">' + who + (cat ? '<span class="cat">' + esc(cat) + '</span>' : '') + label + '</div>' +
    '<p class="line">' + esc(item.statement) + '</p>' + src +
    renderMeter(item) +
    '<div class="foot-row"><span class="spacer"></span><button class="btn-check" type="button" data-check="' + esc(item.statement) + '">' + PHONE + 'Check in</button></div>' +
    '</div></article>';
}

export function renderFeed(state, data) {
  const items = selectItems(state, data);
  if (items.length) return items.map(renderPost).join('');
  if (state.curator) return '<p class="end">No lines from this curator right now.</p>';
  if (state.tab === 'following') {
    return data.followingError === 'auth'
      ? '<p class="end">Sign in in the SomaCheck app to follow curators and see their lines here.</p>'
      : '<p class="end">Follow a curator to see their lines here.</p>';
  }
  return '<p class="end">No lines here yet this week.</p>';
}

export function renderFilterText(state) {
  return state.curator ? 'Lines from ' + state.curator : '';
}

function meta(c) {
  return c.lines_count + (c.lines_count === 1 ? ' line' : ' lines') + ' · sparked ' + c.checkins_sparked + ' check-ins';
}

export function renderCuratorList(curators, state) {
  return curators.map((c) => '<button class="curator" type="button" data-who="' + esc(c.display_name) + '" aria-pressed="' + (state.curator === c.display_name) + '">' +
    '<span class="av" style="background:' + tint(c.display_name) + '" aria-hidden="true">' + esc(initials(c.display_name)) + '</span>' +
    '<div><b>' + esc(c.display_name) + '</b><small>' + esc(meta(c)) + '</small></div></button>').join('');
}

export function renderStrip(curators, state) {
  return curators.map((c) => '<button class="story" type="button" data-who="' + esc(c.display_name) + '" aria-pressed="' + (state.curator === c.display_name) + '">' +
    '<span class="ring"><span style="background:' + tint(c.display_name) + '" aria-hidden="true">' + esc(initials(c.display_name)) + '</span></span>' +
    esc(c.display_name.split(' ')[0]) + '</button>').join('');
}

export function renderSteps() {
  return STEPS.map((s) => '<div class="step"><span class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + s[2] + '"/></svg></span><div><b>' + s[0] + '</b><span>' + s[1] + '</span></div></div>').join('');
}

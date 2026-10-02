// Pure render + selection functions for World Vibe Explore. Input shapes are the
// columns of world_vibe_public_feed_v3, world_vibe_following_feed and
// world_vibe_public_curators. No DOM, no network. The reveal ladder lives in
// renderMeter (home-render.js) and is reused, never re-implemented.
import { renderMeter, visibleCuratorName, esc, threshold, contributors, CATEGORY_LABELS, PUBLIC_SIGNAL_LABEL, PHONE } from '../home/home-render.js';

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

// Which rows the feed shows. A curator filter reads feed_v3 and matches the
// stable public curator_id (display names are not unique). A consented
// public-signal row never matches: its curator_id is hidden and ignored here.
export function selectItems(state, data) {
  if (state.curator) return (data.feed || []).filter((i) => i.public_signals !== true && typeof i.curator_id === 'string' && i.curator_id === state.curator);
  if (state.tab === 'following') return data.followingError ? [] : data.following || [];
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

const retry = (what) => '<button class="retry" type="button" data-retry="' + what + '">Try again</button>';
const errorBox = (msg, what) => '<div class="end" role="alert">' + msg + ' ' + retry(what) + '</div>';

export function renderFeed(state, data) {
  const items = selectItems(state, data);
  if (items.length) return items.map(renderPost).join('');
  // A failed load is never reported as an empty state, before or after filtering.
  if (state.curator || state.tab !== 'following') {
    if (data.feedError) return errorBox("Couldn't load lines right now.", 'feed');
    if (state.curator) return '<p class="end">No lines from this curator right now.</p>';
    return '<p class="end">No lines here yet this week.</p>';
  }
  if (data.followingError === 'signin' || data.followingError === 'auth') {
    return '<div class="end" data-signin-state><p>Sign in to see who you follow.</p>' +
      '<button class="signin" type="button" disabled aria-disabled="true">Sign in (coming soon)</button></div>';
  }
  if (data.followingError) return errorBox("Couldn't load who you follow right now.", 'following');
  return '<p class="end">Follow a curator to see their lines here.</p>';
}

// Under the feed: "Load more" while pages remain, "all caught up" only when the
// cursor is exhausted. A failed continuation keeps its rows and unread cursor
// and shows the error with Try again instead of either. The following list is
// not paged.
export function renderEnd(state, data) {
  if (state.tab === 'following' && !state.curator) return selectItems(state, data).length ? "You're all caught up." : '';
  if (data.feedError && selectItems(state, data).length) return errorBox("Couldn't load more lines.", 'more');
  if (data.feedCursor && !data.feedError) return '<button class="more" type="button" data-more>Load more</button>';
  return selectItems(state, data).length ? "You're all caught up." : '';
}

// Selector that finds the focused control again after a re-render. It is built
// from the stable list container (never the control's parent, which has no id).
export function focusSelector(el) {
  if (!el || !el.closest) return null;
  const w = el.closest('[data-who]');
  if (w) {
    const root = w.closest('#strip, #cur-list');
    return root ? '#' + root.id + ' [data-who="' + w.dataset.who + '"]' : null;
  }
  const m = el.closest('[data-more],[data-retry]');
  if (m) {
    const root = m.closest('#feed, #end');
    return root ? '#' + root.id + ' ' + (m.hasAttribute('data-more') ? '[data-more]' : '[data-retry]') : null;
  }
  return null;
}

const TABS = ['all', 'following'];
// Arrow-key target for the tablist (ARIA tabs pattern); null for other keys.
export function nextTab(current, key) {
  const i = TABS.indexOf(current);
  if (key === 'ArrowRight') return TABS[(i + 1) % TABS.length];
  if (key === 'ArrowLeft') return TABS[(i + TABS.length - 1) % TABS.length];
  if (key === 'Home') return TABS[0];
  if (key === 'End') return TABS[TABS.length - 1];
  return null;
}

export function renderFilterText(state, curators = []) {
  if (!state.curator) return '';
  const c = curators.find((x) => x.curator_id === state.curator);
  return 'Lines from ' + (c && c.display_name ? c.display_name : 'this curator');
}

function meta(c) {
  return c.lines_count + (c.lines_count === 1 ? ' line' : ' lines') + ' · sparked ' + c.checkins_sparked + ' check-ins';
}

const nameOf = (c) => (typeof c.display_name === 'string' ? c.display_name.trim() : '') || 'Curator';

export function renderCuratorList(curators, state) {
  return curators.map((c) => '<button class="curator" type="button" data-who="' + esc(c.curator_id) + '" aria-pressed="' + (state.curator === c.curator_id) + '">' +
    '<span class="av" style="background:' + tint(nameOf(c)) + '" aria-hidden="true">' + esc(initials(nameOf(c))) + '</span>' +
    '<div><b>' + esc(nameOf(c)) + '</b><small>' + esc(meta(c)) + '</small></div></button>').join('');
}

export function renderStrip(curators, state) {
  return curators.map((c) => '<button class="story" type="button" data-who="' + esc(c.curator_id) + '" aria-pressed="' + (state.curator === c.curator_id) + '">' +
    '<span class="ring"><span style="background:' + tint(nameOf(c)) + '" aria-hidden="true">' + esc(initials(nameOf(c))) + '</span></span>' +
    esc(nameOf(c).split(' ')[0]) + '</button>').join('');
}

// Topic of the Week hero (approved v2.1). `featured` is the /featured payload
// or null. Same reveal ladder as every card: under the unlock threshold only
// big dots and "n of T"; at threshold renderMeter decides (lean without
// numbers, exact split at 10+, or the consented public-signal split).
export function renderHero(featured) {
  if (!featured || typeof featured.statement !== 'string' || !featured.statement) return '';
  const c = contributors(featured);
  const t = threshold(featured);
  let dots = '';
  for (let k = 0; k < t; k++) dots += '<i' + (k < c ? ' class="on"' : '') + '></i>';
  // A consented public-signal topic carries its own readings and a threshold of 1,
  // so renderMeter (which shows them) takes over before the gather state.
  const shared = featured.public_signals === true && Number.isFinite(featured.aligned) && Number.isFinite(featured.unaligned) && featured.aligned + featured.unaligned > 0;
  const progress = c < t && !shared
    ? '<div class="progress"><span class="dots big" aria-hidden="true">' + dots + '</span><span><b>' + c + ' of ' + t + '</b> checked in. You could be the one who reveals it.</span></div>'
    : renderMeter(featured);
  const label = featured.public_signals === true ? '<span class="public-label">' + PUBLIC_SIGNAL_LABEL + '</span>' : '';
  return '<article class="totw" aria-labelledby="totw-h"><span class="eyebrow"><i></i>TOPIC OF THE WEEK</span>' +
    '<h2 id="totw-h">' + esc(featured.statement) + '</h2>' + label + progress +
    '<button class="btn-main" type="button" data-check="' + esc(featured.statement) + '">' + PHONE + 'Check in</button>' +
    '<p class="micro">Three seconds on your phone. Your reading stays private.</p></article>';
}

export function renderSteps() {
  return STEPS.map((s) => '<div class="step"><span class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + s[2] + '"/></svg></span><div><b>' + s[0] + '</b><span>' + s[1] + '</span></div></div>').join('');
}

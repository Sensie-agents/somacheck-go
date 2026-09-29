// Pure render functions for the World Vibe v3 home. Each takes response-shaped
// data (world_vibe_public_feed_v2 fields plus reason, category, curator_name)
// and returns an HTML string. No DOM, no network.

export const PUBLIC_SIGNAL_LABEL = 'Shown publicly by choice';
export const DEFAULT_THRESHOLD = 3;
export const EXACT_COUNT_FROM = 10;

export const CATEGORY_LABELS = {
  work_ai: 'Work & AI',
  health: 'Health',
  politics: 'Politics',
  culture: 'Culture',
  money: 'Money',
  science: 'Science',
  leadership: 'Leadership',
  self: 'Self'
};

const TINTS = ['#F6E3C8', '#D5EEE9', '#E4E1F5', '#DCE8F5', '#E3F3F0'];
const TONE = {
  aligned: ['Leans aligned', '#0B7A6D', '#12A594', '26%'],
  mixed: ['Mixed so far', '#4A5159', '#6B7178', '50%'],
  unaligned: ['Leans unaligned', '#9A5B12', '#E0953F', '74%']
};

export const PHONE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>';
export const LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A5B12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

export function esc(x) {
  return String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const isNum = (v) => typeof v === 'number' && isFinite(v);
const threshold = (item) => (isNum(item.unlock_threshold) && item.unlock_threshold >= DEFAULT_THRESHOLD ? item.unlock_threshold : DEFAULT_THRESHOLD);
const contributors = (item) => (isNum(item.contributors) ? item.contributors : 0);

// Consented public-signal items never carry a curator name, even if one is sent.
export function visibleCuratorName(item) {
  if (item.publish_after_answer) return null;
  const n = typeof item.curator_name === 'string' ? item.curator_name.trim() : '';
  return n || null;
}

export function reasonSentence(pick) {
  const t = threshold(pick);
  switch (pick.reason) {
    case 'shared_link': return 'Someone shared this with you.';
    case 'topic_of_week': return "It's the topic of the week.";
    case 'closest_to_unlock': return contributors(pick) + ' of ' + t + ' have checked in. Yours could reveal it.';
    case 'time_of_day': return pick.time_of_day ? "It's " + pick.time_of_day + ' where you are.' : 'It fits this time of day.';
    case 'trending_in_category': return 'Trending in ' + (CATEGORY_LABELS[pick.category] || 'this category') + ' today.';
    case 'following': return 'From a curator you follow.';
    case 'most_checked': return 'Most checked this week.';
    default: return 'Picked by relevance.';
  }
}

function dotsHtml(n, t) {
  let d = '';
  for (let k = 0; k < t; k++) d += '<i' + (k < n ? ' class="on"' : '') + '></i>';
  return d;
}

// Reveal ladder: under threshold dots and "n of T"; threshold to 9 a lean with
// no numbers; 10+ with counts a percent bar. publish_after_answer items show
// the consented readings they carry.
export function renderMeter(item) {
  const c = contributors(item);
  const t = threshold(item);
  const hasCounts = isNum(item.aligned) && isNum(item.unaligned) && item.aligned + item.unaligned > 0;

  if (item.publish_after_answer && hasCounts) {
    const total = item.aligned + item.unaligned;
    const pct = Math.round((item.aligned / total) * 100);
    return '<div class="meter"><span class="meter-row"><b class="tone-aligned">' + pct + '% aligned</b><span>' + total + ' shared by choice</span></span>' +
      '<span class="split"><i style="width:' + pct + '%"></i><i></i></span></div>';
  }
  if (c < t) {
    return '<div class="meter"><span class="meter-row meter-gather"><span class="dots" aria-hidden="true">' + dotsHtml(c, t) + '</span><span>' + c + ' of ' + t + ' checked in · reveals at ' + t + '</span></span></div>';
  }
  if (c >= EXACT_COUNT_FROM && hasCounts) {
    const total = item.aligned + item.unaligned;
    const pct = Math.round((item.aligned / total) * 100);
    return '<div class="meter"><span class="meter-row"><b class="tone-aligned">' + pct + '% aligned</b><b class="tone-unaligned">' + (100 - pct) + '% unaligned</b></span>' +
      '<span class="split"><i style="width:' + pct + '%"></i><i></i></span>' +
      '<span class="meter-row"><span>' + c + ' checked in · what participants noticed</span></span></div>';
  }
  const tone = TONE[item.lean];
  if (!tone) {
    return '<div class="meter"><span class="meter-row"><span>The vibe is still forming</span></span></div>';
  }
  return '<div class="meter"><span class="meter-row"><b style="color:' + tone[1] + '">' + tone[0] + '</b><span>A few checked in</span></span>' +
    '<span class="track" aria-hidden="true"><i style="left:' + tone[3] + ';border-color:' + tone[2] + '"></i></span>' +
    '<span class="ends" aria-hidden="true"><span>ALIGNED</span><span>UNALIGNED</span></span></div>';
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
function tint(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

function byLine(pick) {
  const name = visibleCuratorName(pick);
  const src = pick.domain ? '<span class="src">' + (name ? '· ' : '') + esc(pick.domain) + '</span>' : '';
  const label = pick.publish_after_answer ? '<span class="public-label">' + PUBLIC_SIGNAL_LABEL + '</span>' : '';
  if (!name && !src && !label) return '';
  const who = name
    ? '<span class="av" style="background:' + tint(name) + '" aria-hidden="true">' + esc(initials(name)) + '</span><span>Brought by <b>' + esc(name) + '</b></span>'
    : '';
  return '<div class="by">' + who + src + label + '</div>';
}

export function renderSharedCard(pick) {
  return '<article class="card enter" aria-label="Line picked for you">' +
    '<span class="why"><i></i>Picked for you · ' + esc(reasonSentence(pick)) + '</span>' +
    '<p class="line">' + esc(pick.statement) + '</p>' +
    byLine(pick) +
    renderMeter(pick) +
    '<button class="btn-main" type="button" data-act="check">' + PHONE + 'Check in</button>' +
    '<div class="quiet"><button type="button" data-act="skip">Not this one</button><button type="button" data-open="bring">Bring your own line</button></div></article>';
}

// After a check-in: progress comes from the server (world_vibe_public_progress
// plus the caller's own revealed_by_you flag).
export function renderReveal(progress) {
  const revealed = progress.revealed_by_you === true;
  return '<article class="card enter" aria-label="Check-in result">' +
    '<span class="reveal-head">' + (revealed ? 'YOU REVEALED IT' : "YOU'RE IN") + '</span>' +
    '<p class="thanks">' + (revealed ? 'Your check-in unlocked the vibe.' : 'Thanks. The room just got one body clearer.') + '</p>' +
    '<p class="echo">' + esc(progress.statement) + '</p>' +
    renderMeter(progress) +
    '<p class="fine left">Your own reading is in your SomaCheck app. Here you only ever see the room, never who.</p>' +
    '<button class="btn-main" type="button" data-act="next">One more?</button>' +
    "<p class=\"soft\">Or come back later. The vibe keeps updating while you're away.</p></article>";
}

// state: { phase: 'compose'|'written'|'done', ctx: 'agent'|'words', line }
export function renderPrivateCard(state) {
  const ctx = state.ctx === 'words' ? 'words' : 'agent';
  if (state.phase === 'done') {
    return '<article class="card private enter" aria-label="Private check-in result"><span class="reveal-head amber">SAVED TO YOUR BASELINE</span>' +
      '<p class="thanks">Your reading is in your SomaCheck app.</p>' +
      '<p class="echo">' + esc(state.line) + '</p>' +
      '<div class="private-note">' + LOCK + '<span>Nothing about this check-in shows here or anywhere public.</span></div>' +
      '<button class="btn-main" type="button" data-act="lane-shared">Check one with everyone</button>' +
      '<p class="soft">Or come back later.</p></article>';
  }
  if (state.phase === 'written') {
    return '<article class="card private enter" aria-label="Private line for you">' +
      '<span class="why"><i></i>Written for you · from ' + (ctx === 'agent' ? 'what you share with your agent' : 'your words') + '</span>' +
      '<p class="line">' + esc(state.line) + '</p>' +
      '<div class="private-note">' + LOCK + '<span>Private. Only you see this line and your reading.</span></div>' +
      '<button class="btn-main" type="button" data-act="check">' + PHONE + 'Check in</button>' +
      '<div class="quiet"><button type="button" data-act="rewrite">Write another</button><button type="button" data-act="edit">Edit the words</button></div></article>';
  }
  return '<article class="card private enter" aria-label="Just for me">' +
    '<span class="why"><i></i>Just for you · private</span>' +
    '<p class="line small">Get a personalized vibecheck to help get aligned today.</p>' +
    '<div class="compose"><span class="compose-title" id="ctx-title">Use context from</span>' +
    '<div class="ctx" role="group" aria-labelledby="ctx-title"><button type="button" data-ctx="agent" aria-pressed="' + (ctx === 'agent') + '">My connected agent</button><button type="button" data-ctx="words" aria-pressed="' + (ctx === 'words') + '">A few words from me</button></div>' +
    (ctx === 'words'
      ? '<label for="mind">What\'s on your mind?</label><textarea id="mind" rows="2" placeholder="A deadline, a conversation, a decision..."></textarea>'
      : '<p class="fine left">Talk to an agent every day? It\'s picked up more about you than you\'d guess. Let it write your vibecheck.</p><p class="fine left">You choose what it can use, and you can turn it off any time.</p>') +
    '</div>' +
    '<div class="private-note">' + LOCK + '<span>Only you see this line and your reading. It never appears on World Vibe and never counts toward a public vibe.</span></div>' +
    '<button class="btn-main" type="button" data-act="generate">Write my line</button></article>';
}

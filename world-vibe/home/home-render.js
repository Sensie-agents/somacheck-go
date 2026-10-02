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
export const threshold = (item) => (isNum(item.unlock_threshold) && item.unlock_threshold >= DEFAULT_THRESHOLD ? item.unlock_threshold : DEFAULT_THRESHOLD);
export const contributors = (item) => (isNum(item.contributor_count) ? item.contributor_count : 0);

// Consented public-signal items never carry a curator name, even if one is sent.
export function visibleCuratorName(item) {
  if (item.public_signals === true) return null;
  const n = typeof item.curator_name === 'string' ? item.curator_name.trim() : '';
  return n || null;
}

export function reasonSentence(pick) {
  const t = threshold(pick);
  switch (pick.reason) {
    case 'shared_link': return 'Someone shared this with you.';
    case 'topic_of_week': return "It's the topic of the week.";
    case 'closest_to_unlock': return contributors(pick) + ' of ' + t + ' have checked in. Yours could reveal it.';
    case 'time_of_day': return 'It fits this time of day.';
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

// Reveal ladder: under threshold dots and "n of T"; at threshold a lean with the
// head count and no percentages; a percent bar only when contributor_count >= 10
// AND >= unlock_threshold. public_signals items show
// the consented readings they carry.
export function renderMeter(item) {
  const c = contributors(item);
  const t = threshold(item);
  const hasCounts = isNum(item.aligned) && isNum(item.unaligned) && item.aligned + item.unaligned > 0;

  if (item.public_signals === true && hasCounts) {
    const total = item.aligned + item.unaligned;
    const pct = Math.round((item.aligned / total) * 100);
    return '<div class="meter"><span class="meter-row"><b class="tone-aligned">' + pct + '% aligned</b><span>' + total + ' shared by choice</span></span>' +
      '<span class="split"><i style="width:' + pct + '%"></i><i></i></span></div>';
  }
  if (c < t) {
    return '<div class="meter"><span class="meter-row meter-gather"><span class="dots" aria-hidden="true">' + dotsHtml(c, t) + '</span><span>' + c + ' of ' + t + ' checked in · reveals at ' + t + '</span></span></div>';
  }
  if (c >= EXACT_COUNT_FROM && c >= t && hasCounts) {
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
  return '<div class="meter"><span class="meter-row"><b style="color:' + tone[1] + '">' + tone[0] + '</b><span>&nbsp;· ' + c + ' checked in</span></span>' +
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
  const label = pick.public_signals === true ? '<span class="public-label">' + PUBLIC_SIGNAL_LABEL + '</span>' : '';
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

// After a check-in: progress comes from the server (item progress plus the
// caller's own revealed_by_you flag). your_reading is the viewer's own reading
// and is only ever present for the signed-in owner of the receipt.
export function renderReveal(progress) {
  const revealed = progress.revealed_by_you === true;
  const own = progress.your_reading === 'aligned' || progress.your_reading === 'unaligned'
    ? '<p class="own">Your reading: <b>' + (progress.your_reading === 'aligned' ? 'Aligned' : 'Unaligned') + '</b>. Only you see this.</p>'
    : '';
  return '<article class="card enter" aria-label="Check-in result">' +
    '<span class="reveal-head">' + (revealed ? 'YOU REVEALED IT' : "YOU'RE IN") + '</span>' +
    '<p class="thanks">' + (revealed ? 'Your check-in unlocked the vibe.' : 'Thanks. The room just got one body clearer.') + '</p>' +
    '<p class="echo">' + esc(progress.statement) + '</p>' +
    (progress.public_signals === true ? '<div class="by"><span class="public-label">' + PUBLIC_SIGNAL_LABEL + '</span></div>' : '') +
    renderMeter(progress) + own +
    '<p class="fine left">' + (own ? '' : 'Your own reading is in your SomaCheck app. ') + 'Here you only ever see the room, never who.</p>' +
    '<button class="btn-main" type="button" data-act="next">One more?</button>' +
    "<p class=\"soft\">Or come back later. The vibe keeps updating while you're away.</p></article>";
}

// Without a receipt (the QR path) the page cannot know whether this person
// checked in, so it shows the room and makes no claim about them.
export function renderRoom(progress) {
  return '<article class="card enter" aria-label="The room so far">' +
    '<span class="reveal-head">THE ROOM SO FAR</span>' +
    '<p class="echo">' + esc(progress.statement) + '</p>' +
    (progress.public_signals === true ? '<div class="by"><span class="public-label">' + PUBLIC_SIGNAL_LABEL + '</span></div>' : '') +
    renderMeter(progress) +
    '<p class="fine left">Here you only ever see the room, never who. Your own reading stays in your SomaCheck app.</p>' +
    '<button class="btn-main" type="button" data-act="next">One more?</button></article>';
}

const PRIVATE_ERRORS = {
  no_context: "Your agent hasn't shared anything with SomaCheck yet. Try \"A few words from me\" instead.",
  empty_words: 'Write a few words first.',
  invalid_words: 'Write a few words first.',
  consent_required: 'Turn on the setting below to let SomaCheck write a line for you.',
  unavailable: "Couldn't write a line right now. Try again in a moment.",
  consent_unavailable: "Couldn't check this setting. Try again in a moment."
};

function consentSwitch(state) {
  return '<div class="consent"><label class="switch" for="consent"><input type="checkbox" role="switch" id="consent" data-consent' + (state.consent === true ? ' checked' : '') + '>' +
    '<span>Let SomaCheck use what I share with my agent to write private lines for me.</span></label>' +
    '<p class="fine left">Only I see these lines and my readings. I can turn this off any time.</p></div>';
}

// state: { phase: 'compose'|'written'|'done', ctx: 'agent'|'words', line,
//          signedIn, consent: true|false|null, error }
// Signed out, or consent not on, never reaches the drafts route: the write
// button is not there or is disabled.
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
  const note = '<div class="private-note">' + LOCK + '<span>Only you see this line and your reading. It never appears on World Vibe and never counts toward a public vibe.</span></div>';
  if (!state.signedIn) {
    return '<article class="card private enter" aria-label="Just for me">' +
      '<span class="why"><i></i>Just for you · private</span>' +
      '<p class="line small">Get a personalized vibecheck to help get aligned today.</p>' + note +
      '<button class="btn-main" type="button" data-open="signin">Sign in to start</button>' +
      '<p class="fine">Sign in with your email. No password.</p></article>';
  }
  // Only the agent source reads stored context, so only it needs the consent flag.
  const allowed = ctx === 'words' || state.consent === true;
  return '<article class="card private enter" aria-label="Just for me">' +
    '<span class="why"><i></i>Just for you · private</span>' +
    '<p class="line small">Get a personalized vibecheck to help get aligned today.</p>' +
    '<div class="compose"><span class="compose-title" id="ctx-title">Use context from</span>' +
    '<div class="ctx" role="group" aria-labelledby="ctx-title"><button type="button" data-ctx="agent" aria-pressed="' + (ctx === 'agent') + '">My connected agent</button><button type="button" data-ctx="words" aria-pressed="' + (ctx === 'words') + '">A few words from me</button></div>' +
    (ctx === 'words'
      ? '<label for="mind">What\'s on your mind?</label><textarea id="mind" rows="2" maxlength="500" placeholder="A deadline, a conversation, a decision..."></textarea>'
      : '<p class="fine left">Talk to an agent every day? It\'s picked up more about you than you\'d guess. Let it write your vibecheck.</p><p class="fine left">You choose what it can use, and you can turn it off any time.</p>') +
    '</div>' + consentSwitch(state) +
    (state.error ? '<p class="err" role="alert">' + esc(PRIVATE_ERRORS[state.error] || PRIVATE_ERRORS.unavailable) + '</p>' : '') +
    note +
    '<button class="btn-main" type="button" data-act="generate"' + (allowed ? '' : ' disabled') + '>Write my line</button></article>';
}

// Why the one-line card is empty: nothing left to pick, or the route failed.
export function renderEmpty(error) {
  return '<article class="card enter" aria-label="No line right now">' +
    '<p class="line small">' + (error ? "Couldn't load a line right now." : "You've seen everything for now.") + '</p>' +
    '<p class="fine left">' + (error ? 'Check your connection and try again.' : 'New lines arrive all day. Come back later, or look around Explore.') + '</p>' +
    '<button class="btn-main" type="button" data-act="retry">' + (error ? 'Try again' : 'Start over') + '</button></article>';
}

export function renderAccountBar({ configured, email }) {
  if (email) return '<span class="who" title="Signed in">' + esc(email) + '</span><button class="nav-link" type="button" data-act="signout">Sign out</button>';
  return configured ? '<button class="nav-link" type="button" data-open="signin">Sign in</button>' : '';
}

export const SIGNIN_STATUS = {
  sent: 'Check your email for the sign-in link. You can close this tab.',
  invalid_email: 'Enter a valid email address.',
  rate_limited: 'Too many tries. Wait a minute and try again.',
  unavailable: "Couldn't send the link. Try again in a moment."
};
export function renderSignInSheet(status) {
  return '<form id="signin-form" novalidate><div class="field"><label for="si-email">Email</label><input id="si-email" name="email" type="email" autocomplete="email" required></div>' +
    '<button class="btn-main" type="submit">Email me a sign-in link</button></form>' +
    '<p class="fine" id="si-status" role="status">' + esc(SIGNIN_STATUS[status] || '') + '</p>' +
    '<p class="fine">No password. Signing in lets you send lines to your phone and see your own readings.</p>';
}

// The statement is only ever shared by its slug: a private draft has none, so a
// private sheet has no QR, and never leaves the account.
// ctx: { statement, slug (null for private), shareUrl, signedIn, linkRequired, sent, error,
//        linked (GET /v1/me/world-vibe/phone said true), omitStatement, noProgress } (the last two
//        are for Explore's own sheet). Send to my phone for a shared line needs linked === true.
export function renderCheckSheet(ctx) {
  const priv = !ctx.slug;
  // Send is offered only once the phone route confirmed an active agent link.
  const noLink = ctx.linkRequired || ctx.phoneLinked === false;
  const showSend = ctx.signedIn && ctx.phoneLinked === true && !noLink && !ctx.sent;
  let notice = '';
  if (ctx.sent) notice = 'Sent. Open SomaCheck on your phone.';
  else if (ctx.signedIn && noLink) notice = priv ? 'To send private lines to your phone, connect an agent in SomaCheck.' : 'To send lines straight to your phone, connect an agent in SomaCheck. Scan this instead.';
  else if (ctx.error === 'rate_limited') notice = 'Please wait a moment before sending another.';
  else if (ctx.error === 'pending') notice = 'A check-in is already waiting on your phone.';
  else if (ctx.error === 'signin') notice = 'Your sign-in expired. Sign in again.';
  else if (ctx.error) notice = priv ? "Couldn't send it. Make sure SomaCheck on your phone is linked to this account." : "Couldn't send it. Scan the code instead.";
  return (ctx.omitStatement ? '' : '<p class="big">' + esc(ctx.statement) + '</p>') +
    (showSend ? '<button class="btn-main" type="button" data-act="send">Send to my phone</button>' : '') +
    '<div class="fine sent" id="sent" role="status" tabindex="-1">' + esc(notice) + '</div>' +
    (priv ? '' : (ctx.signedIn ? '' : '<button class="linkbtn" type="button" data-open="signin">Sign in to send this straight to your phone</button>') + '<div class="or">' + (showSend ? 'or scan' : 'Scan') + '</div><div class="qr"><div id="qr" data-qr="' + esc(ctx.shareUrl) + '"></div>With your iPhone camera</div>' +
      '<p class="fine"><a class="open-link" href="' + esc(ctx.shareUrl) + '">Open this line on this phone: ' + esc(ctx.shareUrl.replace(/^https:\/\//, '')) + '</a></p>') +
    (priv || ctx.noProgress ? '' : '<button class="btn-sec" type="button" data-act="checked">I\'ve checked in</button>') +
    '<p class="fine">Three seconds. Your body answers, not your thumbs.</p>';
}

// "Bring your own line" on the web is the Chrome callout only (the paste path
// waits for the app-side continuity work).
export function renderBringSheet() {
  return '<div class="chrome"><small>ON A COMPUTER</small><b>Highlight any line on the web and bring it here with one click.</b><a href="/world-vibe/chrome/">Add to Chrome</a></div>' +
    '<p class="fine">Your check-in counts first. A shared line appears on World Vibe after your gesture.</p>';
}

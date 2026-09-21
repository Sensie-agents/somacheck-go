// World Vibe content-item share page (Lane H, 2026-09-17).
//
// Serves any content-item slug at /world-vibe/share/<slug> via the
// Served directly at /world-vibe/share/?item=<slug>; no rewrite rule needed.
// (200, so the URL bar and the slug this script reads stay the original one).
// The three curated topic pages are untouched static folders and keep
// resolving before this rewrite ever applies.
//
// Flow: read the slug from the path, look it up in the public feed (there is
// no per-slug read endpoint for content items, only the topics one), render
// the quote/statement/source/progress, and only on an explicit tap call
// POST {API_BASE}/v1/public/world-vibe/items/{slug}/join and navigate to the
// returned link_url (a signed /s/<token> statement link). No statement is
// ever issued before that tap. The feed only ever contains live items, so an
// item that cannot be found there is treated as not available.
//
// Lean phase (2026-09-19): below the unlock threshold, progress only, as
// before. From the unlock threshold to 9 completed check-ins, only a
// plain-language lean is shown (Leans aligned / Leans unaligned / Mixed)
// with a one-line note that it is a direction, not a count. The exact split
// still renders once the API returns it, at 10 completed check-ins. Privacy
// fix (Mike): this closes the hole where a creator sharing an item with
// exactly two friends could infer both friends' individual readings from a
// 3-0 or 1-2 split the moment the item unlocked.
//
// Vibe indicator redesign (2026-09-21, Mike's feedback: the page was text
// heavy and needed a glanceable UI feature): the quote leads, then the vibe
// indicator (see vibeIndicatorHtml below), with the statement and source as
// secondary lines.
(function () {
  'use strict';

  var API_BASE = window.SOMACHECK_API_BASE || 'https://pbldcmniommltbdwuykk.supabase.co/functions/v1/statement-api';
  var FEED_PAGE_SIZE = 50;
  // Safety cap while walking the paginated public feed looking for one slug
  // (there is no server-side filter by slug). 20 pages of 50 covers 1000 live
  // items; beyond that the item is treated as not found rather than hanging
  // the page on an unbounded fetch loop.
  var MAX_FEED_PAGES = 20;
  var SESSION_NONCE_KEY = 'world-vibe-item-join-session';

  var els = {};
  var currentItem = null;
  // Generated once per page load and reused if the tap is retried, so a
  // retry replays the same statement instead of minting a new one.
  var joinNonce = null;

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function createNonce() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'wv-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function getSessionNonce() {
    try {
      var value = window.sessionStorage.getItem(SESSION_NONCE_KEY);
      if (!value) {
        value = createNonce();
        window.sessionStorage.setItem(SESSION_NONCE_KEY, value);
      }
      return value;
    } catch (error) {
      return createNonce();
    }
  }

  function slugFromPath() {
    // Primary form: /world-vibe/share/?item=<slug>, which needs no rewrite rule.
    // Also accepts /world-vibe/share/<slug> if a rewrite is ever configured.
    try {
      var q = new URLSearchParams(window.location.search).get('item');
      if (q) return q;
    } catch (err) { /* older browsers fall through to the path form */ }
    var parts = window.location.pathname.split('/').filter(Boolean);
    var last = parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
    return last === 'share' ? '' : last;
  }

  function setStatus(message, isError) {
    els.status.textContent = message || '';
    els.status.className = 'status' + (isError ? ' error' : '');
  }

  // Plain-language lean labels. Never "aligned: 60%" style wording here: a
  // lean is a direction, not a count, so nobody reads it as a vote tally.
  var LEAN_LABELS = {
    aligned: 'Leans aligned',
    unaligned: 'Leans unaligned',
    mixed: 'Mixed'
  };
  var LEAN_NOTE = 'A lean shows the general direction so far, not a count.';

  function leanOf(item) {
    var lean = item.lean;
    return lean === 'aligned' || lean === 'unaligned' || lean === 'mixed' ? lean : null;
  }

  // Vibe indicator: one glanceable graphic that replaces the old stack of
  // stat blocks. All three privacy phases render as the same ring (same
  // size, same position on the card), and each phase fills that ring
  // differently so nobody reads more precision into it than the API
  // actually returned:
  //   - progress (below unlock_threshold): a ring filled to count/threshold.
  //     The count itself is public, so a precise fill here is honest.
  //   - lean (unlock_threshold to 9 check-ins): a fixed-length colored arc
  //     resting on one of three fixed clock positions. Only the position
  //     (which of the three) carries information; the arc's length never
  //     changes and is not derived from the data, so it cannot be read as a
  //     ratio or an angle.
  //   - split (10+ check-ins): a two-tone ring filled to the exact aligned
  //     percentage, with the percentage itself as the center label.
  // Every phase also carries a plain-word caption, so the phase is available
  // as text, not only as a shape. (Kept in sync with feed.js's copy of this
  // function; there is no shared module between the two pages. This page
  // shows only one item at a time, so unlike feed.js it keeps the lean note
  // on the card instead of moving it to a page-level legend -- there is
  // nothing here for it to repeat against.)
  var VIBE_RING_R = 26;
  var VIBE_RING_C = 2 * Math.PI * VIBE_RING_R;

  function vibeArcAttrs(fraction) {
    var clamped = Math.max(0, Math.min(1, fraction));
    var len = clamped * VIBE_RING_C;
    return 'stroke-dasharray="' + len.toFixed(2) + ' ' + (VIBE_RING_C - len).toFixed(2) + '" transform="rotate(-90 32 32)"';
  }

  function vibeRingHtml(arcsHtml, centerText) {
    return '<svg class="vibe-ring" viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" focusable="false">' +
      '<circle class="vibe-ring-track" cx="32" cy="32" r="' + VIBE_RING_R + '"></circle>' +
      arcsHtml +
      (centerText ? '<text x="32" y="37" text-anchor="middle" class="vibe-ring-text">' + escapeHtml(centerText) + '</text>' : '') +
      '</svg>';
  }

  // Exactly three fixed clock positions (never a continuum): unaligned,
  // mixed, aligned. Only which position lights up carries information; the
  // segment length (LEAN_ARC_FRACTION) is constant and never a function of
  // the actual data, so it can never be read as a ratio or an angle.
  var LEAN_ARC_FRACTION = 60 / 360;
  var LEAN_ARC_CENTER_DEG = { unaligned: 240, mixed: 0, aligned: 120 };

  function vibeLeanArcAttrs(lean) {
    var center = LEAN_ARC_CENTER_DEG[lean];
    var spanDeg = LEAN_ARC_FRACTION * 360;
    var startDeg = center - spanDeg / 2;
    var len = LEAN_ARC_FRACTION * VIBE_RING_C;
    return 'stroke-dasharray="' + len.toFixed(2) + ' ' + (VIBE_RING_C - len).toFixed(2) + '" transform="rotate(' + (startDeg - 90).toFixed(2) + ' 32 32)"';
  }

  // Same ring as the progress and split phases; the lean phase just fills a
  // fixed-length arc at one of the three fixed positions instead of a
  // count-derived or percentage-derived fraction. No center text: unlike the
  // other two phases, nothing here should ever look like a number.
  function vibeLeanRingHtml(lean) {
    var arc = '<circle class="vibe-ring-arc vibe-ring-arc-lean vibe-ring-arc-lean-' + lean + '" cx="32" cy="32" r="' + VIBE_RING_R + '" ' + vibeLeanArcAttrs(lean) + '></circle>';
    return vibeRingHtml(arc, null);
  }

  function vibeIndicatorHtml(item) {
    var count = Number(item.contributor_count);
    if (!isFinite(count) || count < 0) count = 0;
    var threshold = Number(item.unlock_threshold) || 3;
    var hasExact = item.aligned !== null && item.aligned !== undefined &&
      item.unaligned !== null && item.unaligned !== undefined;
    var lean = leanOf(item);
    var svg, main, sub, phase;

    if (hasExact) {
      var aligned = Number(item.aligned) || 0;
      var unaligned = Number(item.unaligned) || 0;
      var total = aligned + unaligned;
      var alignedPct = total ? Math.round((aligned / total) * 100) : 0;
      var unalignedPct = total ? Math.max(0, 100 - alignedPct) : 0;
      // The unaligned circle is a full, dashed-texture ring; the aligned arc
      // is drawn solid on top of it for the exact aligned fraction, so the
      // two shares stay distinguishable without relying on color alone.
      var arcs = '<circle class="vibe-ring-arc vibe-ring-arc-unaligned" cx="32" cy="32" r="' + VIBE_RING_R + '"></circle>' +
        '<circle class="vibe-ring-arc vibe-ring-arc-aligned" cx="32" cy="32" r="' + VIBE_RING_R + '" ' + vibeArcAttrs(alignedPct / 100) + '></circle>';
      svg = vibeRingHtml(arcs, alignedPct + '%');
      main = alignedPct + '% aligned, ' + unalignedPct + '% unaligned';
      sub = count + ' checked in';
      phase = 'split';
    } else if (lean) {
      svg = vibeLeanRingHtml(lean);
      main = LEAN_LABELS[lean];
      sub = LEAN_NOTE;
      phase = 'lean';
    } else {
      svg = vibeRingHtml('<circle class="vibe-ring-arc vibe-ring-arc-progress" cx="32" cy="32" r="' + VIBE_RING_R + '" ' + vibeArcAttrs(threshold ? count / threshold : 0) + '></circle>', count + '/' + threshold);
      main = count + ' of ' + threshold + ' checked in';
      sub = 'Unlocks once ' + threshold + ' people join.';
      phase = 'progress';
    }

    return '<div class="vibe-indicator" data-phase="' + phase + '">' +
      svg +
      '<div class="vibe-caption"><div class="vibe-caption-main">' + escapeHtml(main) + '</div><div class="vibe-caption-sub">' + escapeHtml(sub) + '</div></div>' +
      '</div>';
  }

  function renderItem(item) {
    els.quote.textContent = item.quote || '';
    els.statement.textContent = item.statement || '';
    els.progress.innerHTML = vibeIndicatorHtml(item);
    if (item.source_url) {
      els.sourceLink.href = item.source_url;
      els.sourceLink.textContent = item.domain || item.source_url;
      els.sourceLine.hidden = false;
    } else {
      els.sourceLine.hidden = true;
    }
    els.start.hidden = false;
    els.start.disabled = false;
    document.title = 'World Vibe: ' + (item.statement || 'SomaCheck');
    setStatus('', false);
  }

  function renderUnavailable() {
    els.quote.textContent = 'This item is not available.';
    els.statement.textContent = '';
    els.progress.innerHTML = '';
    els.sourceLine.hidden = true;
    els.start.hidden = true;
    setStatus('This item could not be found. It may have been removed or is still awaiting review.', true);
  }

  function findItemBySlug(slug, cursor, pagesChecked) {
    var url = API_BASE + '/v1/public/world-vibe/feed?limit=' + FEED_PAGE_SIZE +
      (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('feed-unavailable-' + r.status);
      return r.json();
    }).then(function (data) {
      var items = Array.isArray(data.items) ? data.items : [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].slug === slug) return items[i];
      }
      var nextCursor = data.next_cursor || null;
      if (nextCursor && pagesChecked + 1 < MAX_FEED_PAGES) {
        return findItemBySlug(slug, nextCursor, pagesChecked + 1);
      }
      return null;
    });
  }

  function onStartClick() {
    if (!currentItem || els.start.disabled) return;
    els.start.disabled = true;
    setStatus('Preparing your check-in...', false);
    if (!joinNonce) joinNonce = createNonce();

    fetch(API_BASE + '/v1/public/world-vibe/items/' + encodeURIComponent(currentItem.slug) + '/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_nonce: joinNonce, session_nonce: getSessionNonce() })
    }).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }

        if (r.status === 404) {
          setStatus('This item is no longer available.', true);
          els.start.disabled = false;
          return;
        }
        if (r.status === 429) {
          setStatus('the world is busy today, come back tomorrow', false);
          els.start.disabled = false;
          return;
        }
        if (!r.ok || !data || !data.link_url) {
          setStatus('Something went wrong. Please try again.', true);
          els.start.disabled = false;
          return;
        }

        setStatus('Your check-in is ready in SomaCheck.', false);
        window.location.href = data.link_url;
      });
    }).catch(function (err) {
      setStatus('Something went wrong. Please try again.', true);
      els.start.disabled = false;
      console.error('world-vibe item join error:', err);
    });
  }

  function init() {
    els.quote = document.getElementById('item-quote');
    els.statement = document.getElementById('item-statement');
    els.progress = document.getElementById('progress');
    els.sourceLine = document.getElementById('source-line');
    els.sourceLink = document.getElementById('source-link');
    els.start = document.getElementById('start-check-in');
    els.status = document.getElementById('status');
    if (!els.start) return;

    els.start.addEventListener('click', onStartClick);

    var slug = slugFromPath();
    if (!slug) {
      renderUnavailable();
      return;
    }

    findItemBySlug(slug, null, 0).then(function (item) {
      if (!item) {
        renderUnavailable();
        return;
      }
      currentItem = item;
      renderItem(item);
    }).catch(function (err) {
      renderUnavailable();
      console.error('world-vibe item load error:', err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

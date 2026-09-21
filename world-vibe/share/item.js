// World Vibe content-item share page (Lane H, 2026-09-17).
//
// The canonical content-item page is /world-vibe/share/?item=<slug>. The
// legacy path form remains a browser-compatible alias through _redirects.
// Curated topic pages stay in their own static folders.
//
// Flow: read the slug from the canonical query parameter, look it up through
// the one-item public endpoint, render the quote/statement/source/progress,
// and only on an explicit tap call
// POST {API_BASE}/v1/public/world-vibe/items/{slug}/join and navigate to the
// returned link_url (a signed /s/<token> statement link). No statement is
// ever issued before that tap. The feed only ever contains live items, so an
// item that cannot be found is treated as not available.
//
// Lean phase (2026-09-19): below the unlock threshold, progress only, as
// before. From the unlock threshold to 9 completed check-ins, only a
// plain-language lean is shown (Leans aligned / Leans unaligned / Mixed)
// with a one-line note that it is a direction, not a count. The exact split
// still renders once the API returns it, at 10 completed check-ins. Privacy
// fix (Mike): this closes the hole where a creator sharing an item with
// exactly two friends could infer both friends' individual readings from a
// 3-0 or 1-2 split the moment the item unlocked.
(function () {
  'use strict';

  var API_BASE = window.SOMACHECK_API_BASE || 'https://pbldcmniommltbdwuykk.supabase.co/functions/v1/statement-api';
  var SESSION_NONCE_KEY = 'world-vibe-item-join-session';
  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

  function slugFromLocation() {
    // The query form is canonical. This fallback makes direct legacy paths
    // graceful on hosts that have not yet picked up the redirect rule.
    try {
      var q = new URLSearchParams(window.location.search).get('item');
      if (q) return { slug: q, fromLegacyPath: false };
    } catch (err) { /* older browsers fall through to the path form */ }
    var parts = window.location.pathname.split('/').filter(Boolean);
    var last = parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
    return { slug: last === 'share' ? '' : last, fromLegacyPath: true };
  }

  function validSlug(slug) {
    return typeof slug === 'string' && slug.length <= 100 && SLUG.test(slug);
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

  function progressHtml(item) {
    var count = Number(item.contributor_count);
    if (!isFinite(count) || count < 0) count = 0;
    var threshold = Number(item.unlock_threshold) || 3;
    var hasExact = item.aligned !== null && item.aligned !== undefined &&
      item.unaligned !== null && item.unaligned !== undefined;
    var lean = leanOf(item);

    if (hasExact) {
      var aligned = Number(item.aligned) || 0;
      var unaligned = Number(item.unaligned) || 0;
      var total = aligned + unaligned;
      var alignedPct = total ? Math.round((aligned / total) * 100) : 0;
      var unalignedPct = total ? Math.max(0, 100 - alignedPct) : 0;
      return (
        '<div class="aggregate-label">What participants noticed</div>' +
        '<div class="split">' +
          '<div class="split-row"><span>Aligned</span><strong>' + alignedPct + '%</strong></div>' +
          '<div class="split-row"><span>Unaligned</span><strong>' + unalignedPct + '%</strong></div>' +
        '</div>' +
        count + ' checked in'
      );
    }

    if (lean) {
      return (
        '<div class="aggregate-label">What participants noticed</div>' +
        '<div class="lean lean-' + lean + '">' + LEAN_LABELS[lean] + '</div>' +
        '<div class="lean-note">' + LEAN_NOTE + '</div>' +
        count + ' checked in'
      );
    }

    return '<strong>' + count + ' of ' + threshold + '</strong>Results appear after ' + threshold + ' people join.';
  }

  function renderItem(item) {
    els.quote.textContent = item.quote || '';
    els.statement.textContent = item.statement || '';
    els.progress.innerHTML = progressHtml(item);
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

  function fetchItem(slug) {
    return fetch(API_BASE + '/v1/public/world-vibe/items/' + encodeURIComponent(slug)).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('item-unavailable-' + r.status);
      return r.json();
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

    var route = slugFromLocation();
    if (!validSlug(route.slug)) {
      renderUnavailable();
      return;
    }

    if (route.fromLegacyPath && window.history && window.history.replaceState) {
      window.history.replaceState(
        null,
        '',
        '/world-vibe/share/?item=' + encodeURIComponent(route.slug)
      );
    }

    fetchItem(route.slug).then(function (item) {
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

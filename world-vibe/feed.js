// World Vibe live feed (Lane E, 2026-09-17; ranking added at Lane I, 2026-09-18;
// lean phase added at Lane I, 2026-09-19).
//
// Renders GET {statementApiBase}/v1/public/world-vibe/feed?order=&limit= as
// cards, polling every 30 seconds and merging without a full re-render so
// scroll position is not disturbed. Each card exposes:
//   - the quote and the statement
//   - "X of Y checked in" until the API returns a lean, which it only does
//     at or above the unlock threshold; from there to 9 completed check-ins
//     the card shows only a plain-language lean (Leans aligned / Leans
//     unaligned / Mixed) with a one-line note that it is a direction, not a
//     count; the exact split still appears once the API returns it, at 10
//     completed check-ins (privacy fix, Mike 2026-09-19: closes the hole
//     where a creator sharing with exactly two friends could infer both
//     friends' individual readings from a 3-0 or 1-2 split)
//   - the source (site name) linking back to the exact original page
//   - "Check in on your phone", which opens the item's share link exactly as
//     the curated topic cards already do
//   - a Report control that posts to
//     /v1/public/world-vibe/items/{slug}/report
//
// Ranked (order=ranked) is the default: it orders by completed check-ins,
// the same count a card already shows as "X of Y checked in" -- a pending
// ask never moves a card. Newest (order=recent) stays one tap away. A poll
// can change an item's rank as well as its progress, so every poll
// reconciles the DOM order to match the API's order, moving existing card
// elements rather than rebuilding them, so scroll position survives a card
// moving up or down same as it survives one being added or removed.
//
// This module also owns the Feed / Topics tab switch. The Topics tab keeps
// its existing markup and script (the inline script at the bottom of
// index.html) untouched; this file never touches topic state.
(function () {
  'use strict';

  var STATEMENT_API_URL = (typeof window !== 'undefined' && window.SOMACHECK_API_BASE) ||
    'https://pbldcmniommltbdwuykk.supabase.co/functions/v1/statement-api';
  var FEED_POLL_MS = 30000;
  var FEED_PAGE_SIZE = 30;
  var DEFAULT_ORDER = 'ranked';
  var ORDER_NOTES = {
    ranked: 'Ordered by completed check-ins.',
    recent: 'Ordered by newest activity.'
  };
  // Persists across sessions so a repeat report from the same browser dedupes
  // server-side (the RPC hashes this; nothing readable is ever sent).
  var CLIENT_NONCE_KEY = 'world-vibe-report-nonce';
  // Per-tab session id. A fresh one each session is fine: the nonce above is
  // what dedupes a reporter, this is a secondary fingerprint component.
  var CLIENT_SESSION_KEY = 'world-vibe-session-nonce';

  // Plain-language lean labels. Never "aligned: 60%" style wording here: a
  // lean is a direction, not a count, so nobody reads it as a vote tally.
  var LEAN_LABELS = {
    aligned: 'Leans aligned',
    unaligned: 'Leans unaligned',
    mixed: 'Mixed'
  };
  var LEAN_NOTE = 'A lean shows the general direction so far, not a count.';

  var REPORT_REASONS = [
    { value: 'illegal_content', label: 'Illegal content' },
    { value: 'adult_content', label: 'Adult content' },
    { value: 'harassment', label: 'Harassment' },
    { value: 'hate', label: 'Hate' },
    { value: 'self_harm', label: 'Self harm' },
    { value: 'spam', label: 'Spam' },
    { value: 'other', label: 'Other' }
  ];

  var els = {};
  var itemsBySlug = {};
  var loaded = false;
  var currentOrder = DEFAULT_ORDER;

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function randomId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'wv-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function persistentValue(key, storage) {
    try {
      var value = storage.getItem(key);
      if (!value) {
        value = randomId();
        storage.setItem(key, value);
      }
      return value;
    } catch (error) {
      return randomId();
    }
  }

  function getClientNonce() { return persistentValue(CLIENT_NONCE_KEY, window.localStorage); }
  function getClientSession() { return persistentValue(CLIENT_SESSION_KEY, window.sessionStorage); }

  function shareUrlFor(slug) { return '/world-vibe/share/?item=' + encodeURIComponent(slug); }

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
        '<div class="stat"><span class="value">' + count + '</span><span class="label">checked in</span></div>'
      );
    }

    if (lean) {
      return (
        '<div class="aggregate-label">What participants noticed</div>' +
        '<div class="lean lean-' + lean + '">' + LEAN_LABELS[lean] + '</div>' +
        '<div class="lean-note">' + LEAN_NOTE + '</div>' +
        '<div class="stat"><span class="value">' + count + '</span><span class="label">checked in</span></div>'
      );
    }

    return (
      '<div class="progress-lock">' +
        '<div class="value">' + count + ' of ' + threshold + '</div>' +
        '<div class="label">checked in</div>' +
      '</div>'
    );
  }

  function reasonOptionsHtml() {
    return REPORT_REASONS.map(function (r) {
      var selected = r.value === 'other' ? ' selected' : '';
      return '<option value="' + r.value + '"' + selected + '>' + escapeHtml(r.label) + '</option>';
    }).join('');
  }

  function cardHtml(item) {
    var domain = item.domain || 'this source';
    var sourceUrl = item.source_url || '#';
    var slug = item.slug;
    return (
      '<div class="quote">“' + escapeHtml(item.quote) + '”</div>' +
      '<div class="statement">' + escapeHtml(item.statement) + '</div>' +
      '<div data-role="progress">' + progressHtml(item) + '</div>' +
      '<div class="source-line">Source: <a href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(domain) + '</a></div>' +
      '<div class="actions">' +
        '<a class="btn btn-primary" href="' + shareUrlFor(slug) + '">Check in on your phone</a>' +
        '<button type="button" class="btn btn-secondary report-btn" data-slug="' + escapeHtml(slug) + '">Report</button>' +
      '</div>' +
      '<div class="report-panel" data-role="report-panel" hidden>' +
        '<label class="report-label" for="report-reason-' + escapeHtml(slug) + '">Why are you reporting this item?</label>' +
        '<select class="report-reason" id="report-reason-' + escapeHtml(slug) + '">' + reasonOptionsHtml() + '</select>' +
        '<div class="report-actions">' +
          '<button type="button" class="btn btn-primary report-submit" data-slug="' + escapeHtml(slug) + '">Send report</button>' +
          '<button type="button" class="btn btn-secondary report-cancel">Cancel</button>' +
        '</div>' +
      '</div>' +
      '<div class="status" data-role="status"></div>'
    );
  }

  function bindCard(el, slug) {
    var reportBtn = el.querySelector('.report-btn');
    var panel = el.querySelector('[data-role="report-panel"]');
    var cancelBtn = el.querySelector('.report-cancel');
    var submitBtn = el.querySelector('.report-submit');
    var statusEl = el.querySelector('[data-role="status"]');

    if (reportBtn && panel) {
      reportBtn.addEventListener('click', function () {
        panel.hidden = !panel.hidden;
      });
    }
    if (cancelBtn && panel) {
      cancelBtn.addEventListener('click', function () { panel.hidden = true; });
    }
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        submitReport(el, slug, statusEl, submitBtn, reportBtn, panel);
      });
    }
  }

  function submitReport(cardEl, slug, statusEl, submitBtn, reportBtn, panel) {
    var select = cardEl.querySelector('.report-reason');
    var reason = select ? select.value : 'other';
    submitBtn.disabled = true;
    if (statusEl) {
      statusEl.textContent = 'Sending report...';
      statusEl.className = 'status';
    }
    fetch(STATEMENT_API_URL + '/v1/public/world-vibe/items/' + encodeURIComponent(slug) + '/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: reason,
        client_nonce: getClientNonce(),
        client_session: getClientSession()
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('report-failed-' + r.status);
      return r.json();
    }).then(function () {
      if (statusEl) {
        statusEl.textContent = 'This item was sent for review.';
        statusEl.className = 'status';
      }
      if (panel) panel.hidden = true;
      if (reportBtn) {
        reportBtn.disabled = true;
        reportBtn.textContent = 'Reported';
      }
    }).catch(function (err) {
      if (statusEl) {
        statusEl.textContent = 'The report could not be sent. Please try again.';
        statusEl.className = 'status error';
      }
      submitBtn.disabled = false;
      console.error('world-vibe report error:', err);
    });
  }

  function buildCard(item) {
    var el = document.createElement('article');
    el.className = 'topic feed-card';
    el.id = 'feed-item-' + item.slug;
    el.innerHTML = cardHtml(item);
    bindCard(el, item.slug);
    return el;
  }

  function updateCard(item) {
    var el = document.getElementById('feed-item-' + item.slug);
    if (!el) return;
    var progressEl = el.querySelector('[data-role="progress"]');
    if (progressEl) progressEl.innerHTML = progressHtml(item);
  }

  function renderEmpty() {
    els.list.innerHTML = '<div class="empty">Nothing in the feed yet. Vibe a page from the SomaCheck extension to start it.</div>';
  }

  function renderError() {
    els.list.innerHTML = '<div class="error">The feed could not be loaded. Please try again later.</div>';
  }

  // Moves existing card elements into the exact order the API returned,
  // without recreating any of them, so bound listeners and any open report
  // panel survive. A rank change (a count rising) or a newest-first bump is
  // reflected the same way an addition or removal already was: no full
  // re-render, so scroll position is not disturbed.
  function reorderList(items) {
    items.forEach(function (item) {
      var el = document.getElementById('feed-item-' + item.slug);
      if (el) els.list.appendChild(el);
    });
  }

  // Reconciles the DOM against the newest page of items: updates cards that
  // are still present, builds genuinely new ones, drops cards that fell out
  // of the page (moderation, or pushed off by newer activity), then
  // reorders everything to match the API's order. Existing cards are
  // mutated and moved in place rather than the list being rebuilt, so a
  // reader partway down the feed keeps their place.
  function mergeItems(items) {
    if (!loaded) {
      els.list.innerHTML = '';
      itemsBySlug = {};
      if (items.length === 0) {
        renderEmpty();
      } else {
        items.forEach(function (item) {
          itemsBySlug[item.slug] = item;
          els.list.appendChild(buildCard(item));
        });
      }
      loaded = true;
      return;
    }

    var seen = {};
    items.forEach(function (item) {
      seen[item.slug] = true;
      if (itemsBySlug[item.slug]) {
        itemsBySlug[item.slug] = item;
        updateCard(item);
      } else {
        itemsBySlug[item.slug] = item;
        els.list.appendChild(buildCard(item));
      }
    });

    // Drop cards no longer in the newest page (reported+held, or scrolled
    // off the top of the window by newer activity).
    Object.keys(itemsBySlug).forEach(function (slug) {
      if (seen[slug]) return;
      delete itemsBySlug[slug];
      var el = document.getElementById('feed-item-' + slug);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    if (items.length === 0) {
      renderEmpty();
      return;
    }
    if (els.list.querySelector('.empty')) {
      els.list.innerHTML = '';
      items.forEach(function (item) {
        els.list.appendChild(buildCard(item));
      });
      return;
    }

    // The API is the source of truth for order (ranked or recent): move
    // every card into that exact sequence rather than trusting arrival order.
    reorderList(items);
  }

  function loadFeed() {
    return fetch(
      STATEMENT_API_URL + '/v1/public/world-vibe/feed?order=' + currentOrder + '&limit=' + FEED_PAGE_SIZE
    )
      .then(function (r) {
        if (!r.ok) throw new Error('feed-unavailable-' + r.status);
        return r.json();
      })
      .then(function (data) {
        var items = Array.isArray(data.items) ? data.items : [];
        mergeItems(items);
      })
      .catch(function (err) {
        if (!loaded) renderError();
        console.error('world-vibe feed error:', err);
      });
  }

  function pollFeed() {
    if (document.visibilityState === 'hidden') return;
    loadFeed();
  }

  // Switching order is a deliberate navigation, not a poll: the page starts
  // a fresh first page and renders it from scratch, same as the very first
  // load. A poll keeps reconciling in place; only this jumps to page one.
  function setOrder(order) {
    if (order !== 'ranked' && order !== 'recent') return;
    if (order === currentOrder) return;
    currentOrder = order;
    if (els.orderButtons) {
      els.orderButtons.forEach(function (btn) {
        var active = btn.dataset.order === order;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    if (els.orderNote) els.orderNote.textContent = ORDER_NOTES[order] || '';
    loaded = false;
    itemsBySlug = {};
    loadFeed();
  }

  function initOrderControl() {
    els.orderButtons = Array.prototype.slice.call(document.querySelectorAll('.order-btn'));
    els.orderNote = document.getElementById('feed-order-note');
    if (els.orderNote) els.orderNote.textContent = ORDER_NOTES[currentOrder] || '';
    els.orderButtons.forEach(function (btn) {
      btn.addEventListener('click', function () { setOrder(btn.dataset.order); });
    });
  }

  function initTabs() {
    var tabButtons = document.querySelectorAll('.tab-btn');
    if (!tabButtons.length) return;
    tabButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.dataset.tab;
        tabButtons.forEach(function (b) {
          var active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('.tab-panel').forEach(function (panel) {
          panel.classList.toggle('active', panel.id === target + '-panel');
        });
      });
    });
  }

  function init() {
    initTabs();
    els.list = document.getElementById('feed-list');
    if (!els.list) return;
    initOrderControl();
    loadFeed();
    setInterval(pollFeed, FEED_POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

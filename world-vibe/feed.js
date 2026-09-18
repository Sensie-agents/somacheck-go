// World Vibe live feed (Lane E, 2026-09-17).
//
// Renders GET {statementApiBase}/v1/public/world-vibe/feed?cursor= as cards,
// newest first, polling every 30 seconds and merging without a full
// re-render so scroll position is not disturbed. Each card exposes:
//   - the quote and the statement
//   - "X of Y checked in" until the API returns an aggregate split, which it
//     only does at or above the unlock threshold
//   - the source (site name) linking back to the exact original page
//   - "Check in on your phone", which opens the item's share link exactly as
//     the curated topic cards already do
//   - a Report control that posts to
//     /v1/public/world-vibe/items/{slug}/report
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
  // Persists across sessions so a repeat report from the same browser dedupes
  // server-side (the RPC hashes this; nothing readable is ever sent).
  var CLIENT_NONCE_KEY = 'world-vibe-report-nonce';
  // Per-tab session id. A fresh one each session is fine: the nonce above is
  // what dedupes a reporter, this is a secondary fingerprint component.
  var CLIENT_SESSION_KEY = 'world-vibe-session-nonce';

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

  function shareUrlFor(slug) { return '/world-vibe/share/' + encodeURIComponent(slug); }

  function progressHtml(item) {
    var count = Number(item.contributor_count);
    if (!isFinite(count) || count < 0) count = 0;
    var threshold = Number(item.unlock_threshold) || 3;
    var unlocked = item.aligned !== null && item.aligned !== undefined &&
      item.unaligned !== null && item.unaligned !== undefined;

    if (!unlocked) {
      return (
        '<div class="progress-lock">' +
          '<div class="value">' + count + ' of ' + threshold + '</div>' +
          '<div class="label">checked in</div>' +
        '</div>'
      );
    }

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

  // Reconciles the DOM against the newest page of items: updates cards that
  // are still present, prepends genuinely new ones above everything else,
  // and drops cards that fell out of the page (moderation, or pushed off by
  // newer activity). Existing cards are mutated in place rather than the
  // list being rebuilt, so a reader partway down the feed keeps their place.
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
    var newOnes = [];
    items.forEach(function (item) {
      seen[item.slug] = true;
      if (itemsBySlug[item.slug]) {
        itemsBySlug[item.slug] = item;
        updateCard(item);
      } else {
        newOnes.push(item);
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

    if (Object.keys(itemsBySlug).length === 0 && newOnes.length === 0) {
      renderEmpty();
      return;
    }
    if (els.list.querySelector('.empty') && (newOnes.length || Object.keys(itemsBySlug).length)) {
      els.list.innerHTML = '';
    }

    // Newest first: insert in reverse so the very newest item ends at top.
    for (var i = newOnes.length - 1; i >= 0; i--) {
      var item = newOnes[i];
      itemsBySlug[item.slug] = item;
      els.list.insertBefore(buildCard(item), els.list.firstChild);
    }
  }

  function loadFeed() {
    return fetch(STATEMENT_API_URL + '/v1/public/world-vibe/feed?limit=' + FEED_PAGE_SIZE)
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
    loadFeed();
    setInterval(pollFeed, FEED_POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

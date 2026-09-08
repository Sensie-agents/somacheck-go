(function() {
  'use strict';

  var API_BASE = window.SOMACHECK_API_BASE || 'https://pbldcmniommltbdwuykk.supabase.co/functions/v1/statement-api';
  var SMART_ROUTE_ORIGIN = 'https://link.somacheck.com';
  // world-vibe/config.js sets window.SOMACHECK_INSTALL_URL; this literal is a
  // fallback only for environments that don't load that file.
  var INSTALL_URL = window.SOMACHECK_INSTALL_URL || 'https://testflight.apple.com/join/C4mAH3zz';
  var TOPICS_TIMEOUT_MS = Number(window.SOMACHECK_TOPICS_TIMEOUT_MS) || 8000;
  var BRANCH_LONG_LINK_PATH = /^\/a\/key_(?:live|test)_[A-Za-z0-9]+$/;
  var SMART_ROUTE_KEYS = [
    'route_version', 'topic_slug', 'prompt_id', '$canonical_url', '$fallback_url',
    '$ios_url', '$ios_nativelink', '$deeplink_no_attribution', '$do_not_process'
  ];

  var page = document.querySelector('[data-world-vibe-topic]');
  if (!page) return;

  var topicSlug = page.dataset.worldVibeTopic;
  var expectedStatement = page.dataset.statement;
  var canonical = document.querySelector('link[rel="canonical"]');
  var stableUrl = canonical ? canonical.href : window.location.href.replace(/\/$/, '');
  var progress = document.getElementById('progress');
  var start = document.getElementById('start-check-in');
  var share = document.getElementById('share-topic');
  var status = document.getElementById('status');
  var activePromptId = null;
  var loadAttempt = 0;
  var loadController = null;

  function exactParam(params, key, expected) {
    var values = params.getAll(key);
    return values.length === 1 && values[0] === expected;
  }

  function smartTopicRoute(raw, promptId) {
    if (typeof raw !== 'string' || !raw || !promptId) return null;
    var parsed;
    try { parsed = new URL(raw); } catch (error) { return null; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null;
    if (parsed.origin !== SMART_ROUTE_ORIGIN || parsed.origin === window.location.origin) return null;
    if (!BRANCH_LONG_LINK_PATH.test(parsed.pathname)) return null;
    var entries = 0;
    var hasExtra = false;
    parsed.searchParams.forEach(function(value, key) {
      entries += 1;
      if (SMART_ROUTE_KEYS.indexOf(key) === -1) hasExtra = true;
    });
    if (hasExtra || entries !== SMART_ROUTE_KEYS.length) return null;
    if (!exactParam(parsed.searchParams, 'route_version', '1')) return null;
    if (!exactParam(parsed.searchParams, 'topic_slug', topicSlug)) return null;
    if (!exactParam(parsed.searchParams, 'prompt_id', promptId)) return null;
    if (!exactParam(parsed.searchParams, '$canonical_url', stableUrl)) return null;
    if (!exactParam(parsed.searchParams, '$fallback_url', stableUrl)) return null;
    if (!exactParam(parsed.searchParams, '$ios_url', INSTALL_URL)) return null;
    if (!exactParam(parsed.searchParams, '$ios_nativelink', 'true')) return null;
    if (!exactParam(parsed.searchParams, '$deeplink_no_attribution', 'true')) return null;
    if (!exactParam(parsed.searchParams, '$do_not_process', 'true')) return null;
    return raw;
  }

  function setStatus(message, isError) {
    status.textContent = message || '';
    status.className = 'status' + (isError ? ' error' : '');
  }

  function renderProgress(topic) {
    var count = Number(topic.contributor_count);
    var threshold = Number(topic.unlock_threshold) || 5;
    if (!isFinite(count) || count < 0) count = 0;
    var unlocked = topic.unlocked === true && count >= threshold;
    if (!unlocked) {
      progress.innerHTML = '<strong>' + count + ' of ' + threshold + ' check-ins</strong>' +
        'Results appear after ' + threshold + ' people join.';
      return;
    }
    var aligned = Number(topic.aligned);
    var unaligned = Number(topic.unaligned);
    if (!isFinite(aligned) || !isFinite(unaligned) || aligned + unaligned !== count) {
      progress.innerHTML = '<strong>' + count + ' check-ins</strong>Results are updating.';
      return;
    }
    progress.innerHTML = '<strong>World Vibe unlocked</strong>' +
      'What participants noticed: Aligned ' + Math.round((aligned / count) * 100) + '% · Unaligned ' +
      Math.round((unaligned / count) * 100) + '%';
  }

  function findTopic(data) {
    var topics = data && Array.isArray(data.topics) ? data.topics : [];
    return topics.find(function(topic) {
      return topic.topic_slug === topicSlug && topic.statement_text === expectedStatement;
    }) || null;
  }

  function applyTopic(topic) {
    if (!topic) {
      start.href = '/world-vibe/?t=' + encodeURIComponent(topicSlug);
      start.textContent = 'Open World Vibe';
      start.removeAttribute('aria-disabled');
      setStatus('This topic could not be loaded here. Open World Vibe to try again.', true);
      return;
    }
    activePromptId = topic.prompt_id;
    renderProgress(topic);
    var route = smartTopicRoute(topic.route_url, topic.prompt_id);
    if (route) {
      start.href = route;
      start.textContent = 'Open in SomaCheck';
      start.removeAttribute('aria-disabled');
      start.dataset.routeReady = 'true';
      start.dataset.action = 'route';
      setStatus('', false);
      return;
    }
    start.href = '/world-vibe/?t=' + encodeURIComponent(topicSlug);
    start.textContent = 'Open World Vibe';
    start.removeAttribute('aria-disabled');
    setStatus('Open World Vibe to prepare this check-in.', false);
  }

  function prepareTopicLoad() {
    start.removeAttribute('href');
    start.textContent = 'Preparing SomaCheck...';
    start.setAttribute('aria-disabled', 'true');
    delete start.dataset.routeReady;
    delete start.dataset.retryReady;
    start.dataset.action = 'loading';
    setStatus('', false);
  }

  function showRetry(message) {
    activePromptId = null;
    start.removeAttribute('href');
    start.textContent = 'Retry handoff';
    start.removeAttribute('aria-disabled');
    delete start.dataset.routeReady;
    start.dataset.retryReady = 'true';
    start.dataset.action = 'retry';
    setStatus(message, true);
  }

  function loadTopic() {
    var attempt = ++loadAttempt;
    if (loadController) loadController.abort();
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    loadController = controller;
    prepareTopicLoad();
    var timeoutId = window.setTimeout(function() {
      if (controller && attempt === loadAttempt) controller.abort();
    }, TOPICS_TIMEOUT_MS);
    var options = { method: 'GET' };
    if (controller) options.signal = controller.signal;
    return fetch(API_BASE + '/v1/public/world-vibe/topics', options)
      .then(function(response) {
        if (!response.ok) throw new Error('topics-unavailable');
        return response.json();
      })
      .then(function(data) {
        if (attempt === loadAttempt) applyTopic(findTopic(data));
      })
      .catch(function(error) {
        if (attempt !== loadAttempt) return;
        if (error && error.name === 'AbortError') {
          showRetry('This is taking longer than expected. Retry when you are ready.');
          return;
        }
        showRetry('SomaCheck could not be prepared. Check your connection and retry.');
      })
      .finally(function() { window.clearTimeout(timeoutId); });
  }

  function refreshProgress() {
    if (!activePromptId || document.hidden) return;
    fetch(API_BASE + '/v1/public/world-vibe/topics/' + encodeURIComponent(topicSlug) + '/progress', { method: 'GET' })
      .then(function(response) {
        if (!response.ok) throw new Error('progress-unavailable');
        return response.json();
      })
      .then(function(topic) {
        if (topic.topic_slug === topicSlug && topic.prompt_id === activePromptId) renderProgress(topic);
      })
      .catch(function() {});
  }

  start.addEventListener('click', function(event) {
    if (start.dataset.action === 'retry') {
      event.preventDefault();
      loadTopic();
      return;
    }
    if (!start.href) event.preventDefault();
  });

  share.addEventListener('click', function() {
    var text = "World Vibe: '" + expectedStatement + "'. Open it in SomaCheck: " + stableUrl;
    if (navigator.share) {
      navigator.share({ title: 'World Vibe - SomaCheck', text: text, url: stableUrl }).catch(function() {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        share.textContent = 'Link copied';
        setTimeout(function() { share.textContent = 'Share this World Vibe'; }, 1500);
      }).catch(function() {});
    }
  });

  loadTopic().then(function() {
    window.setInterval(refreshProgress, 7000);
  });
})();

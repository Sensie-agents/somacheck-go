(function() {
  'use strict';

  var API_BASE = window.SOMACHECK_API_BASE || 'https://pbldcmniommltbdwuykk.supabase.co/functions/v1/statement-api';
  var SMART_ROUTE_ORIGIN = 'https://link.somacheck.com';
  var INSTALL_URL = 'https://testflight.apple.com/join/C4mAH3zz';
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

  function formatTimestamp(value) {
    if (!value) return 'Waiting for the first completed check-in';
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'Waiting for the first completed check-in';
    return 'Last check-in ' + date.toLocaleString();
  }

  function renderProgress(topic) {
    var count = Number(topic.contributor_count);
    var threshold = Number(topic.unlock_threshold) || 5;
    if (!isFinite(count) || count < 0) count = 0;
    var unlocked = topic.unlocked === true && count >= threshold;
    if (!unlocked) {
      progress.innerHTML = '<strong>' + count + ' of ' + threshold + ' check-ins</strong>' +
        'Results appear after ' + threshold + ' people join.<br>' + formatTimestamp(topic.last_completed_at);
      return;
    }
    var aligned = Number(topic.aligned);
    var unaligned = Number(topic.unaligned);
    if (!isFinite(aligned) || !isFinite(unaligned) || aligned + unaligned !== count) {
      progress.innerHTML = '<strong>' + count + ' check-ins</strong>Results are updating.';
      return;
    }
    progress.innerHTML = '<strong>World Vibe unlocked</strong>' +
      'Aligned ' + Math.round((aligned / count) * 100) + '% · Unaligned ' +
      Math.round((unaligned / count) * 100) + '%<br>' + formatTimestamp(topic.last_completed_at);
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
      start.textContent = 'Start your check-in';
      start.removeAttribute('aria-disabled');
      start.dataset.routeReady = 'true';
      setStatus('', false);
      return;
    }
    start.href = '/world-vibe/?t=' + encodeURIComponent(topicSlug);
    start.textContent = 'Open World Vibe';
    start.removeAttribute('aria-disabled');
    setStatus('Open World Vibe to prepare this check-in.', false);
  }

  function loadTopic() {
    return fetch(API_BASE + '/v1/public/world-vibe/topics', { method: 'GET' })
      .then(function(response) {
        if (!response.ok) throw new Error('topics-unavailable');
        return response.json();
      })
      .then(function(data) { applyTopic(findTopic(data)); })
      .catch(function() { applyTopic(null); });
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

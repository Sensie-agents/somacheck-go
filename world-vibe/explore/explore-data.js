// Live data for World Vibe Explore. Routes and envelopes are the ones the
// statement-api serves (receipts/EXPLORE-API.md). Every loader takes the fetch
// function so tests can replay the captured contract fixtures.
export const DEFAULT_API = 'https://pbldcmniommltbdwuykk.supabase.co/functions/v1/statement-api';
const PUBLIC = '/v1/public/world-vibe';
export const MAX_PAGES = 20;

async function getJson(fetchFn, url, init) {
  const r = await (init ? fetchFn(url, init) : fetchFn(url));
  if (!r.ok) { const e = new Error('http_' + r.status); e.status = r.status; throw e; }
  return r.json();
}

// feed_v3 pages: { items, next_cursor }. Follows the cursor until it is null.
// If maxPages is hit first, the unread cursor is returned so the caller can
// offer "Load more" instead of claiming the feed is finished.
export async function loadFeed(fetchFn, base, { cursor = null, maxPages = MAX_PAGES } = {}) {
  const items = [];
  for (let page = 0; page < maxPages && (page === 0 || cursor); page++) {
    const body = await getJson(fetchFn, base + PUBLIC + '/feed' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    items.push(...(Array.isArray(body.items) ? body.items : []));
    cursor = body.next_cursor || null;
  }
  return { items, cursor };
}

// Applies one feed load to the page state. A failed continuation keeps the rows
// and the unread cursor it already has and only raises the error flag.
export async function loadFeedInto(data, fetchFn, base, cursor) {
  try {
    const r = await loadFeed(fetchFn, base, { cursor });
    data.feed = cursor ? data.feed.concat(r.items) : r.items;
    data.feedCursor = r.cursor;
    data.feedError = false;
  } catch (e) {
    data.feedError = true;
  }
}

// Try again resumes from the preserved cursor when pagination state has one
// (a failed continuation), and starts over only when there is none.
export const retryCursor = (data) => data.feedCursor || null;

// { curators: [{ curator_id, display_name, lines_count, checkins_sparked }] }
export async function loadCurators(fetchFn, base) {
  const body = await getJson(fetchFn, base + PUBLIC + '/curators');
  return Array.isArray(body.curators) ? body.curators : [];
}

// { featured: {...} | null }
export async function loadFeatured(fetchFn, base) {
  const body = await getJson(fetchFn, base + PUBLIC + '/featured?slot=topic_of_week');
  return body.featured || null;
}

// { items } for a signed-in caller. No token means no request at all and the
// 'signin' state; a 401 with a token is 'auth'; anything else is 'unavailable'.
export async function loadFollowing(fetchFn, base, getToken = () => null) {
  const token = getToken();
  if (!token) return { items: [], error: 'signin' };
  try {
    const body = await getJson(fetchFn, base + '/v1/me/world-vibe/following-feed', { headers: { Authorization: 'Bearer ' + token } });
    return { items: Array.isArray(body.items) ? body.items : [], error: null };
  } catch (e) {
    return { items: [], error: e.status === 401 ? 'auth' : 'unavailable' };
  }
}

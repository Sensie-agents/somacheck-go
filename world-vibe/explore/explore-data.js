// Live data for World Vibe Explore. Routes and envelopes are the ones the
// statement-api serves (receipts/EXPLORE-API.md). Every loader takes the fetch
// function so tests can replay the captured contract fixtures.
export const DEFAULT_API = 'https://pbldcmniommltbdwuykk.supabase.co/functions/v1/statement-api';
const PUBLIC = '/v1/public/world-vibe';
const MAX_PAGES = 5;

async function getJson(fetchFn, url) {
  const r = await fetchFn(url);
  if (!r.ok) { const e = new Error('http_' + r.status); e.status = r.status; throw e; }
  return r.json();
}

// feed_v3 pages: { items, next_cursor }
export async function loadFeed(fetchFn, base) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getJson(fetchFn, base + PUBLIC + '/feed' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    items.push(...(Array.isArray(body.items) ? body.items : []));
    cursor = body.next_cursor || null;
    if (!cursor) break;
  }
  return items;
}

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

// { items } for a signed-in caller; 401 means signed out.
export async function loadFollowing(fetchFn, base) {
  try {
    const body = await getJson(fetchFn, base + '/v1/me/world-vibe/following-feed');
    return { items: Array.isArray(body.items) ? body.items : [], error: null };
  } catch (e) {
    return { items: [], error: e.status === 401 ? 'auth' : 'unavailable' };
  }
}

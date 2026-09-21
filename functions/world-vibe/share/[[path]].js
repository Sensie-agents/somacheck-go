const CURATED = new Set([
  'gut-vs-dashboard',
  'ai-at-work',
  'present-leadership'
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function pathParts(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split('/').filter(Boolean);
}

export async function onRequest(context) {
  const parts = pathParts(context.params.path);
  if (parts.length !== 1 || CURATED.has(parts[0]) || !SLUG.test(parts[0])) {
    return context.next();
  }

  const slug = parts[0];
  const assetURL = new URL('/world-vibe/share/', context.request.url);
  const asset = await context.env.ASSETS.fetch(assetURL);
  const headers = new Headers(asset.headers);
  headers.set(
    'Link',
    `</world-vibe/share/?item=${encodeURIComponent(slug)}>; rel="canonical"`
  );
  headers.set('Cache-Control', 'public, max-age=60');
  return new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers
  });
}

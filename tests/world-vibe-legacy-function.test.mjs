import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/world-vibe/share/[[path]].js';

function context(path) {
  let nextCalls = 0;
  let assetURL = null;
  return {
    value: {
      params: { path },
      request: new Request('https://go.somacheck.com/world-vibe/share/example-item'),
      env: {
        ASSETS: {
          fetch: async (url) => {
            assetURL = url.toString();
            return new Response('<html>item</html>', { headers: { 'content-type': 'text/html' } });
          }
        }
      },
      next: async () => {
        nextCalls += 1;
        return new Response('next');
      }
    },
    facts: () => ({ nextCalls, assetURL })
  };
}

test('serves arbitrary legacy slug from the shared item asset', async () => {
  const probe = context(['arbitrary-live-item']);
  const response = await onRequest(probe.value);
  assert.equal(response.status, 200);
  assert.equal(probe.facts().assetURL, 'https://go.somacheck.com/world-vibe/share/');
  assert.equal(probe.facts().nextCalls, 0);
  assert.equal(response.headers.get('link'), '</world-vibe/share/?item=arbitrary-live-item>; rel="canonical"');
});

test('preserves curated, base, nested, and invalid static routing', async () => {
  for (const path of [undefined, [], ['gut-vs-dashboard'], ['nested', 'path'], ['Bad_Slug']]) {
    const probe = context(path);
    const response = await onRequest(probe.value);
    assert.equal(await response.text(), 'next');
    assert.equal(probe.facts().nextCalls, 1);
    assert.equal(probe.facts().assetURL, null);
  }
});

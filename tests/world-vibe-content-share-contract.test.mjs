import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [script, redirects, aasa, legacyFunction] = await Promise.all([
  readFile(path.join(root, 'world-vibe', 'share', 'item.js'), 'utf8'),
  readFile(path.join(root, '_redirects'), 'utf8'),
  readFile(path.join(root, '.well-known', 'apple-app-site-association'), 'utf8'),
  readFile(path.join(root, 'functions', 'world-vibe', 'share', '[[path]].js'), 'utf8')
]);

assert.match(script, /\/world-vibe\/share\/\?item=<slug>/, 'the query form must be documented as canonical');
assert.match(script, /new URLSearchParams\(window\.location\.search\)\.get\('item'\)/, 'the share page must read the canonical item parameter');
assert.match(script, /\/v1\/public\/world-vibe\/items\//, 'an arbitrary item must use the direct public item lookup');
assert.doesNotMatch(script, /world-vibe\/feed\?limit=/, 'an arbitrary item must not scan public feed pages');
assert.doesNotMatch(redirects, /^\/world-vibe\/share\//m, 'legacy share routing must not rely on unsupported query substitution in _redirects');
assert.match(legacyFunction, /context\.env\.ASSETS\.fetch/, 'legacy arbitrary paths must serve the shared item asset through Pages Functions');
assert.match(legacyFunction, /CURATED\.has/, 'curated static pages must bypass the arbitrary-item function');
assert.match(legacyFunction, /rel="canonical"/, 'the legacy response must advertise the canonical query URL');
assert.match(script, /history\.replaceState[\s\S]*\/world-vibe\/share\/\?item=/, 'legacy item pages must replace the visible URL with the canonical query form');

const components = JSON.parse(aasa).applinks.details[0].components;
assert.equal(components.some((component) => component['/'] === '/world-vibe/share/*'), true, 'canonical and legacy share paths must stay associated with SomaCheck');

console.log(JSON.stringify({
  passed: true,
  canonical: 'https://go.somacheck.com/world-vibe/share/?item=arbitrary-live-item',
  legacyAlias: '/world-vibe/share/arbitrary-live-item',
  directLookup: '/v1/public/world-vibe/items/arbitrary-live-item'
}));

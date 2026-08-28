import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const expectedAppID = 'G4KXPE7MY4.com.sensie.somacheck';
const expectedPaths = [
  '/auth/callback*',
  '/s/*',
  '/world-vibe/share/*'
];

const documents = await Promise.all([
  readFile(path.join(root, '.well-known', 'apple-app-site-association'), 'utf8'),
  readFile(path.join(root, 'apple-app-site-association'), 'utf8')
]);

assert.equal(
  documents[0],
  documents[1],
  'root and .well-known AASA files must stay byte-for-byte identical'
);

const aasa = JSON.parse(documents[0]);
assert.equal(aasa.applinks.details.length, 1, 'production AASA must have one app-link detail');

const [detail] = aasa.applinks.details;
assert.deepEqual(detail.appIDs, [expectedAppID], 'only the production SomaCheck app ID may handle these links');
assert.deepEqual(
  detail.components.map((component) => component['/']),
  expectedPaths,
  'AASA must authorize only auth callbacks, shared statements, and World Vibe topic shares'
);
assert.deepEqual(aasa.webcredentials.apps, [expectedAppID], 'web credentials must retain the production SomaCheck app ID');

function componentMatches(pathname, pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(pathname);
}

function isAppLinked(pathname) {
  return expectedPaths.some((pattern) => componentMatches(pathname, pattern));
}

for (const pathname of [
  '/auth/callback',
  '/auth/callback?code=redacted',
  '/s/statement-token',
  '/world-vibe/share/gut-vs-dashboard',
  '/world-vibe/share/gut-vs-dashboard/'
]) {
  assert.equal(isAppLinked(pathname), true, `${pathname} must remain app-linked`);
}

for (const pathname of [
  '/',
  '/world-vibe/',
  '/world-vibe/share',
  '/privacy/',
  '/support/',
  '/terms/'
]) {
  assert.equal(isAppLinked(pathname), false, `${pathname} must remain web-only`);
}

console.log(JSON.stringify({
  passed: true,
  appID: expectedAppID,
  appLinkedPaths: expectedPaths,
  webOnlyPaths: ['/', '/world-vibe/', '/world-vibe/share', '/privacy/', '/support/', '/terms/']
}, null, 2));

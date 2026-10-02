// The contract fixtures are captured, never written by hand. Each file here is a
// byte copy of wv3-integration/supabase/functions/statement-api/fixtures/ (checked
// with cmp in the WP12 receipt); this pins the bytes so a hand edit fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fixturesDir } from './helpers/captured.mjs';

const SHA256 = {
  'wv3_explore_curators.json': '40be6944f1c2b26bcaf4ae2fafdd1a042bb23f5ce250a3803de0b93939392d09',
  'wv3_explore_featured.json': 'cb38f16db9aba8adbbf5426eca78ab87d4490f3fd9fe7b8c5f413ad39b9485d1',
  'wv3_explore_feed.json': '99805dfef048282b75fc13b72dc0da99d4bd335325e884a2a13477209a5843e9',
  'wv3_explore_following.json': 'aa52b41252627bab893affdd17a3bbc1116a2f6000c7256384d21490fdb9168e',
  'wv3_explore_item.json': '483c64e310e7762cd8b2e5e399efc2b8df413911ff2a6027ce74e93c086a0fb5',
  'wv3_explore_my_follows.json': '1fc99536bc89dc400871364362fabf28a0961a76283869be282accc8842523a1',
  'wv3_explore_v2_golden.json': 'f03776f66c3fce246cc80613176b6255bed145c3b8e03ee1ccf3324d42e83392'
};

test('every captured fixture is byte-identical to its recorded capture', () => {
  for (const [name, sha] of Object.entries(SHA256)) {
    assert.equal(createHash('sha256').update(readFileSync(path.join(fixturesDir, name))).digest('hex'), sha, name);
  }
});

test('no fixture exists that is not a recorded capture', () => {
  assert.deepEqual(readdirSync(fixturesDir).sort(), Object.keys(SHA256).sort());
});

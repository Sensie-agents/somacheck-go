// The contract fixtures are captured, never written by hand. Each file here is a
// byte copy (integration commit b68279fa) of wv3-integration/supabase/functions/statement-api/fixtures/ (checked
// with cmp in the WP12 receipt); this pins the bytes so a hand edit fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fixturesDir } from './helpers/captured.mjs';

const SHA256 = {
  'wv3_explore_curators.json': '40be6944f1c2b26bcaf4ae2fafdd1a042bb23f5ce250a3803de0b93939392d09',
  'wv3_explore_featured.json': 'a9d2bdd24039afbf11c74cd7239041d8ce089cbb72d6387ca544ced1a1c768ab',
  'wv3_explore_feed.json': 'ab2f9618dfca8029506970a56edbf4007264b4183185c42535b64f76ed975732',
  'wv3_explore_following.json': '4c9b644763857b4371fdb75fbc301adaef414592347002cf1f5b817d4daa3edd',
  'wv3_explore_item.json': '6c95cc6ec2c5d6ceac3bb6b0a44050f0810692ede3e6ceb3648befb78b77a6c2',
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

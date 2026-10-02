// The contract fixtures are captured, never written by hand. Each file here is a
// byte copy of the backend worktrees' statement-api/fixtures/ (integration
// b68279fa and 59515bad; wv3_consent.json from consent-api-sol2 91580176). The
// hashes pin the bytes, and the backend worktrees are compared directly when
// they exist, so a hand edit fails either way.
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
  'wv3_explore_v2_golden.json': 'f03776f66c3fce246cc80613176b6255bed145c3b8e03ee1ccf3324d42e83392',
  'wv3_pick_anon.json': '709d93f46b070b869b4da6e91dae50925cf4d5d3d90e1723b716223bcb99dbbe',
  'wv3_pick_signed_in.json': '8a36e427e0dc72ca8839e1f2ca57befedfd94c820b3ade6b0135cb5251bda28d',
  'wv3_progress_locked.json': '878ccf619779e3f9a78e82be67f1739eea8db399daf225f826a3356a61dae106',
  'wv3_progress_lean.json': '68d93d42a0cc5ed69d5fae4a05b2cd407ce996633b880ad2b8a5ce12e666af22',
  'wv3_progress_exact.json': 'a2ea991f6955395d769308b4925b601c851f2e7280406e96063519dff5f5b94e',
  'wv3_progress_revealed_by_you.json': '2a7b36ff2a44080cb313d6dda8178839e5f3717b46198ff2d8fa346de2ed49a1',
  'wv3_send_ok.json': '01c0656090c9aab4d9fc20ebebff86d0348e962fbba5717e5d5b2cf2fe4c5cad',
  'wv3_send_link_required.json': '3bd188bb1b6b0fba5cdb9b412eaa1cdff61916e8fdf93fa4ce56b2678f44ac20',
  'wv3_drafts_create.json': 'afc7d1311b3165a0a4e2731a7ba3af4b6628b0b956c6416e77ee51cd968201e2',
  'wv3_drafts_consent_required.json': 'b627001727c7f35e63988cc403093fea370314d1aee57b587d660aeeed7a9396',
  'wv3_create_v3.json': 'fc77093cf6840e73a8441216d93aa940b0d1bab2c4527230d6e44bc6ae94307c',
  'wv3_consent.json': '02edb74014a211553ef98267973762f8cf3ddd9736a3a0242aca42b24796094e'
};

test('every captured fixture is byte-identical to its recorded capture', () => {
  for (const [name, sha] of Object.entries(SHA256)) {
    assert.equal(createHash('sha256').update(readFileSync(path.join(fixturesDir, name))).digest('hex'), sha, name);
  }
});

// Where each capture lives in its backend worktree. When the sibling worktree is
// present the bytes are compared directly, not only against the pinned hash.
const BACKEND = (wt) => path.resolve(fixturesDir, '..', '..', '..', '..', wt, 'supabase', 'functions', 'statement-api', 'fixtures');
const SOURCE = (name) => (name === 'wv3_consent.json' ? 'wv3-consent-sol2' : 'wv3-integration');

test('each home and consent capture is byte-identical to its backend worktree when present', () => {
  for (const name of Object.keys(SHA256).filter((n) => /pick|progress|send|drafts|create_v3|consent/.test(n))) {
    let theirs;
    try { theirs = readFileSync(path.join(BACKEND(SOURCE(name)), name)); } catch { continue; }
    assert.ok(readFileSync(path.join(fixturesDir, name)).equals(theirs), name);
  }
});

// wv3_phone.json is still pending from the backend lane; tests/helpers/captured.mjs
// keeps the contract-shape fallback for it only. Any other extra file is hand-written.
const PENDING_CAPTURES = ['wv3_phone.json'];

test('no fixture exists that is not a recorded capture', () => {
  const extra = readdirSync(fixturesDir).filter((n) => !(n in SHA256));
  assert.deepEqual(extra.filter((n) => !PENDING_CAPTURES.includes(n)), []);
});

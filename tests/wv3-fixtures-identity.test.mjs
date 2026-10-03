// The contract fixtures are captured, never written by hand. Each file here is a
// byte copy of the backend worktrees' statement-api/fixtures/ (integration
// b68279fa, 59515bad and 4e35e548 for the private ask, empty pick and refusals; wv3_consent.json from
// consent-api-sol2 91580176). The
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
  'wv3_phone.json': '2f317fe9599ccb49744eead8f57b74ad49ce372c0d130b823d1988691ba0360d',
  'wv3_phone_unlinked.json': 'dbf204b1173dd3720018d767944ce3b89ff1fd348b0e622230ae09f7933ed85b',
  'wv3_consent.json': '02edb74014a211553ef98267973762f8cf3ddd9736a3a0242aca42b24796094e',
  'wv3_refusal_ask_401.json': '0a433356e7056376f1f5ec20b07381e9bd2f3dfed7c2d1dec43bb1f2f6acc08d',
  'wv3_refusal_ask_404.json': '4040a373151733c96de51697bc2c0b6e2fafb6cf58d60c84f82762ff4f784668',
  'wv3_refusal_ask_409.json': '1d02084c09ace071e04cd20f5c1c1ce4c6fadea7e4a9d4b0a09d325f0fee8b13',
  'wv3_refusal_ask_429.json': '899d9a9ca79d7314614dcd3f1125b61ae9c198be962613962bb7ad6d50b70a27',
  'wv3_refusal_consent_get_401.json': '05e22ba7910ccefa4dfa31684c0283ffcbb81b041fd9fdeeaa13841a3019baee',
  'wv3_refusal_consent_put_401.json': '05e22ba7910ccefa4dfa31684c0283ffcbb81b041fd9fdeeaa13841a3019baee',
  'wv3_refusal_drafts_401.json': '05e22ba7910ccefa4dfa31684c0283ffcbb81b041fd9fdeeaa13841a3019baee',
  'wv3_refusal_drafts_422_invalid_words.json': '7c4cb6f7780e8cbbfd62525a218ec79d68641938084d038366c5802d3b51ee27',
  'wv3_refusal_drafts_422_no_context.json': '853b171c1fb9569b297749db41c7407934347eb8536c3c63ec581c9ead380a65',
  'wv3_refusal_follow_delete_401.json': '5ac6fd86cc2ca763607cee7061f4b077df824c44045b8e4239e495832270c4ad',
  'wv3_refusal_follow_post_401.json': '5ac6fd86cc2ca763607cee7061f4b077df824c44045b8e4239e495832270c4ad',
  'wv3_refusal_following_feed_401.json': 'c7fa62a20471d0d626a26e69c9d2769e76ec14092342791a172feb9b35dcdc57',
  'wv3_refusal_follows_401.json': '5b3b1a7b5491717f3bfd211f46c616c72bcde64d81859680e9b40d347870fe85',
  'wv3_refusal_item_404.json': '278500f3542967062b4a309418d806031496a5bdac7f0b09bbf6ec08815b42f4',
  'wv3_refusal_progress_404.json': 'eec074df0a004330bc6ab270db03e312d34c582ff716bc7a9e0b5edb42cd48da',
  'wv3_refusal_feed_422_cursor.json': '5879c4118d7a4b8756121eea3a1ad2f143e871bc2625752dee632b4f71f4101f',
  'wv3_refusal_phone_401.json': '05e22ba7910ccefa4dfa31684c0283ffcbb81b041fd9fdeeaa13841a3019baee',
  'wv3_refusal_private_ask_401.json': '05e22ba7910ccefa4dfa31684c0283ffcbb81b041fd9fdeeaa13841a3019baee',
  'wv3_refusal_private_ask_404.json': '7f977ef0cc2248d37fd9f590e8eb13aa54706fc541012da69375c8db0f66063c',
  'wv3_refusal_private_ask_409.json': '2efa47018aaefb20842bad38c6e2648a213f3f60466c861b635ef5453f7e6d47',
  'wv3_pick_empty.json': 'e3ed4c1ee3e56ef1e547eca513ea401e17206e314072567ebef323110a1a3377',
  'wv3_private_ask.json': '39b2bc4b3831311ccac3f839783c329ffdaee5839a4e75abc348b8c56d992459'
};

test('every captured fixture is byte-identical to its recorded capture', () => {
  for (const [name, sha] of Object.entries(SHA256)) {
    assert.equal(createHash('sha256').update(readFileSync(path.join(fixturesDir, name))).digest('hex'), sha, name);
  }
});

// Where each capture lives in its backend worktree. When the sibling worktree is
// present the bytes are compared directly, not only against the pinned hash.
const BACKEND = (wt) => path.resolve(fixturesDir, '..', '..', '..', '..', wt, 'supabase', 'functions', 'statement-api', 'fixtures');
const SOURCE = (name) => (/^wv3_refusal_|^wv3_private_ask|^wv3_pick_empty/.test(name) ? 'wv3-integration' : name === 'wv3_consent.json' ? 'wv3-consent-sol2' : /phone/.test(name) ? 'wv3-backend-sol2' : 'wv3-integration');

test('each home, consent and refusal capture is byte-identical to its backend worktree when present', () => {
  for (const name of Object.keys(SHA256).filter((n) => /pick|progress|send|drafts|create_v3|consent|phone|private_ask|refusal/.test(n))) {
    let theirs;
    try { theirs = readFileSync(path.join(BACKEND(SOURCE(name)), name)); } catch { continue; }
    assert.ok(readFileSync(path.join(fixturesDir, name)).equals(theirs), name);
  }
});

// Any file here that is not a recorded capture is hand-written.
test('no fixture exists that is not a recorded capture', () => {
  const extra = readdirSync(fixturesDir).filter((n) => !(n in SHA256));
  assert.deepEqual(extra, []);
});

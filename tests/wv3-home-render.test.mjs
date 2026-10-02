import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSharedCard, renderMeter, renderReveal, renderRoom, renderPrivateCard, renderCheckSheet, renderBringSheet, renderSignInSheet, renderAccountBar, renderEmpty, reasonSentence } from '../world-vibe/home/home-render.js';
import { feedRow, publicSignalRow, row, pickOf, progressEnvelope } from './helpers/captured.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const homeDir = path.join(root, 'world-vibe', 'home');
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');

const gather2 = row({ contributor_count: 2, aligned: null, unaligned: null, lean: null });
const lean5 = row({ contributor_count: 5, aligned: null, unaligned: null, lean: 'mixed' });
const split12 = row({ contributor_count: 12, aligned: 9, unaligned: 3 });

test('contributors 2: dots and "2 of 3", no percent', () => {
  const html = renderMeter(gather2);
  assert.match(html, /class="dots"/);
  assert.match(html, /2 of 3 checked in/);
  assert.equal((html.match(/<i class="on">/g) || []).length, 2);
  assert.doesNotMatch(html, /%/);
});

test('lean with aligned=NULL: track, head count, no percentages', () => {
  assert.equal(lean5.aligned, null);
  const html = renderMeter(lean5);
  assert.match(html, /class="track"/);
  assert.match(text(html), /Mixed so far · 5 checked in/);
  assert.doesNotMatch(text(html), /%/);
  assert.doesNotMatch(text(html).replace('5 checked in', ''), /\d/);
  assert.doesNotMatch(html, /class="dots"/);
});

test('contributors 12 with counts: percent bar', () => {
  const html = renderMeter(split12);
  assert.match(html, /class="split"/);
  assert.match(html, /75% aligned/);
  assert.match(html, /25% unaligned/);
  assert.match(html, /12 checked in/);
});

test('the captured 10-contributor row shows its exact split (10 aligned, 0 unaligned)', () => {
  const html = renderMeter(feedRow);
  assert.match(html, /100% aligned/);
  assert.match(html, /10 checked in/);
});

test('exact-count rule: threshold 20 with 12 contributors shows no split and no lean', () => {
  const item = row({ contributor_count: 12, unlock_threshold: 20, aligned: 9, unaligned: 3, lean: 'aligned' });
  for (const html of [renderMeter(item), renderReveal({ ...item, statement: 'I am ready.' })]) {
    assert.doesNotMatch(text(html), /%/);
    assert.doesNotMatch(html, /class="split"/);
    assert.doesNotMatch(html, /Leans|Mixed so far/);
    assert.match(html, /12 of 20 checked in/);
  }
});

test('curator_name NULL renders no name', () => {
  const html = renderSharedCard(pickOf('trending_in_category', { curator_name: null, curator_id: null }));
  assert.doesNotMatch(html, /Brought by/);
  assert.doesNotMatch(html, /class="av"/);
  assert.doesNotMatch(html, /Alex/);
  assert.match(renderSharedCard(pickOf('trending_in_category')), /Brought by <b>Alex<\/b>/);
});

const EXPECTED = {
  shared_link: ['Someone shared this with you.', {}],
  topic_of_week: ['It&#39;s the topic of the week.', {}],
  closest_to_unlock: ['2 of 3 have checked in. Yours could reveal it.', { contributor_count: 2, aligned: null, unaligned: null, lean: null }],
  time_of_day: ['It fits this time of day.', {}],
  trending_in_category: ['Trending in Work &amp; AI today.', { category: 'work_ai' }],
  following: ['From a curator you follow.', {}],
  most_checked: ['Most checked this week.', {}]
};
for (const [reason, [sentence, over]] of Object.entries(EXPECTED)) {
  test('reason ' + reason + ' renders its sentence', () => {
    const pick = pickOf(reason, over);
    const html = renderSharedCard(pick);
    assert.ok(html.includes('Picked for you · ' + sentence), html);
    assert.ok(html.includes(pick.statement));
  });
}

test('the pick contract has no time_of_day field, so the sentence never names a part of the day', () => {
  const html = renderSharedCard(pickOf('time_of_day', { time_of_day: 'morning' }));
  assert.doesNotMatch(html, /morning|where you are/);
  assert.match(reasonSentence(pickOf('time_of_day')), /^It fits this time of day\.$/);
});

test('an unknown reason falls back to a plain sentence, never raw text', () => {
  assert.equal(reasonSentence(pickOf('<b>x</b>')), 'Picked by relevance.');
});

test('public-signal item shows the label and never a curator name', () => {
  const item = { ...publicSignalRow, curator_name: 'Should Never Show' };
  const html = renderSharedCard({ ...item, reason: 'most_checked' });
  assert.match(html, /Shown publicly by choice/);
  assert.ok(!html.includes('Should Never Show'));
  assert.doesNotMatch(html, /Brought by/);
  const reveal = renderReveal({ ...item, revealed_by_you: false });
  assert.match(reveal, /Shown publicly by choice/);
  assert.ok(!reveal.includes('Should Never Show'));
  assert.doesNotMatch(renderReveal({ ...item, public_signals: false }), /Shown publicly by choice/);
});

test('captured public-signal row: consented counts, label on card and reveal', () => {
  const card = renderSharedCard({ ...publicSignalRow, reason: 'most_checked' });
  assert.match(card, /Shown publicly by choice/);
  assert.match(card, /100%/);
  assert.doesNotMatch(card, /1 of 3/);
});

test('reveal: revealed_by_you shows YOU REVEALED IT, otherwise YOU\'RE IN', () => {
  const p = progressEnvelope({ revealed_by_you: true });
  assert.match(renderReveal(p), /YOU REVEALED IT/);
  assert.match(renderReveal({ ...p, revealed_by_you: false }), /YOU&#39;RE IN|YOU'RE IN/);
  assert.match(renderReveal(p), /Never who|never who/);
});

test('reveal shows the viewer\'s own reading only when the server sent one', () => {
  const own = renderReveal(progressEnvelope({ your_reading: 'unaligned' }));
  assert.match(own, /Your reading: <b>Unaligned<\/b>\. Only you see this\./);
  assert.match(renderReveal(progressEnvelope({ your_reading: 'aligned' })), /Your reading: <b>Aligned<\/b>/);
  const none = renderReveal(progressEnvelope({ your_reading: null }));
  assert.doesNotMatch(none, /Your reading:/);
  assert.match(none, /Your own reading is in your SomaCheck app/);
  assert.doesNotMatch(renderReveal(progressEnvelope({ your_reading: 'maybe' })), /Your reading:/);
});

test('room view (no receipt) makes no claim about the person', () => {
  const html = renderRoom(progressEnvelope({ revealed_by_you: true, your_reading: 'aligned' }));
  assert.match(html, /THE ROOM SO FAR/);
  assert.doesNotMatch(html, /YOU REVEALED IT|YOU&#39;RE IN|Your reading/);
  assert.match(html, /class="meter"/);
});

test('private card: written and done phases always say private, no public meter', () => {
  const written = renderPrivateCard({ phase: 'written', ctx: 'agent', line: 'I am <b>tired</b>.', signedIn: true, consent: true });
  assert.match(written, /Only you see this line/);
  assert.ok(!written.includes('<b>tired</b>'), 'line is escaped');
  assert.match(renderPrivateCard({ phase: 'done', line: 'x' }), /SAVED TO YOUR BASELINE/);
  assert.doesNotMatch(written, /class="meter"/);
});

test('private compose, signed out: sign-in prompt and no write button', () => {
  const html = renderPrivateCard({ phase: 'compose', ctx: 'agent', signedIn: false });
  assert.match(html, /data-open="signin"/);
  assert.doesNotMatch(html, /data-act="generate"|data-consent/);
});

test('private compose, signed in, consent off or unknown: switch is off and Write my line is disabled', () => {
  for (const consent of [false, null]) {
    const html = renderPrivateCard({ phase: 'compose', ctx: 'agent', signedIn: true, consent });
    assert.match(html, /<input type="checkbox" role="switch" id="consent" data-consent>/);
    assert.match(html, /<button class="btn-main" type="button" data-act="generate" disabled>/);
  }
});

test('private compose, consent on: switch is checked and Write my line is enabled; words has its field', () => {
  const html = renderPrivateCard({ phase: 'compose', ctx: 'agent', signedIn: true, consent: true });
  assert.match(html, /data-consent checked>/);
  assert.match(html, /<button class="btn-main" type="button" data-act="generate">/);
  assert.match(renderPrivateCard({ phase: 'compose', ctx: 'words', signedIn: true, consent: true }), /id="mind"/);
});

test('private compose errors render as an alert with their own copy', () => {
  const html = renderPrivateCard({ phase: 'compose', ctx: 'agent', signedIn: true, consent: false, error: 'consent_required' });
  assert.match(html, /role="alert"[^>]*>Turn on the setting below/);
  assert.match(renderPrivateCard({ phase: 'compose', ctx: 'agent', signedIn: true, consent: true, error: 'no_context' }), /hasn&#39;t shared anything|hasn't shared anything/);
});

const SHARE = 'https://go.somacheck.com/world-vibe/share/?item=wv3-r2-named';
const shared = { statement: feedRow.statement, slug: feedRow.slug, shareUrl: SHARE, signedIn: false, linkRequired: false, sent: false, error: null };

test('check sheet signed out: QR with the share URL, no Send to my phone, sign-in offer', () => {
  const html = renderCheckSheet(shared);
  assert.doesNotMatch(html, /data-act="send"/);
  assert.ok(html.includes('data-qr="' + SHARE + '"'));
  assert.match(html, /data-open="signin"/);
});

test('check sheet signed in with a link: Send to my phone plus the QR', () => {
  const html = renderCheckSheet({ ...shared, signedIn: true });
  assert.match(html, /data-act="send"/);
  assert.ok(html.includes('data-qr="' + SHARE + '"'));
  assert.doesNotMatch(html, /data-open="signin"/);
});

test('check sheet after link_required: the button is gone and the QR explains itself', () => {
  const html = renderCheckSheet({ ...shared, signedIn: true, linkRequired: true });
  assert.doesNotMatch(html, /data-act="send"/);
  assert.match(html, /connect an agent in SomaCheck/);
  assert.ok(html.includes('data-qr="' + SHARE + '"'));
});

test('check sheet after a send says Sent and drops the button', () => {
  const html = renderCheckSheet({ ...shared, signedIn: true, sent: true });
  assert.match(text(html), /Sent\. Open SomaCheck on your phone\./);
  assert.doesNotMatch(html, /data-act="send"/);
});

test('check sheet for a private line has no QR, no URL, no progress button', () => {
  const html = renderCheckSheet({ statement: 'I am carrying Friday into this week.', slug: null, shareUrl: null, signedIn: true, linkRequired: false, sent: false, error: null });
  assert.doesNotMatch(html, /data-qr|go\.somacheck\.com|data-act="checked"|id="qr"/);
  assert.match(html, /data-act="send"/);
});

test('check sheet escapes the statement and the share URL', () => {
  const html = renderCheckSheet({ ...shared, statement: 'I <img src=x>', shareUrl: 'https://x.test/?a="b"' });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('"b"'));
});

test('Bring your own line on the web is the Chrome callout only: no paste field, no send', () => {
  const html = renderBringSheet();
  assert.match(html, /class="chrome"/);
  assert.match(html, /Add to Chrome/);
  assert.doesNotMatch(html, /<input|<textarea|data-act=|or paste/);
});

test('account bar: Sign in only when configured, email and Sign out when signed in', () => {
  assert.equal(renderAccountBar({ configured: false, email: null }), '');
  assert.match(renderAccountBar({ configured: true, email: null }), /data-open="signin"/);
  const out = renderAccountBar({ configured: true, email: 'a@b.test' });
  assert.match(out, /a@b\.test/);
  assert.match(out, /data-act="signout"/);
  assert.doesNotMatch(out, /data-open="signin"/);
});

test('sign-in sheet has a labelled email field and a status region', () => {
  const html = renderSignInSheet('sent');
  assert.match(html, /<label for="si-email">Email<\/label>/);
  assert.match(html, /role="status"[^>]*>Check your email/);
});

test('empty state: nothing left offers Start over, a failed load offers Try again', () => {
  assert.match(renderEmpty(false), /Start over/);
  assert.match(renderEmpty(true), /Try again/);
});

test('statement text is escaped in shared cards', () => {
  const html = renderSharedCard(pickOf('following', { statement: 'I <script>x</script>' }));
  assert.ok(!html.includes('<script>'));
});

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('no "Prototype only" text under world-vibe/home', () => {
  for (const f of walk(homeDir)) assert.ok(!readFileSync(f, 'utf8').includes('Prototype only'), f);
});

test('no em dashes in any WP12 surface', () => {
  const files = [...walk(homeDir), ...walk(path.join(root, 'world-vibe', 'explore')), path.join(root, 'world-vibe', 'index.html'), path.join(root, 'world-vibe', 'session.js'), path.join(root, 'world-vibe', 'config.js'), path.join(root, 'auth', 'callback', 'index.html')];
  for (const f of files) assert.ok(!readFileSync(f, 'utf8').includes('—'), f);
});

test('no hand-written fixtures under world-vibe/home', () => {
  assert.throws(() => statSync(path.join(homeDir, 'fixtures')), /ENOENT/);
});

test('home.js reads no fixture and no local JSON: every card comes from a live route', () => {
  const src = readFileSync(path.join(homeDir, 'home.js'), 'utf8');
  assert.doesNotMatch(src, /fixtures|\.json'/);
});

test('every captured fixture statement starts with "I " or "My "', () => {
  for (const r of [feedRow, publicSignalRow]) assert.match(r.statement, /^(I|My)\b/);
});

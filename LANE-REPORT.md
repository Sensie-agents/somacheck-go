# World Vibe feed, Lane E (portal) — report

Branch `wvfeed/lane-e`. Local only, nothing pushed, nothing deployed.

## Built

`world-vibe/index.html` and a new `world-vibe/feed.js`. Everything else in
`world-vibe/` (share pages, topics.json, config.js, assets) is untouched.

- **Feed tab (default) and Topics tab.** The existing curated-topics markup,
  polling and behavior are unchanged, just moved inside a `#topics-panel` that
  the new tab bar shows/hides. `#feed-panel` is the new default view.
- **Live feed.** `feed.js` fetches `GET {statementApiBase}/v1/public/world-vibe/feed?limit=30`
  on load and every 30 seconds (paused when the tab is hidden). Each poll
  reconciles the DOM against the same first page: cards still present are
  updated in place, genuinely new items are prepended (newest first, since
  the API is `last_activity_at DESC`), and cards that dropped out of that
  page (moderated, or pushed off by newer activity) are removed. Nothing is
  ever wiped and rebuilt, so a reader scrolled down keeps their place —
  verified directly (see below), not assumed.
- **Card contents:** the quote, the statement, "X of Y checked in" while
  `aligned`/`unaligned` are null, and the aligned/unaligned split the moment
  the API returns non-null values (the API is the source of truth for the
  unlock threshold, per `world_vibe_feed.ts`'s own comment that it strips
  the split below threshold; the client never re-derives "unlocked" from the
  count itself). Source renders as the `domain` field linking to
  `source_url` with `target="_blank" rel="noopener noreferrer"`. No creator,
  no individual reading, anywhere in the markup.
- **Check in on your phone:** an `<a>` to `/world-vibe/share/<slug>`, the
  same relative pattern the curated topic cards already use for their share
  link.
- **Report control:** a per-card toggle revealing a reason `<select>`
  (`illegal_content`, `adult_content`, `harassment`, `hate`, `self_harm`,
  `spam`, `other`, matching `moderation.ts`'s `ReportReason` enum exactly)
  and a submit button that `POST`s
  `/v1/public/world-vibe/items/{slug}/report` with
  `{ reason, client_nonce, client_session }`. `client_nonce` persists in
  `localStorage` (survives across sessions, so a repeat report from the same
  browser dedupes server-side per `moderation_report.ts`); `client_session`
  is a `sessionStorage` value. On a `200` response the card shows "This item
  was sent for review" and the Report button disables; the card itself
  disappears on the next poll once the server actually drops it from the
  feed (confirmed live, see below).
- **Empty state:** "Nothing in the feed yet..." when `items: []`.
- **Failure state:** "The feed could not be loaded. Please try again
  later." shown only on the *first* load failure (a polling failure after
  that keeps the last good state rather than flashing an error over live
  content).
- Mobile-first: card styling reuses the existing `.topic` class, tokens
  (`--card`, `--border`, `--emerald`, etc.), and the existing 720px
  breakpoint. No new dependencies, no build step, no analytics. Copy
  reviewed for em dashes and for health/stress/emotion/diagnosis/truth
  wording — none added (kept "Aligned"/"Unaligned", which was already the
  portal's existing vocabulary).

## How to verify (exact commands)

No live API is deployed yet, so verification used a local static+mock server
plus the `browse` headless-Chromium skill (both local to this machine, not
part of the diff — nothing under `world-vibe/` depends on either).

1. Mock server (serves the repo root as static files and stubs the two feed
   endpoints; the script lived in this session's scratchpad, not the repo,
   and was not committed):
   ```
   python3 wv_mock_server.py 8765
   ```
   Once the real API is live, the same checks below apply unchanged by
   pointing `window.SOMACHECK_API_BASE` at it instead (or deploying, since
   the default already targets the real Supabase function URL).
2. Load the page:
   ```
   browse goto http://127.0.0.1:8765/world-vibe/index.html
   browse text        # feed cards render: quote, statement, progress, source, actions
   browse network      # confirms GET .../v1/public/world-vibe/feed?limit=30 → 200
   ```
3. Tab switch:
   ```
   browse snapshot -i -c
   browse click <Topics tab ref>
   browse is visible "#topics-panel"   # true
   browse is visible "#feed-panel"     # false
   ```
4. Source link target:
   ```
   browse attrs <source link ref>
   # { "href": "https://...", "target": "_blank", "rel": "noopener noreferrer" }
   ```
5. Check-in link:
   ```
   browse attrs <"Check in on your phone" link ref>
   # href: "/world-vibe/share/<slug>"
   ```
6. Report flow (confirmed via mock server access log showing the POST, and
   via DOM state after):
   ```
   browse select "#feed-item-<slug> .report-reason" "spam"
   browse click "#feed-item-<slug> .report-submit"
   browse js "document.querySelector('#feed-item-<slug> [data-role=status]').textContent"
   # "This item was sent for review."
   ```
7. Poll merge without losing scroll position (edited the mock server's
   in-memory item list mid-session to simulate a live change, then waited
   for the real 30s `setInterval` to fire — not a manual re-render call):
   ```
   browse js "window.scrollTo(0, 400)"
   # ... wait 32s for the real poll ...
   browse js "window.scrollY"                                    # 400, unchanged
   browse js "Array.from(document.querySelectorAll('#feed-list .feed-card')).map(e => e.id)"
   # new item prepended at top, held/removed item gone, existing item's
   # progress updated in place to the newly unlocked split
   ```
8. Empty state: pointed the mock server at `[]` items, reloaded, confirmed
   `#feed-list` shows "Nothing in the feed yet...".
9. Failure state: pointed `window.SOMACHECK_API_BASE` at a closed port,
   reloaded, confirmed `#feed-list` shows "The feed could not be loaded.
   Please try again later."
10. A CSS bug was caught and fixed during this pass: `.report-panel`'s own
    `display: grid` was overriding the browser's default `[hidden]`
    styling, so the report form rendered open by default. Fixed by adding
    `.report-panel[hidden] { display: none; }`. Verified before/after with a
    screenshot.

The mock server and screenshots used for verification were left in
`/tmp` and the session scratchpad, not committed.

## Not done

- **"Check in on your phone" will 404 for content items today.** The share
  link points at `/world-vibe/share/<slug>`, exactly like the curated topic
  cards, but there is no static folder (or dynamic route) for arbitrary
  content-item slugs, and this repo has no `_redirects`/Pages Functions to
  generate one. This is the same gap `CONTRACT.md` in the integration
  worktree already flags to Fable ("a second person can only check in if
  the share link resolves for a content item... That path is the existing
  curated-topic join flow, and content items are not yet wired into it").
  My link construction is correct and ready; it depends on that cross-lane
  fix landing (either a generic `/world-vibe/share/*` route lane A/Fable
  build, or per-item static pages).
- **No "load older" pagination.** Every load and poll fetches only the
  first page (`limit=30`, no cursor). If more than 30 items are ever live
  at once, older items simply scroll off with no way to page back to them.
  Chose this over implementing cursor pagination because combining "poll
  refreshes page 1" with "load-more appends page 2+" creates a real bug: a
  poll's removal-reconciliation (dropping cards no longer in page 1) would
  incorrectly delete page-2 items that were never supposed to be affected by
  a page-1 refresh. Simplest correct thing for v1. Flagging as a explicit
  scope cut rather than an oversight.
- Did not touch the Topics tab's own polling, join flow, or smart-route
  logic. It is bit-for-bit the same code that shipped before, just moved
  under a tab panel.
- No visual pass beyond the local mock server screenshots (light mode only;
  did not screenshot the dark-mode media query, though it reuses the same
  CSS variables the existing topics UI already uses in dark mode).

## Questions for Fable

1. Confirm the plan for content-item share pages (`/world-vibe/share/<slug>`)
   — this is required before acceptance criterion 2 (a second person checking
   in from the feed) can pass, and it is out of lane E's file scope
   (`world-vibe/` static folders vs. whatever routing lane A/integration
   adds).
2. The feed API response (`world_vibe_feed.ts`) does not include a
   `share_url` field, only `slug`. I derived the share path client-side
   (`/world-vibe/share/<slug>`) to match the pattern in lane A's
   `CONTRACT.md`. Confirm that's the intended contract for the feed route
   too, not just item creation.
3. Pagination: confirm a 30-item first-page-only feed (no "load older") is
   acceptable for this build, or whether Fable wants cursor-based
   "load more" added in a follow-up once the moderation-drop interaction
   with pagination is designed.

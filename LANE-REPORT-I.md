# World Vibe feed, Lane I (ranking, portal) -- report

Branch `wvfeed/lane-i`, from `wvfeed/lane-h`. Local only, nothing pushed, nothing deployed.

## Built

`world-vibe/feed.js` and `world-vibe/index.html`. Nothing else under
`world-vibe/` touched (topics tab, share pages, config.js, assets untouched).

- **Order control.** A small "Ranked" / "Newest" segmented control above the
  feed list, ranked active by default, plus a one-line note under it that
  swaps with the selection: "Ordered by completed check-ins." (ranked) or
  "Ordered by newest activity." (recent), so nobody reads the order as votes.
- **`loadFeed` now requests `?order=<ranked|recent>&limit=30`**, always the
  currently selected order.
- **Switching order is a deliberate navigation**, not a poll: `setOrder`
  resets `itemsBySlug` and `loaded`, then fetches page one fresh and rebuilds
  the list, same as the very first load. This mirrors the API contract from
  lane I's backend: a cursor from one order can never be replayed against the
  other, so switching orders always restarts pagination at page one rather
  than trying to reuse a cursor.
- **Poll reconciliation now handles position changes, not only additions and
  removals.** `mergeItems` still updates cards in place and drops cards that
  fell out of the page, but it no longer stops there: a new `reorderList`
  pass moves every existing card element (via `appendChild`, which relocates
  a node instead of recreating it) into the exact sequence the API returned.
  A card whose completed-check-in count rises moves up the same poll it
  updates its progress text, with no full re-render and no new elements, so
  bound listeners and any open report panel survive and scroll position is
  not disturbed. This applies under both orders: a "recent" card also moves
  to the top once its own last_activity_at bumps, which the pre-lane-I code
  did not do (a pre-existing gap this reconciliation pass also closes).
- Card contents unchanged: quote, statement, "X of Y checked in" until the
  API returns a non-null split, source link, Check in on your phone, Report.
  No creator, no individual reading, anywhere in the markup.
- No new dependencies, no analytics, no em dashes, no health/stress/emotion/
  diagnosis/truth wording added.

## How to verify (exact commands)

No live API is deployed yet, so verification used a local mock server (not
part of the diff, not committed) plus the `browse` headless-Chromium skill,
the same combination lanes E and H used.

1. Mock server (serves this repo root as static files, stubs
   `GET /v1/public/world-vibe/feed`, and overrides `SOMACHECK_API_BASE` via a
   patched `config.js` response so the page talks to itself):
   ```
   python3 wv_mock_server.py 8765 /Volumes/SensieSSD/agent_tmp/wvfeed-i
   ```
   The mock returns a fixed 3-item snapshot on the very first feed request,
   then a second snapshot on every request after that where
   `gut-vs-dashboard` rises from 1 to 3 completed check-ins (unlocking it)
   and its `last_activity_at` bumps to now -- a live analogue of a pending
   ask finally producing a verdict. `order=ranked` and `order=recent` are
   both served, sorted server-side exactly like the real RPC.
2. Load the page and confirm the initial ranked order and copy:
   ```
   browse goto http://127.0.0.1:8765/world-vibe/index.html
   browse network   # GET .../feed?order=ranked&limit=30 -> 200
   browse text
   ```
   Result: cards render `ai-at-work (2 of 3)`, `gut-vs-dashboard (1 of 3)`,
   `present-leadership (0 of 3)`, in that order (ranked, ties would break on
   last_activity_at/slug). "Ranked" is the active button; the note reads
   "Ordered by completed check-ins."
3. **The poll cycle, run for real** (`FEED_POLL_MS` is 30000, not mocked
   down, so this is the actual interval, not a simulated one):
   ```
   browse viewport 400x700
   browse js "window.scrollTo(0, 150)"
   # wait one real poll interval (~31s)
   browse network            # confirms a second GET .../feed?order=ranked fired
   browse js "({scrollY: window.scrollY})"
   browse js "Array.from(document.querySelectorAll('#feed-list .feed-card')).map(e => e.id)"
   ```
   Result: `scrollY` is still `150` (unchanged -- no page jump). The card
   order is now `gut-vs-dashboard, ai-at-work, present-leadership`:
   `gut-vs-dashboard` moved from position 2 to position 1 because its
   completed-check-in count rose past `ai-at-work`'s, and its progress text
   flipped to the unlocked split ("Aligned 67%, Unaligned 33%, 3 checked
   in"). No other card moved unnecessarily.
4. Order switch:
   ```
   browse click ".order-btn[data-order='recent']"
   browse js "({note: document.getElementById('feed-order-note').textContent, order: [...document.querySelectorAll('#feed-list .feed-card')].map(e => e.id)})"
   browse network   # confirms GET .../feed?order=recent&limit=30 fired
   ```
   Result: note switches to "Ordered by newest activity.", order becomes
   `gut-vs-dashboard, present-leadership, ai-at-work` (by `last_activity_at`
   descending), matching the mock's `recent_sort`. Clicking back to "Ranked"
   restores the ranked order and note and refetches with `order=ranked`.
5. `git diff --check` -- passed (no trailing-whitespace / newline issues).

Not run: the repo's pre-existing `tests/*.mjs` Playwright suite
(`node --test tests/*.mjs`). It fails the same way (3 pass / 5 fail, missing
Playwright browser binary in this environment) on `wvfeed/lane-h` before any
of this lane's changes, so it is a pre-existing environment gap, not a
regression, and none of those tests touch `world-vibe/feed.js` or
`index.html`'s feed panel.

## Not done

- Nothing deployed. Portal deploy stays gated on Mike per 00-SCOPE.md.
- The mock server script lived in this session's scratchpad and was not
  committed, matching lane E's report.
- Pagination beyond the first page (`next_cursor`) is still unused by the
  portal, same as before this lane -- the portal has never wired a "load
  more" control, in either order.

## Questions for Fable

- None. The backend contract (`wvfeed/integration`, commit `wv(i): rank the
  World Vibe feed by completed check-ins`) and this portal change were built
  together against the same `?order=` / cursor-tag contract; nothing here is
  blocked on a decision.

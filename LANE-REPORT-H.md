# World Vibe feed, Lane H (share resolution) — report

Branch `wvfeed/lane-h`, off `wvfeed/lane-e` (7a77c5b). Local only, nothing pushed, nothing deployed.

## Built

Three new files, nothing existing touched:

- **`_redirects`** — one Cloudflare Pages rewrite: `/world-vibe/share/* /world-vibe/share/_item/index.html 200`.
  Cloudflare Pages serves a matching static asset before it ever evaluates
  `_redirects`, so the three curated topic folders
  (`world-vibe/share/{ai-at-work,gut-vs-dashboard,present-leadership}/index.html`)
  keep resolving to themselves unchanged. Any other slug falls through to the
  new page. The 200 status is a rewrite, not a redirect, so the visitor's URL
  bar and the slug this page reads both stay the original
  `/world-vibe/share/<slug>`.
- **`world-vibe/share/_item/index.html`** — the generic share page shell.
  Named with a leading underscore so it can never collide with a real
  content-item slug (the slug grammar `^[a-z0-9]+(?:-[a-z0-9]+)*$`, enforced
  both client and server side across this codebase, has no underscores).
  Reuses `world-vibe/share/topic.css` for the card/button/status styling the
  curated pages already use, plus a small local `<style>` block for the
  source line and the aligned/unaligned split rows.
- **`world-vibe/share/item.js`** — the logic:
  - Reads the slug from `window.location.pathname` (last path segment).
  - There is no per-slug read endpoint for content items (only topics have
    one), so it resolves the slug by walking
    `GET {API_BASE}/v1/public/world-vibe/feed?limit=50&cursor=...`, checking
    each page for a matching `slug`, and following `next_cursor` until found
    or exhausted (capped at 20 pages / 1000 items as a safety bound against
    an unbounded fetch loop — see "Not done" below). The feed RPC only ever
    returns live items, so an item that is held, hidden, or nonexistent is
    never found, and the page shows a not-available state without ever
    calling join.
  - Renders quote, statement, "X of Y checked in" (or the aligned/unaligned
    split once the API returns non-null values, same convention as
    `feed.js`), and the source as `domain` linking to `source_url` with
    `target="_blank" rel="noopener noreferrer"`.
  - On an explicit tap of "Check in on your phone" (a `<button>`, not an
    `<a>`, since there is nothing to navigate to until the join call
    returns): generates a `client_nonce` once per page load (reused on a
    retry, so a repeated tap replays the same statement instead of minting a
    new one, matching `CONTRACT.md`'s and lane G's replay-safety contract), a
    `session_nonce` persisted in `sessionStorage`, `POST`s
    `/v1/public/world-vibe/items/{slug}/join`, and on success navigates the
    current tab to the response's `link_url` (a `/s/<token>` statement link).
    No statement is ever issued on page load, scroll, or poll, only on that
    click.
  - Not-installed path: unchanged. `link_url` points at the existing
    `/s/<token>` page (`s/index.html`, untouched), which already has its own
    deep-link / QR / TestFlight fallback. Nothing new was built for that
    case.
  - Errors from the join call: 404 -> "no longer available"; 429 -> "the
    world is busy today, come back tomorrow" (same copy as the existing
    topic join flow in `world-vibe/index.html`); anything else -> generic
    retry message. Button re-enables on every failure path.
  - No QR code on this page (the curated pages' QR encodes their pre-known
    Branch smart route; a content item has no such link until after the
    join call returns, so there is nothing to encode before the tap).
  - No em dashes, no health/stress/emotion/diagnosis/truth-detection
    wording, no new dependencies, no build step, no analytics.

## How to verify (exact commands)

No live API is deployed, so verification used a local static+mock server
(script lived in this session's scratchpad, not the repo, not part of the
diff) plus the `browse` headless-Chromium skill, the same combination lane E
used.

1. Mock server: serves the repo root as static files, applies the same
   `/world-vibe/share/*` fallback-to-`_item` rule `_redirects` declares
   (only when no real static asset matches, exactly like Cloudflare Pages),
   injects `window.SOMACHECK_API_BASE` pointed at itself into every served
   HTML page (test-only, so the page's own scripts hit the mock instead of
   the real Supabase function URL), and stubs:
   - `GET /v1/public/world-vibe/feed` — two pages (`cursor=page2` for page
     2), so pagination is actually exercised. Page 1 has one item
     (`page1-item`, not the target), page 2 has `test-item-1` (locked, "2 of
     3") and `unlocked-item` (unlocked, 2/1 split). `not-live-slug` and
     `not-found` exist nowhere in the feed, simulating a non-live or
     nonexistent item.
   - `POST /v1/public/world-vibe/items/{slug}/join` — validates nonce
     lengths, 404s for a slug not in the feed's known set, returns
     `{..., link_url: "http://127.0.0.1:<port>/s/stub-token-<slug>", replayed}`,
     with `replayed: true` on a second call with the same `client_nonce`.
   - `GET /v1/public/world-vibe/topics` — minimal stub so the curated pages
     can be smoke-checked end to end too, not just confirmed to still load
     as static files.
   ```
   python3 wv_mock_server_h.py 8765
   ```
2. Arbitrary slug resolves across pagination:
   ```
   browse goto http://127.0.0.1:8765/world-vibe/share/test-item-1
   browse network
   # GET .../feed?limit=50 -> 200 (page 1, no match)
   # GET .../feed?limit=50&cursor=page2 -> 200 (match found)
   browse text
   # "This is the quote captured from the page." / statement / "2 of 3" /
   # "Source: www.foxnews.com" / "Check in on your phone"
   browse attrs "#source-link"
   # { href: "https://www.foxnews.com/politics/a-story", target: "_blank",
   #   rel: "noopener noreferrer" }
   ```
3. No statement before the tap:
   ```
   browse network --clear
   browse goto http://127.0.0.1:8765/world-vibe/share/test-item-1
   browse network | grep -c join   # 0
   ```
4. Tap issues exactly one join call and redirects to the returned `link_url`:
   ```
   browse click "#start-check-in"
   browse network | grep join
   # POST .../items/test-item-1/join -> 201  (exactly one line)
   browse url
   # http://127.0.0.1:8765/s/stub-token-test-item-1  (equals the response's link_url)
   ```
5. Replay safety (same nonce returns the same statement):
   ```
   curl -s -X POST http://127.0.0.1:8765/v1/public/world-vibe/items/test-item-1/join \
     -H "Content-Type: application/json" \
     -d '{"client_nonce":"abcdefghijklmnop","session_nonce":"qrstuvwxyz012345"}'
   # replayed: false, link_url: .../s/stub-token-test-item-1
   # same call again -> replayed: true, same link_url
   ```
6. Non-live / nonexistent item is refused, no statement issued:
   ```
   browse goto http://127.0.0.1:8765/world-vibe/share/not-live-slug
   browse text
   # "This item is not available." / "This item could not be found..."
   browse is hidden "#start-check-in"   # true
   ```
7. Unlocked item renders the split:
   ```
   browse goto http://127.0.0.1:8765/world-vibe/share/unlocked-item
   browse text
   # "What participants noticed / Aligned 67% / Unaligned 33% / 3 checked in"
   ```
8. The three curated topic pages still work, unchanged:
   ```
   browse goto http://127.0.0.1:8765/world-vibe/share/ai-at-work
   browse text
   # "Work" / "I feel hopeful about AI at work" / "2 of 5 check-ins" (from the
   # topics stub) / "Scan to open this topic..." / "Share this World Vibe"
   browse goto http://127.0.0.1:8765/world-vibe/share/gut-vs-dashboard
   browse attrs "[data-world-vibe-topic]"
   # { "data-world-vibe-topic": "gut-vs-dashboard", "data-statement": "I trust my gut more than my dashboard" }
   browse goto http://127.0.0.1:8765/world-vibe/share/present-leadership
   browse attrs "[data-world-vibe-topic]"
   # { "data-world-vibe-topic": "present-leadership", ... }
   ```
9. A CSS bug was caught and fixed during this pass, the same class of bug
   lane E hit: `topic.css`'s `.button` rule sets `display: inline-flex`
   unconditionally, which beats the browser's default `[hidden] { display:
   none }` at equal selector specificity (author stylesheet always wins over
   the user-agent stylesheet regardless of source order). The "Check in on
   your phone" button was rendering visible with `display: flex` even while
   marked `hidden` on the not-available path. Fixed with a local
   `.button[hidden] { display: none; }` override in the new page's own
   `<style>` block (not touching `topic.css`, so the curated pages are
   unaffected). Verified before (`css #start-check-in display` -> `flex`
   while `hidden` was set) and after (`display: none`).

## Not done / flagged for Fable

- **Slug resolution walks the whole public feed.** There is no per-slug read
  endpoint for content items (topics have
  `/v1/public/world-vibe/topics/{slug}/progress`; items have nothing
  equivalent), so this page's only option is paging through
  `GET /v1/public/world-vibe/feed` looking for a `slug` match, capped at 20
  pages (1000 items) as a safety bound. This works today and is what the
  brief specifies as the fallback ("read it from the feed endpoint by slug"),
  but it means opening a share link for an item that has scrolled off the
  live feed's first ~1000 entries would incorrectly show "not available"
  even though the item is still live. If World Vibe grows past that scale, a
  dedicated `GET /v1/public/world-vibe/items/{slug}` (mirroring the topics
  progress route) would remove the cap and the multi-page fetch entirely.
- **No QR code on the new page.** The curated pages' QR encodes a
  pre-computed Branch smart-route URL known before any join call. A content
  item's `link_url` only exists after the join call returns, so there is
  nothing stable to encode before the tap. Not treated as a gap since the
  brief's spec for this page (quote, statement, source, progress, tap-to-join)
  never mentions a QR.
- **No social-preview (Open Graph) content per item.** This is a static
  single page serving every slug; without a build step or Pages Functions
  (out of scope per the brief), `og:title`/`og:description` are generic
  ("World Vibe - SomaCheck"), not slug-specific. `document.title` is set
  client-side per item once it loads, but that never reaches server-rendered
  crawlers/link previews.
- Did not touch `feed.js`, `index.html`, `topic.js`, `topic.css`, or any of
  the three curated share folders. The only shared file referenced (not
  modified) is `world-vibe/config.js`, for the install URL fallback that the
  reused `/s/<token>` page already depends on.

## Files

- `/Volumes/SensieSSD/agent_tmp/wvfeed-h/_redirects` (new)
- `/Volumes/SensieSSD/agent_tmp/wvfeed-h/world-vibe/share/_item/index.html` (new)
- `/Volumes/SensieSSD/agent_tmp/wvfeed-h/world-vibe/share/item.js` (new)

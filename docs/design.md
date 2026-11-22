# Chess Watch design

## Architecture

```
Bip 6 / Active 3 ──BLE──> Zepp app (side service) ──HTTP──> Cloudflare Worker
                            (page/index.js renders only)     ──stub──> ChessGame
                                                              Durable Object
                                                              (single source
                                                              of truth)
```

- **Worker + Durable Object** (`worker/`): the Worker entry
  (`src/index.js`) checks the config, authenticates the Bearer token,
  and routes to the one `ChessGame` DO (`src/game-do.js`), which enforces
  every rule, stores the game in DO SQLite, and wakes both watches via
  long-poll. Rules live in `src/rules.js` (chess.js 1.4.0 + a persisted
  repetition map — see "Worker internals").
- **Watch page**: renders `legal_moves` from the server, sends tap-to-move.
  No chess engine on the watch — two engines could disagree on repetition,
  50-move counters, castling rights, and en passant. The watch only parses
  FEN to know which piece sits where.
- **Side service** (`app-side/index.js`): the only place that does `fetch`
  on the watch. The page talks to it through `BasePage.request()`.
- **Web harness** (`web/`): Vite + React + zepp-web-runner runs the same
  `page/index.js` in the browser. A local `BasePage` shim calls the same
  HTTP adapter directly (no BLE). Requests use `/api` on the Vite origin;
  Vite proxies them to `CHESS_SERVER_URL` — the local Worker dev server
  by default (`make web` sets it to `http://localhost:8787`).

## State machine (page)

`no role → picker → polling → board`. Overlays: `menu`, `confirm-resign`,
`confirm-restart`, `promotion`, `offer` (incoming), `result`. Every state
change triggers a full re-render (koala pattern: delete all widgets,
recreate). Board flips for Black. Tap a piece → dots from `legal_moves` →
tap a target → promotion picker if needed → send with a fresh idempotent
`client_move_id` → disable input, show a dim pulse → authoritative board.

Poll loop: `GET_STATE { since: revision, wait: 20 }`; on error the red dot
shows and retry backs off 3 s → 10 s; `onHide` stops, `onShow` refreshes.
The connecting screen shows the latest poll error code plus a "Test link"
button. The result lives in a Diagnostics overlay (also reachable from
Menu → Test link at any time, including while the offline board is showing),
so a poll failure swapping in the offline board can no longer wipe it: it
reports the installed build (commit + version from `gen-app-config`), the
player names and host baked into that build, the side-service fetch shape,
a live `/health` ping with its HTTP status, the last server-call outcome,
and the latest poll error. While a test runs, new polls are deferred so
the answer is not stuck behind a 20 s long-poll. Error codes are mapped in
`shared/protocol.js`: ZML BLE codes 1 (shake timeout — the side service
never answered, ~5 s of "Connecting…"), 2 (BLE disconnect), 4 (request
timeout) mean the page never reached the side service, while `unauthorized`
means the player tokens in `.env` differ from the Worker secrets, and
`http_403` / `http_200`-with-HTML mean an edge/proxy error page, not a
game error. A stale install is identifiable on that screen: names
Aurora/Sam or a `Build` commit older than HEAD means rebuild + reinstall,
not a server problem.
First poll sends `since: -1` so it returns immediately (a fresh game has
revision 0). A revision conflict triggers an immediate refresh, never a
retry. Failed sends retry with the same client id (idempotent server-side).

Request timeouts (0.2.1): `BasePage.request` has no timeout — the only
timer in the ZML messaging plugin is the 5 s BLE shake timer — so a lost
BLE response used to hang the await forever. A hung MOVE left
`_pendingMove` set (no further taps accepted) and a hung poll left
`_pollInFlight` set (no further polls), while polls and actions kept
working: "connected but can't play" with no toast. The controller now
races every request against a timer — polls 40 s (`wait: 20` + the 15 s
side-service fetch timeout + margin), MOVE/ACTION/DIAG 25 s — rejecting
with `{ code: "timeout" }`, which the existing paths already handle
(poll: backoff retry; send: `_sendWithRetry` retries, then a toast).
`doMove` also resets `_pendingMove` in a `finally`. The Diagnostics
overlay shows the live game state (`Turn:`, `Ply:`, `Status:`, `Legal:`,
`Rev:`) for real states only, so a turn/role problem can be told apart
from a move-submit problem; the panel uses a tighter 22 px line step so
all 14 lines still fit the 450 px Bip 6 display.

Board taps (0.2.2): Zepp widgets do NOT bubble — the topmost widget at
the tap point gets the event and nothing falls through to the widget
below. The board was built as 64 FILL_RECT cells with `click_func`, with
the piece IMG created after (on top of) each cell: the IMG covers ~90%
of its cell (38/42 px on Bip 6, 37/41 px on Active 3), so tapping a piece
hit the handler-less image and `onSquare()` never ran — \"can't select a
piece\" on-device, while the same code worked in the web harness, whose
DOM cell `onClick` fires through the `<img>`. The legal-move dots (14 px,
centred on target squares) and the selection frame swallowed taps the
same way. Rule, now in `page/board.js`: every widget covering a square
carries the tap itself via `addEventListener(CLICK_DOWN)` — pieces,
dots and frame alike (0.2.2 originally used `click_func` for the dots
and frame, which turned out to be silently ignored on FILL_RECT — see
"`click_func` is BUTTON-only (0.2.4)" below). `page/board.test.mjs`
asserts it: the topmost widget at every square centre has a tap path,
and the pre-0.2.2 code fails 5 of its 6 tests. The pending-move dim
overlay deliberately has no handler (taps are ignored while a send is in
flight anyway).

Selection survives poll timeouts (0.2.3): `onState` used to clear the
selection (`_selected = null`) on EVERY state delivery. A long-poll
returns the same state when its 20 s wait times out with no change, so a
player who took >~10 s between tapping a piece and tapping its target
lost the selection mid-thought — the target tap then only deselected,
and the move never happened, with no toast and no error anywhere. Now
`onState` clears the selection (and a send in flight) only when the
position actually changed — `shared/protocol.js` `positionChanged()`
compares ply, FEN, game_no and status, so a poll-timeout refresh, a
presence-only refresh, or an offer arriving leaves the selection alone,
while a move, a restart, or a game-over clears it. The same guard also
stops a poll timeout from clearing `_pendingMove` mid-send.

`click_func` is BUTTON-only (0.2.4): the 0.2.2 fix gave the board's
FILL_RECT cells, dots and frame `click_func` — and the dots still did
nothing on-device. `click_func` works on BUTTON (Menu, Test link, all
overlay buttons), but on FILL_RECT it is silently ignored on the real
watch; FILL_RECT (and IMG) taps must use `addEventListener(CLICK_DOWN)`,
the pattern dragon-army uses for both. The 0.2.2 unit tests missed it
because their stub treated `click_func` as a live tap path for every
widget, and the web harness missed it because its shim maps `click_func`
to a click — so the bug was invisible everywhere except on the watch.
The stubs in `page/board.test.mjs` and `page/overlays.test.mjs` now model
the device (only BUTTON `click_func` and any `addEventListener`
register a tap path): against the 0.2.3 code they fail 5 tests. The same
defect also hid in the overlay backdrop (tapping outside a panel never
closed it) — it uses `addEventListener` now too.

## Layout

Physical pixels from `getDeviceInfo()`, no `designWidth` (the runner
ignores it, so browser and watch would disagree). Bip 6: board 336 px at
(27, 46), cell 42, piece 38. Active 3: board 328 px at (69, 69), cell 41,
piece 37. Status bar and 160×40 Menu button per `page/layout.js`.

## Worker internals

- One game row (`games.id = 1`), `moves` and `actions` tables with `UNIQUE`
  client ids for idempotency, `meta` for schema version — same table and
  column names as the 0.1.x backend, plus `games.positions_json`
  (the persisted repetition map, see below). DO SQLite via
  `ctx.storage.sql.exec()` — note there is no `.query()` in workerd's
  `SqlStorage`; `exec()` serves SELECTs too. The migration must declare
  `new_sqlite_classes`, not `new_classes`, or `ctx.storage.sql` throws
  ("SQL is not enabled for this Durable Object class").
- The live `Chess` instance is cached on the DO object between requests;
  on cold start it loads from the stored FEN (cheap) and the counts map
  is read from storage — never a full replay per request. Measured:
  a 200-ply replay + legal moves costs ~22–38 ms (measured in workerd and Node respectively), over the Workers Free
  10 ms CPU/invocation cap; a FEN load is ~1 ms. Replay is used only for
  takeback (truncated history) and restart.
- Repetition comes from the persisted map (trimmed FEN — first 4 fields —
  → count): chess.js 1.4.0 has no `isFivefoldRepetition` /
  `isSeventyFiveMoveRule`, and after `load(fen)` its history is empty so
  even `isThreefoldRepetition()` returns false. Threefold (>= 3) and
  fivefold (>= 5) derive from the map; 50-move (>= 100) and 75-move
  (>= 150) from the FEN half-move clock. The map is updated on every move
  and recomputed on takeback/restart.
- Offer expiry is lazy on read (expired offer → cleared, `revision++`,
  waiters woken) AND via `setAlarm()` on offer creation, so an expired
  offer clears even with no traffic. Long-poll waiters are a per-DO list
  of resolvers + `setTimeout` (never `blockConcurrencyWhile`: 30 s
  timeout + it blocks the DO). A pending long-poll keeps the DO
  non-hibernatable, so it bills duration while a watch page is open:
  24 h of polling ≈ 10,800 GB-s of the 13,000 GB-s/day free tier.
- Presence: last-seen per role on state calls (in-memory); online within 45 s.
- Config: tokens are Worker secrets (`CHESS_TOKEN_P1` / `CHESS_TOKEN_P2`,
  `.dev.vars` for local dev). Missing, equal, < 24-char, or `CHANGEME`
  tokens fail every `/api/v1/*` request with 500 `config_error` — there
  is no deploy-time startup to refuse in, so the failure surfaces on
  first request instead. Player names are Worker vars: the deploy script
  passes `CHESS_P1_NAME` / `CHESS_P2_NAME` from the root `.env` as
  `--var` flags on every deploy, overriding the Aurora/Sam defaults in
  `wrangler.toml` `[vars]` (without `--var` a deploy silently reverts
  the board names to the defaults — the first 0.2.0 deploy did exactly
  that, while the Diagnostics names, which come from the watch bundle
  config, were correct).

## Pieces

Pieces are generated per shape (38 px square, 37 px round) because zeus
only packages `assets/<target>.<shape>/` — a top-level `images/` dir never
reaches the watch. `scripts/gen-pieces.mjs` therefore also emits
`assets/default.{s,r}/pieces/{s,r}/` (board.js addresses
`pieces/<shape>/<color><type>.png`, which resolves against each target's
asset root on-device and against `web/public/images/` in the browser). White: `#FFFFFF` fill, `#101418`
outline. Black: `#14181C` fill, `#FFFFFF` outline. Icons are a 192×192
checker + knight mark (`scripts/gen-icons.mjs`).

## Deviations from plan

1. **Active 3 board y 58 → 69.** The plan's board (328 px at x=69, y=58)
   is not centred: its centre is (233, 222), so the corners sit at radius
   ≈ 239.8 px, outside the 233 px display radius — the plan's own
   "corner radius ≈ 232 px" only holds for a centred board. Centring the
   board vertically (y=69) puts the corners at ≈ 231.9 px. Board size,
   cell, and piece sizes are unchanged; the Menu button at y=398 still
   clears the board (ends 397). `page/layout.test.mjs` asserts the radius.
2. **Active 3 status bar (123, 16, 220×30) → (133, 24, 200×28), compact
   labels.** At y=16 the round display's visible chord is only ~170 px
   wide, so the plan's 220 px bar and "Opponent's turn ● Aurora" at 20 px
   wrapped and clipped. The bar moved down/narrowed to fit the chord and
   the round layout uses 18 px with "Opp. turn" instead of "Opponent's
   turn".
3. **Extra error codes.** The plan's error list has no code for "takeback
   with no moves" or "offerer answering their own offer"; the server uses
   `takeback_unavailable` and `not_recipient` (409), documented in
   `docs/protocol.md`.
4. **Web harness: local `WatchPage` copy.** The runner's `WatchPage`
   imports `_reset`/`_collect` from `zepp-web-runner/shims/hmUI`, while
   the page imports `@zos/ui` (plugin-resolved to the same file). Vite
   serves those as two URLs (one with `?v=`, one without) — two module
   instances, so created widgets never reached the collector and the board
   rendered empty. `web/src/components/WatchPage.jsx` is a copy of the
   runner's component that imports `_reset`/`_collect` from `@zos/ui`,
   guaranteeing one instance. `optimizeDeps.exclude` also keeps the shims
   out of the pre-bundle.
5. **Web preset switch black screen.** Switching Bip 6 ↔ Active 3 in
   `make web` rendered a black frame, while loading `?device=active-3`
   directly worked. Root cause was not the round layout: the preset
   switcher remounts `WatchPage` (keyed wrapper), and React runs the old
   component's cleanup after the new one renders but before its effects —
   the old cleanup nulled the module-level `_triggerRender`, so the new
   mount's `build()` render (and every later poll render) was collected
   but never delivered to React state. `WatchPage.jsx` now re-asserts
   `_triggerRender` inside its effect (post-cleanup) and the cleanup only
   clears it if it is still its own setter.
6. **Build stamp.** `scripts/gen-app-config.mjs` writes
   `build: { at, commit }` (git HEAD, or null outside a checkout) into the
   generated config, so DIAG can prove which commit the installed bundle
   came from. `dist/*.zab` is gitignored: a build artifact embeds the real
   bearer tokens and must never be committed (one was, in
   `c6346a3`, and was removed again here; it stays in that commit's history).
7. **Side-service link verified against the official sample, not just
   the docs.** The 0.1.1 build on a real Active 3 reported `Diag: side
   unreachable`, Err 1 (ZML BLE shake timeout), `Poll err: none` — the
   last line was a lie: `page/index.js` `onState()` cleared `_netError`
   unconditionally, and the offline fallback is delivered through that
   same callback, so the poll failure was wiped the moment the fake
   board rendered. 0.1.2 only clears it for a real (`!_offline`) state.
   The Err 1 itself was traced to the phone side, not the code:
   `application/4.0/fetch-api` from `zepp-health/zeppos-samples` was
   cloned and built with this repo's `zeus-cli` — same
   `BaseSideService`/`BasePage` wiring, same `app.json` module mapping,
   same bundled output shape (`AppSideService(BaseSideService(...))`,
   `hmrpcv1` protocol), and the ZML transport in 0.0.38 (the sample's
   pin) vs 0.0.43 (ours) is identical apart from minifier renames and
   null-safe mixin calls. The preview `.zab` was unpacked and does
   contain `app-side.zip` with the fixed code. So a shake timeout means
   the side service is not running inside the Zepp app on the phone:
   the only proof available is the Zepp app's own log screen
   (Developer Mode: Profile → Settings → About → tap the Zepp icon
   7× → Mini Program icon → Side Service tab). 0.1.2 therefore logs
   `[chess-watch] side service init …` (host + version, no tokens) from
   `app-side` `onInit`/`onRun` and each request method, the way the
   sample logs `onRequest` — if that line never appears, the service
   never started; if it appears and Err 1 persists, the Zepp-app
   bridge is not answering. `app.json` `targets` uses the key `default`
   where the sample uses `common`; the built `.zab` flattens the module
   mapping, so the key does not reach the device and was left as-is.
8. **Worker + Durable Object backend (0.2.0).** The 0.1.x laptop-server
    setup was replaced by `worker/` (Worker entry + `ChessGame` DO +
    chess.js); the API is unchanged, so no watch-side protocol change was
    needed. Details live in "Worker internals" above and `worker/README.md`
    (FEN-load, never replay; persisted repetition map; `setAlarm()` offer
    expiry; resolver-list long-poll). Test tooling: `@cloudflare/vitest-plugin`
    needs vitest 4 while the repo root pins vitest 2, so `worker/` is a
    separate package with its own vitest 4 install and `worker/.npmrc` sets
    `legacy-peer-deps=true`; the integration run uses
    `test-config/wrangler.test.toml` with fake tokens (see the comment at
    the top of that file for why it lives in a subdirectory), and the pool
    shares DO storage per file, so `tests/integration.test.mjs` is ordered
    to build on a single game. One carried-over quirk: `recent_moves[].ply`
    is numbered within the last-6 window (1..6), exactly as the 0.1.x
    backend computed it — clients only display `san`.

## Verification items (plan §10) — status

1. **`app-side` module key** — `app.json` uses
   `"module": {"app-side": {"path": "app-side/index"}}` per plan; Zeus
   build still to be attempted (see below).
2. **Zepp `fetch` response shape** — `shared/httpClient.js` uses the
   side-service call shape `fetch({ url, method, headers, body, timeout })`
   on-device (detected via `sideService`/`messaging` globals) and the
   standard `fetch(url, {...})` shape in browsers/Node; `parseBody` handles
   `res.body` as string or object plus the browser `.json()` path, and a
   missing `res.status` is inferred from whether the body parsed. The
   2026-11-21 14:03 preview build's bundled `app-side.js` was inspected
   and does contain the object-fetch shape, DIAG, and the Worker URL —
   so a watch still showing the offline board with the default Aurora/Sam
   names is running an older install or never reaches the side service
   (see the Diagnostics decision table in the README); on-device fetch
   behaviour is still unconfirmed until that screen is read.
3. **`IMG` sizing** — avoided by generating 38/37 px assets per shape.
4. **`FILL_RECT` radius/alpha** — verified in the runner source:
   `WidgetRenderer.jsx` passes `radius` to `borderRadius` and decodes the
   top color byte as alpha (`toCssColor`). Used for dots/highlights.
5. **`getDeviceInfo()` in the runner** — **not provided**: the runner has
   no `getDeviceInfo` shim. `web/src/shims/device.js` provides it from
   the selected preset; `layout.js` accepts `screenShape` as `"round"` /
   `"square"` or `1` / `0`, plus a width==height fallback.
6. **Icon dimensions** — 192×192 PNGs at `assets/default.s|default.r/
   icon.png`, plus a root `icon.png` copy (koala pattern) since `app.json`
   names `icon.png`. Console acceptance unverified.
7. **Vibrator API** — `utils/haptics.js` wraps `new Vibrator()` in
   try/catch with a no-op fallback; availability unverified on-device.
8. **`appId`** — registered `1137599` in `app.json`.

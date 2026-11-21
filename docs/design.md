# Chess Watch design

## Architecture

```
Bip 6 / Active 3 ──BLE──> Zepp app (side service) ──HTTP──> FastAPI server
                            (page/index.js renders only)     (single source
                                                              of truth)
```

- **Server** (Python/FastAPI + python-chess + SQLite): enforces every rule,
  stores the game, wakes both watches via long-poll. One uvicorn worker.
- **Watch page**: renders `legal_moves` from the server, sends tap-to-move.
  No chess engine on the watch — two engines could disagree on repetition,
  50-move counters, castling rights, and en passant. The watch only parses
  FEN to know which piece sits where.
- **Side service** (`app-side/index.js`): the only place that does `fetch`
  on the watch. The page talks to it through `BasePage.request()`.
- **Web harness** (`web/`): Vite + React + zepp-web-runner runs the same
  `page/index.js` in the browser. A local `BasePage` shim calls the same
  HTTP adapter directly (no BLE). Requests use `/api` on the Vite origin;
  Vite proxies them to `CHESS_SERVER_URL` and adds the Cloudflare Access
  service-token headers, avoiding CORS/preflight on the tunnel hostname.

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
means the player tokens in `.env` differ from `server/.env`, and
`http_403` / `http_200`-with-HTML mean the Cloudflare Access service token
was rejected. A stale install is identifiable on that screen: names
Aurora/Sam or a `Build` commit older than HEAD means rebuild + reinstall,
not a server problem.
First poll sends `since: -1` so it returns immediately (a fresh game has
revision 0). A revision conflict triggers an immediate refresh, never a
retry. Failed sends retry with the same client id (idempotent server-side).

## Layout

Physical pixels from `getDeviceInfo()`, no `designWidth` (the runner
ignores it, so browser and watch would disagree). Bip 6: board 336 px at
(27, 46), cell 42, piece 38. Active 3: board 328 px at (69, 69), cell 41,
piece 37. Status bar and 160×40 Menu button per `page/layout.js`.

## Server internals

- One game row (`games.id = 1`), `moves` and `actions` tables with `UNIQUE`
  client ids for idempotency, `meta` for schema version. WAL mode.
- The board is rebuilt per request by replaying moves through python-chess
  (a few hundred plies at most) and cached implicitly by the stored FEN.
- Offer expiry is lazy on read (expired offer → cleared, `revision++`,
  waiters woken). The long-poll wait slices its sleep at the offer's
  expiry time so a backgrounded expiry still wakes clients promptly.
- Presence: last-seen per role on state calls; online within 45 s.

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
4. **`uv` not required.** `uv` is not installed in this environment, so
   the server venv is created with `python3 -m venv` + `pip install -r
   requirements.txt`; `pyproject.toml` keeps the same deps for `uv sync`
   users. `server/Makefile` uses the venv's uvicorn.
5. **Web harness: local `WatchPage` copy.** The runner's `WatchPage`
   imports `_reset`/`_collect` from `zepp-web-runner/shims/hmUI`, while
   the page imports `@zos/ui` (plugin-resolved to the same file). Vite
   serves those as two URLs (one with `?v=`, one without) — two module
   instances, so created widgets never reached the collector and the board
   rendered empty. `web/src/components/WatchPage.jsx` is a copy of the
   runner's component that imports `_reset`/`_collect` from `@zos/ui`,
   guaranteeing one instance. `optimizeDeps.exclude` also keeps the shims
   out of the pre-bundle.
6. **Config file location.** `server/.env.example` lives next to the
   server (the root `.env.example` covers the watch build); either file is
   read, `CHESS_ENV_FILE` overrides.
7. **Web preset switch black screen.** Switching Bip 6 ↔ Active 3 in
   `make web` rendered a black frame, while loading `?device=active-3`
   directly worked. Root cause was not the round layout: the preset
   switcher remounts `WatchPage` (keyed wrapper), and React runs the old
   component's cleanup after the new one renders but before its effects —
   the old cleanup nulled the module-level `_triggerRender`, so the new
   mount's `build()` render (and every later poll render) was collected
   but never delivered to React state. `WatchPage.jsx` now re-asserts
   `_triggerRender` inside its effect (post-cleanup) and the cleanup only
   clears it if it is still its own setter.
8. **Build stamp.** `scripts/gen-app-config.mjs` writes
   `build: { at, commit }` (git HEAD, or null outside a checkout) into the
   generated config, so DIAG can prove which commit the installed bundle
   came from. `dist/*.zab` is gitignored: a build artifact embeds the real
   bearer + Access tokens and must never be committed (one was, in
   `c6346a3`, and was removed again here; it stays in that commit's history).
7. **Tokens in `app.json`.** `appId` is `0` with a TODO comment — it must
   be registered in console.zepp.com; no real appId is invented.

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
   and does contain the object-fetch shape, DIAG, and the tunnel hostname —
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
8. **`appId`** — placeholder `0`; must be registered before preview.

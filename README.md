# Chess Watch

Two-player chess between an Amazfit Bip 6 and an Amazfit Active 3 Premium,
relayed by a Cloudflare Worker + Durable Object. The Worker is the single
source of truth; the watches are thin tap-to-move clients.

- Tap a piece, then tap a target square. No drag.
- Full rules on the Worker: castling, en passant, promotion, check,
  checkmate, stalemate, insufficient material, threefold / 50-move claims,
  fivefold / 75-move auto-draws, resignation, draw agreement.
- "Start over" and "move back" need opponent confirmation; resign is
  immediate. Result screens for every ending.
- Browser development through `zepp-web-runner` (`make web`).

## Quick start

1. Register the app in console.zepp.com and put the numeric `appId` in
   `app.json` (it ships as `0`, a placeholder).
2. Generate two tokens:
   `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` (twice).
3. Fill in `.env` — watch build: `CHESS_SERVER_URL`
   (`https://chess.gulfrenderstudio.com`), both tokens, names.
4. `cd worker && cp .dev.vars.example .dev.vars` and put the SAME tokens
   there for local dev; for production set them as Worker secrets:
   `wrangler secret put CHESS_TOKEN_P1` / `CHESS_TOKEN_P2`
   (`make worker-secrets` prints the commands).
5. `make worker-deploy` — deploy the Worker (or `make worker-dev` for
   local testing on `http://localhost:8787`).
6. `make config` — generate `shared/config.generated.js` from `.env`.
7. `make web` — test in the browser (`?player=p1` / `?player=p2` tabs).
   It points the harness at the local Worker dev server by default
   (`CHESS_SERVER_URL=http://localhost:8787`); run `make worker-dev` in
   another terminal first. To use the deployed Worker instead:
   `CHESS_SERVER_URL=https://chess.gulfrenderstudio.com make web`.
8. `make preview` — scan the QR with the Zepp app on each watch, enable
   developer mode.

`make setup` does the installs and copies the `.env.example` files the
first time. On Arch/Omarchy, where `libvips` is installed system-wide,
setup sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1` so `sharp` uses its bundled
prebuilt binary instead of trying (and failing) to compile against the
system library. `make test` runs the root JS vitest suite and the worker
unit tests (`make worker-test` adds the workerd integration suite).
`make pieces` / `make icons` regenerate the PNG assets.

## Repo layout

```
app.json / app.js          Zepp app entry (2 platforms: Bip 6 + Active 3)
page/                      watch page: lifecycle, board, overlays, status
app-side/                  side service — the only place that does fetch
shared/                    protocol, FEN parser, HTTP client, version
utils/                     role storage, haptics
images/pieces/{s,r}/       generated piece PNGs (38 px / 37 px)
assets/default.{s,r}/      app icons (192x192)
web/                       Vite + React + zepp-web-runner harness
worker/                    Cloudflare Worker + Durable Object backend
scripts/                   config / piece / icon generators
docs/                      protocol.md, design.md, manual-test.md
```

## How the backend works

`worker/src/index.js` (Worker entry) checks the config, authenticates the
Bearer token, and routes to the `ChessGame` Durable Object
(`worker/src/game-do.js`), which holds the game in memory (live chess.js
board loaded from the stored FEN) and persists it in DO SQLite. Rules live
in `worker/src/rules.js` — including the persisted repetition map, because
chess.js 1.4.0 has no fivefold/75-move APIs and its threefold check is
false after a FEN load. Full detail, including the free-tier duration
caveat (a pending long-poll keeps the DO non-hibernatable), is in
`worker/README.md` and `docs/design.md`.

## Migration from the tunnel setup

Version 0.2.0 replaced the old backend (FastAPI laptop server +
Cloudflare Tunnel + Cloudflare Access). If you still have the old setup
running:

1. Deploy the Worker (`make worker-deploy`) and verify it on the
   workers.dev URL, then on `https://chess.gulfrenderstudio.com`
   (`curl .../api/v1/health` → `{"status":"ok","version":"0.2.0"}`).
2. Delete the tunnel's DNS CNAME for `chess.gulfrenderstudio.com` (the
   Worker route replaces it), the Zero Trust Access application + Service
   Auth policy, and the Access service token.
3. On the laptop: stop/disable `cloudflared-chess-watch`
   (`sudo systemctl stop --now cloudflared-chess-watch`), delete the
   tunnel and `/etc/cloudflared/chess-watch.yml`, remove any `ufw` rules
   for tcp/8787, and delete the old `server/` tree, `server/.venv`, and
   `data/`.
4. Rebuild both watches (`make config && make build`) — the bundle no
   longer carries Access headers.
5. The old game does NOT migrate: the first game on the Worker starts
   fresh (revision 0). Finish or abandon any in-progress laptop game
   first. The old `server/` code is gone from this repo; the protocol is
   unchanged, so only the backend moved.

## Still offline on the watch? Read the Diagnostics screen

On the watch: Menu → **Test link** (or the Test link button on the
"Connecting…" screen). It runs a live probe through the side service and
shows where the link breaks — no tokens are displayed. Report the lines
verbatim; the table below is what they mean.

| What the screen shows | Meaning | Fix |
|---|---|---|
| `Build:` older than `git rev-parse HEAD`, or `Names: Aurora / Sam` when `.env` says otherwise | The watch is running a stale install | `make preview` again from the current checkout and reinstall; check the Build line changes |
| `Host: localhost…` / `127.0.0.1` | Stale build baked with a dev URL | Same as above — the watch cannot reach localhost |
| `Poll err: 1` / `Diag: side unreachable` | The page never reached the side service (ZML BLE shake timed out after 5 s). The app-side code matches the official `fetch-api` sample exactly (same `BaseSideService` wiring, same bundler output, ZML 0.0.38 vs 0.0.43 transport identical) and the `.zab` contains the side service — so this is the phone side, not the code: the side service is not running in the Zepp app | Keep the Zepp app open in the foreground, Bluetooth on, watch paired; reinstall via a fresh `make preview`. Then prove it on the phone: Zepp app → Profile → Settings → About → tap the Zepp icon 7× (Developer Mode) → Mini Program icon → log screen → **Side Service** tab. If it is empty, the side service never started — the `[chess-watch] side service init …` line (0.1.2+) must appear there after opening the app on the watch. If it appears and the watch still reports Err 1, the Zepp-app bridge itself is not answering (try force-stopping and reopening the Zepp app, then re-running Test link) |
| `Ping: ok` + `Last: state unauthorized` | Player tokens differ between `.env` and the Worker secrets | Copy the same tokens into both (`wrangler secret put …` for the Worker) and rebuild |
| `Ping: FAIL` + `Last: state timeout` / `network` | Phone has no route to the Worker, or the Worker is down | `curl https://chess.gulfrenderstudio.com/api/v1/health` from a laptop; check `wrangler tail` (`make worker-logs`) |
| `Ping: ok` + `Last: state ok` but the board stays offline | The poll itself is failing after a good ping (BLE flakiness, stale revision) | Wait through a retry cycle; if it persists, the `Last` line after the next poll is the new evidence |

The Worker can be fine while the watch is offline — the CLI health check
only proves the Worker side. The Diagnostics screen is the only evidence
about the watch → phone → Worker path.

## Security note

Player bearer tokens are embedded in the bundle and extractable. Do not
distribute the build; rotate by editing `.env` and the Worker secrets and
rebuilding both watches. The Worker only answers with a valid player
token (and returns 500 `config_error` if the secrets are missing or are
still the placeholders).

## Verification status (2026-11-21)

Verified: worker unit tests 66/66 (rules, DO API/actions, Worker entry —
a port of the old 37-test pytest suite, plus cold-start and alarm cases),
worker integration tests 4/4 through real workerd + SQLite (health,
state, full flow with long-poll wake + offer + resign, duplicate id),
JS vitest 27/27, `vite build` pass, `zeus build` pass (0.2.0, all 4
targets — see below), headless-Chromium screenshots of both presets
(correct start position, flipped Black board, selection dots, last-move
highlight), a browser tap e2→e4 reaching the local Worker (ply 1,
turn b), preset switching Bip 6 ↔ Active 3 in `make web` (board
re-renders both ways — previously black after switching, see
`docs/design.md` §7), and Menu → Test link opening the Diagnostics
overlay on both presets, including with the Worker down (offline board +
`Ping: FAIL` + the true poll error).

Not yet verified on-device: the 0.2.0 build has not been installed on
either watch yet (see `docs/manual-test.md`). The first thing to check
after installing it is Menu → Test link and the decision table above —
and, for a shake timeout (Err 1), the Zepp app's Side Service log screen,
which is the only place that can show whether the side service started on
the phone. Also unconfirmed: Vibrator availability, console icon
acceptance.

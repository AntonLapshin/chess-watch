# Chess Watch Worker

Cloudflare Worker + Durable Object backend for Chess Watch. Replaces the
old FastAPI laptop server + Cloudflare Tunnel (deleted in the same change;
see the root README's migration note). The API is identical to the old
server — see `docs/protocol.md` — so the watch app, side service, and web
harness needed no protocol changes.

## Layout

```
worker/
  wrangler.toml          Worker + route + DO binding (production)
  wrangler.test.toml     test-only config (fake tokens, no route)
  .dev.vars.example      copy to .dev.vars for local dev (gitignored)
  src/index.js           Worker entry: config check, Bearer auth, routing
  src/game-do.js         ChessGame Durable Object: game state, long-poll
  src/rules.js           chess.js wrapper + persisted repetition map
  src/store.js           SQLite persistence (ctx.storage.sql)
  tests/                 vitest: unit (fake storage) + integration (workerd)
```

## How it works

One Durable Object instance (`ChessGame`, id `"game"`) owns the single
game. It keeps a live `Chess` instance cached in memory plus the revision,
offer, presence, and long-poll waiters; SQLite (`ctx.storage.sql`) holds
the durable copy: one `games` row, `moves` / `actions` tables with UNIQUE
client ids for idempotency, `meta` for the schema version (same table and
column names as the old `server/db.py`, plus `games.positions_json`).

Two chess.js 1.4.0 gaps shape the design (both verified by measurement):

- **No replay per request.** The board is loaded from the stored FEN on
  cold start and kept live afterwards. Replaying 200 plies + legal moves
  costs ~22–38 ms (measured in workerd and Node respectively), over the Workers Free 10 ms CPU/invocation cap; a FEN
  load is ~1 ms. Replay is used only for takeback (truncated history).
- **Repetition needs a persisted map.** chess.js 1.4.0 has no
  `isFivefoldRepetition` / `isSeventyFiveMoveRule`, and after `load(fen)`
  its history is empty so even `isThreefoldRepetition()` is false. The DO
  persists a position-count map (trimmed FEN — first 4 fields — → count)
  alongside the FEN, updates it on every move, and recomputes it on
  takeback/restart. Threefold (>= 3) and fivefold (>= 5) come from the
  map; 50-move (>= 100) and 75-move (>= 150) from the FEN half-move clock.

Long-poll: `GET /api/v1/state?since=&wait=` registers a waiter
(`{since, resolve, timer}`, `wait` clamped 0–25 s) on the DO; any commit
resolves all waiters whose `since < revision`. `blockConcurrencyWhile`
is deliberately NOT used for the wait (30 s timeout, blocks the DO).
Offers expire two ways: lazily on read (as before) and via `setAlarm()`
on offer creation, so an expired offer clears even with no traffic.

## Free-tier limits

- Requests: 100,000/day — a 20 s long-poll is ~4,320 requests/day per
  connected watch, fine for two watches.
- **Duration: 13,000 GB-s/day is the binding constraint.** A pending
  long-poll keeps the DO non-hibernatable, so it bills duration while a
  watch page is open. 24 h of polling ≈ 10,800 GB-s — most of the daily
  budget, but watches only poll while the page is open, and two watches
  playing a few hours a day are far under it. If duration ever becomes a
  problem, shorten the client `wait` or poll only while the board is
  visible; do not "fix" it by moving the wait into `blockConcurrencyWhile`.
- CPU: 10 ms/invocation on Free — this is why the per-request path never
  replays moves (see above). A single move + legal-moves computation is
  ~1–3 ms.
- DO SQLite: 10 GB total; this game is kilobytes.

## Setup

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # then fill in real tokens (gitignored)
```

Generate tokens with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`
(twice). The SAME tokens go in the repo-root `.env` (watch build).

## Local dev

```bash
npm run dev          # wrangler dev on http://localhost:8787
```

Then `make web` in the repo root (the Vite proxy points at
`http://localhost:8787` by default — see `web/vite.config.mjs`).

Smoke check against the dev server:

```bash
curl -s http://localhost:8787/api/v1/health
curl -s -H "Authorization: Bearer $CHESS_TOKEN_P1" \
  "http://localhost:8787/api/v1/state?since=-1"
```

## Deploy + cutover

```bash
wrangler secret put CHESS_TOKEN_P1
wrangler secret put CHESS_TOKEN_P2
wrangler deploy
```

Cutover from the tunnel setup (the old DNS pointed
`chess.gulfrenderstudio.com` at the tunnel via CNAME):

1. `wrangler deploy` — the `route` in `wrangler.toml` attaches the Worker
   to `chess.gulfrenderstudio.com`. Verify first on the workers.dev URL:
   `curl https://<name>.<subdomain>.workers.dev/api/v1/health`.
2. In the Cloudflare dashboard → DNS, delete the tunnel CNAME for
   `chess.gulfrenderstudio.com` (the Worker route replaces it; if the
   CNAME still exists the Worker route wins, but delete it to avoid
   confusion).
3. Zero Trust → Access → Applications: delete the Chess Watch application
   and its Service Auth policy; Zero Trust → Access → Service Auth →
   Service Tokens: delete the service token.
4. On the laptop: `sudo systemctl stop --now cloudflared-chess-watch`
   (and `disable` it), remove `/etc/cloudflared/chess-watch.yml` and the
   tunnel (`cloudflared tunnel delete chess-watch`), and remove any
   `ufw` rules for tcp/8787 (`scripts/firewall/` is gone — the port is no
   longer listened on at all).
5. Delete the old server: the `server/` directory is already gone from
   this repo; remove any leftover `server/.venv` and `data/` on the laptop.
6. Verify: `curl https://chess.gulfrenderstudio.com/api/v1/health` →
   `{"status":"ok","version":"0.2.0"}`, then a state call with each token.
   The watches need a rebuild (`make config && make build`) — the bundle
   no longer carries Access headers, and the version is 0.2.0.

The old game is NOT migrated: the laptop SQLite database is not copied
to the DO. The first game on the Worker starts fresh (revision 0). That
is expected — finish or abandon any in-progress laptop game first.

## Tests

```bash
npm test            # unit: fake-storage DO + rules + Worker entry (66 tests)
npm run test:workers  # integration: real workerd + SQLite via SELF (4 tests)
```

The integration run uses `wrangler.test.toml` (fake tokens, no route);
never deploy with it. `make test` at the repo root runs both suites plus
the root JS vitest suite.

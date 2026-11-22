# Chess Watch Worker

Cloudflare Worker + Durable Object backend for Chess Watch. Replaces the
0.1.x laptop-server backend (deleted in 0.2.0). The API is unchanged since
0.1.x — see `docs/protocol.md` — so the watch app, side service, and web
harness needed no protocol changes.

## Layout

```
worker/
  wrangler.toml          Worker + DO binding (production; no route — see Deploy)
  test-config/
    wrangler.test.toml   test-only config (fake tokens, no route)
  .dev.vars.example      copy to .dev.vars for local dev (gitignored)
  src/index.js           Worker entry: config check, Bearer auth, routing
  src/game-do.js         ChessGame Durable Object: game state, long-poll
  src/rules.js           chess.js wrapper + persisted repetition map
  src/store.js           SQLite persistence (ctx.storage.sql)
  tests/                 vitest: unit (fake storage) + integration (workerd)
```

`wrangler` is a devDependency here (installed by `make setup` into
`worker/node_modules/.bin`). Every wrangler invocation goes through a
make target or `npx` from `worker/` — no global install needed:

- recommended: `make worker-dev` / `make worker-test` / `make worker-deploy` / `make worker-secrets` / `make worker-logs` from the repo root;
- direct: `cd worker && npx wrangler <cmd>`;
- optional: `npm install -g wrangler` if you prefer bare commands.

## How it works

One Durable Object instance (`ChessGame`, id `"game"`) owns the single
game. It keeps a live `Chess` instance cached in memory plus the revision,
offer, presence, and long-poll waiters; SQLite (`ctx.storage.sql`) holds
the durable copy: one `games` row, `moves` / `actions` tables with UNIQUE
client ids for idempotency, `meta` for the schema version (same table and
column names as the 0.1.x backend, plus `games.positions_json`).

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

CORS is for the browser harness only (the watch does not use it):
`http://localhost:5173` is always allowed; set `CHESS_CORS_ORIGINS`
(comma-separated, as a Worker var / secret / `.dev.vars` entry) to allow
more origins, e.g. the deployed Worker URL when running `make web`
against it.

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
  ~1–3 ms. Since 0.2.1 the derived position data (check, check-square,
  side-to-move legal moves) is cached per revision, so a long-poll that
  returns the same position does no move generation at all — only moves
  and other mutations recompute it.
- DO SQLite: 10 GB total; this game is kilobytes.

## Setup

From the repo root:

```bash
make setup   # installs root + web + worker, copies .env.example -> .env
             # and worker/.dev.vars.example -> worker/.dev.vars
```

Generate tokens with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`
(twice). The SAME tokens go in the repo-root `.env` (watch build),
`worker/.dev.vars` (local dev), and the Worker secrets
(`make worker-secrets`). Put the player names in `.env` and
`worker/.dev.vars` too (`CHESS_P1_NAME` / `CHESS_P2_NAME`) — the deploy
passes them to the Worker, and local dev reads them from `.dev.vars`.

## Local dev

```bash
make worker-dev   # or: cd worker && npm run dev — http://localhost:8787
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
make worker-login     # first time only: authorizes wrangler (opens a browser)
make worker-secrets   # interactive: sets CHESS_TOKEN_P1 / CHESS_TOKEN_P2
make worker-deploy    # deploys; attaches the route from CHESS_SERVER_URL
```

`make worker-deploy` runs `scripts/worker-deploy.sh`, which reads
`CHESS_SERVER_URL` from the repo-root `.env` and passes its host to
`npx wrangler deploy --route "<host>/*"`. No route is declared in
`wrangler.toml` — the hostname lives only in that `.env` value.
Optional `CHESS_WORKER_ZONE` (in `.env` or the environment) is passed as
`--zone` if route attachment needs an explicit zone. If
`CHESS_SERVER_URL` is unset, localhost, or a `*.workers.dev` URL, the
deploy is plain (workers.dev URL only). To validate the deploy without
deploying or logging in: `bash scripts/worker-deploy.sh --dry-run`.

Player names come from `.env` too: the script passes `CHESS_P1_NAME` /
`CHESS_P2_NAME` as `--var` flags on every deploy, overriding the
Aurora/Sam defaults in `wrangler.toml` `[vars]`. Without `--var` a deploy
would silently revert the board names to those defaults — that is what
happened on the first 0.2.0 deploy. Dashboard alternative: Workers &
Pages → chess-watch → Settings → Variables → add `CHESS_P1_NAME` /
`CHESS_P2_NAME` as plain Variables (not Secrets).

Dashboard half of the deploy (dash.cloudflare.com; also summarized in
the root README): the custom domain must be a Cloudflare zone (DNS
managed by Cloudflare). After deploying, check Workers & Pages →
chess-watch for the deployment and version 0.2.1. Settings → Variables
→ Secrets is the dashboard alternative to `make worker-secrets`;
Settings → Triggers → Routes is the alternative to the `--route` the
deploy script passes (add the route there if you deploy without it).
Observability → Logs (or `make worker-logs`) is where runtime errors
surface. After the first real request, Workers & Pages → Durable
Objects lists the `ChessGame` namespace — a redeploy keeps it, so the
game survives deploys. If wrangler reports an auth error, run
`make worker-login` again (or `cd worker && npx wrangler whoami` to
check who is logged in).

Cutover from the old 0.1.x setup (tunnel + Access — delete all of it;
the old game does NOT migrate, the first Worker game starts fresh at
revision 0, so finish or abandon any in-progress laptop game first):

1. Deploy the Worker and verify it on the workers.dev URL first
   (`curl https://<name>.<subdomain>.workers.dev/api/v1/health` →
   `{"status":"ok","version":"0.2.1"}`), then on the custom-domain URL
   from `.env` after the route attaches.
2. In the Cloudflare dashboard → DNS, delete the tunnel CNAME for the
   custom domain (the Worker route replaces it; if the CNAME still
   exists the Worker route wins, but delete it to avoid confusion).
3. Zero Trust → Access → Applications: delete the Chess Watch application
   and its Service Auth policy; Zero Trust → Access → Service Auth →
   Service Tokens: delete the service token.
4. On the laptop: `sudo systemctl stop --now cloudflared-chess-watch`
   (and `disable` it), remove `/etc/cloudflared/chess-watch.yml` and the
   tunnel (`cloudflared tunnel delete chess-watch`), and remove any
   `ufw` rules for tcp/8787 (the port is no longer listened on at all).
5. Delete the old server leftovers on the laptop: `server/.venv` and
   `data/` (`server/` itself is already gone from this repo).
6. Rebuild both watches (`make config && make build`) — the bundle no
   longer carries Access headers, and the version is 0.2.1.

## Tests

```bash
npm test              # unit: fake-storage DO + rules + Worker entry
npm run test:workers  # integration: real workerd + SQLite via SELF
```

The integration run uses `test-config/wrangler.test.toml` (fake tokens,
no route); never deploy with it. It is independent of `worker/.dev.vars`
— see the comment at the top of that file for why it lives in a
subdirectory. `make test` at the repo root runs both suites plus the
root JS vitest suite.

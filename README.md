# Chess Watch

Two-player chess between an Amazfit Bip 6 and an Amazfit Active 3 Premium,
relayed by a self-hosted server on the LAN/VPN. The server is the single
source of truth; the watches are thin tap-to-move clients.

- Tap a piece, then tap a target square. No drag.
- Full rules on the server: castling, en passant, promotion, check,
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
3. Fill both `.env` files:
   - `.env` — watch build: `CHESS_SERVER_URL` (the public HTTPS hostname
     from Cloudflare Tunnel, e.g. `https://chess.gulfrenderstudio.com`;
     a LAN/VPN address also works while the phone is on that network),
     both tokens, names.
   - `server/.env` — the **same** tokens, and `CHESS_HOST=127.0.0.1`
     (loopback; the tunnel is the only way in).
4. `make server` — start the relay (single worker) on `127.0.0.1:8787`.
5. `make config` — generate `shared/config.generated.js` from `.env`.
6. `make web` — test in the browser (`?player=p1` / `?player=p2` tabs).
   It regenerates the config from `.env`, then Vite proxies `/api` to
   `CHESS_SERVER_URL` and adds the Cloudflare Access service-token headers
   server-side. The browser never calls the tunnel directly, so CORS and
   Access preflight do not get in the way. To use a local relay instead,
   run `CHESS_SERVER_URL=http://localhost:8787 make web`.
7. `make preview` — scan the QR with the Zepp app on each watch, enable
   developer mode.

`make setup` does the installs and copies the `.env.example` files the
first time. On Arch/Omarchy, where `libvips` is installed system-wide,
setup sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1` so `sharp` uses its bundled
prebuilt binary instead of trying (and failing) to compile against the
system library. `make test` runs the JS vitest suite and the server
pytest suite. `make pieces` / `make icons` regenerate the PNG assets.

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
server/                    FastAPI + python-chess + SQLite relay
scripts/                   config / piece / icon generators
docs/                      protocol.md, design.md, manual-test.md
```

## Remote access (Cloudflare Tunnel)

The watches use the phone's network, so they need a public HTTPS hostname,
not a LAN IP. `scripts/cloudflare/` contains a setup script for a dedicated
Cloudflare Tunnel plus a Cloudflare Access service token:

```bash
sudo scripts/cloudflare/setup-tunnel.sh          # chess.gulfrenderstudio.com
sudo scripts/cloudflare/setup-tunnel.sh --status
```

The relay listens on `127.0.0.1:8787` only; `cloudflared` connects outbound,
so no inbound port is open. Full walkthrough, Access policy, verification
and troubleshooting: `scripts/cloudflare/README.md`.

## Still offline on the watch? Read the Diagnostics screen

On the watch: Menu → **Test link** (or the Test link button on the
"Connecting…" screen). It runs a live probe through the side service and
shows where the link breaks — no tokens are displayed. Report the lines
verbatim; the table below is what they mean.

| What the screen shows | Meaning | Fix |
|---|---|---|
| `Build:` older than `git rev-parse HEAD`, or `Names: Aurora / Sam` when `.env` says otherwise | The watch is running a stale install | `make preview` again from the current checkout and reinstall; check the Build line changes |
| `Host: localhost…` / `127.0.0.1` | Stale build baked with a dev URL | Same as above — the watch cannot reach localhost |
| `Poll err: 1` / `Diag: side unreachable` | The page never reached the side service (ZML BLE shake timed out after 5 s) | Keep the Zepp app open in the foreground, Bluetooth on, watch paired; reinstall via a fresh `make preview` (a pre-fix build crashes its side service on load) |
| `Ping: FAIL` + `Last: state http_403` | Cloudflare Access rejected the service token | Recheck `CHESS_CF_ACCESS_CLIENT_ID`/`_SECRET` in `.env` and the Service Auth policy on the Access application, then rebuild |
| `Ping: ok` + `Last: state unauthorized` | Player tokens differ between `.env` and `server/.env` | Copy the same tokens into both files (see `scripts/cloudflare/README.md` §0) and restart the server + rebuild |
| `Ping: FAIL` + `Last: state timeout` / `network` | Phone has no route to the tunnel, or the tunnel/server is down | `curl` the health URL with the Access headers from a laptop (see `scripts/cloudflare/README.md` §3); check `make -C server status` and `scripts/cloudflare/setup-tunnel.sh --status` |
| `Ping: ok` + `Last: state ok` but the board stays offline | The poll itself is failing after a good ping (BLE flakiness, stale revision) | Wait through a retry cycle; if it persists, the `Last` line after the next poll is the new evidence |

The server and tunnel can be fine while the watch is offline — the CLI
health check only proves the server side. The Diagnostics screen is the
only evidence about the watch → phone → server path.

## Security note

Tokens (player bearer tokens and the optional Cloudflare Access service
token) are embedded in the bundle and extractable. Do not distribute the
build; rotate by editing `.env` and rebuilding both watches. The server
listens on loopback and is reached through Cloudflare Tunnel, so there is
no public port to scan.

## Verification status (2026-11-21)

Verified: server pytest 37/37, smoke script pass, JS vitest 27/27, `vite
build` pass, `zeus build` pass (0.1.1, all 4 targets), headless-Chromium
screenshots of both presets (correct start position, flipped Black board,
selection dots, last-move highlight), a browser tap e2→e4 reaching the
server (ply 1, turn b), preset switching Bip 6 ↔ Active 3 in `make web`
(board re-renders both ways — previously black after switching, see
`docs/design.md` §7), and Menu → Test link opening the Diagnostics overlay
on both presets, including with the server down (offline board + `Ping:
FAIL` + `Last: state http_500`).

Not yet verified on-device (see `docs/manual-test.md`): the 0.1.1 build
has not been installed on either watch yet. The first thing to check after
installing it is Menu → Test link and the decision table above. Also
unconfirmed: Vibrator availability, console icon acceptance.

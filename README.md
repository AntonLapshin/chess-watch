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
   - `.env` — watch build: `CHESS_SERVER_URL` (LAN/VPN address of the
     server; the watch cannot reach `localhost`), both tokens, names.
   - `server/.env` — same tokens (see `server/.env.example`).
4. `make server` — start the relay (single worker) on port 8787.
5. `make config` — generate `shared/config.generated.js` from `.env`.
6. `make web` — test in the browser (`?player=p1` / `?player=p2` tabs).
7. `make preview` — scan the QR with the Zepp app on each watch, enable
   developer mode.

`make setup` does the installs and copies the `.env.example` files the
first time. `make test` runs the JS vitest suite and the server pytest
suite. `make pieces` / `make icons` regenerate the PNG assets.

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

## Security note

Tokens are embedded in the bundle and extractable. Do not distribute the
build; rotate by editing `.env` and rebuilding both watches.

## Verification status (2026-11-21)

Verified: server pytest 37/37, smoke script pass, JS vitest 11/11, `vite
build` pass, headless-Chromium screenshots of both presets (correct start
position, flipped Black board, selection dots, last-move highlight), and a
browser tap e2→e4 reaching the server (ply 1, turn b).

Not yet verified on-device (see `docs/manual-test.md`): Zeus build was
attempted 2026-11-21 (zeus-cli 1.10.2) and failed with `[ERROR] appId is
invalid, please confirm it` — expected, since `app.json` has the
placeholder `appId` 0; re-run after console registration, which will also
confirm the `app-side` module key and zml imports. Also unconfirmed:
`fetch` response shape on the side service, Vibrator availability, console
icon acceptance, and `appId` registration. The round-board y (69, not the
plan's 58) and round status bar are documented deviations in
`docs/design.md` — the plan's numbers put board corners outside the round
display.

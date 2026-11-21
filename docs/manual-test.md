# Manual test checklist

Two watches (Bip 6 + Active 3 Premium) + the server on the LAN/VPN host.

## Setup

1. Register the app in console.zepp.com, put the numeric `appId` in
   `app.json` (currently `0` placeholder).
2. Generate two tokens, fill `.env` (watch build) and `server/.env`.
3. `make server` (or `make -C server start`), then `make config`.
4. `make web` to test in the browser first (`?player=p1` / `?player=p2` tabs).
5. `make preview`, scan with the Zepp app on each watch, enable developer mode.

## Checklist

- [ ] First launch on each watch shows the player picker; the choice
      persists across restarts. Menu → Switch player returns to the picker.
- [ ] Start position renders correctly on both shapes; Black's board is
      flipped (black pieces at the bottom on the Active 3).
- [ ] Tap a piece → legal-target dots only; tap a target → the move lands
      on both watches within ~1 s; last-move squares highlight.
- [ ] Illegal taps do nothing (no dot, no send); tapping an empty square
      deselects.
- [ ] Promotion: push a pawn to the last rank → picker (Q/R/B/N) → the
      promoted piece appears on both watches.
- [ ] Castling (both sides), en passant, check (king square tints red,
      "Check!" in the status bar).
- [ ] Checkmate / stalemate → result screen on both watches ("You win —
      checkmate" / "Draw — stalemate"). Play again sends a restart offer.
- [ ] Menu → Offer draw → opponent sees the offer dialog with countdown;
      accept ends the game as a draw, decline toasts the offerer.
- [ ] Menu → Take back: after 1 ply reverts 1 move; after the opponent
      replied reverts 2; unavailable at game start (toast).
- [ ] Menu → Start over → opponent accepts → fresh board, `game_no` + 1.
- [ ] Menu → Resign → immediate loss, no confirmation from the opponent.
- [ ] Offer expiry: send an offer, leave it 120 s → it disappears on both
      watches, no accept possible afterwards.
- [ ] Airplane mode mid-game: red dot, board stays on the last good state;
      reconnect → state refreshes, no duplicate moves.
- [ ] Server restart mid-game: game survives (SQLite); both watches resume
      polling and see the same position.
- [ ] Square vs round layout: status bar fits, Menu button reachable,
      board corners inside the round display.
- [ ] Haptics toggle in the menu silences the move/check buzz.

## Open verification items (not yet done on-device)

- Zeus build: attempted 2026-11-21 with @zeppos/zeus-cli 1.10.2. The CLI
  ran (device list updated OK) and then failed with
  `[ERROR] appId is invalid, please confirm it` — expected, because
  `app.json` carries the placeholder `appId` 0, not a console-registered
  id. Re-run `make build` after registering the app and setting the real
  `appId`; that run will also confirm the `app-side` module key and the
  zml imports (`BasePage`, `BaseSideService`, `BaseApp`).
- `fetch` response shape on the side service (`res.status` vs `res.body`
  only) — the client parses defensively, but on-device behaviour is
  unconfirmed.
- Vibrator availability on both models.
- Console icon acceptance (192×192 PNGs provided).
- `appId` registration (placeholder `0` in `app.json`).

## Already verified (browser + server, 2026-11-21)

- Server pytest: 37 tests green (rules, API, actions, config).
- Smoke script: health, auth, move, long-poll wake, dedupe, 409 conflict,
  resign — all pass against real uvicorn.
- JS vitest: 11 tests green (FEN parsing, both layouts, round corner radius).
- Web harness: `vite build` passes; headless-Chromium screenshots of both
  presets show the correct start position; tap e2→e4 in the browser reached
  the server (ply 1, turn b); selection dots and last-move highlight
  verified visually.

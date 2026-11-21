# Manual test checklist

Two watches (Bip 6 + Active 3 Premium) + the Cloudflare Worker backend.

## Setup

1. Register the app in console.zepp.com, put the numeric `appId` in
   `app.json` (currently `1137599`).
2. Generate two tokens, fill `.env` (watch build) with the same values
   set as Worker secrets (`wrangler secret put CHESS_TOKEN_P1` /
   `CHESS_TOKEN_P2`); for local testing use `worker/.dev.vars`.
3. Deploy the Worker (`make worker-deploy`) or run it locally
   (`make worker-dev`, `http://localhost:8787` — watch builds still need
   the public `https://chess.gulfrenderstudio.com` URL).
4. `make config`.
5. `make web` to test in the browser first (`?player=p1` / `?player=p2` tabs).
   It points the harness at the local Worker dev server by default; run
   `make worker-dev` in another terminal first.
6. `make preview`, scan with the Zepp app on each watch, enable developer mode.

## Checklist

- [ ] Install via `make preview` (keep the command running while the
      Zepp app scans the QR code), then open Chess Watch on the watch.
      Keep the Zepp app open on the phone — the side service runs inside
      it, and the watch cannot reach the Worker without it.
- [ ] First launch on each watch shows the player picker; the choice
      persists across restarts. Menu → Switch player returns to the picker.
- [ ] Menu → Test link shows the Diagnostics overlay (build commit matches
      `git rev-parse HEAD`, names/host match `.env`); with the Worker up it
      reports `Ping: ok` and `Last: state ok`. Close returns to the board.
- [ ] If Test link reports Err 1 / `Diag: side unreachable`, check the
      phone before touching the Worker: Zepp app → Profile → Settings →
      About → tap the Zepp icon 7× (Developer Mode) → Mini Program icon
      → log screen → **Side Service** tab. The `[chess-watch] side
      service init …` line must appear after opening the app on the
      watch; an empty log means the side service never started.
      Force-stop and reopen the Zepp app, then re-run Test link.
- [ ] With the Worker unreachable (airplane mode on the phone, or wrong
      URL), the board still renders (offline dot) and Menu → Test link
      still opens, reporting `Ping: FAIL` and the last poll error — the
      diagnostics must not disappear with the board.
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
- [ ] Remote/cellular: turn off Wi-Fi on the phone, keep the watch paired;
      moves still sync through `https://chess.gulfrenderstudio.com`.
- [ ] Worker redeploy mid-game: game survives (DO SQLite); both watches
      resume polling and see the same position.
- [ ] Square vs round layout: status bar fits, Menu button reachable,
      board corners inside the round display.
- [ ] Haptics toggle in the menu silences the move/check buzz.

## Open verification items (not yet done on-device)

- 0.2.0 build install: `zeus build` passes (0.2.0, all targets) with the
  registered `appId` 1137599. Install via `make preview` on both
  watches and read Menu → Test link first (see the README decision table).
  For a shake timeout (Err 1) also read the Zepp app's Side Service log
  screen — see the checklist above.
- `fetch` response shape on the side service (`res.status` vs `res.body`
  only) — the client parses defensively, but on-device behaviour is
  unconfirmed until the Diagnostics screen is read.
- Vibrator availability on both models.
- Console icon acceptance (192×192 PNGs provided).
- Production cutover: the Worker route on `chess.gulfrenderstudio.com`
  has not been deployed yet; the tunnel CNAME / Access application /
  `cloudflared-chess-watch` service still need deleting per
  `worker/README.md` § "Deploy + cutover".

## Already verified (browser + Worker, 2026-11-21)

- Worker unit tests: 66 tests green (rules, DO API/actions, Worker entry).
- Worker integration tests: 4 tests green through real workerd + SQLite
  (health, state, full flow with long-poll wake + offer + resign,
  duplicate id).
- Smoke: health, auth, move, long-poll wake, dedupe, 409 conflict,
  resign — all pass against a real `wrangler dev` server (see below).
- JS vitest: 27 tests green (FEN parsing, both layouts, round corner radius,
  HTTP bearer headers).
- Web harness: `vite build` passes; headless-Chromium screenshots of both
  presets show the correct start position; tap e2→e4 in the browser reached
  the local Worker (ply 1, turn b); selection dots and last-move highlight
  verified visually.

## Worker smoke (local `wrangler dev`)

```bash
cd worker && cp .dev.vars.example .dev.vars   # fill in test tokens
npm run dev &                                 # http://localhost:8787
P1=<token-p1>; P2=<token-p2>
curl -s http://localhost:8787/api/v1/health
# -> {"status":"ok","version":"0.2.0"}
curl -s -H "Authorization: Bearer $P1" "http://localhost:8787/api/v1/state?since=-1"
curl -s -X POST -H "Authorization: Bearer $P1" -H "Content-Type: application/json" \
  -d '{"client_move_id":"smoke-1","expected_revision":0,"from":"e2","to":"e4"}' \
  http://localhost:8787/api/v1/move
# -> ply 1, turn b, duplicate false
curl -s -X POST -H "Authorization: Bearer $P1" -H "Content-Type: application/json" \
  -d '{"client_move_id":"smoke-1","expected_revision":0,"from":"e2","to":"e4"}' \
  http://localhost:8787/api/v1/move
# -> same state, duplicate true
curl -s -X POST -H "Authorization: Bearer $P2" -H "Content-Type: application/json" \
  -d '{"client_action_id":"smoke-2","expected_revision":1,"type":"resign"}' \
  http://localhost:8787/api/v1/action
# -> finished, result w, resign
```

Remove `.dev.vars` afterwards if it holds anything but placeholders
(it is gitignored, but never commit it).

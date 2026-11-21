# Chess Watch protocol

Wire protocol between the watches (via the side service) and the relay
Worker. Base URL: `{CHESS_SERVER_URL}`. All endpoints require
`Authorization: Bearer <token>` except `/health`.

Backend: a Cloudflare Worker (`worker/src/index.js`) routing to a
`ChessGame` Durable Object (`worker/src/game-do.js`) with SQLite storage.
The API below is unchanged from the old FastAPI server it replaced — the
watch app, side service, and web harness needed no protocol changes.

## Auth

Two tokens, one per player: `CHESS_TOKEN_P1` (White) and `CHESS_TOKEN_P2`
(Black). A token identifies the role (`p1` / `p2`); there is no separate
login step. A bad or missing token gets `401 {"code": "unauthorized"}`.

## Endpoints

### `GET /api/v1/health`

Liveness, no auth. Returns `{"status": "ok", "version": "0.2.0"}`. If the
Worker secrets are missing, equal, shorter than 24 chars, or still the
placeholders, every `/api/v1/*` request (including health) fails with
`500 {"code": "config_error"}` instead.

### `GET /api/v1/state?since=&wait=&presence=1`

Full game state, with long-polling.

- `since` (int): the last revision the client has. If `since < revision`
  the server answers immediately; otherwise it waits until the revision
  changes or `wait` seconds elapse. Omit `since` (or pass `-1`) for an
  immediate snapshot — a fresh game has revision 0, so `since=0` would
  wait the full `wait` on first load.
- `wait` (seconds, clamped to 0–25): long-poll budget. The client uses 20.
- `presence=1`: marks the caller online (seen within the last 45 s).

State payload (kept under ~1 KB for BLE):

```json
{
  "revision": 14,
  "server_time": 1760000000.0,
  "game_no": 1,
  "you":      { "role": "p1", "color": "w", "name": "Aurora" },
  "opponent": { "role": "p2", "name": "Sam", "color": "b", "online": true },
  "game": {
    "status": "active",
    "result": null,
    "result_reason": null,
    "turn": "b",
    "fen": "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    "ply": 2,
    "last_move": { "from": "e2", "to": "e4", "san": "e4", "by": "p1" },
    "recent_moves": [ { "ply": 1, "san": "e4", "by": "p1" } ],
    "check": false,
    "check_square": null,
    "claimable": [],
    "legal_moves": ["g1f3", "b1c3"],
    "offer": null,
    "last_action": { "type": "offer_declined", "by": "p2", "at": 1760000000 }
  }
}
```

- `legal_moves` (UCI) is included only when the game is active and it is
  the requesting player's turn. The watch renders target dots from it.
- `recent_moves` is capped at 6; full history stays server-side.
- `offer` is `{type, by, expires_at}` or `null`.
- `claimable` lists `"threefold"` / `"fifty"` when the player to move may
  claim a draw.

### `POST /api/v1/move`

```json
{ "client_move_id": "p1-1760000000123-7", "expected_revision": 14,
  "from": "e2", "to": "e4", "promotion": null }
```

Validation order: auth → parse → idempotency (`client_move_id`) → revision
match → game active → your turn → promotion required/valid → legality
(chess.js) → apply → terminal/claimable detection → `revision++` →
notify long-poll waiters.

A duplicate `client_move_id` returns the current state with
`"duplicate": true` and does not change anything. `promotion` is `q`/`r`/
`b`/`n` or `null`.

### `POST /api/v1/action`

```json
{ "client_action_id": "p1-1760000000123-8", "expected_revision": 14,
  "type": "offer_draw", "claim": null }
```

| Type | Behavior |
|---|---|
| `offer_restart` | Opponent must accept; works during play or after a result. Accept resets the board, clears moves, increments `game_no`. |
| `offer_takeback` | Opponent must accept; reverts to the requester's turn (1 ply if the requester just moved, 2 if the opponent replied). Only during play; rejected when no move exists. |
| `offer_draw` | Opponent must accept; only during play. |
| `accept` / `decline` | Applies to the pending offer; only the opponent may answer. Decline produces `last_action` so the offerer sees it. |
| `resign` | Immediate, no confirmation. Winner is the opponent. |
| `claim_draw` | `claim: "threefold" \| "fifty"`, only if in `claimable` and it is your turn. |

One pending offer per game. Offers expire after `CHESS_OFFER_TTL` (120 s);
expiry is applied lazily on read AND by a Durable Object alarm set when
the offer is created: an expired offer is cleared, `revision++`, and
long-poll waiters wake (with `last_action.type == "offer_expired"`).

## Terminal detection (after each move)

- Checkmate → win for the side that moved (`result_reason: "checkmate"`).
- Stalemate, insufficient material → draw.
- Fivefold repetition, 75-move rule → automatic draw.
- Threefold, 50-move → added to `claimable` for the player to move.
- Resign, agreement, accepted claim → immediate result
  (`resign`, `agreement`, `threefold_claim`, `fifty_claim`).

## Errors

Every error body is `{"code", "message"}`; `revision_conflict` also carries
the current `state` so the client can refresh instead of retrying.

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `unauthorized` | Missing or invalid bearer token |
| 409 | `revision_conflict` | `expected_revision` is stale (body includes `state`) |
| 409 | `not_your_turn` | It is the opponent's turn |
| 409 | `game_over` | The game already ended |
| 409 | `offer_pending` | An offer is already pending |
| 409 | `no_offer` | No pending offer to answer |
| 409 | `invalid_claim` | Draw cannot be claimed now |
| 409 | `takeback_unavailable` | No move exists to take back |
| 409 | `not_recipient` | Only the opponent may answer an offer |
| 422 | `illegal_move` | chess.js rejects the move |
| 422 | `promotion_required` | A promotion move needs `q`/`r`/`b`/`n` |
| 500 | `config_error` | Worker secrets missing / equal / too short / placeholder |

## Long-poll mechanics

`wait` is clamped to 0–25 s. The Durable Object holds waiters on a
per-DO list of resolvers + `setTimeout` (see `worker/src/game-do.js`): a
commit between the state read and the wait resolves the waiter first, so
there is no lost-wakeup window. `blockConcurrencyWhile` is deliberately
not used for the wait (30 s timeout + it blocks the DO). A pending
long-poll keeps the DO non-hibernatable, so it bills duration while a
watch page is open — see `worker/README.md` for the free-tier numbers.

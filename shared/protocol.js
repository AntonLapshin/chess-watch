// Shared protocol constants and small pure helpers (no Zepp imports, so
// both the watch page and the web harness can use them).
import { applyMoveToFen } from "./fen.js";
export const ACTION_TYPES = [
  "offer_restart", "offer_takeback", "offer_draw",
  "accept", "decline", "resign", "claim_draw",
];

export const ERROR_CODES = [
  "unauthorized", "revision_conflict", "not_your_turn", "game_over",
  "offer_pending", "no_offer", "invalid_claim", "illegal_move",
  "promotion_required", "takeback_unavailable", "not_recipient",
];

export const ERROR_MESSAGES = {
  unauthorized: "Not authorized",
  revision_conflict: "State changed — refreshing",
  not_your_turn: "Not your turn",
  game_over: "Game is over",
  offer_pending: "An offer is already pending",
  no_offer: "No offer to answer",
  invalid_claim: "Draw cannot be claimed now",
  illegal_move: "Illegal move",
  promotion_required: "Choose a promotion piece",
  takeback_unavailable: "Nothing to take back",
  not_recipient: "Only the opponent can answer",
  network: "No connection to server",
  timeout: "Server did not answer",
  unknown: "Something went wrong",
  // ZML BLE-transport errors (zml-side.js MessageBuilder): the page never
  // reached the side service at all, so no server error exists. Codes are
  // numeric on the wire (1 = shake timeout, 2 = BLE disconnect, 4 =
  // request timeout); the 5 s shake timeout is exactly the "~5 s of
  // Connecting…" before the offline board appears.
  1: "No link to phone — side service did not answer",
  2: "Bluetooth disconnected",
  4: "Request timed out",
};

/** Human line for a poll/send error code (server, HTTP or ZML link). */
export function errorMessage(code, message) {
  if (code != null && code !== "unknown" && ERROR_MESSAGES[code] !== undefined) {
    return ERROR_MESSAGES[code];
  }
  if (typeof code === "string" && /^http_\d+$/.test(code)) {
    return `Server answered ${code.slice(5)}`;
  }
  const msg = String(message || "");
  if (/shake timeout/i.test(msg)) return ERROR_MESSAGES[1];
  if (/ble disconnect/i.test(msg)) return ERROR_MESSAGES[2];
  if (/request id=.*timeout/i.test(msg)) return ERROR_MESSAGES[4];
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown;
}

/** UCI targets for one origin square, from the server-supplied legal_moves. */
export function targetsFor(legalMoves, from) {
  return (legalMoves || []).filter((m) => m.slice(0, 2) === from);
}

/** True when any legal move from -> to is a promotion. */
export function isPromotionMove(legalMoves, from, to) {
  return (legalMoves || []).some(
    (m) => m.slice(0, 2) === from && m.slice(2, 4) === to && m.length === 5,
  );
}

/** True when the game position changed between two states. A long-poll
 *  returns the SAME state when its 20 s wait times out with no change, and
 *  the page must not treat that refresh as a new position: clearing the
 *  selection on it meant a deliberate player who took >~10 s between
 *  tapping a piece and tapping its target lost the selection mid-thought
 *  (the target tap then only deselected, and the move never happened).
 *  Only a real change — a move (ply/fen), a restart (game_no), or a
 *  status change (active -> finished) — invalidates the selection and a
 *  send in flight. `prev` null (first state) counts as changed. */
export function positionChanged(prev, next) {
  if (!prev || !prev.game || !next || !next.game) return true;
  return (
    next.game.ply !== prev.game.ply ||
    next.game.fen !== prev.game.fen ||
    next.game_no !== prev.game_no ||
    next.game.status !== prev.game.status
  );
}

/** Optimistic move: apply a tap to the displayed board immediately so
 *  the piece visibly moves the moment it is tapped, instead of the board
 *  going dark for the ~1 s BLE + Worker round-trip. The FEN applier is
 *  byte-identical to the server's chess.js FEN (verified against it in
 *  fen.test.mjs / the chess.js oracle), so the confirming state lands on
 *  the same position with no jump. check is left false and legal_moves
 *  empty — both are unknown locally and the server corrects them on
 *  arrival. Returns null when the move cannot be applied locally
 *  (malformed state); the caller then falls back to waiting for the
 *  server. */
export function optimisticState(state, from, to, promotion) {
  try {
    const fen = applyMoveToFen(state.game.fen, from, to, promotion);
    if (!fen) return null;
    const next = JSON.parse(JSON.stringify(state));
    next.game.fen = fen;
    next.game.turn = state.game.turn === "w" ? "b" : "w";
    next.game.ply = state.game.ply + 1;
    next.game.last_move = { from, to, san: null, by: state.you.role };
    next.game.check = false;
    next.game.legal_moves = [];
    return next;
  } catch (_) {
    return null;
  }
}

/** Client-side idempotency id: role + timestamp + counter. */
let _counter = 0;
export function nextClientId(role) {
  _counter += 1;
  return `${role}-${Date.now()}-${_counter}`;
}

/** Fake start-position state, used when the server is unreachable so the
 *  board still renders (offline dot shown). Never used for moves.
 *  `names` ({ p1, p2 }) overrides the built-in defaults so the side service
 *  — which knows the generated config — can supply the real .env names. */
export function fakeInitialState(role, names) {
  const p1 = (names && names.p1) || "Aurora";
  const p2 = (names && names.p2) || "Sam";
  const youColor = role === "p1" ? "w" : "b";
  return {
    revision: 0,
    server_time: Date.now() / 1000,
    game_no: 1,
    you: { role, color: youColor, name: role === "p1" ? p1 : p2 },
    opponent: {
      role: role === "p1" ? "p2" : "p1",
      name: role === "p1" ? p2 : p1,
      color: youColor === "w" ? "b" : "w",
      online: false,
    },
    game: {
      status: "active",
      result: null,
      result_reason: null,
      turn: "w",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      ply: 0,
      last_move: null,
      recent_moves: [],
      check: false,
      check_square: null,
      claimable: [],
      legal_moves:
        youColor === "w"
          ? ["a2a3","a2a4","b2b3","b2b4","c2c3","c2c4","d2d3","d2d4",
             "e2e3","e2e4","f2f3","f2f4","g2g3","g2g4","h2h3","h2h4",
             "g1f3","g1h3","b1a3","b1c3"]
          : [],
      offer: null,
      last_action: null,
    },
    _offline: true,
  };
}

const RESULT_REASONS = {
  checkmate: "checkmate",
  stalemate: "stalemate",
  insufficient_material: "insufficient material",
  fivefold: "fivefold repetition",
  seventyfive: "75-move rule",
  resign: "resignation",
  agreement: "draw agreed",
  threefold_claim: "threefold repetition claimed",
  fifty_claim: "50-move rule claimed",
};

/** Human result line for the result screen, from the winner's perspective. */
export function resultText(state, role) {
  const g = state.game;
  if (g.status !== "finished") return "";
  const youColor = state.you.color;
  const reason = RESULT_REASONS[g.result_reason] || g.result_reason || "";
  if (g.result === "draw") return `Draw — ${reason}`;
  if (g.result === youColor) return `You win — ${reason}`;
  return `You lose — ${reason}`;
}

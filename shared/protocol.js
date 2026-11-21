// Shared protocol constants and small pure helpers (no Zepp imports, so
// both the watch page and the web harness can use them).
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
};

export function errorMessage(code) {
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

// Pure chess rules on top of chess.js 1.4.0. No I/O, no storage: the
// Durable Object owns persistence, this module only answers rules questions.
//
// chess.js 1.4.0 gaps this module works around (verified by measurement
// against the installed package, 2026-11-21):
//   - No isFivefoldRepetition() / isSeventyFiveMoveRule() at all.
//   - After load(fen) the move history is empty, so even
//     isThreefoldRepetition() returns false for a position reached three
//     times. Repetition is therefore derived from a position-count map
//     (trimmed FEN -> count) that the DO persists in SQLite alongside the
//     FEN; see positionCountsFor() / trimmedFen().
//   - 50-move / 75-move come from the FEN half-move clock (fields 5),
//     never from history.
import { Chess } from "chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const PROMOTION_PIECES = new Set(["q", "r", "b", "n"]);

/** Position key: FEN fields 1-4 (placement, turn, castling, en passant).
 *  The half-move/full-move clocks are excluded: the same position with a
 *  different clock is still the same position for repetition purposes. */
export function trimmedFen(fen) {
  return fen.split(" ").slice(0, 4).join(" ");
}

/** Half-move clock (field 5 of the FEN). 100 = 50 moves, 150 = 75 moves. */
export function halfmoveClock(fen) {
  const n = parseInt(fen.split(" ")[4] || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

/** Fresh counts map for the start position. */
export function initialPositionCounts() {
  return { [trimmedFen(START_FEN)]: 1 };
}

/**
 * Recompute the position-count map by replaying UCI moves from the start.
 * Used ONLY for takeback (a rare op that truncates history): the
 * per-request path never replays — it loads the board from the stored FEN
 * and reads the persisted map. A 200-ply replay + legal moves costs ~22–38 ms (measured in workerd and Node respectively),
 * over the Workers Free 10 ms CPU/invocation cap; a FEN load is ~1 ms.
 */
export function positionCountsFor(uciMoves) {
  const board = new Chess();
  const counts = { [trimmedFen(board.fen())]: 1 };
  for (const uci of uciMoves) {
    board.move(uci);
    const key = trimmedFen(board.fen());
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Rebuild a board by replaying UCI moves (takeback/restart only). */
export function replay(uciMoves) {
  const board = new Chess();
  for (const uci of uciMoves) board.move(uci);
  return board;
}

/**
 * Terminal / claimable detection for the position on `board`, with
 * repetition counts from the persisted map.
 * Returns { status, result, resultReason, claimable } — status is
 * "finished" for an automatic ending, else null. Check order:
 * checkmate, stalemate, insufficient material, fivefold, 75-move, then
 * claimable threefold / fifty.
 */
export function terminalAndClaimable(board, positionCounts) {
  const claimable = [];
  if (board.isCheckmate()) {
    const winner = board.turn() === "b" ? "w" : "b";
    return { status: "finished", result: winner, resultReason: "checkmate", claimable };
  }
  if (board.isStalemate()) {
    return { status: "finished", result: "draw", resultReason: "stalemate", claimable };
  }
  if (board.isInsufficientMaterial()) {
    return { status: "finished", result: "draw", resultReason: "insufficient_material", claimable };
  }
  const count = (positionCounts && positionCounts[trimmedFen(board.fen())]) || 0;
  if (count >= 5) {
    return { status: "finished", result: "draw", resultReason: "fivefold", claimable };
  }
  if (halfmoveClock(board.fen()) >= 150) {
    return { status: "finished", result: "draw", resultReason: "seventyfive", claimable };
  }
  if (count >= 3) claimable.push("threefold");
  if (halfmoveClock(board.fen()) >= 100) claimable.push("fifty");
  return { status: null, result: null, resultReason: null, claimable };
}

/** Legal moves from `board` as UCI strings (promotion letter appended). */
export function legalMovesUci(board) {
  return board.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ""));
}

/** Legal promotion moves from `from` to `to` (verbose move objects). */
export function promotionMoves(board, from, to) {
  return board
    .moves({ verbose: true })
    .filter((m) => m.from === from && m.to === to && m.promotion);
}

/** Square of the side-to-move king, or null. Used for `check_square`. */
export function kingSquare(board) {
  const turn = board.turn();
  for (const row of board.board()) {
    for (const sq of row) {
      if (sq && sq.type === "k" && sq.color === turn) return sq.square;
    }
  }
  return null;
}

/**
 * Plies to revert so it is the requester's turn again: 1 ply if the requester just moved
 * (opponent has not replied yet), 2 plies if the opponent replied,
 * null when no moves exist.
 */
export function takebackPlies(moves, requesterColor) {
  if (!moves || moves.length === 0) return null;
  if (moves[moves.length - 1].by_color === requesterColor) return 1;
  if (moves.length >= 2) return 2;
  return 1; // single opponent move: revert it, requester to move
}

/** SAN + UCI record for a legal verbose move, before it is pushed. */
export function moveRecord(boardBefore, verboseMove, by) {
  return {
    uci: verboseMove.from + verboseMove.to + (verboseMove.promotion || ""),
    san: verboseMove.san,
    by,
    by_color: boardBefore.turn(),
  };
}

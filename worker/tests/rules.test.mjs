// Rules tests: chess.js 1.4.0 + the persisted repetition map. The fivefold / 75-move cases MUST go
// through the map path (chess.js has no such APIs — verified: both are
// undefined in 1.4.0), including a takeback that changes the counts.
import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  START_FEN,
  trimmedFen,
  halfmoveClock,
  initialPositionCounts,
  positionCountsFor,
  replay,
  terminalAndClaimable,
  legalMovesUci,
  promotionMoves,
  takebackPlies,
} from "../src/rules.js";

describe("terminal detection", () => {
  it("fool's mate is checkmate", () => {
    const board = replay(["f2f3", "e7e5", "g2g4", "d8h4"]);
    expect(board.isCheckmate()).toBe(true);
    expect(terminalAndClaimable(board, {})).toMatchObject({
      status: "finished", result: "b", resultReason: "checkmate",
    });
  });

  it("stalemate FEN", () => {
    const board = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(board.isStalemate()).toBe(true);
    expect(terminalAndClaimable(board, {})).toMatchObject({
      status: "finished", result: "draw", resultReason: "stalemate",
    });
  });

  it("insufficient material", () => {
    for (const fen of [
      "8/8/4k3/8/8/3K4/8/8 w - - 0 1", // K vs K
      "8/8/4k3/8/8/3K1B2/8/8 w - - 0 1", // K+B vs K
      "8/8/4k3/8/8/3K1N2/8/8 w - - 0 1", // K+N vs K
    ]) {
      const board = new Chess(fen);
      expect(board.isInsufficientMaterial()).toBe(true);
      expect(terminalAndClaimable(board, {})).toMatchObject({
        status: "finished", result: "draw", resultReason: "insufficient_material",
      });
    }
  });

  it("castling through check is illegal, queenside still legal", () => {
    const board = new Chess("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1");
    const uci = legalMovesUci(board);
    expect(uci).not.toContain("e1g1");
    expect(uci).toContain("e1c1");
  });

  it("castling into check is illegal", () => {
    const board = new Chess("3rk2r/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    const uci = legalMovesUci(board);
    expect(uci).not.toContain("e1c1");
    expect(uci).toContain("e1g1");
  });

  it("en passant", () => {
    const board = replay(["e2e4", "a7a6", "e4e5", "d7d5"]);
    expect(legalMovesUci(board)).toContain("e5d6");
    board.move("e5d6");
    expect(board.get("d5")).toBeUndefined();
  });

  it("promotion required and valid", () => {
    const board = new Chess("8/P7/8/8/8/8/k6K/8 w - - 0 1");
    expect(legalMovesUci(board)).not.toContain("a7a8");
    expect(legalMovesUci(board)).toContain("a7a8q");
    expect(promotionMoves(board, "a7", "a8").length).toBe(4);
  });

  it("replay keeps castling rights", () => {
    const board = replay(["e2e4", "e7e5", "g1f3", "b8c6"]);
    expect(board.get("e1")).toMatchObject({ type: "k", color: "w" });
    // FEN castling field still KQkq (both kingside rights intact).
    expect(board.fen().split(" ")[2]).toBe("KQkq");
    // And castling is actually legal once the pieces are out of the way.
    const open = replay(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"]);
    expect(legalMovesUci(open)).toContain("e1g1");
  });
});

describe("repetition map (chess.js cannot do this from FEN)", () => {
  it("chess.js threefold is false after load() — the map is what counts", () => {
    const board = new Chess();
    board.load("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(board.isThreefoldRepetition()).toBe(false);
    expect(typeof board.isFivefoldRepetition).toBe("undefined");
    expect(typeof board.isSeventyFiveMoveRule).toBe("undefined");
  });

  it("threefold is claimable, not automatic", () => {
    const moves = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
    const board = replay(moves);
    const counts = positionCountsFor(moves);
    const t = terminalAndClaimable(board, counts);
    expect(t.status).toBe(null);
    expect(t.claimable).toContain("threefold");
  });

  it("fifty-move is claimable from the FEN half-move clock", () => {
    const board = new Chess("7k/8/8/8/8/8/8/K6R w - - 100 51");
    expect(halfmoveClock(board.fen())).toBe(100);
    const t = terminalAndClaimable(board, {});
    expect(t.status).toBe(null);
    expect(t.claimable).toContain("fifty");
  });

  it("fivefold is an automatic draw via the map", () => {
    const moves = ["g1f3", "g8f6", "f3g1", "f6g8"].map((m) => m);
    const repeated = [...moves, ...moves, ...moves, ...moves]; // position occurs 5x
    const board = replay(repeated);
    const counts = positionCountsFor(repeated);
    expect(counts[trimmedFen(board.fen())]).toBe(5);
    expect(terminalAndClaimable(board, counts)).toMatchObject({
      status: "finished", result: "draw", resultReason: "fivefold",
    });
  });

  it("75-move is an automatic draw from the FEN half-move clock", () => {
    const board = new Chess("7k/8/8/8/8/8/8/K6R w - - 150 76");
    expect(halfmoveClock(board.fen())).toBe(150);
    expect(terminalAndClaimable(board, {})).toMatchObject({
      status: "finished", result: "draw", resultReason: "seventyfive",
    });
  });

  it("takeback recompute drops the counts (no phantom threefold)", () => {
    // Knight shuffle to threefold, then truncate the last 2 plies: the
    // position now occurs twice, not three times.
    const moves = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
    const full = positionCountsFor(moves);
    const board = replay(moves);
    expect(terminalAndClaimable(board, full).claimable).toContain("threefold");
    const truncated = positionCountsFor(moves.slice(0, 6));
    const board2 = replay(moves.slice(0, 6));
    expect(terminalAndClaimable(board2, truncated).claimable).not.toContain("threefold");
  });

  it("trimmed FEN ignores the move clocks", () => {
    expect(trimmedFen("7k/8/8/8/8/8/8/K6R w - - 100 51")).toBe("7k/8/8/8/8/8/8/K6R w - -");
    expect(trimmedFen(START_FEN)).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
    expect(initialPositionCounts()[trimmedFen(START_FEN)]).toBe(1);
  });
});

describe("takebackPlies", () => {
  const mv = (by, byColor) => ({ uci: "e2e4", san: "e4", by, by_color: byColor });
  it("null with no moves", () => {
    expect(takebackPlies([], "w")).toBe(null);
  });
  it("1 ply when the requester just moved", () => {
    expect(takebackPlies([mv("p1", "w")], "w")).toBe(1);
  });
  it("2 plies when the opponent replied", () => {
    expect(takebackPlies([mv("p1", "w"), mv("p2", "b")], "w")).toBe(2);
  });
  it("1 ply for a single opponent move", () => {
    expect(takebackPlies([mv("p2", "b")], "w")).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { parseFen, pieceAt, applyMoveToFen } from "./fen.js";

describe("parseFen", () => {
  it("parses the start position", () => {
    const b = parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(b[0][0]).toEqual({ type: "r", color: "b" }); // a8 black rook
    expect(b[0][4]).toEqual({ type: "k", color: "b" }); // e8 black king
    expect(b[7][4]).toEqual({ type: "k", color: "w" }); // e1 white king
    expect(b[6][4]).toEqual({ type: "p", color: "w" }); // e2 white pawn
    expect(b[3][4]).toBeNull(); // e5 empty
  });

  it("parses a castling FEN with empty squares and digits", () => {
    const b = parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(b[0][0]).toEqual({ type: "r", color: "b" });
    expect(b[0][1]).toBeNull();
    expect(b[0][4]).toEqual({ type: "k", color: "b" });
    expect(b[7][7]).toEqual({ type: "r", color: "w" });
    expect(b[4].every((c) => c === null)).toBe(true);
  });

  it("parses a mid-game FEN", () => {
    const b = parseFen("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    expect(pieceAt(b, "e4")).toEqual({ type: "p", color: "w" });
    expect(pieceAt(b, "e5")).toEqual({ type: "p", color: "b" });
    expect(pieceAt(b, "e2")).toBeNull();
    expect(pieceAt(b, "a1")).toEqual({ type: "r", color: "w" });
  });

  it("tolerates a bare placement string", () => {
    const b = parseFen("8/8/8/8/8/8/8/8");
    expect(b.flat().every((c) => c === null)).toBe(true);
  });
});

describe("applyMoveToFen", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  it("pawn double-step flips the turn; no en-passant square when no enemy pawn can capture", () => {
    // chess.js's convention (the server's FENs follow it): the square is
    // recorded only when an enemy pawn stands beside the landing square.
    expect(applyMoveToFen(START, "e2", "e4")).toBe(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    );
  });

  it("pawn double-step sets the en-passant square when an enemy pawn can capture", () => {
    const fen = "rnbqkbnr/pppppppp/8/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2";
    expect(applyMoveToFen(fen, "d7", "d5")).toBe(
      "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3",
    );
  });

  it("knight move keeps castling rights, bumps the halfmove clock", () => {
    expect(applyMoveToFen(START, "g1", "f3")).toBe(
      "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1",
    );
  });

  it("capture resets the halfmove clock", () => {
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    expect(applyMoveToFen(fen, "e4", "d5")).toBe(
      "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2",
    );
  });

  it("castling moves the rook too and drops both rights", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 4 4";
    expect(applyMoveToFen(fen, "e1", "g1")).toBe(
      "r3k2r/8/8/8/8/8/8/R4RK1 b kq - 5 4",
    );
    expect(applyMoveToFen(fen, "e1", "c1")).toBe(
      "r3k2r/8/8/8/8/8/8/2KR3R b kq - 5 4",
    );
    expect(applyMoveToFen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 4 4", "e8", "g8")).toBe(
      "r4rk1/8/8/8/8/8/8/R3K2R w KQ - 5 5",
    );
  });

  it("rook leaving its home square drops only that castling right", () => {
    expect(applyMoveToFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "a1", "a3")).toBe(
      "r3k2r/8/8/8/8/R7/8/4K2R b Kkq - 1 1",
    );
  });

  it("en passant removes the captured pawn", () => {
    // Black just played d7-d5; white pawn on e5 takes en passant.
    const fen = "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3";
    expect(applyMoveToFen(fen, "e5", "d6")).toBe(
      "rnbqkbnr/ppp1pppp/3P4/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3",
    );
  });

  it("promotion places the chosen piece", () => {
    const fen = "8/P7/8/8/8/8/k6K/8 w - - 0 1";
    expect(applyMoveToFen(fen, "a7", "a8", "q")).toBe(
      "Q7/8/8/8/8/8/k6K/8 b - - 0 1",
    );
    expect(applyMoveToFen(fen, "a7", "a8", "n")).toBe(
      "N7/8/8/8/8/8/k6K/8 b - - 0 1",
    );
  });

  it("black's move bumps the fullmove number", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    expect(applyMoveToFen(fen, "e7", "e5")).toBe(
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    );
  });

  it("returns null for malformed input", () => {
    expect(applyMoveToFen("", "e2", "e4")).toBeNull();
    expect(applyMoveToFen(START, "e2", "e9")).toBeNull();
    expect(applyMoveToFen(START, "e3", "e4")).toBeNull(); // no piece there
    expect(applyMoveToFen(START, "e7", "e5")).toBeNull(); // not black's turn
  });
});

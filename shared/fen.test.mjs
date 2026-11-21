import { describe, it, expect } from "vitest";
import { parseFen, pieceAt } from "./fen.js";

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

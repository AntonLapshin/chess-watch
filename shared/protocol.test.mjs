import { describe, it, expect } from "vitest";
import { fakeInitialState, errorMessage, positionChanged, optimisticState } from "./protocol.js";

describe("fakeInitialState", () => {
  it("uses built-in defaults without names", () => {
    const s = fakeInitialState("p1");
    expect(s.you.name).toBe("Aurora");
    expect(s.opponent.name).toBe("Sam");
  });

  it("uses supplied .env names when given", () => {
    const names = { p1: "Dad", p2: "Emma" };
    const s1 = fakeInitialState("p1", names);
    expect(s1.you.name).toBe("Dad");
    expect(s1.opponent.name).toBe("Emma");
    const s2 = fakeInitialState("p2", names);
    expect(s2.you.name).toBe("Emma");
    expect(s2.opponent.name).toBe("Dad");
  });
});

describe("errorMessage", () => {
  it("maps server error codes", () => {
    expect(errorMessage("unauthorized")).toBe("Not authorized");
    expect(errorMessage("network")).toBe("No connection to server");
  });

  it("maps ZML BLE-transport codes (page never reached the side service)", () => {
    // Numeric codes straight from zml-side.js MessageBuilder.
    expect(errorMessage(1)).toBe("No link to phone — side service did not answer");
    expect(errorMessage(2)).toBe("Bluetooth disconnected");
    expect(errorMessage(4)).toBe("Request timed out");
    // ... and the same failures surfaced only as a message string.
    expect(errorMessage("unknown", "shake timeout")).toBe("No link to phone — side service did not answer");
    expect(errorMessage("unknown", "ble disconnect")).toBe("Bluetooth disconnected");
  });

  it("turns a bare HTTP status into a readable line", () => {
    expect(errorMessage("http_403")).toBe("Server answered 403");
    expect(errorMessage("http_401")).toBe("Server answered 401");
  });
});

describe("positionChanged", () => {
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const E4_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
  const start = (over = {}) => ({
    revision: 0, game_no: 1,
    game: { ply: 0, fen: START_FEN, status: "active", ...over },
  });

  it("identical states (a poll timeout returning the same position) are not a change", () => {
    expect(positionChanged(start(), start())).toBe(false);
    // Same position, newer revision only (e.g. presence-only refresh).
    expect(positionChanged(start(), { ...start(), revision: 3 })).toBe(false);
    // Same position, offer attached/detached is not a position change.
    expect(positionChanged(start(), start({ offer: { type: "offer_draw", by: "p2" } }))).toBe(false);
  });

  it("a move changes the position", () => {
    expect(positionChanged(start(), start({ ply: 1, fen: E4_FEN }))).toBe(true);
  });

  it("a restart (new game_no) changes the position even at ply 0", () => {
    expect(positionChanged(start(), { ...start(), game_no: 2 })).toBe(true);
  });

  it("a status change (game over) changes the position", () => {
    expect(positionChanged(start(), start({ status: "finished" }))).toBe(true);
  });

  it("no previous state counts as changed", () => {
    expect(positionChanged(null, start())).toBe(true);
    expect(positionChanged(undefined, start())).toBe(true);
  });
});

describe("optimisticState", () => {
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  function startState() {
    const s = fakeInitialState("p1");
    delete s._offline;
    s.game.legal_moves = ["e2e3", "e2e4", "g1f3"];
    return s;
  }

  it("applies the move locally: FEN, turn, ply, last move; clears legal moves", () => {
    const next = optimisticState(startState(), "e2", "e4", null);
    expect(next).not.toBeNull();
    // Byte-identical to the server's chess.js FEN for the same move.
    expect(next.game.fen).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    expect(next.game.turn).toBe("b");
    expect(next.game.ply).toBe(1);
    expect(next.game.last_move).toEqual({ from: "e2", to: "e4", san: null, by: "p1" });
    expect(next.game.legal_moves).toEqual([]);
    expect(next.game.check).toBe(false);
    expect(next.revision).toBe(0); // revision only moves when the server answers
    // The original state is untouched.
    expect(startState().game.fen).toBe(START_FEN);
  });

  it("the confirming server state matches the optimistic one (no jump)", () => {
    const opt = optimisticState(startState(), "e2", "e4", null);
    const confirmed = startState();
    confirmed.game.fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    confirmed.game.turn = "b";
    confirmed.game.ply = 1;
    expect(positionChanged(opt, confirmed)).toBe(false);
  });

  it("handles promotion", () => {
    const s = startState();
    s.game.fen = "8/P7/8/8/8/8/k6K/8 w - - 0 1";
    const next = optimisticState(s, "a7", "a8", "q");
    expect(next.game.fen).toBe("Q7/8/8/8/8/8/k6K/8 b - - 0 1");
  });

  it("returns null for a move that cannot be applied locally", () => {
    expect(optimisticState(startState(), "e3", "e4", null)).toBeNull(); // no piece
    expect(optimisticState(startState(), "e7", "e5", null)).toBeNull(); // not our turn
    expect(optimisticState({ game: {} }, "e2", "e4", null)).toBeNull();
  });
});

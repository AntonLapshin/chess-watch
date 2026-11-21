// Action tests: restart, takeback,
// resign, draw agreement, claim draw. Repetition claims go through the
// persisted map: fivefold auto-draw and the takeback-changing-counts case
// are exercised here at the API level (75-move / 50-move from a bare FEN
// are covered in tests/rules.test.mjs — they cannot be reached from the
// start position in a reasonable number of API moves).
import { describe, it, expect } from "vitest";
import { makeGame, state, play, action } from "./helpers.mjs";

describe("restart", () => {
  it("accept and decline", async () => {
    const { game } = makeGame();
    let s = await play(game, "p1", 0, "e2e4", "r1");
    let r = await action(game, "p1", s.revision, "offer_restart", "r2");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game.offer.type).toBe("offer_restart");
    // Offerer cannot accept their own offer.
    r = await action(game, "p1", s.revision, "accept", "r3");
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("not_recipient");
    // Opponent declines.
    r = await action(game, "p2", s.revision, "decline", "r4");
    expect(r.status).toBe(200);
    expect(r.data.game.offer).toBe(null);
    expect(r.data.game.ply).toBe(1);
    // Offer again, opponent accepts: board resets, game_no increments.
    s = r.data;
    r = await action(game, "p1", s.revision, "offer_restart", "r5");
    s = r.data;
    r = await action(game, "p2", s.revision, "accept", "r6");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game_no).toBe(2);
    expect(s.game.ply).toBe(0);
    expect(s.game.status).toBe("active");
    expect(s.game.fen).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w/);
  });
});

describe("takeback", () => {
  it("one ply when the requester just moved", async () => {
    const { game } = makeGame();
    let s = await play(game, "p1", 0, "e2e4", "t1");
    let r = await action(game, "p1", s.revision, "offer_takeback", "t2");
    expect(r.status).toBe(200);
    s = r.data;
    r = await action(game, "p2", s.revision, "accept", "t3");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game.ply).toBe(0);
    expect(s.game.turn).toBe("w");
  });

  it("two plies when the opponent replied", async () => {
    const { game } = makeGame();
    let s = await play(game, "p1", 0, "e2e4", "t2-1");
    s = await play(game, "p2", s.revision, "e7e5", "t2-2");
    let r = await action(game, "p1", s.revision, "offer_takeback", "t2-3");
    expect(r.status).toBe(200);
    s = r.data;
    r = await action(game, "p2", s.revision, "accept", "t2-4");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game.ply).toBe(0);
    expect(s.game.turn).toBe("w");
  });

  it("unavailable at game start", async () => {
    const { game } = makeGame();
    const s = await state(game, "p1");
    const r = await action(game, "p1", s.revision, "offer_takeback", "tu1");
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("takeback_unavailable");
  });

  it("rejected after game over", async () => {
    const { game } = makeGame();
    let s = await play(game, "p1", 0, "f2f3", "tg1");
    s = await play(game, "p2", s.revision, "e7e5", "tg2");
    s = await play(game, "p1", s.revision, "g2g4", "tg3");
    s = await play(game, "p2", s.revision, "d8h4", "tg4");
    expect(s.game.status).toBe("finished");
    const r = await action(game, "p1", s.revision, "offer_takeback", "tg5");
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("game_over");
  });

  it("takeback drops the repetition counts (no phantom threefold)", async () => {
    const { game } = makeGame();
    // Knight shuffle to threefold: Ng1-f3-g1 / Ng8-f6-g8 twice.
    const moves = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
    let s = await state(game, "p1");
    for (let i = 0; i < moves.length; i++) {
      s = await play(game, i % 2 === 0 ? "p1" : "p2", s.revision, moves[i], `tb${i}`);
    }
    expect(s.game.claimable).toContain("threefold");
    // White offers takeback (opponent replied, so 2 plies revert).
    let r = await action(game, "p1", s.revision, "offer_takeback", "tb-offer");
    s = r.data;
    r = await action(game, "p2", s.revision, "accept", "tb-accept");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game.ply).toBe(6);
    expect(s.game.claimable).not.toContain("threefold");
  });
});

describe("resign and draw", () => {
  it("resign is immediate", async () => {
    const { game } = makeGame();
    let s = await play(game, "p1", 0, "e2e4", "rs1");
    const r = await action(game, "p1", s.revision, "resign", "rs2");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game.status).toBe("finished");
    expect(s.game.result).toBe("b");
    expect(s.game.result_reason).toBe("resign");
    expect(s.game.last_action.type).toBe("resign");
  });

  it("draw agreement", async () => {
    const { game } = makeGame();
    let s = await play(game, "p1", 0, "e2e4", "d1");
    let r = await action(game, "p1", s.revision, "offer_draw", "d2");
    s = r.data;
    r = await action(game, "p2", s.revision, "accept", "d3");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game.status).toBe("finished");
    expect(s.game.result).toBe("draw");
    expect(s.game.result_reason).toBe("agreement");
  });

  it("claim draw (threefold)", async () => {
    const { game } = makeGame();
    const moves = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
    let s = await state(game, "p1");
    for (let i = 0; i < moves.length; i++) {
      s = await play(game, i % 2 === 0 ? "p1" : "p2", s.revision, moves[i], `cd${i}`);
    }
    expect(s.game.claimable).toContain("threefold");
    expect(s.game.turn).toBe("w");
    const r = await action(game, "p1", s.revision, "claim_draw", "cd-claim", "threefold");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game.status).toBe("finished");
    expect(s.game.result).toBe("draw");
    expect(s.game.result_reason).toBe("threefold_claim");
  });

  it("invalid claim", async () => {
    const { game } = makeGame();
    const s = await state(game, "p1");
    let r = await action(game, "p1", s.revision, "claim_draw", "ci1", "threefold");
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("invalid_claim");
    r = await action(game, "p2", s.revision, "claim_draw", "ci2", "fifty");
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("invalid_claim");
  });

  it("fivefold repetition is an automatic draw through the API", async () => {
    const { game } = makeGame();
    const moves = ["g1f3", "g8f6", "f3g1", "f6g8"];
    let s = await state(game, "p1");
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let i = 0; i < moves.length; i++) {
        s = await play(game, i % 2 === 0 ? "p1" : "p2", s.revision, moves[i], `ff${cycle}-${i}`);
      }
    }
    expect(s.game.status).toBe("finished");
    expect(s.game.result).toBe("draw");
    expect(s.game.result_reason).toBe("fivefold");
  });

  it("duplicate action id and revision conflict", async () => {
    const { game } = makeGame();
    const s0 = await state(game, "p1");
    let r = await action(game, "p1", s0.revision, "offer_draw", "ad1");
    expect(r.status).toBe(200);
    const s = r.data;
    r = await action(game, "p1", 0, "offer_draw", "ad1"); // same id, stale revision
    expect(r.status).toBe(200);
    expect(r.data.duplicate).toBe(true);
    r = await action(game, "p2", 0, "decline", "ad2"); // stale revision, new id
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("revision_conflict");
    expect(r.data.state.revision).toBe(s.revision);
  });

  it("unknown action type is 422", async () => {
    const { game } = makeGame();
    const s = await state(game, "p1");
    const r = await action(game, "p1", s.revision, "dance", "bad-type");
    expect(r.status).toBe(422);
    expect(r.data.code).toBe("invalid_request");
  });
});

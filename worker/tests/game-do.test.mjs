// API tests: auth (via DO role header),
// turns, revisions, idempotency, long-poll, offers. The DO trusts the
// x-chess-role header the Worker sets after Bearer auth; Worker-level auth
// is covered in tests/index.test.mjs.
import { describe, it, expect } from "vitest";
import { ChessGame } from "../src/game-do.js";
import { makeGame, state, move, play, action, call } from "./helpers.mjs";

describe("state", () => {
  it("initial state shape", async () => {
    const { game } = makeGame();
    const s = await state(game, "p1");
    expect(s.revision).toBe(0);
    expect(s.you).toEqual({ role: "p1", color: "w", name: "Aurora" });
    expect(s.opponent.name).toBe("Sam");
    expect(s.game.status).toBe("active");
    expect(s.game.turn).toBe("w");
    expect(s.game.fen).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w/);
    expect(s.game.legal_moves.length).toBe(20);
    expect(s.game.recent_moves).toEqual([]);
    const s2 = await state(game, "p2");
    expect(s2.game.legal_moves).toEqual([]);
  });

  it("rejects a missing role header (Worker auth fills it)", async () => {
    const { game } = makeGame();
    const res = await game.fetch(new Request("http://test/api/v1/state"));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unauthorized");
  });

  it("marks presence: opponent online within 45 s", async () => {
    const { game } = makeGame();
    await state(game, "p2");
    const s = await state(game, "p1");
    expect(s.opponent.online).toBe(true);
  });

  it("unknown endpoint is 404", async () => {
    const { game } = makeGame();
    const r = await call(game, "/api/v1/nope", "p1");
    expect(r.status).toBe(404);
  });
});

describe("moves", () => {
  it("wrong turn", async () => {
    const { game } = makeGame();
    const r = await move(game, "p2", 0, "e7", "e5", { cid: "w1" });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("not_your_turn");
  });

  it("revision conflict includes current state", async () => {
    const { game } = makeGame();
    const r = await move(game, "p1", 99, "e2", "e4", { cid: "c1" });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("revision_conflict");
    expect(r.data.state.revision).toBe(0);
  });

  it("illegal move and promotion required", async () => {
    const { game } = makeGame();
    const r = await move(game, "p1", 0, "e2", "e5", { cid: "i1" });
    expect(r.status).toBe(422);
    expect(r.data.code).toBe("illegal_move");
    // 1.a4 b5 2.axb5 h5 3.b6 h4 4.b7 h3, then b7xc8=Q.
    let s = await play(game, "p1", 0, "a2a4", "p-a1");
    s = await play(game, "p2", s.revision, "b7b5", "p-b1");
    s = await play(game, "p1", s.revision, "a4b5", "p-a2");
    s = await play(game, "p2", s.revision, "h7h5", "p-b2");
    s = await play(game, "p1", s.revision, "b5b6", "p-a3");
    s = await play(game, "p2", s.revision, "h5h4", "p-b3");
    s = await play(game, "p1", s.revision, "b6b7", "p-a4");
    s = await play(game, "p2", s.revision, "h4h3", "p-b4");
    const noPiece = await move(game, "p1", s.revision, "b7", "c8", { cid: "promo1" });
    expect(noPiece.status).toBe(422);
    expect(noPiece.data.code).toBe("promotion_required");
    const ok = await move(game, "p1", s.revision, "b7", "c8", { promotion: "q", cid: "promo2" });
    expect(ok.status).toBe(200);
    expect(ok.data.game.fen.split(" ")[0].startsWith("rnQqkbnr")).toBe(true);
  });

  it("duplicate client_move_id returns current state, changes nothing", async () => {
    const { game } = makeGame();
    const s = await play(game, "p1", 0, "e2e4", "dup-1");
    expect(s.duplicate).toBe(false);
    const r = await move(game, "p1", 0, "e2", "e4", { cid: "dup-1" }); // stale revision, same id
    expect(r.status).toBe(200);
    expect(r.data.duplicate).toBe(true);
    expect(r.data.revision).toBe(s.revision);
  });

  it("move after game over (fool's mate)", async () => {
    const { game } = makeGame();
    let s = await play(game, "p1", 0, "f2f3", "fm1");
    s = await play(game, "p2", s.revision, "e7e5", "fm2");
    s = await play(game, "p1", s.revision, "g2g4", "fm3");
    s = await play(game, "p2", s.revision, "d8h4", "fm4");
    expect(s.game.status).toBe("finished");
    expect(s.game.result).toBe("b");
    expect(s.game.result_reason).toBe("checkmate");
    const r = await move(game, "p1", s.revision, "e2", "e4", { cid: "fm5" });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("game_over");
  });

  it("invalid square is an illegal move", async () => {
    const { game } = makeGame();
    const r = await move(game, "p1", 0, "e9", "e4", { cid: "bad1" });
    expect(r.status).toBe(422);
    expect(r.data.code).toBe("illegal_move");
  });

  it("malformed body is 422 invalid_request", async () => {
    const { game } = makeGame();
    const r = await call(game, "/api/v1/move", "p1", {
      method: "POST",
      body: { client_move_id: "x" }, // missing expected_revision/from/to
    });
    expect(r.status).toBe(422);
    expect(r.data.code).toBe("invalid_request");
  });
});

describe("long-poll", () => {
  it("timeout returns the same revision after ~wait", async () => {
    const { game } = makeGame();
    const t0 = Date.now();
    const s = await state(game, "p1", { since: 0, wait: 1 });
    const dt = Date.now() - t0;
    expect(s.revision).toBe(0);
    expect(dt).toBeGreaterThanOrEqual(800);
    expect(dt).toBeLessThan(3000);
  });

  it("a move wakes a waiting poll", async () => {
    const { game } = makeGame();
    const polling = state(game, "p2", { since: 0, wait: 10 });
    await new Promise((r) => setTimeout(r, 200));
    const s = await play(game, "p1", 0, "e2e4", "lp1");
    expect(s.revision).toBe(1);
    const got = await polling;
    expect(got.revision).toBe(1);
    expect(got.game.last_move.san).toBe("e4");
  });

  it("omitting since returns an immediate snapshot", async () => {
    const { game } = makeGame();
    const t0 = Date.now();
    const s = await state(game, "p1");
    expect(s.revision).toBe(0);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("offers", () => {
  it("offer, pending, decline, no_offer", async () => {
    const { game } = makeGame();
    let s = await state(game, "p1");
    let r = await action(game, "p1", s.revision, "offer_draw", "od1");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game.offer.type).toBe("offer_draw");
    expect(s.game.offer.by).toBe("p1");
    r = await action(game, "p2", s.revision, "offer_draw", "od2");
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("offer_pending");
    r = await action(game, "p2", s.revision, "decline", "od3");
    expect(r.status).toBe(200);
    s = r.data;
    expect(s.game.offer).toBe(null);
    expect(s.game.last_action.type).toBe("offer_declined");
    r = await action(game, "p2", s.revision, "decline", "od4");
    expect(r.status).toBe(409);
    expect(r.data.code).toBe("no_offer");
  });

  it("offer carries a ~120 s expiry and arms an alarm", async () => {
    const { game, alarms } = makeGame();
    const s = await state(game, "p1");
    const r = await action(game, "p1", s.revision, "offer_draw", "ox1");
    expect(r.status).toBe(200);
    const offer = r.data.game.offer;
    expect(offer.expires_at - r.data.server_time).toBeGreaterThan(100);
    expect(alarms.length).toBe(1);
    expect(alarms[0]).toBeGreaterThan(Date.now());
  });

  it("expired offer clears lazily on read with offer_expired", async () => {
    const { game } = makeGame();
    let s = await state(game, "p1");
    let r = await action(game, "p1", s.revision, "offer_draw", "ex1");
    expect(r.status).toBe(200);
    const revBefore = r.data.revision;
    // Force expiry: the live DO holds state in memory (storage is only
    // read on cold start), so poke the in-memory offer.
    game.game.offer.expires_at = Date.now() / 1000 - 1;
    s = await state(game, "p1");
    expect(s.game.offer).toBe(null);
    expect(s.revision).toBe(revBefore + 1);
    expect(s.game.last_action.type).toBe("offer_expired");
  });

  it("alarm() clears an expired offer and bumps the revision", async () => {
    const { game } = makeGame();
    let s = await state(game, "p1");
    const r = await action(game, "p1", s.revision, "offer_draw", "al1");
    const revBefore = r.data.revision;
    game.game.offer.expires_at = Date.now() / 1000 - 1;
    await game.alarm();
    s = await state(game, "p1");
    expect(s.game.offer).toBe(null);
    expect(s.revision).toBe(revBefore + 1);
    expect(s.game.last_action.type).toBe("offer_expired");
  });

  it("cold start reloads the game from SQLite (DO eviction)", async () => {
    const { game, sql } = makeGame();
    let s = await play(game, "p1", 0, "e2e4", "ev1");
    expect(s.game.ply).toBe(1);
    // A new ChessGame over the same storage = the DO after eviction.
    const freshCtx = { storage: { sql, setAlarm: () => {} } };
    const fresh = new ChessGame(freshCtx, { CHESS_P1_NAME: "Aurora", CHESS_P2_NAME: "Sam" });
    const reloaded = await state(fresh, "p2");
    expect(reloaded.revision).toBe(1);
    expect(reloaded.game.ply).toBe(1);
    expect(reloaded.game.fen).toBe(s.game.fen);
    expect(reloaded.game.last_move.san).toBe("e4");
    // And it keeps working: black replies on the reloaded instance.
    const s2 = await play(fresh, "p2", 1, "e7e5", "ev2");
    expect(s2.game.ply).toBe(2);
  });
});

// Integration test: runs the real Worker + Durable Object (real workerd
// SQLite) through @cloudflare/vitest-plugin. Run with:
//   npm run test:workers
// Test-only bearer tokens come from test-config/wrangler.test.toml (fake values,
// never real secrets).
import { describe, it, expect } from "vitest";
import { env, SELF, runDurableObjectAlarm } from "cloudflare:test";

const P1 = { Authorization: "Bearer test-token-p1-0000000000000001" };
const P2 = { Authorization: "Bearer test-token-p2-0000000000000002" };

async function state(headers, params = "") {
  const res = await SELF.fetch(`https://chess.test/api/v1/state${params}`, { headers });
  expect(res.status).toBe(200);
  return res.json();
}

async function move(headers, rev, from, to, cid, promotion = null) {
  const res = await SELF.fetch("https://chess.test/api/v1/move", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ client_move_id: cid, expected_revision: rev, from, to, promotion }),
  });
  return { status: res.status, data: await res.json() };
}

async function action(headers, rev, type, cid, claim) {
  const body = { client_action_id: cid, expected_revision: rev, type };
  if (claim) body.claim = claim;
  const res = await SELF.fetch("https://chess.test/api/v1/action", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

// Storage is shared across the tests in this file (one DO instance per
// file), so the tests below are ordered to build on a single game: shape,
// auth, then the full flow (which also covers duplicate move ids).
describe("worker + DO integration (real workerd SQLite)", () => {
  it("health, no auth", async () => {
    const res = await SELF.fetch("https://chess.test/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "0.2.1" });
  });

  it("state shape and names come from Worker vars", async () => {
    const s = await state(P1);
    expect(s.revision).toBe(0);
    expect(s.you).toEqual({ role: "p1", color: "w", name: "Aurora" });
    expect(s.opponent.name).toBe("Sam");
    expect(s.game.legal_moves.length).toBe(20);
  });

  it("unauthenticated state is 401", async () => {
    const res = await SELF.fetch("https://chess.test/api/v1/state");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unauthorized");
  });

  it("full flow: e4, duplicate id, long-poll wake, offer, decline, resign", async () => {
    const polling = state(P2, "?since=0&wait=10");
    await new Promise((r) => setTimeout(r, 200));
    const m = await move(P1, 0, "e2", "e4", "int-1");
    expect(m.status).toBe(200);
    expect(m.data.game.ply).toBe(1);
    // Same client_move_id again: idempotent, current state, no new move.
    const dup = await move(P1, 0, "e2", "e4", "int-1");
    expect(dup.status).toBe(200);
    expect(dup.data.duplicate).toBe(true);
    expect(dup.data.revision).toBe(m.data.revision);
    const woken = await polling;
    expect(woken.revision).toBe(1);
    expect(woken.game.last_move.san).toBe("e4");

    const m2 = await move(P2, 1, "e7", "e5", "int-2");
    expect(m2.status).toBe(200);
    const offer = await action(P1, 2, "offer_draw", "int-3");
    expect(offer.status).toBe(200);
    expect(offer.data.game.offer.type).toBe("offer_draw");
    const decline = await action(P2, 3, "decline", "int-4");
    expect(decline.status).toBe(200);
    expect(decline.data.game.offer).toBe(null);

    // Offer expiry via the real DO alarm: offer again, then run the alarm.
    const offer2 = await action(P1, 4, "offer_draw", "int-5");
    expect(offer2.status).toBe(200);
    const stub = env.CHESS_GAME.get(env.CHESS_GAME.idFromName("game"));
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const after = await state(P1);
    // Alarm fired before expiry (offer still has ~120 s left), so it must
    // NOT have cleared the offer.
    expect(after.game.offer).not.toBe(null);
    expect(after.game.offer.type).toBe("offer_draw");

    const resign = await action(P2, after.revision, "resign", "int-6");
    expect(resign.status).toBe(200);
    expect(resign.data.game.status).toBe("finished");
    expect(resign.data.game.result).toBe("w");
    expect(resign.data.game.result_reason).toBe("resign");
  });

});

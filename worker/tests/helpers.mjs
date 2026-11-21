// Shared helpers for the Durable Object unit tests: build a fresh
// ChessGame over FakeSql and drive it through fetch(), mirroring
// server/tests/conftest.py.
import { ChessGame } from "../src/game-do.js";
import { fakeCtx } from "./fake-sql.mjs";

export const P1_TOKEN = "test-token-p1-0000000000000001";
export const P2_TOKEN = "test-token-p2-0000000000000002";

export function makeGame(envOverrides) {
  const { ctx, sql, alarms } = fakeCtx();
  const env = {
    CHESS_P1_NAME: "Aurora",
    CHESS_P2_NAME: "Sam",
    CHESS_OFFER_TTL: "120",
    ...(envOverrides || {}),
  };
  const game = new ChessGame(ctx, env);
  return { game, sql, alarms };
}

function req(path, role, { method = "GET", body } = {}) {
  return new Request(`http://test${path}`, {
    method,
    headers: {
      "x-chess-role": role,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function call(game, path, role, opts) {
  const res = await game.fetch(req(path, role, opts));
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

export async function state(game, role, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await call(game, `/api/v1/state${qs ? `?${qs}` : ""}`, role);
  if (r.status !== 200) throw new Error(`state failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

export async function move(game, role, rev, from, to, { promotion = null, cid = "m1" } = {}) {
  return call(game, "/api/v1/move", role, {
    method: "POST",
    body: { client_move_id: cid, expected_revision: rev, from, to, promotion },
  });
}

/** Play one UCI move (with promotion letter if present); return new state. */
export async function play(game, role, rev, uci, cid) {
  const r = await move(game, role, rev, uci.slice(0, 2), uci.slice(2, 4), {
    promotion: uci.length === 5 ? uci[4] : null,
    cid,
  });
  if (r.status !== 200) throw new Error(`play ${uci} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

export async function action(game, role, rev, type, cid, claim) {
  const body = { client_action_id: cid, expected_revision: rev, type };
  if (claim) body.claim = claim;
  return call(game, "/api/v1/action", role, { method: "POST", body });
}

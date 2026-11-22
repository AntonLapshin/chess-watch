// Fake ctx.storage.sql for Durable Object unit tests: implements the
// exact statements store.js issues, over in-memory JS tables. NOT a SQL
// engine — it pattern-matches the canonical statements only. The
// integration test (tests/integration.test.mjs, workers pool) runs the
// same code against real workerd SQLite.
export class FakeSql {
  constructor() {
    this.gamesRow = null;
    this.moves = []; // { game_id, game_no, ply, uci, san, by_role, fen_after, client_move_id, created_at }
    this.actions = []; // { client_action_id, type, actor, revision, payload_json, created_at }
  }

  exec(sql, ...params) {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("CREATE TABLE") || s.startsWith("INSERT OR IGNORE INTO meta")) return { toArray: () => [] };
    if (s === "SELECT * FROM games WHERE id = 1") {
      const out = this.gamesRow ? [{ ...this.gamesRow }] : [];
      return { toArray: () => out };
    }
    if (s === "SELECT * FROM moves WHERE client_move_id = ?") {
      const out = this.moves.filter((m) => m.client_move_id === params[0]).map((r) => ({ ...r }));
      return { toArray: () => out };
    }
    if (s === "SELECT * FROM actions WHERE client_action_id = ?") {
      const out = this.actions.filter((a) => a.client_action_id === params[0]).map((r) => ({ ...r }));
      return { toArray: () => out };
    }
    if (s.startsWith("INSERT INTO games")) {
      this.gamesRow = {
        id: 1,
        revision: 0,
        fen: params[0],
        moves_json: "[]",
        status: "active",
        result: null,
        result_reason: null,
        claimable_json: "[]",
        offer_json: null,
        last_action_json: null,
        game_no: 1,
        updated_at: params[1],
        positions_json: params[2],
      };
      return;
    }
    if (s.startsWith("UPDATE games SET")) {
      const g = this.gamesRow;
      [
        g.revision, g.fen, g.moves_json, g.status, g.result, g.result_reason,
        g.claimable_json, g.offer_json, g.last_action_json, g.game_no,
        g.updated_at, g.positions_json,
      ] = params;
      return;
    }
    if (s.startsWith("INSERT INTO moves")) {
      const [gameNo, ply, uci, san, byRole, fenAfter, clientMoveId, now] = params;
      this.moves.push({
        game_id: 1, game_no: gameNo, ply, uci, san, by_role: byRole,
        fen_after: fenAfter, client_move_id: clientMoveId, created_at: now,
      });
      return;
    }
    if (s.startsWith("DELETE FROM moves WHERE game_id = 1 AND game_no = ? AND ply > ?")) {
      const [gameNo, keep] = params;
      this.moves = this.moves.filter((m) => !(m.game_no === gameNo && m.ply > keep));
      return;
    }
    if (s.startsWith("DELETE FROM moves WHERE game_id = 1 AND game_no = ?")) {
      const [gameNo] = params;
      this.moves = this.moves.filter((m) => m.game_no !== gameNo);
      return;
    }
    if (s.startsWith("INSERT INTO actions")) {
      const [clientActionId, type, actor, revision, payloadJson, now] = params;
      this.actions.push({
        client_action_id: clientActionId, type, actor, revision,
        payload_json: payloadJson, created_at: now,
      });
      return;
    }
    throw new Error(`FakeSql.exec: unsupported statement: ${s.slice(0, 80)}`);
  }
}

/** Fake DurableObject ctx: { storage: { sql, setAlarm } }. */
export function fakeCtx() {
  const sql = new FakeSql();
  const alarms = [];
  return {
    sql,
    alarms,
    ctx: {
      storage: {
        sql,
        setAlarm: (ms) => {
          alarms.push(ms);
        },
      },
    },
  };
}

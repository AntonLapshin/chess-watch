// SQLite persistence for the ChessGame Durable Object, via
// ctx.storage.sql (exec with parameter binding — exec serves SELECTs too; there is no .query() in workerd SqlStorage).
//
// Schema: same table/column names as the 0.1.x backend (so the 0.2.0
// port stayed reviewable), plus one addition: games.positions_json, the
// persisted repetition map (trimmed FEN -> count) that chess.js cannot
// rebuild from a bare FEN (see src/rules.js). The single game row
// (games.id = 1), moves and actions tables with UNIQUE client ids for
// idempotency, and meta for the schema version are otherwise unchanged.
//
// All functions take the `sql` object (ctx.storage.sql) so unit tests can
// substitute a fake implementing the same exec interface.
import { START_FEN, initialPositionCounts } from "./rules.js";

export const SCHEMA_VERSION = "1";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  revision         INTEGER NOT NULL DEFAULT 0,
  fen              TEXT NOT NULL,
  moves_json       TEXT NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'active',
  result           TEXT,
  result_reason    TEXT,
  claimable_json   TEXT NOT NULL DEFAULT '[]',
  offer_json       TEXT,
  last_action_json TEXT,
  game_no          INTEGER NOT NULL DEFAULT 1,
  updated_at       REAL NOT NULL,
  positions_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS moves (
  game_id        INTEGER NOT NULL,
  game_no        INTEGER NOT NULL,
  ply            INTEGER NOT NULL,
  uci            TEXT NOT NULL,
  san            TEXT NOT NULL,
  by_role        TEXT NOT NULL,
  fen_after      TEXT NOT NULL,
  client_move_id TEXT NOT NULL UNIQUE,
  created_at     REAL NOT NULL,
  PRIMARY KEY (game_id, game_no, ply)
);

CREATE TABLE IF NOT EXISTS actions (
  client_action_id TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  actor            TEXT NOT NULL,
  revision         INTEGER NOT NULL,
  payload_json     TEXT NOT NULL DEFAULT '{}',
  created_at       REAL NOT NULL
);
`;

function rows(cursor) {
  if (!cursor) return [];
  if (typeof cursor.toArray === "function") return cursor.toArray();
  if (Array.isArray(cursor)) return cursor;
  return [...cursor];
}

export function ensureSchema(sql) {
  sql.exec(SCHEMA);
  sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)", SCHEMA_VERSION);
}

/** Load the single game row, creating it (start position, revision 0) if absent. */
export function loadGame(sql, now) {
  const found = rows(sql.exec("SELECT * FROM games WHERE id = 1"));
  if (found.length > 0) return found[0];
  sql.exec(
    `INSERT INTO games (id, revision, fen, moves_json, status, result,
       result_reason, claimable_json, offer_json, last_action_json,
       game_no, updated_at, positions_json)
     VALUES (1, 0, ?, '[]', 'active', NULL, NULL, '[]', NULL, NULL, 1, ?, ?)`,
    START_FEN,
    now,
    JSON.stringify(initialPositionCounts()),
  );
  return rows(sql.exec("SELECT * FROM games WHERE id = 1"))[0];
}

export function saveGame(sql, game) {
  sql.exec(
    `UPDATE games SET revision=?, fen=?, moves_json=?, status=?, result=?,
       result_reason=?, claimable_json=?, offer_json=?, last_action_json=?,
       game_no=?, updated_at=?, positions_json=? WHERE id = 1`,
    game.revision,
    game.fen,
    game.moves_json,
    game.status,
    game.result,
    game.result_reason,
    game.claimable_json,
    game.offer_json,
    game.last_action_json,
    game.game_no,
    game.updated_at,
    game.positions_json,
  );
}

export function findMoveByClientId(sql, clientMoveId) {
  const found = rows(sql.exec("SELECT * FROM moves WHERE client_move_id = ?", clientMoveId));
  return found.length > 0 ? found[0] : null;
}

export function findActionByClientId(sql, clientActionId) {
  const found = rows(
    sql.exec("SELECT * FROM actions WHERE client_action_id = ?", clientActionId),
  );
  return found.length > 0 ? found[0] : null;
}

export function insertMove(sql, { gameNo, ply, uci, san, byRole, fenAfter, clientMoveId, now }) {
  sql.exec(
    `INSERT INTO moves (game_id, game_no, ply, uci, san, by_role,
       fen_after, client_move_id, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    gameNo,
    ply,
    uci,
    san,
    byRole,
    fenAfter,
    clientMoveId,
    now,
  );
}

export function deleteMovesFromPly(sql, gameNo, keepPlies) {
  sql.exec("DELETE FROM moves WHERE game_id = 1 AND game_no = ? AND ply > ?", gameNo, keepPlies);
}

export function clearMoves(sql, gameNo) {
  sql.exec("DELETE FROM moves WHERE game_id = 1 AND game_no = ?", gameNo);
}

/** Drop all recorded action ids. Called on restart so action idempotency
 *  is per-game, like move idempotency (see clearMoves): the actions table
 *  is only consulted for duplicate detection, never for history (the last
 *  action lives on the games row), and a single global game means every
 *  stored action belongs to the game being restarted. */
export function clearActions(sql) {
  sql.exec("DELETE FROM actions");
}

export function insertAction(sql, { clientActionId, type, actor, revision, payload, now }) {
  sql.exec(
    `INSERT INTO actions (client_action_id, type, actor, revision,
       payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    clientActionId,
    type,
    actor,
    revision,
    JSON.stringify(payload || {}),
    now,
  );
}

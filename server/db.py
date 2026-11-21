"""SQLite storage (WAL, single row of game state + move/action logs).

One aiosqlite connection; writes are serialized by an asyncio.Lock so
idempotency checks and inserts stay atomic within the single worker.
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import aiosqlite

SCHEMA = """
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
  updated_at       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS moves (
  game_id       INTEGER NOT NULL,
  game_no       INTEGER NOT NULL,
  ply           INTEGER NOT NULL,
  uci           TEXT NOT NULL,
  san           TEXT NOT NULL,
  by_role       TEXT NOT NULL,
  fen_after     TEXT NOT NULL,
  client_move_id TEXT NOT NULL UNIQUE,
  created_at    REAL NOT NULL,
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
"""

SCHEMA_VERSION = "1"
START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


class Database:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._conn: aiosqlite.Connection | None = None
        self._write_lock = asyncio.Lock()

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("database is not connected")
        return self._conn

    async def _fetchone(self, sql: str, params=()):
        cur = await self.conn.execute(sql, params)
        row = await cur.fetchone()
        await cur.close()
        return row

    async def connect(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode = WAL")
        await self._conn.execute("PRAGMA busy_timeout = 5000")
        await self._conn.execute("PRAGMA foreign_keys = ON")
        await self._conn.executescript(SCHEMA)
        await self._conn.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)",
            (SCHEMA_VERSION,),
        )
        row = await self._fetchone("SELECT id FROM games WHERE id = 1")
        if row is None:
            await self._conn.execute(
                """INSERT INTO games (id, revision, fen, moves_json, status, result,
                     result_reason, claimable_json, offer_json, last_action_json,
                     game_no, updated_at)
                   VALUES (1, 0, ?, '[]', 'active', NULL, NULL, '[]', NULL, NULL, 1, ?)""",
                (START_FEN, time.time()),
            )
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def get_game(self) -> dict:
        row = await self._fetchone("SELECT * FROM games WHERE id = 1")
        return dict(row)

    async def get_moves(self, game_no: int) -> list[dict]:
        cur = await self.conn.execute(
            "SELECT * FROM moves WHERE game_id = 1 AND game_no = ? ORDER BY ply",
            (game_no,),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def find_move_by_client_id(self, client_move_id: str) -> dict | None:
        row = await self._fetchone(
            "SELECT * FROM moves WHERE client_move_id = ?", (client_move_id,)
        )
        return dict(row) if row else None

    async def find_action_by_client_id(self, client_action_id: str) -> dict | None:
        row = await self._fetchone(
            "SELECT * FROM actions WHERE client_action_id = ?", (client_action_id,)
        )
        return dict(row) if row else None

    async def save_game(self, game: dict) -> None:
        """Upsert the single game row. Caller must hold the write lock."""
        await self.conn.execute(
            """UPDATE games SET revision=?, fen=?, moves_json=?, status=?, result=?,
                 result_reason=?, claimable_json=?, offer_json=?, last_action_json=?,
                 game_no=?, updated_at=? WHERE id = 1""",
            (
                game["revision"], game["fen"], game["moves_json"], game["status"],
                game["result"], game["result_reason"], game["claimable_json"],
                game["offer_json"], game["last_action_json"], game["game_no"],
                game["updated_at"],
            ),
        )

    async def insert_move(self, *, game_no: int, ply: int, uci: str, san: str,
                          by_role: str, fen_after: str, client_move_id: str) -> None:
        await self.conn.execute(
            """INSERT INTO moves (game_id, game_no, ply, uci, san, by_role,
                 fen_after, client_move_id, created_at)
               VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (game_no, ply, uci, san, by_role, fen_after, client_move_id, time.time()),
        )

    async def delete_moves_from_ply(self, game_no: int, keep_plies: int) -> None:
        await self.conn.execute(
            "DELETE FROM moves WHERE game_id = 1 AND game_no = ? AND ply > ?",
            (game_no, keep_plies),
        )

    async def clear_moves(self, game_no: int) -> None:
        await self.conn.execute(
            "DELETE FROM moves WHERE game_id = 1 AND game_no = ?", (game_no,)
        )

    async def insert_action(self, *, client_action_id: str, type_: str, actor: str,
                            revision: int, payload: dict) -> None:
        await self.conn.execute(
            """INSERT INTO actions (client_action_id, type, actor, revision,
                 payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)""",
            (client_action_id, type_, actor, revision, json.dumps(payload), time.time()),
        )

    async def commit(self) -> None:
        await self.conn.commit()

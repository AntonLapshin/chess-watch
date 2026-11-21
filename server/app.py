"""Chess Watch relay server — FastAPI + python-chess + SQLite.

The server is the single source of truth for the game. Run exactly ONE
uvicorn worker: long-poll waiters live in this process (see notifier.py).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager

import chess
from fastapi import FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from auth import resolve_role
from config import Config, ConfigError, load_config
from db import Database, START_FEN
from game import (
    legal_moves_uci,
    move_record,
    promotion_moves,
    replay,
    takeback_plies,
    terminal_and_claimable,
)
from models import ActionRequest, MoveRequest
from notifier import Notifier

VERSION = "0.1.0"
ONLINE_WINDOW_S = 45.0
PROMOTION_PIECES = {"q": chess.QUEEN, "r": chess.ROOK, "b": chess.BISHOP, "n": chess.KNIGHT}

log = logging.getLogger("chess-watch")


def _err(code: str, message: str, status: int, state: dict | None = None):
    body = {"code": code, "message": message}
    if state is not None:
        body["state"] = state
    return JSONResponse(body, status_code=status)


class ServerState:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.db = Database(config.db_path)
        self.notifier = Notifier()
        self.presence: dict[str, float] = {}  # role -> last seen epoch

    def role_color(self, role: str) -> str:
        return "w" if role == "p1" else "b"

    def opponent_role(self, role: str) -> str:
        return "p2" if role == "p1" else "p1"


def _moves_list(game: dict) -> list[dict]:
    try:
        raw = json.loads(game["moves_json"])
    except (ValueError, TypeError):
        raw = []
    return raw if isinstance(raw, list) else []


def _offer(game: dict) -> dict | None:
    if not game["offer_json"]:
        return None
    try:
        return json.loads(game["offer_json"])
    except (ValueError, TypeError):
        return None


def _last_action(game: dict) -> dict | None:
    if not game["last_action_json"]:
        return None
    try:
        return json.loads(game["last_action_json"])
    except (ValueError, TypeError):
        return None


def _claimable(game: dict) -> list[str]:
    try:
        raw = json.loads(game["claimable_json"])
    except (ValueError, TypeError):
        raw = []
    return raw if isinstance(raw, list) else []


async def _expire_offer(state: ServerState, game: dict, now: float) -> bool:
    """Lazily expire a pending offer. Returns True if one expired.

    Caller must hold db._write_lock. Commits + notifies on expiry.
    """
    offer = _offer(game)
    if not offer:
        return False
    if now < float(offer.get("expires_at", 0)):
        return False
    game["offer_json"] = None
    game["revision"] += 1
    game["updated_at"] = now
    game["last_action_json"] = json.dumps(
        {"type": "offer_expired", "by": offer.get("by"), "at": now}
    )
    await state.db.save_game(game)
    await state.db.commit()
    await state.notifier.notify()
    return True


def _build_state(state: ServerState, game: dict, role: str, now: float) -> dict:
    moves = _moves_list(game)
    board = replay([m["uci"] for m in moves])
    you_color = state.role_color(role)
    opp_role = state.opponent_role(role)
    opp_seen = state.presence.get(opp_role, 0.0)
    check = board.is_check() if game["status"] == "active" else False
    check_square = None
    if check:
        check_square = chess.square_name(board.king(board.turn))
    recent = [
        {"ply": i + 1, "san": m["san"], "by": m["by"]}
        for i, m in enumerate(moves[-6:])
    ]
    last = None
    if moves:
        m = moves[-1]
        last = {"from": m["uci"][:2], "to": m["uci"][2:4], "san": m["san"], "by": m["by"]}
    legal = []
    if game["status"] == "active" and board.turn == chess.WHITE and you_color == "w":
        legal = legal_moves_uci(board)
    elif game["status"] == "active" and board.turn == chess.BLACK and you_color == "b":
        legal = legal_moves_uci(board)
    offer = _offer(game)
    return {
        "revision": game["revision"],
        "server_time": now,
        "game_no": game["game_no"],
        "you": {
            "role": role,
            "color": you_color,
            "name": state.config.name_for(role),
        },
        "opponent": {
            "role": opp_role,
            "name": state.config.name_for(opp_role),
            "color": state.role_color(opp_role),
            "online": (now - opp_seen) <= ONLINE_WINDOW_S,
        },
        "game": {
            "status": game["status"],
            "result": game["result"],
            "result_reason": game["result_reason"],
            "turn": "w" if board.turn == chess.WHITE else "b",
            "fen": board.fen(),
            "ply": len(moves),
            "last_move": last,
            "recent_moves": recent,
            "check": check,
            "check_square": check_square,
            "claimable": _claimable(game),
            "legal_moves": legal,
            "offer": offer,
            "last_action": _last_action(game),
        },
    }


def create_app(config: Config | None = None) -> FastAPI:
    cfg = config or load_config()
    state = ServerState(cfg)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await state.db.connect()
        app.state.chess = state
        yield
        await state.db.close()

    app = FastAPI(title="chess-watch", version=VERSION, lifespan=lifespan)
    if cfg.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cfg.cors_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type"],
        )

    def _role_or_401(authorization: str | None):
        role = resolve_role(authorization, cfg)
        if role is None:
            return None, _err("unauthorized", "missing or invalid bearer token", 401)
        return role, None

    @app.get("/api/v1/health")
    async def health():
        return {"status": "ok", "version": VERSION}

    @app.get("/health")
    async def health_alias():
        return {"status": "ok", "version": VERSION}

    @app.get("/api/v1/state")
    async def get_state(
        request: Request,
        authorization: str | None = Header(default=None),
        since: int | None = Query(default=None),
        wait: float | None = Query(default=None),
        presence: int | None = Query(default=None),
    ):
        role, err = _role_or_401(authorization)
        if err is not None:
            return err
        state.presence[role] = time.time()
        wait_s = 0.0 if wait is None else max(0.0, min(25.0, float(wait)))
        deadline = time.monotonic() + wait_s
        seen_version = state.notifier.version
        while True:
            now = time.time()
            async with state.db._write_lock:
                game = await state.db.get_game()
                await _expire_offer(state, game, now)
                game = await state.db.get_game()
                if since is None or since < game["revision"]:
                    return _build_state(state, game, role, now)
                offer = _offer(game)
                expires_in = None
                if offer:
                    expires_in = max(0.0, float(offer["expires_at"]) - now)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                async with state.db._write_lock:
                    game = await state.db.get_game()
                return _build_state(state, game, role, time.time())
            slice_s = remaining
            if expires_in is not None:
                slice_s = min(slice_s, expires_in + 0.05)
            await state.notifier.wait_for_change(seen_version, slice_s)
            seen_version = state.notifier.version

    @app.post("/api/v1/move")
    async def post_move(body: MoveRequest, authorization: str | None = Header(default=None)):
        role, err = _role_or_401(authorization)
        if err is not None:
            return err
        now = time.time()
        async with state.db._write_lock:
            game = await state.db.get_game()
            await _expire_offer(state, game, now)
            game = await state.db.get_game()
            # Idempotency lookup (before revision check).
            existing = await state.db.find_move_by_client_id(body.client_move_id)
            if existing is not None:
                payload = _build_state(state, game, role, now)
                payload["duplicate"] = True
                return payload
            if body.expected_revision != game["revision"]:
                return _err(
                    "revision_conflict",
                    f"expected revision {body.expected_revision}, current is {game['revision']}",
                    409,
                    _build_state(state, game, role, now),
                )
            if game["status"] != "active":
                return _err("game_over", "the game is already over", 409)
            moves = _moves_list(game)
            board = replay([m["uci"] for m in moves])
            you_color = state.role_color(role)
            turn_color = "w" if board.turn == chess.WHITE else "b"
            if turn_color != you_color:
                return _err("not_your_turn", "it is not your turn", 409)
            try:
                from_sq = chess.parse_square(body.from_)
                to_sq = chess.parse_square(body.to)
            except ValueError:
                return _err("illegal_move", "invalid square", 422)
            promos = promotion_moves(board, body.from_, body.to)
            if promos:
                if body.promotion is None or body.promotion.lower() not in PROMOTION_PIECES:
                    return _err("promotion_required", "choose a promotion piece (q, r, b, n)", 422)
            if body.promotion is not None and not promos:
                # A promotion was supplied but no promotion move exists for
                # this from/to pair: fall through to the legality check,
                # which rejects it as illegal.
                pass
            uci = body.from_ + body.to
            if promos and body.promotion:
                uci += body.promotion.lower()
            try:
                move = chess.Move.from_uci(uci)
            except ValueError:
                return _err("illegal_move", "invalid move", 422)
            if not board.is_legal(move):
                return _err("illegal_move", "that move is not legal", 422)
            rec = move_record(board, move, role)
            board.push(move)
            moves.append(
                {"uci": rec["uci"], "san": rec["san"], "by": role, "by_color": rec["by_color"]}
            )
            status, result, reason, claimable = terminal_and_claimable(board)
            game["fen"] = board.fen()
            game["moves_json"] = json.dumps(moves)
            game["status"] = status or "active"
            game["result"] = result
            game["result_reason"] = reason
            game["claimable_json"] = json.dumps(claimable)
            game["revision"] += 1
            game["updated_at"] = now
            await state.db.insert_move(
                game_no=game["game_no"], ply=len(moves), uci=rec["uci"],
                san=rec["san"], by_role=role, fen_after=board.fen(),
                client_move_id=body.client_move_id,
            )
            await state.db.save_game(game)
            await state.db.commit()
            await state.notifier.notify()
            payload = _build_state(state, game, role, now)
            payload["duplicate"] = False
            return payload

    @app.post("/api/v1/action")
    async def post_action(body: ActionRequest, authorization: str | None = Header(default=None)):
        role, err = _role_or_401(authorization)
        if err is not None:
            return err
        now = time.time()
        async with state.db._write_lock:
            game = await state.db.get_game()
            await _expire_offer(state, game, now)
            game = await state.db.get_game()
            existing = await state.db.find_action_by_client_id(body.client_action_id)
            if existing is not None:
                payload = _build_state(state, game, role, now)
                payload["duplicate"] = True
                return payload
            if body.expected_revision != game["revision"]:
                return _err(
                    "revision_conflict",
                    f"expected revision {body.expected_revision}, current is {game['revision']}",
                    409,
                    _build_state(state, game, role, now),
                )
            moves = _moves_list(game)
            board = replay([m["uci"] for m in moves])
            offer = _offer(game)
            you_color = state.role_color(role)
            opp_role = state.opponent_role(role)
            last_action: dict | None = None

            if body.type in ("offer_restart", "offer_takeback", "offer_draw"):
                if offer is not None:
                    return _err("offer_pending", "an offer is already pending", 409)
                if body.type == "offer_takeback":
                    if game["status"] != "active":
                        return _err("game_over", "takeback is only available during play", 409)
                    if takeback_plies(moves, you_color) is None:
                        return _err("takeback_unavailable", "there is no move to take back", 409)
                if body.type == "offer_draw" and game["status"] != "active":
                    return _err("game_over", "the game is already over", 409)
                game["offer_json"] = json.dumps(
                    {"type": body.type, "by": role, "expires_at": now + cfg.offer_ttl}
                )
                last_action = {"type": body.type, "by": role, "at": now}
            elif body.type in ("accept", "decline"):
                if offer is None:
                    return _err("no_offer", "there is no pending offer", 409)
                if offer.get("by") == role:
                    return _err("not_recipient", "only the opponent may answer an offer", 409)
                offer_type = offer.get("type")
                if body.type == "decline":
                    game["offer_json"] = None
                    last_action = {"type": "offer_declined", "by": role, "at": now}
                else:  # accept
                    if offer_type == "offer_restart":
                        new_no = game["game_no"] + 1
                        await state.db.clear_moves(game["game_no"])
                        game["game_no"] = new_no
                        game["fen"] = START_FEN
                        game["moves_json"] = "[]"
                        game["status"] = "active"
                        game["result"] = None
                        game["result_reason"] = None
                        game["claimable_json"] = "[]"
                        game["offer_json"] = None
                        last_action = {"type": "restart_accepted", "by": role, "at": now}
                    elif offer_type == "offer_takeback":
                        plies = takeback_plies(moves, state.role_color(offer["by"]))
                        if plies is None:
                            return _err("takeback_unavailable", "there is no move to take back", 409)
                        keep = max(0, len(moves) - plies)
                        await state.db.delete_moves_from_ply(game["game_no"], keep)
                        moves = moves[:keep]
                        board = replay([m["uci"] for m in moves])
                        game["fen"] = board.fen()
                        game["moves_json"] = json.dumps(moves)
                        _, _, _, claimable = terminal_and_claimable(board)
                        game["claimable_json"] = json.dumps(claimable)
                        game["offer_json"] = None
                        last_action = {"type": "takeback_accepted", "by": role, "at": now}
                    elif offer_type == "offer_draw":
                        game["status"] = "finished"
                        game["result"] = "draw"
                        game["result_reason"] = "agreement"
                        game["offer_json"] = None
                        last_action = {"type": "draw_accepted", "by": role, "at": now}
                    else:
                        return _err("no_offer", "unknown pending offer", 409)
            elif body.type == "resign":
                if game["status"] != "active":
                    return _err("game_over", "the game is already over", 409)
                game["status"] = "finished"
                game["result"] = state.role_color(opp_role)
                game["result_reason"] = "resign"
                game["offer_json"] = None
                last_action = {"type": "resign", "by": role, "at": now}
            elif body.type == "claim_draw":
                if game["status"] != "active":
                    return _err("game_over", "the game is already over", 409)
                turn_color = "w" if board.turn == chess.WHITE else "b"
                claimable = _claimable(game)
                if body.claim is None or body.claim not in claimable or turn_color != you_color:
                    return _err("invalid_claim", "that draw cannot be claimed now", 409)
                game["status"] = "finished"
                game["result"] = "draw"
                game["result_reason"] = (
                    "threefold_claim" if body.claim == "threefold" else "fifty_claim"
                )
                game["offer_json"] = None
                last_action = {"type": "claim_draw", "by": role, "at": now}
            else:  # pragma: no cover - pydantic restricts the type
                return _err("invalid_action", "unknown action type", 422)

            game["revision"] += 1
            game["updated_at"] = now
            if last_action is not None:
                game["last_action_json"] = json.dumps(last_action)
            await state.db.insert_action(
                client_action_id=body.client_action_id, type_=body.type,
                actor=role, revision=game["revision"],
                payload={"claim": body.claim} if body.claim else {},
            )
            await state.db.save_game(game)
            await state.db.commit()
            await state.notifier.notify()
            payload = _build_state(state, game, role, now)
            payload["duplicate"] = False
            return payload

    return app


def main() -> None:
    import uvicorn

    try:
        config = load_config()
    except ConfigError as exc:
        raise SystemExit(f"config error: {exc}") from exc
    app = create_app(config)
    uvicorn.run(app, host=config.host, port=config.port, workers=1, log_level="info")


app = create_app()

if __name__ == "__main__":
    main()

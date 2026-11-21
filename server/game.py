"""Pure chess logic: replay, terminal detection, claimable draws, takeback.

The board is rebuilt per request by replaying the move list through
python-chess, which keeps repetition, 50/75-move counters, castling rights
and en passant correct. The watch never enforces rules; the server does.
"""
from __future__ import annotations

import chess

START_FEN = chess.STARTING_FEN


def replay(uci_moves: list[str]) -> chess.Board:
    """Rebuild the board by replaying UCI moves from the start position."""
    board = chess.Board()
    for uci in uci_moves:
        board.push_uci(uci)
    return board


def board_from_fen(fen: str) -> chess.Board:
    return chess.Board(fen)


def terminal_and_claimable(board: chess.Board) -> tuple[str | None, str | None, str | None, list[str]]:
    """Return (status, result, result_reason, claimable).

    status: 'finished' when the game is over by an automatic rule, else None.
    result: 'w' / 'b' / 'draw' when finished.
    claimable: claimable draw kinds for the player to move.
    """
    claimable: list[str] = []
    if board.is_checkmate():
        winner = "w" if board.turn == chess.BLACK else "b"
        return "finished", winner, "checkmate", claimable
    if board.is_stalemate():
        return "finished", "draw", "stalemate", claimable
    if board.is_insufficient_material():
        return "finished", "draw", "insufficient_material", claimable
    if board.is_fivefold_repetition():
        return "finished", "draw", "fivefold", claimable
    if board.is_seventyfive_moves():
        return "finished", "draw", "seventyfive", claimable
    if board.is_repetition(3):
        claimable.append("threefold")
    if board.is_fifty_moves():
        claimable.append("fifty")
    return None, None, None, claimable


def legal_moves_uci(board: chess.Board) -> list[str]:
    return [m.uci() for m in board.legal_moves]


def promotion_moves(board: chess.Board, from_sq: str, to_sq: str) -> list[chess.Move]:
    """Legal moves from `from_sq` to `to_sq` that are promotions."""
    try:
        f = chess.parse_square(from_sq)
        t = chess.parse_square(to_sq)
    except ValueError:
        return []
    return [m for m in board.legal_moves if m.from_square == f and m.to_square == t and m.promotion]


def takeback_plies(moves: list[dict], requester_color: str) -> int | None:
    """Plies to revert so it is the requester's turn again.

    1 ply if the requester just moved (opponent has not replied yet),
    2 plies if the opponent replied. None when no moves exist.
    """
    if not moves:
        return None
    last_by_color = moves[-1]["by_color"]
    if last_by_color == requester_color:
        return 1
    if len(moves) >= 2:
        return 2
    return 1  # single opponent move: revert it, requester to move


def move_record(board_before: chess.Board, move: chess.Move, by: str) -> dict:
    san = board_before.san(move)
    board_after = board_before.copy()
    board_after.push(move)
    return {
        "uci": move.uci(),
        "san": san,
        "by": by,
        "by_color": "w" if board_before.turn == chess.WHITE else "b",
        "fen_after": board_after.fen(),
    }

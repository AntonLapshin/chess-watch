"""Rules tests: replay/terminal detection via python-chess."""
import chess

from game import replay, terminal_and_claimable


def test_fools_mate_is_checkmate():
    board = replay(["f2f3", "e7e5", "g2g4", "d8h4"])
    assert board.is_checkmate()
    status, result, reason, _ = terminal_and_claimable(board)
    assert (status, result, reason) == ("finished", "b", "checkmate")


def test_stalemate_fen():
    board = chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")
    assert board.is_stalemate()
    status, result, reason, _ = terminal_and_claimable(board)
    assert (status, result, reason) == ("finished", "draw", "stalemate")


def test_insufficient_material():
    for fen in ("8/8/4k3/8/8/3K4/8/8 w - - 0 1",  # K vs K
                "8/8/4k3/8/8/3K1B2/8/8 w - - 0 1",  # K+B vs K
                "8/8/4k3/8/8/3K1N2/8/8 w - - 0 1"):  # K+N vs K
        board = chess.Board(fen)
        assert board.is_insufficient_material(), fen
        status, result, reason, _ = terminal_and_claimable(board)
        assert (status, result, reason) == ("finished", "draw", "insufficient_material")


def test_castling_through_check_illegal():
    # Black rook on f8 attacks f1: white cannot castle kingside through f1.
    board = chess.Board("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1")
    assert chess.Move.from_uci("e1g1") not in board.legal_moves
    assert chess.Move.from_uci("e1c1") in board.legal_moves


def test_castling_into_check_illegal():
    board = chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w KQ - 0 1")
    # Black rook on a8 attacks a1..: queenside castle passes through d1? No:
    # put a rook on d8 attacking d1 instead.
    board = chess.Board("3rk2r/8/8/8/8/8/8/R3K2R w KQ - 0 1")
    assert chess.Move.from_uci("e1c1") not in board.legal_moves
    assert chess.Move.from_uci("e1g1") in board.legal_moves


def test_en_passant():
    board = replay(["e2e4", "a7a6", "e4e5", "d7d5"])
    assert board.has_legal_en_passant()
    assert chess.Move.from_uci("e5d6") in board.legal_moves
    board.push_uci("e5d6")
    assert board.piece_at(chess.D5) is None  # captured pawn is gone


def test_promotion_required_and_valid():
    board = chess.Board("8/P7/8/8/8/8/k6K/8 w - - 0 1")
    assert chess.Move.from_uci("a7a8") not in board.legal_moves  # no piece: illegal
    assert chess.Move.from_uci("a7a8q") in board.legal_moves


def test_threefold_claimable_not_auto():
    # Knight shuffle: Ng1-f3-g1 / Ng8-f6-g8 repeated -> threefold.
    moves = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]
    board = replay(moves)
    assert board.is_repetition(3)
    status, _, _, claimable = terminal_and_claimable(board)
    assert status is None  # not an automatic draw
    assert "threefold" in claimable


def test_fifty_move_claimable():
    board = chess.Board("7k/8/8/8/8/8/8/K6R w - - 100 51")
    assert board.is_fifty_moves()
    status, _, _, claimable = terminal_and_claimable(board)
    assert status is None
    assert "fifty" in claimable


def test_fivefold_auto_draw():
    moves = ["g1f3", "g8f6", "f3g1", "f6g8"] * 4  # position occurs 5 times
    board = replay(moves)
    assert board.is_fivefold_repetition()
    status, result, reason, _ = terminal_and_claimable(board)
    assert (status, result, reason) == ("finished", "draw", "fivefold")


def test_seventyfive_auto_draw():
    board = chess.Board("7k/8/8/8/8/8/8/K6R w - - 150 76")
    assert board.is_seventyfive_moves()
    status, result, reason, _ = terminal_and_claimable(board)
    assert (status, result, reason) == ("finished", "draw", "seventyfive")


def test_replay_keeps_castling_rights():
    board = replay(["e2e4", "e7e5", "g1f3", "b8c6"])
    assert board.has_kingside_castling_rights(chess.WHITE)
    assert board.has_queenside_castling_rights(chess.BLACK)

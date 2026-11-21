"""Action tests: restart, takeback, resign, draw agreement, claim draw."""
import pytest

from conftest import P1, P2, action, play, state


async def test_restart_accept_and_decline(client):
    s = await play(client, P1, 0, "e2e4", "r1")
    r = await action(client, P1, s["revision"], "offer_restart", "r2")
    assert r.status_code == 200
    s = r.json()
    assert s["game"]["offer"]["type"] == "offer_restart"
    # Offerer cannot accept their own offer.
    r = await action(client, P1, s["revision"], "accept", "r3")
    assert r.status_code == 409
    # Opponent declines.
    r = await action(client, P2, s["revision"], "decline", "r4")
    assert r.status_code == 200
    assert r.json()["game"]["offer"] is None
    assert r.json()["game"]["ply"] == 1
    # Offer again, opponent accepts: board resets, game_no increments.
    s = r.json()
    r = await action(client, P1, s["revision"], "offer_restart", "r5")
    s = r.json()
    r = await action(client, P2, s["revision"], "accept", "r6")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["game_no"] == 2
    assert s["game"]["ply"] == 0
    assert s["game"]["status"] == "active"
    assert s["game"]["fen"].startswith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w")


async def test_takeback_one_ply(client):
    # White just moved (1 ply): takeback reverts that one move.
    s = await play(client, P1, 0, "e2e4", "t1")
    r = await action(client, P1, s["revision"], "offer_takeback", "t2")
    assert r.status_code == 200, r.text
    s = r.json()
    r = await action(client, P2, s["revision"], "accept", "t3")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["game"]["ply"] == 0
    assert s["game"]["turn"] == "w"


async def test_takeback_two_plies(client):
    # White moved, black replied (2 plies): white's takeback reverts both.
    s = await play(client, P1, 0, "e2e4", "t2-1")
    s = await play(client, P2, s["revision"], "e7e5", "t2-2")
    r = await action(client, P1, s["revision"], "offer_takeback", "t2-3")
    assert r.status_code == 200, r.text
    s = r.json()
    r = await action(client, P2, s["revision"], "accept", "t2-4")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["game"]["ply"] == 0
    assert s["game"]["turn"] == "w"


async def test_takeback_unavailable_at_start(client):
    s = await state(client, P1)
    r = await action(client, P1, s["revision"], "offer_takeback", "tu1")
    assert r.status_code == 409
    assert r.json()["code"] == "takeback_unavailable"


async def test_takeback_after_game_over_rejected(client):
    s = await play(client, P1, 0, "f2f3", "tg1")
    s = await play(client, P2, s["revision"], "e7e5", "tg2")
    s = await play(client, P1, s["revision"], "g2g4", "tg3")
    s = await play(client, P2, s["revision"], "d8h4", "tg4")
    assert s["game"]["status"] == "finished"
    r = await action(client, P1, s["revision"], "offer_takeback", "tg5")
    assert r.status_code == 409
    assert r.json()["code"] == "game_over"


async def test_resign_immediate(client):
    s = await play(client, P1, 0, "e2e4", "rs1")
    r = await action(client, P1, s["revision"], "resign", "rs2")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["game"]["status"] == "finished"
    assert s["game"]["result"] == "b"
    assert s["game"]["result_reason"] == "resign"
    assert s["game"]["last_action"]["type"] == "resign"


async def test_draw_agreement(client):
    s = await play(client, P1, 0, "e2e4", "d1")
    r = await action(client, P1, s["revision"], "offer_draw", "d2")
    s = r.json()
    r = await action(client, P2, s["revision"], "accept", "d3")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["game"]["status"] == "finished"
    assert s["game"]["result"] == "draw"
    assert s["game"]["result_reason"] == "agreement"


async def test_claim_draw_threefold(client):
    moves = [("g1f3", P1), ("g8f6", P2), ("f3g1", P1), ("f6g8", P2),
             ("g1f3", P1), ("g8f6", P2), ("f3g1", P1), ("f6g8", P2)]
    s = await state(client, P1)
    for i, (uci, h) in enumerate(moves):
        s = await play(client, h, s["revision"], uci, f"cd{i}")
    assert "threefold" in s["game"]["claimable"]
    assert s["game"]["turn"] == "w"  # white to move may claim
    r = await action(client, P1, s["revision"], "claim_draw", "cd-claim", claim="threefold")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["game"]["status"] == "finished"
    assert s["game"]["result"] == "draw"
    assert s["game"]["result_reason"] == "threefold_claim"


async def test_claim_draw_invalid(client):
    s = await state(client, P1)
    r = await action(client, P1, s["revision"], "claim_draw", "ci1", claim="threefold")
    assert r.status_code == 409
    assert r.json()["code"] == "invalid_claim"
    # Wrong turn: black tries to claim when it is white's turn (and nothing claimable).
    r = await action(client, P2, s["revision"], "claim_draw", "ci2", claim="fifty")
    assert r.status_code == 409
    assert r.json()["code"] == "invalid_claim"


async def test_action_duplicate_id_and_revision_conflict(client):
    s = await state(client, P1)
    r = await action(client, P1, s["revision"], "offer_draw", "ad1")
    assert r.status_code == 200
    s = r.json()
    r = await action(client, P1, 0, "offer_draw", "ad1")  # same id, stale revision
    assert r.status_code == 200
    assert r.json()["duplicate"] is True
    r = await action(client, P2, 0, "decline", "ad2")  # stale revision, new id
    assert r.status_code == 409
    assert r.json()["code"] == "revision_conflict"
    assert r.json()["state"]["revision"] == s["revision"]


async def test_offer_expiry_lazy_on_read(client):
    # Offer with a 120s TTL; force expiry by rewriting expires_at in the DB.
    s = await state(client, P1)
    r = await action(client, P1, s["revision"], "offer_draw", "ex1")
    assert r.status_code == 200
    rev_before = r.json()["revision"]
    import json as _json
    import time as _time
    app_state = client._transport.app.state.chess  # type: ignore[attr-defined]
    async with app_state.db._write_lock:
        game = await app_state.db.get_game()
        offer = _json.loads(game["offer_json"])
        offer["expires_at"] = _time.time() - 1
        game["offer_json"] = _json.dumps(offer)
        await app_state.db.save_game(game)
        await app_state.db.commit()
    s = await state(client, P1)
    assert s["game"]["offer"] is None
    assert s["revision"] == rev_before + 1
    assert s["game"]["last_action"]["type"] == "offer_expired"

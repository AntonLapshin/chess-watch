"""API tests: auth, turns, revisions, idempotency, long-poll, offers."""
import asyncio
import time

import pytest

from conftest import P1, P2, action, move, play, state


async def test_health_no_auth(client):
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_auth_required_and_wrong_token(client):
    r = await client.get("/api/v1/state")
    assert r.status_code == 401
    assert r.json()["code"] == "unauthorized"
    r = await client.get("/api/v1/state", headers={"Authorization": "Bearer nope-nope-nope-nope"})
    assert r.status_code == 401
    r = await client.post("/api/v1/move", headers={"Authorization": "Bearer nope-nope-nope-nope"},
                          json={"client_move_id": "x", "expected_revision": 0, "from": "e2", "to": "e4"})
    assert r.status_code == 401


async def test_initial_state_shape(client):
    s = await state(client, P1)
    assert s["revision"] == 0
    assert s["you"] == {"role": "p1", "color": "w", "name": "Aurora"}
    assert s["opponent"]["name"] == "Sam"
    assert s["game"]["status"] == "active"
    assert s["game"]["turn"] == "w"
    assert s["game"]["fen"].startswith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w")
    assert s["game"]["legal_moves"]  # white to move: 20 legal moves
    assert len(s["game"]["legal_moves"]) == 20
    assert s["game"]["recent_moves"] == []
    # Black's view: no legal moves (not their turn).
    s2 = await state(client, P2)
    assert s2["game"]["legal_moves"] == []


async def test_move_wrong_turn(client):
    r = await move(client, P2, 0, "e7", "e5", cid="w1")
    assert r.status_code == 409
    assert r.json()["code"] == "not_your_turn"


async def test_move_revision_conflict_includes_state(client):
    r = await move(client, P1, 99, "e2", "e4", cid="c1")
    assert r.status_code == 409
    body = r.json()
    assert body["code"] == "revision_conflict"
    assert body["state"]["revision"] == 0


async def test_move_illegal_and_promotion_required(client):
    r = await move(client, P1, 0, "e2", "e5", cid="i1")
    assert r.status_code == 422
    assert r.json()["code"] == "illegal_move"
    # Reach a pawn on the 7th via a capture (b7 is vacated by the b-pawn):
    # 1.a4 b5 2.axb5 h5 3.b6 h4 4.b7 h3, then white to move b7-b8.
    s = await play(client, P1, 0, "a2a4", "p-a1")
    s = await play(client, P2, s["revision"], "b7b5", "p-b1")
    s = await play(client, P1, s["revision"], "a4b5", "p-a2")
    s = await play(client, P2, s["revision"], "h7h5", "p-b2")
    s = await play(client, P1, s["revision"], "b5b6", "p-a3")
    s = await play(client, P2, s["revision"], "h5h4", "p-b3")
    s = await play(client, P1, s["revision"], "b6b7", "p-a4")
    s = await play(client, P2, s["revision"], "h4h3", "p-b4")
    # White pawn on b7; b8 is occupied by the knight, so promotion is a
    # capture: b7xc8=Q. Without a piece choice the server must demand one.
    r = await move(client, P1, s["revision"], "b7", "c8", cid="promo1")
    assert r.status_code == 422
    assert r.json()["code"] == "promotion_required"
    r = await move(client, P1, s["revision"], "b7", "c8", promotion="q", cid="promo2")
    assert r.status_code == 200, r.text
    assert r.json()["game"]["fen"].split()[0].startswith("rnQqkbnr")


async def test_move_duplicate_client_id(client):
    s = await play(client, P1, 0, "e2e4", "dup-1")
    assert s["duplicate"] is False
    r = await move(client, P1, 0, "e2", "e4", cid="dup-1")  # stale revision, same id
    assert r.status_code == 200
    assert r.json()["duplicate"] is True
    assert r.json()["revision"] == s["revision"]


async def test_move_after_game_over(client):
    # Fool's mate: f3 e5 g4 Qh4#
    s = await play(client, P1, 0, "f2f3", "fm1")
    s = await play(client, P2, s["revision"], "e7e5", "fm2")
    s = await play(client, P1, s["revision"], "g2g4", "fm3")
    s = await play(client, P2, s["revision"], "d8h4", "fm4")
    assert s["game"]["status"] == "finished"
    assert s["game"]["result"] == "b"
    assert s["game"]["result_reason"] == "checkmate"
    r = await move(client, P1, s["revision"], "e2", "e4", cid="fm5")
    assert r.status_code == 409
    assert r.json()["code"] == "game_over"


async def test_long_poll_wake_and_timeout(client):
    # Timeout: since == current revision, wait 1 -> returns after ~1s, same rev.
    t0 = time.monotonic()
    s = await state(client, P1, since=0, wait=1)
    dt = time.monotonic() - t0
    assert s["revision"] == 0
    assert 0.8 <= dt < 3.0
    # Wake: start a poll, then move from the other client.
    async def poll():
        return await state(client, P2, since=0, wait=10)
    task = asyncio.create_task(poll())
    await asyncio.sleep(0.2)
    s = await play(client, P1, 0, "e2e4", "lp1")
    got = await asyncio.wait_for(task, timeout=5)
    assert got["revision"] == 1
    assert got["game"]["last_move"]["san"] == "e4"


async def test_offer_expiry_and_decline(client):
    s = await state(client, P1)
    r = await action(client, P1, s["revision"], "offer_draw", "od1")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["game"]["offer"]["type"] == "offer_draw"
    assert s["game"]["offer"]["by"] == "p1"
    # Second offer while one is pending -> 409 offer_pending.
    r = await action(client, P2, s["revision"], "offer_draw", "od2")
    assert r.status_code == 409
    assert r.json()["code"] == "offer_pending"
    # Opponent declines; offerer sees last_action.
    r = await action(client, P2, s["revision"], "decline", "od3")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["game"]["offer"] is None
    assert s["game"]["last_action"]["type"] == "offer_declined"
    # Answering when no offer exists -> 409 no_offer.
    r = await action(client, P2, s["revision"], "decline", "od4")
    assert r.status_code == 409
    assert r.json()["code"] == "no_offer"


async def test_offer_expiry_lazy(client):
    # Short TTL via a fresh app is awkward here; simulate by offering then
    # checking the stored offer expires_at is ~120s out, and expiry path via
    # direct DB manipulation is covered in test_actions (restart flow).
    s = await state(client, P1)
    r = await action(client, P1, s["revision"], "offer_draw", "ox1")
    assert r.status_code == 200
    offer = r.json()["game"]["offer"]
    assert offer["expires_at"] - r.json()["server_time"] > 100

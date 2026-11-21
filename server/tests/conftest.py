import os
import sys
from pathlib import Path

# Fake tokens (test-only) must exist before `app` is imported: the module
# builds its default app at import time and load_config() refuses to run
# without tokens.
os.environ.setdefault("CHESS_TOKEN_P1", "test-token-p1-0000000000000001")
os.environ.setdefault("CHESS_TOKEN_P2", "test-token-p2-0000000000000002")
os.environ.setdefault("CHESS_DB_PATH", str(Path(__file__).parent / ".test-default.sqlite3"))

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app import create_app
from config import Config


@pytest_asyncio.fixture
async def client(tmp_path):
    cfg = Config(
        token_p1="test-token-p1-0000000000000001",
        token_p2="test-token-p2-0000000000000002",
        p1_name="Aurora",
        p2_name="Sam",
        host="127.0.0.1",
        port=18787,
        db_path=tmp_path / "chess.sqlite3",
        offer_ttl=120,
        cors_origins=("http://localhost:5173",),
    )
    app = create_app(cfg)
    # ASGITransport does not run lifespan; enter it manually so the DB
    # connects (uvicorn runs lifespan for real).
    from contextlib import AsyncExitStack
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(app.router.lifespan_context(app))
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            c._cfg = cfg  # type: ignore[attr-defined]
            yield c


P1 = {"Authorization": "Bearer test-token-p1-0000000000000001"}
P2 = {"Authorization": "Bearer test-token-p2-0000000000000002"}


async def state(c, headers, **params):
    r = await c.get("/api/v1/state", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def move(c, headers, rev, frm, to, promotion=None, cid="m1"):
    return await c.post(
        "/api/v1/move",
        headers=headers,
        json={"client_move_id": cid, "expected_revision": rev,
              "from": frm, "to": to, "promotion": promotion},
    )


async def play(c, headers, rev, uci, cid):
    """Play one UCI move (with promotion letter if present); return new state."""
    frm, to = uci[:2], uci[2:4]
    promo = uci[4] if len(uci) == 5 else None
    r = await move(c, headers, rev, frm, to, promo, cid)
    assert r.status_code == 200, r.text
    return r.json()


async def action(c, headers, rev, type_, cid, claim=None):
    body = {"client_action_id": cid, "expected_revision": rev, "type": type_}
    if claim:
        body["claim"] = claim
    return await c.post("/api/v1/action", headers=headers, json=body)

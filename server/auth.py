"""Bearer-token auth: one token per player, compared in constant time."""
from __future__ import annotations

import hmac

from fastapi import Header


def resolve_role(authorization: str | None, config) -> str | None:
    """Return 'p1' / 'p2' for a valid Bearer token, else None."""
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    # Compare against both tokens every time so timing leaks nothing.
    p1 = hmac.compare_digest(token, config.token_p1)
    p2 = hmac.compare_digest(token, config.token_p2)
    if p1:
        return "p1"
    if p2:
        return "p2"
    return None


async def current_role(authorization: str | None = Header(default=None), config=None) -> str | None:
    return resolve_role(authorization, config)

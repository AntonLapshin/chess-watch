"""Single-process long-poll notifier (asyncio.Condition + version counter).

Waiters capture ``version``, read state, and only then block. A commit that
lands between the read and the block bumps the version first, so the waiter
notices immediately instead of sleeping until the timeout. No lost wakeups.

This is why the server must run as exactly ONE uvicorn worker.
"""
from __future__ import annotations

import asyncio


class Notifier:
    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self._version = 0

    @property
    def version(self) -> int:
        return self._version

    async def notify(self) -> None:
        async with self._condition:
            self._version += 1
            self._condition.notify_all()

    async def wait_for_change(self, seen: int, timeout: float) -> bool:
        async with self._condition:
            if self._version != seen:
                return True
            try:
                await asyncio.wait_for(
                    self._condition.wait_for(lambda: self._version != seen),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                return False
            return True

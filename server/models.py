"""Pydantic request models for the Chess Watch API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ClaimKind = Literal["threefold", "fifty"]
ActionType = Literal[
    "offer_restart", "offer_takeback", "offer_draw",
    "accept", "decline", "resign", "claim_draw",
]


class MoveRequest(BaseModel):
    client_move_id: str = Field(min_length=1, max_length=128)
    expected_revision: int
    from_: str = Field(alias="from", min_length=2, max_length=2)
    to: str = Field(min_length=2, max_length=2)
    promotion: str | None = None

    model_config = {"populate_by_name": True}


class ActionRequest(BaseModel):
    client_action_id: str = Field(min_length=1, max_length=128)
    expected_revision: int
    type: ActionType
    claim: ClaimKind | None = None

"""Configuration for the Chess Watch relay server.

Tokens come from the environment (or ``server/.env`` / repo ``.env``).
Startup refuses to run if a token is missing, both tokens are equal, or a
token is shorter than 24 characters.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

MIN_TOKEN_LEN = 24
SERVER_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVER_DIR.parent


class ConfigError(RuntimeError):
    """Raised when the configuration is missing or malformed."""


@dataclass(frozen=True)
class Config:
    token_p1: str
    token_p2: str
    p1_name: str = "Aurora"
    p2_name: str = "Sam"
    host: str = "127.0.0.1"
    port: int = 8787
    db_path: Path = Path("./data/chess.sqlite3")
    offer_ttl: int = 120
    cors_origins: tuple[str, ...] = ("http://localhost:5173",)

    def token_for(self, role: str) -> str:
        return self.token_p1 if role == "p1" else self.token_p2

    def name_for(self, role: str) -> str:
        return self.p1_name if role == "p1" else self.p2_name


def _env_file() -> Path | None:
    override = os.environ.get("CHESS_ENV_FILE")
    if override:
        return Path(override).expanduser()
    for candidate in (SERVER_DIR / ".env", REPO_ROOT / ".env"):
        if candidate.is_file():
            return candidate
    return None


def load_config() -> Config:
    env_file = _env_file()
    if env_file is not None and env_file.is_file():
        load_dotenv(env_file, override=False)

    p1 = os.environ.get("CHESS_TOKEN_P1", "")
    p2 = os.environ.get("CHESS_TOKEN_P2", "")
    if not p1:
        raise ConfigError("missing CHESS_TOKEN_P1: copy server/.env.example to server/.env and generate tokens")
    if not p2:
        raise ConfigError("missing CHESS_TOKEN_P2: copy server/.env.example to server/.env and generate tokens")
    if p1 == p2:
        raise ConfigError("CHESS_TOKEN_P1 and CHESS_TOKEN_P2 must differ")
    if len(p1) < MIN_TOKEN_LEN:
        raise ConfigError(f"CHESS_TOKEN_P1 must be at least {MIN_TOKEN_LEN} characters")
    if len(p2) < MIN_TOKEN_LEN:
        raise ConfigError(f"CHESS_TOKEN_P2 must be at least {MIN_TOKEN_LEN} characters")
    if p1.startswith("CHANGEME") or p2.startswith("CHANGEME"):
        raise ConfigError(
            "CHESS_TOKEN_P1/CHESS_TOKEN_P2 are still the .env.example placeholders; "
            "generate real tokens and use the same values in both .env files"
        )

    try:
        port = int(os.environ.get("CHESS_PORT", "8787"))
    except ValueError as exc:
        raise ConfigError(f"CHESS_PORT must be an integer: {exc}") from exc
    if not 1 <= port <= 65535:
        raise ConfigError(f"CHESS_PORT must be a TCP port, got {port}")

    try:
        offer_ttl = int(os.environ.get("CHESS_OFFER_TTL", "120"))
    except ValueError as exc:
        raise ConfigError(f"CHESS_OFFER_TTL must be an integer: {exc}") from exc
    if offer_ttl <= 0:
        raise ConfigError("CHESS_OFFER_TTL must be positive")

    db_raw = os.environ.get("CHESS_DB_PATH", "./data/chess.sqlite3")
    db_path = Path(db_raw)
    if not db_path.is_absolute():
        db_path = (REPO_ROOT / db_path).resolve()

    cors_raw = os.environ.get("CHESS_CORS_ORIGINS", "http://localhost:5173")
    cors_origins = tuple(o.strip() for o in cors_raw.split(",") if o.strip())

    return Config(
        token_p1=p1,
        token_p2=p2,
        p1_name=os.environ.get("CHESS_P1_NAME", "Aurora") or "Aurora",
        p2_name=os.environ.get("CHESS_P2_NAME", "Sam") or "Sam",
        host=os.environ.get("CHESS_HOST", "127.0.0.1"),
        port=port,
        db_path=db_path,
        offer_ttl=offer_ttl,
        cors_origins=cors_origins,
    )

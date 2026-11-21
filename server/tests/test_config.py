import pytest

from config import ConfigError, load_config


def test_missing_tokens_refused(monkeypatch):
    monkeypatch.delenv("CHESS_TOKEN_P1", raising=False)
    monkeypatch.delenv("CHESS_TOKEN_P2", raising=False)
    monkeypatch.setenv("CHESS_ENV_FILE", "/nonexistent/nope.env")
    with pytest.raises(ConfigError):
        load_config()


def test_equal_tokens_refused(monkeypatch):
    monkeypatch.setenv("CHESS_ENV_FILE", "/nonexistent/nope.env")
    monkeypatch.setenv("CHESS_TOKEN_P1", "a" * 32)
    monkeypatch.setenv("CHESS_TOKEN_P2", "a" * 32)
    with pytest.raises(ConfigError):
        load_config()


def test_short_token_refused(monkeypatch):
    monkeypatch.setenv("CHESS_ENV_FILE", "/nonexistent/nope.env")
    monkeypatch.setenv("CHESS_TOKEN_P1", "short")
    monkeypatch.setenv("CHESS_TOKEN_P2", "b" * 32)
    with pytest.raises(ConfigError):
        load_config()

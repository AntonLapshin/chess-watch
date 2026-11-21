# Chess Watch relay server

FastAPI + python-chess + SQLite. The server is the single source of truth
for the game: it enforces every rule, stores the move history, and wakes both
watches through long-polling.

> **Run exactly ONE uvicorn worker.** Long-poll waiters live in this process
> (an in-process `asyncio.Condition` + version counter, see `notifier.py`).
> A second worker would hold its own waiter set and miss wakes, so clients
> would only learn about moves when their poll timed out. The Makefile,
> the systemd unit, and `app.py` all enforce `--workers 1`.

## Setup

```bash
make venv            # python3 -m venv .venv; pip install -r requirements.txt
cp .env.example .env # then fill in two tokens (see below)
make start           # start on 0.0.0.0:8787, wait for /health
make status          # is it running?
make logs            # tail the log
make stop            # stop it
make test            # pytest
```

`uv` is not required: the venv is created with `python3 -m venv` and deps
come from `requirements.txt`. (`pyproject.toml` carries the same deps for
`uv sync` users.)

## Tokens

Generate two tokens, one per player:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Put them in `server/.env` (or the repo-root `.env`) as `CHESS_TOKEN_P1` /
`CHESS_TOKEN_P2`. Startup refuses to run if a token is missing, both tokens
are equal, or a token is shorter than 24 characters. Never commit `.env`.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `CHESS_TOKEN_P1` / `CHESS_TOKEN_P2` | — (required) | Bearer tokens, ≥24 chars, must differ |
| `CHESS_P1_NAME` / `CHESS_P2_NAME` | Aurora / Sam | Display names |
| `CHESS_HOST` | `0.0.0.0` | Bind address |
| `CHESS_PORT` | `8787` | Port |
| `CHESS_DB_PATH` | `./data/chess.sqlite3` | SQLite file (WAL); relative to repo root |
| `CHESS_OFFER_TTL` | `120` | Offer expiry, seconds |
| `CHESS_CORS_ORIGINS` | `http://localhost:5173` | Comma-separated; web dev harness |

`CHESS_ENV_FILE` overrides which `.env` file is read (used by tests/smoke).

## API

All endpoints require `Authorization: Bearer <token>` except `/health`.
Full contract: `docs/protocol.md`.

- `GET /api/v1/health` — liveness, no auth.
- `GET /api/v1/state?since=&wait=&presence=1` — full state; long-poll, `wait`
  clamped to 0–25 s. Returns immediately when `since < revision`.
- `POST /api/v1/move` — `{client_move_id, expected_revision, from, to, promotion}`.
- `POST /api/v1/action` — `{client_action_id, expected_revision, type, claim?}`.

Error bodies are `{"code", "message"}` with a stable `code`
(`unauthorized`, `revision_conflict`, `not_your_turn`, `game_over`,
`offer_pending`, `no_offer`, `invalid_claim`, `illegal_move`,
`promotion_required`, plus `takeback_unavailable` / `not_recipient`).
`revision_conflict` also carries the current `state`.

## Running as a service

`chess-watch.service` is a systemd unit (edit `User`, paths, then
`systemctl enable --now chess-watch`). It runs a single worker.

## Firewall

The watches reach the server over LAN or VPN (Tailscale/WireGuard). Open
port 8787 only on the LAN/VPN interface, e.g. with `ufw`:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8787
```

No TLS inside the app; for remote play put an HTTPS reverse proxy in front
(out of scope for this setup).

## Backup

The whole game is one SQLite file (`data/chess.sqlite3`, WAL mode). Back it
up with a plain file copy while the server is stopped, or copy the `-wal`
file together with the main file. Restoring is dropping the files back and
restarting.

#!/usr/bin/env bash
# Smoke test: temp DB, real uvicorn on a free port, auth/move/conflict/resign.
#
#   ./scripts/smoke.sh
#   SMOKE_PORT=18081 ./scripts/smoke.sh
set -euo pipefail

server_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/chess-smoke.XXXXXX")"
port="${SMOKE_PORT:-18080}"
base="http://127.0.0.1:${port}"
p1_token="smoke-test-token-p1-0000000000000001"
p2_token="smoke-test-token-p2-0000000000000002"
pid=""

cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

echo "starting server on port $port (db: $tmp_dir/chess.sqlite3)"
(
  cd "$server_dir"
  CHESS_ENV_FILE="$tmp_dir/no-such.env" \
  CHESS_TOKEN_P1="$p1_token" \
  CHESS_TOKEN_P2="$p2_token" \
  CHESS_DB_PATH="$tmp_dir/chess.sqlite3" \
  CHESS_PORT="$port" \
  exec .venv/bin/uvicorn app:app \
    --host 127.0.0.1 --port "$port" --workers 1 --log-level warning
) &
pid=$!

for _ in $(seq 1 100); do
  if curl -fsS "$base/api/v1/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$pid" 2>/dev/null; then fail "server exited during startup"; fi
  sleep 0.2
done

health="$(curl -fsS "$base/api/v1/health")" || fail "no /health"
[[ "$(jq -r .status <<<"$health")" == "ok" ]] || fail "/health not ok: $health"
pass "/health"

code="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d '{"client_move_id":"p1-0-1","expected_revision":0,"from":"e2","to":"e4"}' \
  "$base/api/v1/move")"
[[ "$code" == "401" ]] || fail "unauthenticated move returned $code"
pass "auth required"

# Long-poll first; the move must wake it.
poll_file="$tmp_dir/poll.json"
curl -fsS -G \
  -H "Authorization: Bearer $p2_token" \
  --data-urlencode since=0 \
  --data-urlencode wait=10 \
  "$base/api/v1/state" >"$poll_file" &
poll_pid=$!

moved="$(curl -fsS -H "Authorization: Bearer $p1_token" \
  -H 'Content-Type: application/json' \
  -d '{"client_move_id":"p1-0-1","expected_revision":0,"from":"e2","to":"e4"}' \
  "$base/api/v1/move")"
[[ "$(jq -r .game.last_move.san <<<"$moved")" == "e4" ]] || fail "move failed: $moved"
[[ "$(jq -r .duplicate <<<"$moved")" == "false" ]] || fail "unexpected duplicate"
pass "move e4"

wait "$poll_pid" || fail "long-poll failed"
polled="$(cat "$poll_file")"
[[ "$(jq -r .revision <<<"$polled")" == "1" ]] || fail "poll did not wake: $polled"
pass "long-poll woke with revision 1"

dup="$(curl -fsS -H "Authorization: Bearer $p1_token" \
  -H 'Content-Type: application/json' \
  -d '{"client_move_id":"p1-0-1","expected_revision":0,"from":"e2","to":"e4"}' \
  "$base/api/v1/move")"
[[ "$(jq -r .duplicate <<<"$dup")" == "true" ]] || fail "retry not idempotent: $dup"
pass "duplicate client_move_id is idempotent"

code="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $p2_token" \
  -H 'Content-Type: application/json' \
  -d '{"client_move_id":"p2-0-1","expected_revision":0,"from":"e7","to":"e5"}' \
  "$base/api/v1/move")"
[[ "$code" == "409" ]] || fail "stale revision returned $code, expected 409"
pass "revision conflict -> 409"

resigned="$(curl -fsS -H "Authorization: Bearer $p2_token" \
  -H 'Content-Type: application/json' \
  -d '{"client_action_id":"p2-a-1","expected_revision":1,"type":"resign"}' \
  "$base/api/v1/action")"
[[ "$(jq -r .game.status <<<"$resigned")" == "finished" ]] || fail "resign failed: $resigned"
[[ "$(jq -r .game.result <<<"$resigned")" == "w" ]] || fail "resign winner wrong: $resigned"
pass "resign ends game, white wins"

echo
echo "SMOKE OK — health, auth, move, long-poll wake, dedupe, conflict, resign."

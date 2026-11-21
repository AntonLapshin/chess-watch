#!/usr/bin/env bash
# Deploy the Chess Watch Worker, attaching the custom-domain route derived
# from CHESS_SERVER_URL in the repo-root .env — so the hostname lives in
# exactly one place (that .env value) and never in wrangler.toml or docs.
#
#   CHESS_SERVER_URL=https://<your-host>/   -> npx wrangler deploy --route "<host>/*"
#   CHESS_SERVER_URL unset / localhost / *.workers.dev
#                                            -> plain deploy (workers.dev URL only)
#
# CHESS_WORKER_ZONE (optional, in .env or the environment) is passed as
# --zone if route attachment needs an explicit zone (it is experimental in
# wrangler 4.x and needs --x-route-zones). Dashboard alternative:
# Workers & Pages -> chess-watch -> Settings -> Triggers -> Add route.
#
# Player names come from .env too (CHESS_P1_NAME / CHESS_P2_NAME) and are
# passed as --var on EVERY deploy (both branches below): the wrangler.toml
# [vars] defaults (Aurora/Sam) are only a fallback, and without --var a
# deploy would silently revert the board names to them. --var overrides
# the toml vars (verified: with --var, wrangler dev state reports the
# --var names, not the toml defaults). Names are single words; a name
# containing ":" would confuse the KEY:VALUE split.
#
# Pass --dry-run to validate the deploy (bundling, bindings, route) without
# deploying or needing a login: scripts/worker-deploy.sh --dry-run
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/worker"

if [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT/.env"; set +a
fi

URL="${CHESS_SERVER_URL:-}"
HOST=""
if [[ "$URL" =~ ^https://([^/:]+) ]]; then
  HOST="${BASH_REMATCH[1]}"
fi

NAME_ARGS=()
if [ -n "${CHESS_P1_NAME:-}" ]; then
  NAME_ARGS+=(--var "CHESS_P1_NAME:${CHESS_P1_NAME}")
fi
if [ -n "${CHESS_P2_NAME:-}" ]; then
  NAME_ARGS+=(--var "CHESS_P2_NAME:${CHESS_P2_NAME}")
fi

if [ -z "$HOST" ] || [[ "$HOST" == *.workers.dev ]] \
    || [[ "$HOST" == localhost || "$HOST" == 127.0.0.1 ]]; then
  echo "worker-deploy: no custom domain in CHESS_SERVER_URL ($URL) — plain deploy (workers.dev URL only)."
  exec npx wrangler deploy "${NAME_ARGS[@]}" "$@"
fi

ARGS=(--route "$HOST/*" "${NAME_ARGS[@]}")
if [ -n "${CHESS_WORKER_ZONE:-}" ]; then
  ARGS+=(--x-route-zones --zone "$CHESS_WORKER_ZONE")
fi
if [ "${1:-}" = "--dry-run" ]; then
  ARGS+=(--dry-run)
fi
echo "worker-deploy: deploying with route $HOST/*"
exec npx wrangler deploy "${ARGS[@]}"

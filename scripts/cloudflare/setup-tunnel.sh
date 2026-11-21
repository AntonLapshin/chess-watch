#!/usr/bin/env bash
# Create (or refresh) a dedicated Cloudflare Tunnel for the Chess Watch relay.
#
#   sudo scripts/cloudflare/setup-tunnel.sh
#   sudo scripts/cloudflare/setup-tunnel.sh chess.gulfrenderstudio.com
#   sudo scripts/cloudflare/setup-tunnel.sh --status
#
# Prerequisites:
#   - cloudflared installed
#   - gulfrenderstudio.com active in this Cloudflare account
#   - `sudo cloudflared tunnel login` already done (root cert present)
#
# What it does:
#   1. cloudflared tunnel create chess-watch        (skips if it exists)
#   2. cloudflared tunnel route dns chess-watch chess.gulfrenderstudio.com
#   3. writes /etc/cloudflared/chess-watch.yml (root-only)
#   4. installs + enables cloudflared-chess-watch.service
#   5. checks the local relay and the public hostname
#
# It does NOT create the Cloudflare Access application: do that in the
# Zero Trust dashboard (see scripts/cloudflare/README.md), then put the
# service token in .env and rebuild the watches.
set -euo pipefail

TUNNEL_HOST="${CHESS_TUNNEL_HOSTNAME:-chess.gulfrenderstudio.com}"
TUNNEL="${CHESS_TUNNEL_NAME:-chess-watch}"
SERVICE="${CHESS_TUNNEL_SERVICE:-http://127.0.0.1:8787}"
CONFIG="/etc/cloudflared/${TUNNEL}.yml"
UNIT="cloudflared-${TUNNEL}.service"
UNIT_PATH="/etc/systemd/system/${UNIT}"

log()  { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: sudo $0 [hostname] [--status]

  (no args)        create/refresh the tunnel for ${TUNNEL_HOST}
  <hostname>       use a different hostname
  --status         show the service, tunnel and health checks

Environment overrides:
  CHESS_TUNNEL_HOSTNAME  default ${TUNNEL_HOST}
  CHESS_TUNNEL_NAME      default ${TUNNEL}
  CHESS_TUNNEL_SERVICE   default ${SERVICE}
EOF
}

status() {
  if [[ -f "$CONFIG" ]]; then
    local cfg_host
    cfg_host="$(awk '/^[[:space:]]*- hostname:/{print $3; exit}' "$CONFIG" 2>/dev/null || true)"
    [[ -n "$cfg_host" ]] && TUNNEL_HOST="$cfg_host"
  fi
  log "== systemd =="
  systemctl status "$UNIT" --no-pager -n 15 || true
  log
  log "== tunnel =="
  cloudflared tunnel info "$TUNNEL" 2>&1 | head -n 12 || true
  log
  log "== local relay =="
  curl -fsS --max-time 5 "${SERVICE}/api/v1/health" || warn "local relay is not answering ${SERVICE}"
  log
  log
  log "== public hostname =="
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://${TUNNEL_HOST}/api/v1/health" || true)"
  log "https://${TUNNEL_HOST}/api/v1/health -> HTTP ${code:-no response}"
  case "$code" in
    200) log "(no Access application yet, or a bypass policy)" ;;
    302|403) log "(protected by Cloudflare Access — expected)" ;;
    *) warn "unexpected status; check cloudflared logs and the Access app" ;;
  esac
}

case "${1:-}" in
  -h | --help) usage; exit 0 ;;
esac

[[ ${EUID} -eq 0 ]] || die "run with sudo"
command -v cloudflared >/dev/null 2>&1 || die "cloudflared is not installed"

case "${1:-}" in
  --status) status; exit 0 ;;
  -*) die "unknown option: $1" ;;
esac
if [[ $# -gt 0 ]]; then
  TUNNEL_HOST="$1"
  shift
fi
[[ $# -eq 0 ]] || die "unexpected arguments: $*"

log "hostname: ${TUNNEL_HOST}"
log "tunnel:   ${TUNNEL}"
log "service:  ${SERVICE}"

if ! cloudflared tunnel list >/dev/null 2>&1; then
  die "cloudflared is not logged in. Run: sudo cloudflared tunnel login"
fi

if cloudflared tunnel list 2>/dev/null | awk -v t="$TUNNEL" '$2 == t { found = 1 } END { exit !found }'; then
  log "(tunnel ${TUNNEL} exists)"
else
  cloudflared tunnel create "$TUNNEL"
fi

TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null |
  awk -v t="$TUNNEL" '$2 == t { print $1; exit }')"
[[ -n "$TUNNEL_ID" ]] || die "could not find the tunnel ID for ${TUNNEL}"

route_out="$(cloudflared tunnel route dns "$TUNNEL" "$TUNNEL_HOST" 2>&1)" || true
if grep -qiE 'already|success|added|updated' <<<"$route_out"; then
  log "(DNS routed: ${TUNNEL_HOST})"
else
  printf '%s\n' "$route_out" >&2
  die "DNS routing failed. Is ${TUNNEL_HOST} in this Cloudflare zone and the zone Active?"
fi

CRED_SRC=""
for f in "/root/.cloudflared/${TUNNEL_ID}.json" \
         "${HOME}/.cloudflared/${TUNNEL_ID}.json" \
         "/etc/cloudflared/${TUNNEL_ID}.json"; do
  [[ -f "$f" ]] && { CRED_SRC="$f"; break; }
done
[[ -n "$CRED_SRC" ]] || die "tunnel credentials ${TUNNEL_ID}.json not found; re-run sudo cloudflared tunnel login"

install -d -m 700 /etc/cloudflared
if [[ "$CRED_SRC" != "/etc/cloudflared/${TUNNEL_ID}.json" ]]; then
  install -m 600 "$CRED_SRC" "/etc/cloudflared/${TUNNEL_ID}.json"
fi

cat >"$CONFIG" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: /etc/cloudflared/${TUNNEL_ID}.json
ingress:
  - hostname: ${TUNNEL_HOST}
    service: ${SERVICE}
  - service: http_status:404
EOF
chmod 600 "$CONFIG"
log "(wrote ${CONFIG})"

cat >"$UNIT_PATH" <<EOF
[Unit]
Description=Cloudflare Tunnel (${TUNNEL}) for the Chess Watch relay
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=notify
ExecStart=$(command -v cloudflared) tunnel --config ${CONFIG} run
Restart=always
RestartSec=5s
TimeoutStopSec=30
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
log "(wrote ${UNIT_PATH})"

systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null
systemctl restart "$UNIT"

for _ in $(seq 1 20); do
  systemctl is-active --quiet "$UNIT" && break
  sleep 0.5
done
if ! systemctl is-active --quiet "$UNIT"; then
  journalctl -u "$UNIT" -n 25 --no-pager >&2 || true
  die "${UNIT} failed to start"
fi
log "(${UNIT} active)"
cloudflared tunnel info "$TUNNEL" 2>&1 | head -n 8 || true

log
log "== checks =="
if curl -fsS --max-time 5 "${SERVICE}/api/v1/health" >/dev/null 2>&1; then
  log "local relay: ok (${SERVICE})"
else
  warn "local relay is not answering ${SERVICE}; start it with: make server"
fi

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://${TUNNEL_HOST}/api/v1/health" || true)"
log "https://${TUNNEL_HOST}/api/v1/health -> HTTP ${code:-no response}"

cat <<EOF

Next:
  1. Zero Trust -> Access -> Service Auth -> create a service token.
  2. Access -> Applications -> Self-hosted:
       name:     Chess Watch
       domain:   ${TUNNEL_HOST}
       policy 1: Action "Service Auth", Include "Service Token" -> that token
       policy 2: (optional, for your browser) Action "Allow", Include Emails -> you
     Do NOT add an "Allow Everyone" policy.
  3. Put the token in the repo-root .env:
       CHESS_CF_ACCESS_CLIENT_ID=...
       CHESS_CF_ACCESS_CLIENT_SECRET=...
  4. make config && make build   (rebuild both watches)
  5. Test: sudo $0 --status

Full walkthrough: scripts/cloudflare/README.md
EOF

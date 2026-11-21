#!/usr/bin/env bash
# Whitelist the Chess Watch relay port (default 8787) with nftables.
#
# For hosts that do not use ufw. Creates a self-contained table
# `inet chess_watch` that accepts tcp/8787 from the given CIDRs and drops
# everything else on that port. Other ports are untouched.
#
#   sudo scripts/firewall/open-8787-nft.sh apply
#   sudo scripts/firewall/open-8787-nft.sh apply 192.168.4.0/22 10.66.66.0/24
#   sudo scripts/firewall/open-8787-nft.sh status
#   sudo scripts/firewall/open-8787-nft.sh remove
#
# Override defaults with CHESS_PORT / CHESS_ALLOW_CIDRS.
set -euo pipefail

PORT="${CHESS_PORT:-8787}"
TABLE="chess_watch"
TAG="chess-watch"
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname -- "$SELF")"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<EOF
Usage: sudo $0 <command> [CIDR...]

Whitelist TCP $PORT (Chess Watch relay) with a standalone nftables table
"inet $TABLE". Everything else on that port is dropped.

Commands:
  apply [CIDR...]  install/replace the table with the given whitelist
  status           show the table and listeners for tcp/$PORT
  remove           delete the table
  help             show this help

CIDRs default to \$CHESS_ALLOW_CIDRS, then to auto-detected LAN + VPN ranges
(the default-route interface plus wg*/tailscale*/tun*/ppp* interfaces).

Examples:
  sudo $0 apply
  sudo $0 apply 192.168.4.0/22 10.66.66.0/24
EOF
}

require_nft() {
  command -v nft >/dev/null 2>&1 || die "nft is not installed"
  if command -v ufw >/dev/null 2>&1 &&
    [[ "$(ufw status 2>/dev/null | head -n1)" == "Status: active" ]]; then
    warn "ufw is active; its rules still apply. Use open-8787.sh unless you want both."
  fi
}

join_by() {
  local IFS="$1"
  shift
  printf '%s' "$*"
}

cmd_apply() {
  require_nft
  local -a cidrs=() v4=() v6=()
  resolve_cidrs cidrs "$@"

  local c
  for c in "${cidrs[@]}"; do
    if [[ "$c" == *:* ]]; then v6+=("$c"); else v4+=("$c"); fi
  done

  local rules
  rules="$(mktemp)"
  trap 'rm -f "$rules"' EXIT

  {
    printf 'table inet %s {\n' "$TABLE"
    if ((${#v4[@]})); then
      printf '  set allowed4 {\n'
      printf '    type ipv4_addr\n'
      printf '    flags interval\n'
      printf '    elements = { %s }\n' "$(join_by ', ' "${v4[@]}")"
      printf '  }\n'
    fi
    if ((${#v6[@]})); then
      printf '  set allowed6 {\n'
      printf '    type ipv6_addr\n'
      printf '    flags interval\n'
      printf '    elements = { %s }\n' "$(join_by ', ' "${v6[@]}")"
      printf '  }\n'
    fi
    printf '  chain input {\n'
    printf '    type filter hook input priority filter; policy accept;\n'
    ((${#v4[@]})) && printf '    tcp dport %s ip saddr @allowed4 accept\n' "$PORT"
    ((${#v6[@]})) && printf '    tcp dport %s ip6 saddr @allowed6 accept\n' "$PORT"
    printf '    tcp dport %s drop\n' "$PORT"
    printf '  }\n'
    printf '}\n'
  } >"$rules"

  # Validate before replacing so a typo cannot leave the port unprotected.
  nft -c -f "$rules"
  nft delete table inet "$TABLE" 2>/dev/null || true
  nft -f "$rules"

  for c in "${v4[@]}"; do log "allow tcp/$PORT from $c"; done
  for c in "${v6[@]}"; do log "allow tcp/$PORT from $c"; done
  log "deny  tcp/$PORT from everywhere else"
  printf '\n'
  cmd_status
}

cmd_status() {
  if nft list table inet "$TABLE" >/dev/null 2>&1; then
    nft list table inet "$TABLE"
  else
    log "no nftables table inet $TABLE"
  fi

  local listeners
  listeners="$(ss -H -ltn "sport = :$PORT" 2>/dev/null || true)"
  if [[ -n "$listeners" ]]; then
    log "listening:"
    printf '%s\n' "$listeners" | sed 's/^/  /'
  else
    log "nothing is listening on tcp/$PORT yet"
  fi
}

cmd_remove() {
  if nft list table inet "$TABLE" >/dev/null 2>&1; then
    nft delete table inet "$TABLE"
    log "removed nftables table inet $TABLE"
  else
    log "no nftables table inet $TABLE"
  fi
}

main() {
  case "${1:-help}" in
    help | -h | --help)
      usage
      return 0
      ;;
  esac
  ensure_root "$@"

  local cmd="${1:-help}"
  (($#)) && shift
  case "$cmd" in
    apply) cmd_apply "$@" ;;
    status) cmd_status ;;
    remove) cmd_remove ;;
    *) usage >&2; die "unknown command: $cmd" ;;
  esac
}

main "$@"

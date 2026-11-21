#!/usr/bin/env bash
# Whitelist the Chess Watch relay port (default 8787) with ufw.
#
# Only peers from the given LAN/VPN CIDRs may reach the port; every other
# source is denied. Rules are tagged with the comment "chess-watch", so
# `remove` deletes exactly what this script added.
#
#   sudo scripts/firewall/open-8787.sh apply                 # auto-detect LAN + VPN
#   sudo scripts/firewall/open-8787.sh apply 192.168.4.0/22 10.66.66.0/24
#   sudo scripts/firewall/open-8787.sh apply --reset 192.168.4.0/22
#   sudo scripts/firewall/open-8787.sh status
#   sudo scripts/firewall/open-8787.sh remove
#
# Override defaults with CHESS_PORT / CHESS_ALLOW_CIDRS.
set -euo pipefail

PORT="${CHESS_PORT:-8787}"
TAG="chess-watch"
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname -- "$SELF")"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<EOF
Usage: sudo $0 <command> [options] [CIDR...]

Whitelist TCP $PORT (Chess Watch relay) with ufw. Everything else is denied.

Commands:
  apply [--reset] [CIDR...]  allow the CIDRs, deny all other sources
  status                     show rules and listeners for tcp/$PORT
  remove                     delete rules tagged "$TAG"
  help                       show this help

CIDRs default to \$CHESS_ALLOW_CIDRS, then to auto-detected LAN + VPN ranges
(the default-route interface plus wg*/tailscale*/tun*/ppp* interfaces).

--reset deletes every existing ufw rule for tcp/$PORT before applying.

Examples:
  sudo $0 apply
  sudo $0 apply 192.168.4.0/22 10.66.66.0/24
  sudo $0 apply --reset 192.168.4.0/22 10.66.66.0/24
EOF
}

require_ufw() {
  command -v ufw >/dev/null 2>&1 ||
    die "ufw is not installed; use open-8787-nft.sh on nftables-only hosts"
  local state
  state="$(ufw status | head -n1)"
  [[ "$state" == "Status: active" ]] ||
    die "ufw is not active. Allow SSH first, then enable it: sudo ufw allow OpenSSH && sudo ufw enable"
}

# Print rule numbers for tcp/$PORT, optionally only lines containing a tag.
port_rule_numbers() {
  local filter="${1:-}"
  ufw status numbered |
    awk -v re="$PORT_RE" -v tag="$filter" '
      $0 ~ re && (tag == "" || index($0, tag)) { print }' |
    sed -n 's/^\[ *\([0-9][0-9]*\)\].*/\1/p'
}

delete_rules() {
  local -a nums=()
  local n
  mapfile -t nums < <(port_rule_numbers "${1:-}")
  ((${#nums[@]})) || return 0
  # Delete from the highest number down so the remaining numbers stay valid.
  while IFS= read -r n; do
    [[ -n "$n" ]] && ufw --force delete "$n" >/dev/null
  done < <(printf '%s\n' "${nums[@]}" | sort -rn)
  log "deleted ${#nums[@]} rule(s)"
}

cmd_apply() {
  require_ufw
  local reset=0
  local -a cidrs=()
  while (($#)); do
    case "$1" in
      --reset) reset=1; shift ;;
      -h | --help) usage; return 0 ;;
      -*) die "unknown option: $1 (see: $0 help)" ;;
      *) cidrs+=("$1"); shift ;;
    esac
  done

  if ((reset)); then
    log "removing existing ufw rules for tcp/$PORT"
    delete_rules
  else
    # Drop our own default-deny first so newly allowed CIDRs are appended
    # above it; ufw evaluates rules in order.
    delete_rules "$TAG default-deny"
  fi

  local -a allow=()
  resolve_cidrs allow "${cidrs[@]}"

  local broad
  broad="$(ufw status | awk -v re="$PORT_RE" '$0 ~ re && /ALLOW/ && /Anywhere/')"
  if [[ -n "$broad" ]]; then
    warn "existing rules allow tcp/$PORT from anywhere and defeat the whitelist:"
    printf '%s\n' "$broad" | sed 's/^/  /' >&2
    warn "remove them (sudo ufw status numbered; sudo ufw delete N) or rerun with --reset"
  fi

  local c
  for c in "${allow[@]}"; do
    ufw allow from "$c" to any port "$PORT" proto tcp comment "$TAG" >/dev/null
    log "allow tcp/$PORT from $c"
  done
  ufw deny "$PORT"/tcp comment "$TAG default-deny" >/dev/null
  log "deny  tcp/$PORT from everywhere else"

  printf '\n'
  cmd_status
}

cmd_status() {
  require_ufw
  local rules
  rules="$(ufw status numbered |
    awk -v re="$PORT_RE" -v tag="$TAG" '$0 ~ re || index($0, tag)')"
  if [[ -n "$rules" ]]; then
    printf '%s\n' "$rules"
  else
    log "no ufw rules for tcp/$PORT"
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
  require_ufw
  log "removing rules tagged \"$TAG\""
  delete_rules "$TAG"
  cmd_status
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

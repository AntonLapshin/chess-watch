#!/usr/bin/env bash
# Shared helpers for the Chess Watch firewall scripts. Sourced, not executed.

TAG="${TAG:-chess-watch}"
# Matches 8787, 8787/tcp, but not 18787/tcp or 8787/udp in ufw status output.
PORT_RE="(^|[^0-9])${PORT:-8787}(/tcp)?([[:space:]]|$)"

log()  { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

# Re-run the script under sudo, preserving the settings we care about.
# Call this from main() with the original "$@" so the command is kept.
ensure_root() {
  [[ ${EUID} -eq 0 ]] && return 0
  command -v sudo >/dev/null 2>&1 || die "must run as root (sudo not found)"
  exec sudo env \
    CHESS_PORT="${PORT:-8787}" \
    CHESS_ALLOW_CIDRS="${CHESS_ALLOW_CIDRS:-}" \
    "$SELF" "$@"
}

# Normalize a CIDR (host bits cleared) and reject garbage.
normalize_cidr() {
  command -v python3 >/dev/null 2>&1 || die "python3 is required to validate CIDRs"
  python3 -c '
import ipaddress, sys
try:
    print(ipaddress.ip_network(sys.argv[1], strict=False))
except ValueError as exc:
    sys.exit(f"invalid CIDR {sys.argv[1]!r}: {exc}")
' "$1"
}

# Default whitelist: the LAN the default route uses plus common VPN links.
detect_cidrs() {
  local iface cidr def_if
  {
    def_if="$(ip -o -4 route show default 2>/dev/null |
      awk '{for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit }}')"
    [[ -n "$def_if" ]] && printf '%s\n' "$def_if"

    ip -o link show 2>/dev/null |
      awk -F': ' '{print $2}' |
      sed 's/@.*//' |
      grep -E '^(wg|tailscale|tun|ppp)[0-9]*$' || true
  } | sort -u | while read -r iface; do
    [[ -n "$iface" ]] || continue
    cidr="$(ip -o -4 route show dev "$iface" proto kernel scope link 2>/dev/null |
      awk '{print $1; exit}')"
    [[ -n "$cidr" ]] && printf '%s\n' "$cidr"
  done | sort -u
}

# resolve_cidrs <array-name> [CIDR...]
# Priority: explicit args > CHESS_ALLOW_CIDRS > auto-detection.
# Values may be separated by spaces or commas.
resolve_cidrs() {
  local -n _out="$1"
  shift
  local -a raw=() uniq=()
  if (($#)); then
    raw=("$@")
  elif [[ -n "${CHESS_ALLOW_CIDRS:-}" ]]; then
    read -r -a raw <<<"${CHESS_ALLOW_CIDRS//,/ }"
  else
    mapfile -t raw < <(detect_cidrs)
  fi
  ((${#raw[@]})) || die "no CIDRs given and none detected; pass CIDRs or set CHESS_ALLOW_CIDRS"
  local c
  for c in "${raw[@]}"; do
    _out+=("$(normalize_cidr "$c")")
  done
  mapfile -t uniq < <(printf '%s\n' "${_out[@]}" | sort -u)
  _out=("${uniq[@]}")
}

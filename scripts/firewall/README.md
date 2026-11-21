# Firewall helpers — Chess Watch relay (tcp/8787)

> With Cloudflare Tunnel the relay binds `127.0.0.1` and there is no inbound
> port, so these scripts are only for a direct LAN/VPN fallback. See
> `scripts/cloudflare/README.md` for the remote-access setup.

The relay binds `0.0.0.0:8787` in LAN mode, so the host firewall is what
limits access. These scripts allow `tcp/8787` only from the LAN and VPN
ranges (the watches connect over Wi-Fi or WireGuard/Tailscale) and deny
every other source.

## ufw (default)

This host already runs `ufw`. From the repo root:

```bash
sudo scripts/firewall/open-8787.sh apply
sudo scripts/firewall/open-8787.sh status
sudo scripts/firewall/open-8787.sh remove
```

`apply` with no CIDRs auto-detects:

- the IPv4 subnet on the default-route interface (the LAN), and
- every `wg*`, `tailscale*`, `tun*`, `ppp*` interface.

Pass CIDRs explicitly when detection is not what you want:

```bash
sudo scripts/firewall/open-8787.sh apply 192.168.4.0/22 10.66.66.0/24
```

`--reset` deletes every existing ufw rule for the port first (useful when an
old `Anywhere` allow would otherwise defeat the whitelist):

```bash
sudo scripts/firewall/open-8787.sh apply --reset 192.168.4.0/22 10.66.66.0/24
```

Rules are tagged with the comment `chess-watch`; `remove` deletes only those.
IPv6 CIDRs work too — pass them in the same list.

## nftables (hosts without ufw)

```bash
sudo scripts/firewall/open-8787-nft.sh apply
sudo scripts/firewall/open-8787-nft.sh status
sudo scripts/firewall/open-8787-nft.sh remove
```

This creates a self-contained `inet chess_watch` table with its own `input`
chain. It only touches `tcp/8787`; other ports and other tables are unchanged.
The ruleset is validated with `nft -c` before the old table is replaced.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `CHESS_PORT` | `8787` | Port to whitelist |
| `CHESS_ALLOW_CIDRS` | auto-detect | Space- or comma-separated CIDRs |

Example:

```bash
sudo CHESS_PORT=8787 CHESS_ALLOW_CIDRS="192.168.4.0/22 10.66.66.0/24" \
  scripts/firewall/open-8787.sh apply
```

## Verify

From another device on the LAN/VPN:

```bash
curl -fsS http://<server-ip>:8787/api/v1/health
```

From a network that is not whitelisted, the same request should time out.
`/api/v1/health` needs no token; all other endpoints require the bearer token.

## Notes

- `ufw` must already be active. If it is not, allow SSH first:
  `sudo ufw allow OpenSSH && sudo ufw enable`.
- If the server also sits behind a cloud/provider firewall or a router doing
  port forwarding, whitelist `tcp/8787` there as well.
- There is no TLS in the relay. For play outside the LAN/VPN, put an HTTPS
  reverse proxy in front and whitelist only that proxy.

# Cloudflare Tunnel for the Chess Watch relay

Goal: the watches talk to `https://chess.gulfrenderstudio.com`, from home
Wi-Fi or cellular, without exposing `tcp/8787` on the router or the host.

```
watch -> phone side service -> HTTPS 443 -> Cloudflare edge
      -> Cloudflare Access (service token) -> tunnel -> cloudflared
      -> http://127.0.0.1:8787 (uvicorn)
```

There is **no inbound port** on the server. `cloudflared` makes outbound
connections to Cloudflare, and the relay listens on loopback only. That is
the "only the right path, not from anywhere" part: there is no public origin
IP to whitelist, because the origin is not reachable directly at all.

## Why not an IP allowlist?

The watches roam between Wi-Fi and cellular, so their public IP changes.
An IP allowlist would break them outside the house. Use a **Cloudflare
Access service token** instead: it is a portable credential that the watch
sends on every request, and it cannot be guessed. The existing per-player
bearer tokens remain the second layer.

## 0. Fix the local server first

Both `.env` files must contain the **same real tokens**; the watch bundle
uses the root one and the server uses `server/.env` (which wins when both
exist). `server/.env` must not contain the `CHANGEME...` placeholders.

```bash
cd ~/ws/chess-watch
for k in CHESS_TOKEN_P1 CHESS_TOKEN_P2; do
  a=$(grep "^$k=" .env | cut -d= -f2-)
  b=$(grep "^$k=" server/.env | cut -d= -f2-)
  [[ -n "$a" && "$a" == "$b" ]] && echo "$k: match" || echo "$k: MISMATCH"
done
grep -H '^CHESS_HOST=' server/.env               # should be 127.0.0.1
```

Bind loopback only (the new default) and restart:

```bash
make -C server restart
ss -ltn 'sport = :8787'          # expect 127.0.0.1:8787, not 0.0.0.0
curl -fsS http://127.0.0.1:8787/api/v1/health
```

If you previously opened 8787 in `ufw`, remove those rules; they are no
longer needed:

```bash
sudo scripts/firewall/open-8787.sh remove
```

## 1. Create the tunnel + subdomain

`gulfrenderstudio.com` is already an active Cloudflare zone (the
`browser.gulfrenderstudio.com` tunnel proves it), and `cloudflared` is
already logged in as root. So:

```bash
sudo scripts/cloudflare/setup-tunnel.sh
# or a different hostname:
sudo scripts/cloudflare/setup-tunnel.sh chess.gulfrenderstudio.com
```

The script creates:

- tunnel `chess-watch` (independent from `brother-browser`),
- proxied CNAME `chess.gulfrenderstudio.com -> <tunnel-id>.cfargotunnel.com`,
- `/etc/cloudflared/chess-watch.yml` (mode 600),
- `/etc/systemd/system/cloudflared-chess-watch.service`, enabled and started.

Check it:

```bash
sudo scripts/cloudflare/setup-tunnel.sh --status
sudo journalctl -u cloudflared-chess-watch -n 30 --no-pager
```

At this point `https://chess.gulfrenderstudio.com/api/v1/health` may already
return 200. Add Access next so it is not a public API.

## 2. Create the Cloudflare Access application

In the Cloudflare dashboard → **Zero Trust** (`one.dash.cloudflare.com`):

1. **Access → Service Auth → Service Tokens → Create Service Token**
   - Name: `chess-watch-watch`
   - Duration: `Non-expiring` (or rotate manually)
   - Copy the **Client ID** and **Client Secret** now; the secret is shown
     once.
2. **Access → Applications → Add an application → Self-hosted**
   - Name: `Chess Watch`
   - Session duration: `24 hours` (only affects browser logins)
   - Application domain: `chess.gulfrenderstudio.com` (path empty)
3. **Policies** on that application:
   - Policy 1 — name `watches`:
     - Action: **Service Auth**
     - Include: **Service Token** → `chess-watch-watch`
   - Policy 2 — optional, for your own browser checks:
     - Action: **Allow**
     - Include: **Emails** → your email
   - Do **not** add an `Allow` policy with `Everyone` / `Anywhere`.
4. If you use the optional email policy and have never used OTP, add it
   under **Access → Integrations → Identity providers → One-time PIN**,
   then select it as a login method on the application.

Policies are OR'd: the watch passes with the service token, and you can
still open the API in a browser with an email PIN.

## 3. Put the service token in the watch build

Edit the repo-root `.env`:

```bash
CHESS_CF_ACCESS_CLIENT_ID=<client-id>
CHESS_CF_ACCESS_CLIENT_SECRET=<client-secret>
```

The generator embeds them as `access: { clientId, clientSecret }` in
`shared/config.generated.js`; `shared/httpClient.js` sends them as
`CF-Access-Client-Id` / `CF-Access-Client-Secret` on every request,
including the `/api/v1/health` PING. Leave both empty for LAN-only builds.

```bash
make config
make build          # or: make preview
```

Both watches need the new build because the URL and service token changed.

## 4. Verify

Without the service token, the edge must challenge the request:

```bash
curl -i https://chess.gulfrenderstudio.com/api/v1/health
# expect 302 to cloudflareaccess.com (or 403), NOT 200
```

With the service token:

```bash
export CF_ID='<client-id>'
export CF_SECRET='<client-secret>'
curl -fsS \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET" \
  https://chess.gulfrenderstudio.com/api/v1/health
# {"status":"ok","version":"0.1.0"}
```

With a player bearer token:

```bash
set -a; . ./.env; set +a
curl -fsS \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET" \
  -H "Authorization: Bearer $CHESS_TOKEN_P1" \
  'https://chess.gulfrenderstudio.com/api/v1/state?since=0&wait=0&presence=1' |
  head -c 300
```

On the watches: test once on home Wi-Fi and once with Wi-Fi off (phone on
cellular). The long poll is 25 s max, below Cloudflare's 100 s request
timeout, so no special configuration is needed.

## 5. Operate

```bash
sudo scripts/cloudflare/setup-tunnel.sh --status   # service + tunnel + health
sudo systemctl restart cloudflared-chess-watch
sudo journalctl -u cloudflared-chess-watch -f
```

Rotate the Access service token: create a new token, update `.env`,
`make config`, rebuild both watches, then delete the old token. Rotate the
player bearer tokens the same way: update **both** `.env` files, restart the
server, rebuild both watches.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `502 Bad Gateway` | Relay is not running on `127.0.0.1:8787`; run `make -C server status` |
| Cloudflare `1033` | Tunnel not connected; `systemctl status cloudflared-chess-watch`, `journalctl -u ...` |
| Redirect loop / Access login every request | Service token headers missing from the build; check `shared/config.generated.js` has `access` and rerun `make config` |
| `403` from Access | Service token deleted/rotated, or the policy is not **Service Auth** |
| `401` from the relay | Bearer token mismatch between root `.env` and `server/.env` |
| `cloudflared tunnel list` says "cannot determine origin certificate" | Run it with `sudo` (the cert is in `/root/.cloudflared`) |
| DNS name does not resolve | Zone not Active, or the CNAME was not created; re-run the setup script |
| `404` from Cloudflare (empty body, only on the edge) | Hostname is DNS-routed to the *wrong* tunnel (e.g. the brother-browser one): the `tunnel route dns` CLI can claim "already configured" while the dashboard DNS row still shows the other tunnel. Compare IDs with `sudo cloudflared tunnel list`, re-route with the explicit UUID (`cloudflared tunnel route dns --overwrite-dns <tunnel-uuid> <hostname>`), or delete the stale CNAME in the dashboard and re-run the setup script. Confirm per-tunnel: `cloudflared_tunnel_total_requests` on each tunnel's metrics port (`127.0.0.1:2024x/metrics`) increments on the tunnel that answered |
| Works on Wi-Fi, not cellular | Watch build still has the LAN URL; set `CHESS_SERVER_URL` to the HTTPS hostname and rebuild |

Do not enable Cloudflare "Under Attack" mode for this hostname: it can
challenge non-browser clients. A WAF rate-limit rule on `/api/*` is fine as
extra protection.

## Alternative: reuse the existing tunnel

If you prefer one `cloudflared` process, add this before the catch-all in
`/etc/cloudflared/config.yml` and restart `cloudflared.service`:

```yaml
  - hostname: chess.gulfrenderstudio.com
    service: http://127.0.0.1:8787
```

Then route DNS to the existing tunnel:

```bash
sudo cloudflared tunnel route dns brother-browser chess.gulfrenderstudio.com
```

A dedicated tunnel is recommended so the browser and chess relays can be
restarted independently and revoked separately.

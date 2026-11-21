// Cloudflare Access service-token headers, when configured. The tunnel's
// Access application uses a Service Auth policy so only requests carrying
// these headers reach the relay. Omitted for localhost/LAN setups.
export function accessHeaders(config) {
  const access = config && config.access;
  if (!access || !access.clientId || !access.clientSecret) return {};
  return {
    "CF-Access-Client-Id": access.clientId,
    "CF-Access-Client-Secret": access.clientSecret,
  };
}

/** Health probe used by PING in both the side service and the web harness. */
export async function checkHealth(config) {
  try {
    const res = await fetch(`${config.serverUrl}/api/v1/health`, {
      headers: { ...accessHeaders(config), Accept: "application/json" },
    });
    const data = await parseBody(res);
    // Require the relay's JSON payload: a followed Cloudflare Access login
    // redirect is HTML with status 200 and must not count as healthy.
    return { ok: res.status >= 200 && res.status < 300 && !!data && data.status === "ok" };
  } catch (_) {
    return { ok: false };
  }
}

// One HTTP implementation shared by the watch side service (app-side) and
// the web harness adapter. Pure fetch; no Zepp imports.
//
// callServer(config, role, path, { method, body, timeoutMs })
//   -> { ok, status, data } on HTTP response, or { ok:false, code, message }
//      on network/timeout failure. `data` is the parsed JSON body (or null).
export async function callServer(config, role, path, opts = {}) {
  const player = config.players[role];
  if (!player || !player.token) {
    return { ok: false, code: "unauthorized", message: "No token for this player" };
  }
  const url = `${config.serverUrl}${path}`;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutMs = opts.timeoutMs || 30000;
  let timer = null;
  if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: {
        ...accessHeaders(config),
        Accept: "application/json",
        Authorization: `Bearer ${player.token}`,
        "Content-Type": "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
    const data = await parseBody(res);
    const ok = res.status >= 200 && res.status < 300;
    if (ok && data === null) {
      // Most likely a followed Cloudflare Access login page (HTML, 200).
      return { ok: false, code: "network", message: "Unexpected response from server" };
    }
    return { ok, status: res.status, data };
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || String(e).includes("abort"));
    return {
      ok: false,
      code: aborted ? "timeout" : "network",
      message: aborted ? "Server did not answer" : "No connection to server",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function parseBody(res) {
  // Zepp `fetch` on the side service returns res.body as a string or an
  // object; browsers return a Response with .json(). Handle all three.
  try {
    if (res && typeof res.body === "string") {
      return res.body ? JSON.parse(res.body) : null;
    }
    if (res && res.body && typeof res.body === "object" && typeof res.json !== "function") {
      return res.body;
    }
    if (res && typeof res.json === "function") {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  } catch (_) {
    return null;
  }
  return null;
}

/** Map a callServer result to the { code, message } shape the page uses. */
export function toError(result) {
  if (result && result.data && typeof result.data.code === "string") {
    return { code: result.data.code, message: result.data.message || result.data.code };
  }
  if (result && result.code) return { code: result.code, message: result.message || result.code };
  return { code: "unknown", message: "Something went wrong" };
}

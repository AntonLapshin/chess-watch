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

// The Zepp side-service `fetch` does NOT use the browser signature
// `fetch(url, { method, headers, body, signal })`. Per the Zepp OS docs it
// takes a single object — `fetch({ url, method, headers, body, timeout })` —
// and only those five fields. A standard two-argument call silently drops
// the second argument on-device: the request goes out as an unauthenticated
// GET with no bearer or Cloudflare Access headers, so every call fails
// (Cloudflare 302 / relay 401) and the page falls back to its offline
// board. Detect the side service and use its call shape there; browsers,
// Node and the web harness keep the standard shape.
function isZeppSideService() {
  // Bare-identifier typeof checks are safe even when the globals do not
  // exist, and they survive runtimes where `globalThis` is missing or where
  // the host exposes the side-service globals without wiring them onto
  // `globalThis`.
  try {
    if (typeof sideService !== "undefined") return true;
  } catch (_) {}
  try {
    if (typeof messaging !== "undefined") return true;
  } catch (_) {}
  try {
    return (
      typeof globalThis.sideService !== "undefined" ||
      typeof globalThis.messaging !== "undefined"
    );
  } catch (_) {
    return false;
  }
}

/** Which fetch call shape doFetch() will use here. Reported via DIAG. */
export function fetchShape() {
  return isZeppSideService() ? "zepp-object" : "standard";
}

function doFetch(url, { method = "GET", headers = {}, body, timeoutMs = 30000 }) {
  if (isZeppSideService()) {
    // The docs list only url/method/headers/body, but the runtime accepts
    // `timeout` too: ZML's own fetch wrapper (zml-side.js) calls this same
    // global fetch as fetch({ timeout: 1e4, ...params }).
    return fetch({
      url,
      method: String(method).toUpperCase(),
      headers,
      body,
      timeout: timeoutMs,
    });
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);
  const promise = fetch(url, {
    method,
    headers,
    body,
    signal: controller ? controller.signal : undefined,
  });
  if (timer) {
    return promise.finally(() => clearTimeout(timer));
  }
  return promise;
}

function inferStatus(res, data) {
  if (res && typeof res.status === "number") return res.status;
  // Some side-service runtimes omit `status`: a parseable body means the
  // relay answered, anything else means no usable response.
  return data != null ? 200 : 0;
}

/** Health probe used by PING in both the side service and the web harness. */
export async function checkHealth(config) {
  try {
    const res = await doFetch(`${config.serverUrl}/api/v1/health`, {
      headers: { ...accessHeaders(config), Accept: "application/json" },
      timeoutMs: 15000,
    });
    const data = await parseBody(res);
    const status = inferStatus(res, data);
    // Require the relay's JSON payload: a followed Cloudflare Access login
    // redirect is HTML with status 200 and must not count as healthy.
    // The status is returned too: DIAG needs to tell a 403 (bad Access
    // service token) from no answer at all.
    return {
      ok: status >= 200 && status < 300 && !!data && data.status === "ok",
      status,
    };
  } catch (_) {
    return { ok: false, status: null };
  }
}

// One HTTP implementation shared by the watch side service (app-side) and
// the web harness adapter. No Zepp imports; doFetch() picks the fetch call
// shape per runtime (single-object on the side service, standard elsewhere).
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
  const timeoutMs = opts.timeoutMs || 30000;
  try {
    const res = await doFetch(url, {
      method: opts.method || "GET",
      headers: {
        ...accessHeaders(config),
        Accept: "application/json",
        Authorization: `Bearer ${player.token}`,
        "Content-Type": "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      timeoutMs,
    });
    const data = await parseBody(res);
    const status = inferStatus(res, data);
    const ok = status >= 200 && status < 300;
    if (ok && data === null) {
      // Most likely a followed Cloudflare Access login page (HTML, 200).
      return { ok: false, code: "network", message: "Unexpected response from server" };
    }
    return { ok, status, data };
  } catch (e) {
    const msg = e && (e.message || String(e)) || "";
    const aborted =
      (e && (e.name === "AbortError" || String(e).includes("abort"))) || /timeout/i.test(msg);
    return {
      ok: false,
      code: aborted ? "timeout" : "network",
      message: aborted ? "Server did not answer" : "No connection to server",
    };
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

/** Host part of the configured server URL (safe to display anywhere). */
export function serverHost(config) {
  try {
    return new URL(config.serverUrl).host;
  } catch (_) {
    return String((config && config.serverUrl) || "?");
  }
}

/** Map a callServer result to the { code, message } shape the page uses.
 *  An HTTP answer with no JSON error body (Cloudflare Access 403, a
 *  proxy 502, ...) used to collapse to "unknown", hiding exactly the
 *  distinction DIAG needs. Keep the status as `http_<status>` instead. */
export function toError(result) {
  if (result && result.data && typeof result.data.code === "string") {
    return { code: result.data.code, message: result.data.message || result.data.code };
  }
  if (result && result.code) return { code: result.code, message: result.message || result.code };
  if (result && typeof result.status === "number") {
    return { code: `http_${result.status}`, message: `Server answered ${result.status}` };
  }
  return { code: "unknown", message: "Something went wrong" };
}

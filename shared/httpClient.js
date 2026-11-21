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
        Authorization: `Bearer ${player.token}`,
        "Content-Type": "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
    const data = await parseBody(res);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, data };
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

// Web-harness request adapter: implements the same methods the side service
// handles (PING / GET_STATE / MOVE / ACTION) by calling the server directly
// over HTTP — no BLE in the browser. Shares shared/httpClient.js with the
// real side service so the request/response mapping is identical.
import CONFIG from "../../../shared/config.generated.js";
import { APP_VERSION } from "../../../shared/version.js";
import { callServer, checkHealth, fetchShape, serverHost, toError } from "../../../shared/httpClient.js";

// Browser requests go to the Vite dev server on the same origin; its /api
// proxy forwards them to CHESS_SERVER_URL and adds the Cloudflare Access
// service-token headers. Calling the tunnel hostname directly would fail
// Cloudflare Access's CORS preflight (OPTIONS is rejected before auth).
const WEB_CONFIG = { ...CONFIG, serverUrl: "", access: null };

let _lastGood = null;
let _lastFetch = null;

function track(where, result) {
  _lastFetch = {
    where,
    ok: result.ok,
    status: result.status != null ? result.status : null,
    // HTTP answers carry no `code` field — derive one (http_403, ...)
    // so DIAG shows the failure instead of a bare "fail".
    code: result.ok ? null : (result.code || toError(result).code),
    at: Date.now(),
  };
  return result;
}

export async function handleRequest(req) {
  const method = req && req.method;
  const params = (req && req.params) || {};
  if (method === "PING") {
    return checkHealth(WEB_CONFIG);
  }
  if (method === "GET_STATE") {
    const since = params.since != null ? params.since : 0;
    const wait = params.wait != null ? params.wait : 20;
    const result = track("state", await callServer(
      WEB_CONFIG, params.role,
      `/api/v1/state?since=${since}&wait=${wait}&presence=1`,
      { timeoutMs: (wait + 15) * 1000 },
    ));
    if (result.ok && result.data) {
      _lastGood = result.data;
      return result.data;
    }
    if (_lastGood) return _lastGood;
    throw toError(result);
  }
  if (method === "MOVE") {
    const result = track("move", await callServer(WEB_CONFIG, params.role, "/api/v1/move", {
      method: "POST",
      body: {
        client_move_id: params.clientMoveId,
        expected_revision: params.expectedRevision,
        from: params.from,
        to: params.to,
        promotion: params.promotion || null,
      },
      timeoutMs: 15000,
    }));
    if (result.ok && result.data) {
      _lastGood = result.data;
      return result.data;
    }
    throw toError(result);
  }
  if (method === "ACTION") {
    const result = track("action", await callServer(WEB_CONFIG, params.role, "/api/v1/action", {
      method: "POST",
      body: {
        client_action_id: params.clientActionId,
        expected_revision: params.expectedRevision,
        type: params.type,
        claim: params.claim || null,
      },
      timeoutMs: 15000,
    }));
    if (result.ok && result.data) {
      _lastGood = result.data;
      return result.data;
    }
    throw toError(result);
  }
  if (method === "DIAG") {
    // Browser equivalent of the side-service diagnostic: same health probe
    // through the Vite /api proxy, same shape report.
    const ping = await checkHealth(WEB_CONFIG);
    return {
      shape: `${fetchShape()}+proxy`,
      host: serverHost(CONFIG),
      ping,
      calls: null,
      lastFetch: _lastFetch,
      names: { p1: CONFIG.players.p1.name, p2: CONFIG.players.p2.name },
      hasTokens: Boolean(CONFIG.players.p1.token && CONFIG.players.p2.token),
      access: false,
      build: CONFIG.build || null,
      version: APP_VERSION,
      role: params.role || null,
    };
  }
  throw { code: "unknown", message: `unknown method ${method}` };
}

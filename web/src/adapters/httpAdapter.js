// Web-harness request adapter: implements the same methods the side service
// handles (PING / GET_STATE / MOVE / ACTION) by calling the server directly
// over HTTP — no BLE in the browser. Shares shared/httpClient.js with the
// real side service so the request/response mapping is identical.
import CONFIG from "../../../shared/config.generated.js";
import { callServer, checkHealth, toError } from "../../../shared/httpClient.js";

let _lastGood = null;

export async function handleRequest(req) {
  const method = req && req.method;
  const params = (req && req.params) || {};
  if (method === "PING") {
    return checkHealth(CONFIG);
  }
  if (method === "GET_STATE") {
    const since = params.since != null ? params.since : 0;
    const wait = params.wait != null ? params.wait : 20;
    const result = await callServer(
      CONFIG, params.role,
      `/api/v1/state?since=${since}&wait=${wait}&presence=1`,
      { timeoutMs: (wait + 15) * 1000 },
    );
    if (result.ok && result.data) {
      _lastGood = result.data;
      return result.data;
    }
    if (_lastGood) return _lastGood;
    throw toError(result);
  }
  if (method === "MOVE") {
    const result = await callServer(CONFIG, params.role, "/api/v1/move", {
      method: "POST",
      body: {
        client_move_id: params.clientMoveId,
        expected_revision: params.expectedRevision,
        from: params.from,
        to: params.to,
        promotion: params.promotion || null,
      },
      timeoutMs: 15000,
    });
    if (result.ok && result.data) {
      _lastGood = result.data;
      return result.data;
    }
    throw toError(result);
  }
  if (method === "ACTION") {
    const result = await callServer(CONFIG, params.role, "/api/v1/action", {
      method: "POST",
      body: {
        client_action_id: params.clientActionId,
        expected_revision: params.expectedRevision,
        type: params.type,
        claim: params.claim || null,
      },
      timeoutMs: 15000,
    });
    if (result.ok && result.data) {
      _lastGood = result.data;
      return result.data;
    }
    throw toError(result);
  }
  throw { code: "unknown", message: `unknown method ${method}` };
}

// Companion app (side service): the ONLY place that talks to the network.
// The page reaches it through BasePage.request(); the web harness calls the
// same HTTP adapter directly (see web/src/adapters/httpAdapter.js).
import { BaseSideService } from "@zeppos/zml/base-app";
import CONFIG from "../shared/config.generated.js";
import { callServer, toError } from "../shared/httpClient.js";

let _lastGood = null;

async function handleRequest(req) {
  const method = req && req.method;
  const params = (req && req.params) || {};
  if (method === "PING") {
    try {
      const res = await fetch(`${CONFIG.serverUrl}/api/v1/health`);
      return { ok: res.status >= 200 && res.status < 300 };
    } catch (_) {
      return { ok: false };
    }
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
    if (_lastGood) return _lastGood; // flaky link can still render something
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

AppSideService(
  BaseSideService({
    onInit() {},

    async onRequest(req, res) {
      try {
        const data = await handleRequest(req);
        res(null, data);
      } catch (e) {
        res(e && e.code ? e : { code: "unknown", message: String(e) });
      }
    },

    onRun() {},
    onDestroy() {},
  }),
);

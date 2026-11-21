// Companion app (side service): the ONLY place that talks to the network.
// The page reaches it through BasePage.request(); the web harness calls the
// same HTTP adapter directly (see web/src/adapters/httpAdapter.js).
import { BaseSideService } from "@zeppos/zml/base-side";
import CONFIG from "../shared/config.generated.js";
import { APP_VERSION } from "../shared/version.js";
import { callServer, checkHealth, fetchShape, serverHost, toError } from "../shared/httpClient.js";

let _lastGood = null;
// Last server round-trip outcome (no tokens — safe to expose via DIAG).
let _lastFetch = null;
let _calls = 0;

// Real display names for the offline fallback. The page bundle must not
// import the generated config (it holds the bearer tokens), so the side
// service — which does hold it — attaches the names to errors raised
// before any good state exists. The controller passes them through to
// fakeInitialState(), keeping the offline board labelled per .env.
function offlineNames() {
  return {
    p1: CONFIG.players.p1.name,
    p2: CONFIG.players.p2.name,
  };
}

function offlineError(result) {
  return { ...toError(result), names: offlineNames() };
}

function hostOf(url) {
  return serverHost({ serverUrl: url });
}

// Same callServer both the poll and the moves use, but records the outcome
// for DIAG so the watch screen can show where the link breaks.
async function trackedCall(where, role, path, opts) {
  _calls += 1;
  const result = await callServer(CONFIG, role, path, opts);
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

async function handleRequest(req) {
  const method = req && req.method;
  const params = (req && req.params) || {};
  if (method === "PING") {
    return checkHealth(CONFIG);
  }
  if (method === "GET_STATE") {
    const since = params.since != null ? params.since : 0;
    const wait = params.wait != null ? params.wait : 20;
    const result = await trackedCall(
      "state", params.role,
      `/api/v1/state?since=${since}&wait=${wait}&presence=1`,
      { timeoutMs: (wait + 15) * 1000 },
    );
    if (result.ok && result.data) {
      _lastGood = result.data;
      return result.data;
    }
    if (_lastGood) return _lastGood; // flaky link can still render something
    throw offlineError(result);
  }
  if (method === "MOVE") {
    const result = await trackedCall("move", params.role, "/api/v1/move", {
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
    const result = await trackedCall("action", params.role, "/api/v1/action", {
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
  if (method === "DIAG") {
    // Link diagnostic for the on-watch "Test link" button. Runs a live
    // health probe through the same fetch path as the poll, so the screen
    // can show whether the side service reaches the relay at all. Contains
    // no tokens: host, shape, probe outcome, last poll outcome, names only.
    // `build` identifies the installed bundle (commit + time): if it is
    // older than the current HEAD, the watch is running a stale build and
    // no server-side fix will help until it is reinstalled.
    const ping = await checkHealth(CONFIG);
    return {
      shape: fetchShape(),
      host: hostOf(CONFIG.serverUrl),
      ping,
      calls: _calls,
      lastFetch: _lastFetch,
      names: offlineNames(),
      hasTokens: Boolean(CONFIG.players.p1.token && CONFIG.players.p2.token),
      access: Boolean(CONFIG.access && CONFIG.access.clientId),
      build: CONFIG.build || null,
      version: APP_VERSION,
      role: params.role || null,
    };
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

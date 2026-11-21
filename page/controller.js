// Poll loop + move/action submission + retry queue.
// The page injects `request` (BasePage.request on the watch, the HTTP
// adapter shim in the web harness). All server traffic flows through it.
import { nextClientId, fakeInitialState } from "../shared/protocol.js";

const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 10000;
const SEND_RETRIES = 3;

export class Controller {
  constructor({ role, request, onState, onConnection, onToast }) {
    this.role = role;
    this.request = request;
    this.onState = onState;
    this.onConnection = onConnection;
    this.onToast = onToast;
    this.state = null;
    // -1: the first poll must return immediately (server returns at once
    // only when since < revision; a fresh game has revision 0).
    this.revision = -1;
    this.running = false;
    this._pollTimer = null;
    this._retryDelay = RETRY_BASE_MS;
    this._pollInFlight = false;
    this._sendQueue = []; // [{ kind, payload, clientId, attempts }]
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._retryDelay = RETRY_BASE_MS;
    this._poll();
  }

  stop() {
    this.running = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  setRevision(revision) {
    this.revision = revision;
  }

  _schedulePoll(delayMs) {
    if (!this.running) return;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(() => this._poll(), delayMs);
  }

  async _poll() {
    if (!this.running || this._pollInFlight) return;
    this._pollInFlight = true;
    try {
      const res = await this.request({
        method: "GET_STATE",
        params: { role: this.role, since: this.revision, wait: 20 },
      });
      this._pollInFlight = false;
      if (!res || !res.game) throw new Error("bad state");
      this._retryDelay = RETRY_BASE_MS;
      this.state = res;
      this.revision = res.revision;
      this.onConnection(true);
      this.onState(res);
      this._schedulePoll(0); // long-poll again immediately
    } catch (e) {
      this._pollInFlight = false;
      this.onConnection(false);
      if (!this.state) {
        // Nothing rendered yet: show the start position with an offline dot
        // so the board is usable-looking while the link is down.
        this.state = fakeInitialState(this.role);
        this.onState(this.state);
      }
      const delay = this._retryDelay;
      this._retryDelay = Math.min(this._retryDelay * 2, RETRY_MAX_MS);
      this._schedulePoll(delay);
    }
  }

  /** Immediate refresh, e.g. after a revision conflict. */
  refresh() {
    if (!this.running) return;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    this._poll();
  }

  async submitMove(from, to, promotion) {
    const clientId = nextClientId(this.role);
    const payload = {
      role: this.role,
      clientMoveId: clientId,
      expectedRevision: this.revision,
      from,
      to,
      promotion: promotion || null,
    };
    return this._sendWithRetry("MOVE", payload, clientId);
  }

  async submitAction(type, claim) {
    const clientId = nextClientId(this.role);
    const payload = {
      role: this.role,
      clientActionId: clientId,
      expectedRevision: this.revision,
      type,
      claim: claim || null,
    };
    return this._sendWithRetry("ACTION", payload, clientId);
  }

  async _sendWithRetry(method, payload, clientId) {
    let lastErr = null;
    for (let attempt = 0; attempt < SEND_RETRIES; attempt++) {
      try {
        const res = await this.request({ method, params: payload });
        if (!res || !res.game) throw new Error("bad response");
        this.state = res;
        this.revision = res.revision;
        this.onConnection(true);
        this.onState(res);
        return { ok: true, state: res };
      } catch (e) {
        lastErr = e;
        const code = (e && e.code) || "";
        // A revision conflict means our view is stale: refresh instead of
        // retrying the same (now wrong) revision.
        if (code === "revision_conflict") {
          this.refresh();
          return { ok: false, code, message: "State changed — refreshing" };
        }
        // Server-rejected moves/actions (illegal, wrong turn, ...) must not
        // be retried: the same id would just fail again.
        if (code && code !== "network" && code !== "timeout" && code !== "unknown") {
          return { ok: false, code, message: e.message || code };
        }
        if (attempt < SEND_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    this.onConnection(false);
    return {
      ok: false,
      code: (lastErr && lastErr.code) || "network",
      message: (lastErr && lastErr.message) || "No connection to server",
    };
  }
}

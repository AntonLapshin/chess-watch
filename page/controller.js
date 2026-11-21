// Poll loop + move/action submission + retry queue.
// The page injects `request` (BasePage.request on the watch, the HTTP
// adapter shim in the web harness). All server traffic flows through it.
import { nextClientId, fakeInitialState } from "../shared/protocol.js";

const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 10000;
const SEND_RETRIES = 3;

export class Controller {
  constructor({ role, request, onState, onConnection, onToast, onPollError, requestTimeoutMs, retryBaseMs, retryMaxMs }) {
    this.role = role;
    this.request = request;
    this.onState = onState;
    this.onConnection = onConnection;
    this.onToast = onToast;
    this.onPollError = onPollError;
    this.state = null;
    // -1: the first poll must return immediately (server returns at once
    // only when since < revision; a fresh game has revision 0).
    this.revision = -1;
    this.running = false;
    this.attempts = 0;
    this.lastError = null;
    this._pollTimer = null;
    this._retryBaseMs = retryBaseMs ?? RETRY_BASE_MS;
    this._retryMaxMs = retryMaxMs ?? RETRY_MAX_MS;
    this._retryDelay = this._retryBaseMs;
    this._pollInFlight = false;
    this._sendQueue = []; // [{ kind, payload, clientId, attempts }]
    this._diagInFlight = false;
    // Per-request timeouts (ms). Polls run a 20 s server long-poll behind
    // the 15 s side-service fetch timeout, so 40 s leaves margin; sends
    // get 25 s (a genuine server timeout surfaces first as code "timeout"
    // from the side service at 15 s). Overridable for tests.
    this.requestTimeoutMs = { poll: 40000, send: 25000, ...(requestTimeoutMs || {}) };
  }

  // BasePage.request has no timeout (the only timer in the ZML messaging
  // plugin is the 5 s BLE shake timer), so a lost BLE response used to
  // hang the await forever: a hung MOVE left _pendingMove set on the page
  // (no further taps accepted) and a hung poll left _pollInFlight set (no
  // further polls), while polls/actions kept working — "connected but
  // can't play" with no toast. Race every request against a timer; on
  // timeout reject with { code: "timeout" }, which the existing paths
  // already handle (poll: backoff retry; send: _sendWithRetry retries,
  // then a toast; diag: { error: "timeout" }).
  _timedRequest(payload, timeoutMs) {
    let timer = null;
    const req = this.request(payload);
    // The race may already have timed out by the time the request later
    // rejects; swallow that rejection so it never surfaces as unhandled.
    req.catch(() => {});
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject({ code: "timeout", message: "Request timed out" }),
        timeoutMs,
      );
    });
    return Promise.race([req, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._retryDelay = this._retryBaseMs;
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
    // A diagnostics run is in progress: do not start another long-poll
    // behind it — the two requests would compete on the one BLE channel
    // and the DIAG answer would sit behind a 20 s poll. Re-check shortly.
    if (this._diagInFlight) {
      this._schedulePoll(1000);
      return;
    }
    this._pollInFlight = true;
    this.attempts += 1;
    try {
      const res = await this._timedRequest(
        { method: "GET_STATE", params: { role: this.role, since: this.revision, wait: 20 } },
        this.requestTimeoutMs.poll,
      );
      this._pollInFlight = false;
      if (!res || !res.game) throw new Error("bad state");
      this._retryDelay = this._retryBaseMs;
      this.state = res;
      this.revision = res.revision;
      this.lastError = null;
      this.onConnection(true);
      this.onState(res);
      this._schedulePoll(0); // long-poll again immediately
    } catch (e) {
      this._pollInFlight = false;
      this.onConnection(false);
      this.lastError = {
        code: (e && e.code) || "unknown",
        message: (e && e.message) || String((e && e.code) || "failed"),
      };
      if (this.onPollError) this.onPollError(this.lastError, this.attempts);
      if (!this.state) {
        // Nothing rendered yet: show the start position with an offline dot
        // so the board is usable-looking while the link is down. The side
        // service attaches the real .env names (it holds the config); the
        // page bundle itself must not import the tokens.
        this.state = fakeInitialState(this.role, e && e.names);
        this.onState(this.state);
      }
      const delay = this._retryDelay;
      this._retryDelay = Math.min(this._retryDelay * 2, this._retryMaxMs);
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

  /** Side-service link diagnostic (no tokens cross the bridge).
   *  While it runs, new polls are deferred (see _poll) so the answer is
   *  not stuck behind a 20 s long-poll; a poll already in flight may still
   *  finish first. Never throws: failures come back as { error }. */
  async runDiag() {
    this._diagInFlight = true;
    try {
      const res = await this._timedRequest(
        { method: "DIAG", params: { role: this.role } },
        this.requestTimeoutMs.send,
      );
      return res || { error: "unknown" };
    } catch (e) {
      return { error: (e && e.code) || "unknown", message: (e && e.message) || String(e) };
    } finally {
      this._diagInFlight = false;
      this._schedulePoll(0);
    }
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
        const res = await this._timedRequest({ method, params: payload }, this.requestTimeoutMs.send);
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

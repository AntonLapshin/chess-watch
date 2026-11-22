// Controller request timeouts: a lost BLE response used to hang the
// await forever (BasePage.request has no timeout) — a hung MOVE left
// _pendingMove set on the page (no further taps accepted) and a hung poll
// left _pollInFlight set (no further polls), while everything else kept
// working. These tests drive the controller with a request that never
// resolves and small constructor timeouts (not the 25/40 s defaults).
import { describe, it, expect, vi } from "vitest";
import { Controller } from "./controller.js";
import { fakeInitialState } from "../shared/protocol.js";

function makeController(request, timeouts) {
  return new Controller({
    role: "p1",
    request,
    onState: vi.fn(),
    onConnection: vi.fn(),
    onToast: vi.fn(),
    onPollError: vi.fn(),
    requestTimeoutMs: { poll: 40, send: 40, ...(timeouts || {}) },
    retryBaseMs: 30,
    retryMaxMs: 60,
  });
}

function realState(revision = 0) {
  const s = fakeInitialState("p1");
  delete s._offline;
  s.revision = revision;
  return s;
}

describe("controller request timeouts", () => {
  it("submitMove times out on a never-resolving request and stays usable", async () => {
    let calls = 0;
    const request = () => {
      calls += 1;
      // Hang for all 3 send attempts of the first move, then answer.
      if (calls <= 3) return new Promise(() => {});
      return Promise.resolve(realState(1));
    };
    const c = makeController(request);
    const t0 = Date.now();
    const res = await c.submitMove("e2", "e4", null);
    expect(res).toEqual(expect.objectContaining({ ok: false, code: "timeout" }));
    // 3 x 40 ms timeouts + 2 x 1000 ms waits between send attempts.
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(calls).toBe(3);
    // No wedge: the next move goes through on the first attempt.
    const res2 = await c.submitMove("e2", "e4", null);
    expect(res2.ok).toBe(true);
    expect(res2.state.revision).toBe(1);
    expect(calls).toBe(4);
  }, 10000);

  it("a never-resolving poll recovers on the next poll", async () => {
    let calls = 0;
    const request = () => {
      calls += 1;
      if (calls === 1) return new Promise(() => {});
      return Promise.resolve(realState(0));
    };
    const c = makeController(request);
    c.start();
    // Poll 1 hangs -> timeout (40 ms) -> onPollError("timeout") -> retry
    // in 30 ms -> poll 2 succeeds with a real (non-offline) state.
    await vi.waitFor(
      () => {
        const last = c.onState.mock.calls.at(-1);
        expect(last && last[0] && !last[0]._offline).toBe(true);
      },
      { timeout: 2000, interval: 10 },
    );
    expect(c.onPollError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "timeout" }),
      1,
    );
    expect(c.state.revision).toBe(0);
    expect(c._pollInFlight).toBe(false);
    c.stop();
  }, 10000);

  it("runDiag times out on a never-resolving request", async () => {
    const c = makeController(() => new Promise(() => {}));
    const t0 = Date.now();
    const res = await c.runDiag();
    expect(res).toEqual(expect.objectContaining({ error: "timeout" }));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(c._diagInFlight).toBe(false);
  }, 10000);

  it("a slow-but-resolving request still succeeds (no false timeout)", async () => {
    const request = () =>
      new Promise((r) => setTimeout(() => r(realState(1)), 20));
    const c = makeController(request);
    const res = await c.submitMove("e2", "e4", null);
    expect(res.ok).toBe(true);
    expect(res.state.revision).toBe(1);
  }, 10000);
});

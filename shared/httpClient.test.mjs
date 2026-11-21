import { describe, it, expect, vi, afterEach } from "vitest";
import { checkHealth, callServer, toError } from "./httpClient.js";

const config = {
  serverUrl: "https://chess.example.com",
  players: { p1: { token: "player-token" } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkHealth", () => {
  it("probes /api/v1/health with no auth headers", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      body: JSON.stringify({ status: "ok" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkHealth(config)).resolves.toEqual({ ok: true, status: 200 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://chess.example.com/api/v1/health");
    expect(opts.headers).not.toHaveProperty("CF-Access-Client-Id");
    expect(opts.headers).not.toHaveProperty("Authorization");
  });

  it("does not treat an HTML error page as healthy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      body: "<!DOCTYPE html><title>Sign in</title>",
    })));
    await expect(checkHealth(config)).resolves.toEqual({ ok: false, status: 200 });
  });

  it("reports failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await expect(checkHealth(config)).resolves.toEqual({ ok: false, status: null });
  });
});

describe("callServer", () => {
  it("sends bearer headers (and no Cloudflare Access headers)", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      body: JSON.stringify({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callServer(config, "p1", "/api/v1/state?since=0", {
      method: "POST",
      body: { hello: "world" },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ ok: true });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://chess.example.com/api/v1/state?since=0");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe('{"hello":"world"}');
    expect(opts.headers).toMatchObject({
      Authorization: "Bearer player-token",
      "Content-Type": "application/json",
    });
    expect(opts.headers).not.toHaveProperty("CF-Access-Client-Id");
    expect(opts.headers).not.toHaveProperty("CF-Access-Client-Secret");
  });

  it("does not call fetch without a player token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await callServer(config, "p2", "/api/v1/state");
    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails cleanly if the Worker returns an HTML error page with 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      body: "<!DOCTYPE html><title>Sign in</title>",
    })));
    const result = await callServer(config, "p1", "/api/v1/state");
    expect(result).toMatchObject({ ok: false, code: "network" });
  });

  it("keeps an HTTP status as the error code when the body has none", () => {
    // A proxy 403 / 502 with an empty body used to
    // collapse to "unknown", hiding the exact failure from DIAG.
    expect(toError({ ok: false, status: 403, data: null })).toMatchObject({ code: "http_403" });
    expect(toError({ ok: false, status: 502, data: null })).toMatchObject({ code: "http_502" });
    // A JSON error body still wins over the status.
    expect(toError({ ok: false, status: 401, data: { code: "unauthorized" } }))
      .toMatchObject({ code: "unauthorized" });
  });

  it("uses the single-object fetch shape on the Zepp side service", async () => {
    vi.stubGlobal("messaging", { peerSocket: {} });
    const fetchMock = vi.fn(async () => ({
      status: 200,
      body: JSON.stringify({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callServer(config, "p1", "/api/v1/state?since=0", {
      method: "POST",
      body: { hello: "world" },
      timeoutMs: 12345,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [arg] = fetchMock.mock.calls[0];
    expect(arg).toMatchObject({
      url: "https://chess.example.com/api/v1/state?since=0",
      method: "POST",
      body: '{"hello":"world"}',
      timeout: 12345,
    });
    expect(arg.headers).toMatchObject({
      Authorization: "Bearer player-token",
    });
    expect(arg.headers).not.toHaveProperty("CF-Access-Client-Id");
    vi.unstubAllGlobals();
  });

  it("treats a parseable body without status as ok (side-service shape)", async () => {
    vi.stubGlobal("messaging", { peerSocket: {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      body: { revision: 3, game: {} },
    })));
    const result = await callServer(config, "p1", "/api/v1/state");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ revision: 3, game: {} });
    vi.unstubAllGlobals();
  });
});

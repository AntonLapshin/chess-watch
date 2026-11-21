import { describe, it, expect, vi, afterEach } from "vitest";
import { accessHeaders, checkHealth, callServer } from "./httpClient.js";

const config = {
  serverUrl: "https://chess.example.com",
  access: { clientId: "access-id", clientSecret: "access-secret" },
  players: { p1: { token: "player-token" } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("accessHeaders", () => {
  it("returns service-token headers when configured", () => {
    expect(accessHeaders(config)).toEqual({
      "CF-Access-Client-Id": "access-id",
      "CF-Access-Client-Secret": "access-secret",
    });
  });

  it("returns nothing without a complete Access configuration", () => {
    expect(accessHeaders({})).toEqual({});
    expect(accessHeaders({ access: { clientId: "only-id" } })).toEqual({});
    expect(accessHeaders(null)).toEqual({});
  });
});

describe("checkHealth", () => {
  it("sends the Access service token to /api/v1/health", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      body: JSON.stringify({ status: "ok" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkHealth(config)).resolves.toEqual({ ok: true });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://chess.example.com/api/v1/health");
    expect(opts.headers["CF-Access-Client-Id"]).toBe("access-id");
  });

  it("does not treat a followed Access login page as healthy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      body: "<!DOCTYPE html><title>Sign in</title>",
    })));
    await expect(checkHealth(config)).resolves.toEqual({ ok: false });
  });

  it("reports failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await expect(checkHealth(config)).resolves.toEqual({ ok: false });
  });
});

describe("callServer", () => {
  it("merges Access and bearer headers", async () => {
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
      "CF-Access-Client-Id": "access-id",
      "CF-Access-Client-Secret": "access-secret",
      Authorization: "Bearer player-token",
      "Content-Type": "application/json",
    });
  });

  it("does not call fetch without a player token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await callServer(config, "p2", "/api/v1/state");
    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails cleanly if Access returns an HTML login page with 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      body: "<!DOCTYPE html><title>Sign in</title>",
    })));
    const result = await callServer(config, "p1", "/api/v1/state");
    expect(result).toMatchObject({ ok: false, code: "network" });
  });
});

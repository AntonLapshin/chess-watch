// Worker entry tests: config validation + Bearer auth + routing to the DO stub.
// The DO itself is stubbed here; its behaviour is covered in
// tests/game-do.test.mjs and tests/integration.test.mjs.
import { describe, it, expect } from "vitest";
import worker, { validateConfig, resolveRole } from "../src/index.js";

const P1 = "test-token-p1-0000000000000001";
const P2 = "test-token-p2-0000000000000002";
const GOOD_ENV = { CHESS_TOKEN_P1: P1, CHESS_TOKEN_P2: P2 };

function stubEnv(overrides, doBody = { ok: true }, doStatus = 200) {
  return {
    ...GOOD_ENV,
    CHESS_GAME: {
      idFromName: (name) => `id:${name}`,
      get: () => ({
        fetch: async (req) =>
          new Response(JSON.stringify({ ...doBody, role: req.headers.get("x-chess-role") }), {
            status: doStatus,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    },
    ...(overrides || {}),
  };
}

describe("validateConfig", () => {
  it("missing tokens refused", () => {
    expect(validateConfig({})).toMatch(/CHESS_TOKEN_P1/);
    expect(validateConfig({ CHESS_TOKEN_P1: P1 })).toMatch(/CHESS_TOKEN_P2/);
  });
  it("equal tokens refused", () => {
    expect(validateConfig({ CHESS_TOKEN_P1: "a".repeat(32), CHESS_TOKEN_P2: "a".repeat(32) }))
      .toMatch(/differ/);
  });
  it("short token refused", () => {
    expect(validateConfig({ CHESS_TOKEN_P1: "short", CHESS_TOKEN_P2: "b".repeat(32) }))
      .toMatch(/at least 24/);
  });
  it("CHANGEME placeholders refused", () => {
    expect(validateConfig({
      CHESS_TOKEN_P1: "CHANGEME-p1-token-at-least-24-chars-long-00000001",
      CHESS_TOKEN_P2: P2,
    })).toMatch(/placeholder/);
  });
  it("good config passes", () => {
    expect(validateConfig(GOOD_ENV)).toBe(null);
  });
});

describe("resolveRole", () => {
  it("maps each token to its role", () => {
    expect(resolveRole(`Bearer ${P1}`, GOOD_ENV)).toBe("p1");
    expect(resolveRole(`Bearer ${P2}`, GOOD_ENV)).toBe("p2");
  });
  it("rejects missing, malformed and wrong tokens", () => {
    expect(resolveRole(null, GOOD_ENV)).toBe(null);
    expect(resolveRole("Basic abc", GOOD_ENV)).toBe(null);
    expect(resolveRole("Bearer nope-nope-nope-nope", GOOD_ENV)).toBe(null);
  });
});

describe("worker fetch", () => {
  it("health needs no auth and returns ok", async () => {
    const res = await worker.fetch(new Request("http://test/api/v1/health"), GOOD_ENV, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "0.2.0" });
  });

  it("health with a broken config is 500 config_error", async () => {
    const res = await worker.fetch(new Request("http://test/api/v1/health"), {}, {});
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("config_error");
  });

  it("state without auth is 401", async () => {
    const res = await worker.fetch(
      new Request("http://test/api/v1/state"), stubEnv(), {},
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unauthorized");
  });

  it("state with a bad token is 401", async () => {
    const res = await worker.fetch(
      new Request("http://test/api/v1/state", {
        headers: { Authorization: "Bearer nope-nope-nope-nope" },
      }),
      stubEnv(), {},
    );
    expect(res.status).toBe(401);
  });

  it("state with a good token reaches the DO with the role header", async () => {
    const res = await worker.fetch(
      new Request("http://test/api/v1/state", {
        headers: { Authorization: `Bearer ${P1}` },
      }),
      stubEnv(), {},
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, role: "p1" });
  });

  it("broken config fails API requests with 500, before auth", async () => {
    const res = await worker.fetch(
      new Request("http://test/api/v1/state", {
        headers: { Authorization: `Bearer ${P1}` },
      }),
      stubEnv({ CHESS_TOKEN_P1: "", CHESS_TOKEN_P2: "" }), {},
    );
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("config_error");
  });

  it("unknown path is 404", async () => {
    const res = await worker.fetch(new Request("http://test/nope"), stubEnv(), {});
    expect(res.status).toBe(404);
  });

  it("OPTIONS preflight answers 204 for an allowed origin", async () => {
    const res = await worker.fetch(
      new Request("http://test/api/v1/state", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:5173" },
      }),
      stubEnv(), {},
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("OPTIONS preflight is 204 without CORS headers for a disallowed origin", async () => {
    const res = await worker.fetch(
      new Request("http://test/api/v1/state", {
        method: "OPTIONS",
        headers: { Origin: "https://example.com" },
      }),
      stubEnv(), {},
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("CHESS_CORS_ORIGINS (comma-separated) adds allowed origins", async () => {
    const res = await worker.fetch(
      new Request("http://test/api/v1/state", {
        method: "OPTIONS",
        headers: { Origin: "https://example.com" },
      }),
      stubEnv({ CHESS_CORS_ORIGINS: "https://example.com, https://other.example" }), {},
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
  });
});

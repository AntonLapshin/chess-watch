// Chess Watch Worker entry: auth + routing to the ChessGame Durable Object.
// /health is answered by the Worker directly; everything else goes to the DO.
//
// Tokens come from Worker secrets (CHESS_TOKEN_P1 / CHESS_TOKEN_P2) or
// .dev.vars for local dev. Missing, equal, or <24-char tokens — or the
// CHANGEME placeholders — fail EVERY /api/v1/* request with 500
// config_error (there is no deploy-time startup to refuse in, so the
// failure surfaces on first request instead). Names are Worker vars
// CHESS_P1_NAME / CHESS_P2_NAME (defaults Aurora / Sam).
import { ChessGame } from "./game-do.js";

export { ChessGame };

const MIN_TOKEN_LEN = 24;
// CORS allow-list for the browser harness only (the watch does not use
// CORS). Default is the Vite dev server; set CHESS_CORS_ORIGINS as a
// Worker var / secret / .dev.vars entry, comma-separated, to allow more
// origins (e.g. the deployed Worker URL for `make web` against it).
function corsOrigins(env) {
  const extra = (env.CHESS_CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set(["http://localhost:5173", ...extra]);
}

function jsonResponse(body, status = 200, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
  });
}

/** Constant-time string compare (no crypto.subtle needed). */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function validateConfig(env) {
  const p1 = env.CHESS_TOKEN_P1 || "";
  const p2 = env.CHESS_TOKEN_P2 || "";
  if (!p1) return "missing CHESS_TOKEN_P1: run `make worker-secrets`";
  if (!p2) return "missing CHESS_TOKEN_P2: run `make worker-secrets`";
  if (p1 === p2) return "CHESS_TOKEN_P1 and CHESS_TOKEN_P2 must differ";
  if (p1.length < MIN_TOKEN_LEN) return `CHESS_TOKEN_P1 must be at least ${MIN_TOKEN_LEN} characters`;
  if (p2.length < MIN_TOKEN_LEN) return `CHESS_TOKEN_P2 must be at least ${MIN_TOKEN_LEN} characters`;
  if (p1.startsWith("CHANGEME") || p2.startsWith("CHANGEME")) {
    return "CHESS_TOKEN_P1/CHESS_TOKEN_P2 are still the placeholders; set real secrets";
  }
  return null;
}

export function resolveRole(authorization, env) {
  if (!authorization) return null;
  const parts = authorization.split(/\s+/, 2);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  const token = parts[1].trim();
  // Compare against both tokens every time so timing leaks nothing.
  const p1 = safeEqual(token, env.CHESS_TOKEN_P1 || "");
  const p2 = safeEqual(token, env.CHESS_TOKEN_P2 || "");
  if (p1) return "p1";
  if (p2) return "p2";
  return null;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (origin && corsOrigins(env).has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    };
  }
  return {};
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/v1/")) {
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === "/api/v1/health" || url.pathname === "/health") {
      if (request.method !== "GET") {
        return jsonResponse({ code: "method_not_allowed", message: "GET only" }, 405, cors);
      }
      const configError = validateConfig(env);
      if (configError) {
        return jsonResponse({ code: "config_error", message: configError }, 500, cors);
      }
      return jsonResponse({ status: "ok", version: "0.2.0" }, 200, cors);
    }
    if (!url.pathname.startsWith("/api/v1/")) {
      return jsonResponse({ code: "not_found", message: "unknown endpoint" }, 404, cors);
    }
    const configError = validateConfig(env);
    if (configError) {
      return jsonResponse({ code: "config_error", message: configError }, 500, cors);
    }
    const role = resolveRole(request.headers.get("Authorization"), env);
    if (role === null) {
      return jsonResponse({ code: "unauthorized", message: "missing or invalid bearer token" }, 401, cors);
    }
    const id = env.CHESS_GAME.idFromName("game");
    const stub = env.CHESS_GAME.get(id);
    const headers = new Headers(request.headers);
    headers.set("x-chess-role", role);
    const forwarded = new Request(request, { headers });
    const response = await stub.fetch(forwarded);
    // Pass CORS through on DO responses.
    if (Object.keys(cors).length > 0) {
      const out = new Headers(response.headers);
      for (const [k, v] of Object.entries(cors)) out.set(k, v);
      return new Response(response.body, { status: response.status, headers: out });
    }
    return response;
  },
};

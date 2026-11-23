// ChessGame Durable Object — the single source of truth for the game.
// Cloudflare Durable Object with SQLite storage (ctx.storage.sql) and
// chess.js.
//
// Design notes:
//   - The board is NOT rebuilt by replaying moves per request. The live
//     Chess instance is cached on the DO object between requests; on a
//     cold start it is loaded from the stored FEN (cheap). A 200-ply
//     replay + legal moves costs ~22–38 ms (measured in workerd and Node respectively), over the Workers Free 10 ms
//     CPU/invocation cap; a FEN load is ~1 ms. Replay is used only for
//     takeback (truncated history) and restart.
//   - Repetition comes from a persisted position-count map (see
//     src/rules.js): chess.js 1.4.0 has no fivefold/75-move APIs and its
//     isThreefoldRepetition() is false after load(fen) (empty history).
//   - Long-poll waiters are a per-DO list of resolvers + setTimeout.
//     Do NOT use blockConcurrencyWhile for the wait (30 s timeout + it
//     blocks the DO). A pending long-poll keeps the DO non-hibernatable,
//     so it bills duration while a watch page is open — expected; see
//     worker/README.md for the free-tier numbers.
//   - Offer expiry is BOTH lazy on read (as before) AND via setAlarm()
//     on offer creation, so an expired offer clears even with no traffic.
import { Chess } from "chess.js";
import { ACTION_TYPES } from "../../shared/protocol.js";
import {
  START_FEN,
  PROMOTION_PIECES,
  initialPositionCounts,
  positionCountsFor,
  replay,
  terminalAndClaimable,
  legalMovesUci,
  promotionMoves,
  kingSquare,
  takebackPlies,
  moveRecord,
  trimmedFen,
} from "./rules.js";
import * as store from "./store.js";

export const VERSION = "0.2.2";
const ONLINE_WINDOW_S = 45;
const SQUARE_RE = /^[a-h][1-8]$/;

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    const v = JSON.parse(text);
    return v == null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class ChessGame {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this.sql = ctx.storage.sql;
    this.game = null; // parsed in-memory state (see ensureLoaded)
    this.board = null; // cached Chess instance, kept in sync with game
    this.derived = null; // per-revision derived position data (see _derived)
    this.waiters = []; // { since, resolve, timer }
    this.presence = {}; // role -> last-seen epoch seconds
  }

  // Derived position data, cached per revision: legal-move generation is
  // the expensive part of a state payload, and a long-poll returns the
  // same position dozens of times between moves. The cache key is the
  // revision, which every mutation bumps, so it can never serve a stale
  // position. Presence and server_time stay per-request — they change
  // without a revision bump, so they are not cached.
  _derived() {
    const g = this.game;
    if (this.derived && this.derived.revision === g.revision) return this.derived;
    const board = this.board;
    // check is a property of the board, not of the game status: a
    // checkmate still reports the mated king in check (the watch status
    // bar already branches on finished first, and the board tints the
    // checked king's square). Previously this was gated on active, so a
    // mate reported check=false / check_square=null.
    const check = board.isCheck();
    this.derived = {
      revision: g.revision,
      check,
      checkSquare: check ? kingSquare(board) : null,
      turn: board.turn(),
      legal: g.status === "active" ? legalMovesUci(board) : [],
    };
    return this.derived;
  }

  // -- config -------------------------------------------------------------
  nameFor(role) {
    const name = role === "p1" ? this.env.CHESS_P1_NAME : this.env.CHESS_P2_NAME;
    return name || (role === "p1" ? "Aurora" : "Sam");
  }

  offerTtl() {
    const ttl = parseInt(this.env.CHESS_OFFER_TTL || "120", 10);
    return Number.isFinite(ttl) && ttl > 0 ? ttl : 120;
  }

  roleColor(role) {
    return role === "p1" ? "w" : "b";
  }

  opponentRole(role) {
    return role === "p1" ? "p2" : "p1";
  }

  // -- persistence --------------------------------------------------------
  ensureLoaded(now) {
    if (this.game) return;
    store.ensureSchema(this.sql);
    const row = store.loadGame(this.sql, now);
    const moves = parseJson(row.moves_json, []);
    this.game = {
      revision: row.revision,
      fen: row.fen,
      moves: Array.isArray(moves) ? moves : [],
      status: row.status,
      result: row.result,
      result_reason: row.result_reason,
      claimable: parseJson(row.claimable_json, []),
      offer: parseJson(row.offer_json, null),
      lastAction: parseJson(row.last_action_json, null),
      gameNo: row.game_no,
      updatedAt: row.updated_at,
      positions: parseJson(row.positions_json, {}),
    };
    if (Object.keys(this.game.positions).length === 0 && this.game.moves.length === 0) {
      this.game.positions = initialPositionCounts();
    }
    this.board = new Chess(this.game.fen);
  }

  toRow() {
    const g = this.game;
    return {
      revision: g.revision,
      fen: g.fen,
      moves_json: JSON.stringify(g.moves),
      status: g.status,
      result: g.result,
      result_reason: g.result_reason,
      claimable_json: JSON.stringify(g.claimable),
      offer_json: g.offer ? JSON.stringify(g.offer) : null,
      last_action_json: g.lastAction ? JSON.stringify(g.lastAction) : null,
      game_no: g.gameNo,
      updated_at: g.updatedAt,
      positions_json: JSON.stringify(g.positions),
    };
  }

  save() {
    store.saveGame(this.sql, this.toRow());
  }

  // -- long-poll waiters ----------------------------------------------------
  wakeWaiters() {
    const rev = this.game.revision;
    const ready = this.waiters.filter((w) => w.since < rev);
    this.waiters = this.waiters.filter((w) => w.since >= rev);
    for (const w of ready) {
      clearTimeout(w.timer);
      w.resolve(true);
    }
  }

  waitForRevision(since, waitMs) {
    if (this.game.revision > since) return Promise.resolve(true);
    return new Promise((resolve) => {
      const entry = { since, resolve, timer: null };
      entry.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== entry);
        resolve(false);
      }, waitMs);
      this.waiters.push(entry);
    });
  }

  // -- offers ---------------------------------------------------------------
  expireOffer(now) {
    const offer = this.game.offer;
    if (!offer) return false;
    if (now < Number(offer.expires_at || 0)) return false;
    this.game.offer = null;
    this.game.revision += 1;
    this.game.updatedAt = now;
    this.game.lastAction = { type: "offer_expired", by: offer.by, at: now };
    this.save();
    this.wakeWaiters();
    return true;
  }

  armOfferAlarm(expiresAt) {
    try {
      const setAlarm = this.ctx && this.ctx.storage && this.ctx.storage.setAlarm;
      if (typeof setAlarm === "function") {
        setAlarm.call(this.ctx.storage, Math.floor(expiresAt * 1000));
      }
    } catch (_) {
      // Alarms are best-effort here: expiry is also applied lazily on read.
    }
  }

  async alarm() {
    this.ensureLoaded(Date.now() / 1000);
    this.expireOffer(Date.now() / 1000);
  }

  // -- state payload (see docs/protocol.md) ----------------------------------
  buildState(role, now) {
    const g = this.game;
    const board = this.board;
    const moves = g.moves;
    const youColor = this.roleColor(role);
    const oppRole = this.opponentRole(role);
    const oppSeen = this.presence[oppRole] || 0;
    const d = this._derived();
    const check = d.check;
    const checkSquare = d.checkSquare;
    // recent_moves is the last 6 moves, labelled with their ABSOLUTE ply
    // numbers (1-based across the whole game). Previously the window was
    // numbered 1..6, so after ply 6 every label was wrong; nothing
    // consumed ply (clients only display san), but a history view would
    // have mislabelled every move.
    const tail = moves.slice(-6);
    const recent = tail.map((m, i) => ({
      ply: moves.length - tail.length + i + 1,
      san: m.san,
      by: m.by,
    }));
    let last = null;
    if (moves.length > 0) {
      const m = moves[moves.length - 1];
      last = { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), san: m.san, by: m.by };
    }
    let legal = [];
    if (g.status === "active" && d.turn === youColor) {
      legal = d.legal;
    }
    return {
      revision: g.revision,
      server_time: now,
      game_no: g.gameNo,
      you: { role, color: youColor, name: this.nameFor(role) },
      opponent: {
        role: oppRole,
        name: this.nameFor(oppRole),
        color: this.roleColor(oppRole),
        online: now - oppSeen <= ONLINE_WINDOW_S,
      },
      game: {
        status: g.status,
        result: g.result,
        result_reason: g.result_reason,
        turn: board.turn(),
        fen: board.fen(),
        ply: moves.length,
        last_move: last,
        recent_moves: recent,
        check,
        check_square: checkSquare,
        claimable: g.claimable,
        legal_moves: legal,
        offer: g.offer,
        last_action: g.lastAction,
      },
    };
  }

  err(code, message, status, state) {
    const body = { code, message };
    if (state !== undefined) body.state = state;
    return jsonResponse(body, status);
  }

  // -- request routing -------------------------------------------------------
  async fetch(request) {
    const url = new URL(request.url);
    const role = request.headers.get("x-chess-role");
    if (role !== "p1" && role !== "p2") {
      return this.err("unauthorized", "missing or invalid bearer token", 401);
    }
    const now = Date.now() / 1000;
    this.ensureLoaded(now);
    if (url.pathname === "/api/v1/state" && request.method === "GET") {
      return this.handleState(request, url, role, now);
    }
    if (url.pathname === "/api/v1/move" && request.method === "POST") {
      return this.handleMove(request, role, now);
    }
    if (url.pathname === "/api/v1/action" && request.method === "POST") {
      return this.handleAction(request, role, now);
    }
    return this.err("not_found", "unknown endpoint", 404);
  }

  async handleState(request, url, role, now) {
    // Presence is opt-in via the query param, as documented: only
    // presence=1 marks the caller online. Previously every state call
    // marked presence (the param was never read), so the flag was dead.
    // Both real clients (side service, web harness) send presence=1.
    if (url.searchParams.get("presence") === "1") this.presence[role] = now;
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw === null || sinceRaw === "" ? null : parseInt(sinceRaw, 10);
    const waitRaw = url.searchParams.get("wait");
    const waitS = waitRaw === null ? 0 : Math.max(0, Math.min(25, parseFloat(waitRaw) || 0));
    this.expireOffer(Date.now() / 1000);
    if (since === null || Number.isNaN(since) || since < this.game.revision) {
      return jsonResponse(this.buildState(role, Date.now() / 1000));
    }
    await this.waitForRevision(since, waitS * 1000);
    this.expireOffer(Date.now() / 1000);
    return jsonResponse(this.buildState(role, Date.now() / 1000));
  }

  async handleMove(request, role, now) {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return this.err("invalid_request", "request body must be JSON", 422);
    }
    if (
      !body || typeof body.client_move_id !== "string" ||
      body.client_move_id.length < 1 || body.client_move_id.length > 128 ||
      !Number.isInteger(body.expected_revision) ||
      typeof body.from !== "string" || typeof body.to !== "string" ||
      (body.promotion !== null && body.promotion !== undefined && typeof body.promotion !== "string")
    ) {
      return this.err("invalid_request", "invalid move request", 422);
    }
    const from = body.from;
    const to = body.to;
    const promotion = body.promotion == null ? null : String(body.promotion).toLowerCase();
    this.expireOffer(now);
    const g = this.game;
    // Idempotency lookup (before revision check) — mirrors app.py.
    if (store.findMoveByClientId(this.sql, body.client_move_id)) {
      const payload = this.buildState(role, now);
      payload.duplicate = true;
      return jsonResponse(payload);
    }
    if (body.expected_revision !== g.revision) {
      return this.err(
        "revision_conflict",
        `expected revision ${body.expected_revision}, current is ${g.revision}`,
        409,
        this.buildState(role, now),
      );
    }
    if (g.status !== "active") {
      return this.err("game_over", "the game is already over", 409);
    }
    if (this.board.turn() !== this.roleColor(role)) {
      return this.err("not_your_turn", "it is not your turn", 409);
    }
    if (!SQUARE_RE.test(from) || !SQUARE_RE.test(to)) {
      return this.err("illegal_move", "invalid square", 422);
    }
    const legal = this.board.moves({ verbose: true });
    const promos = promotionMoves(this.board, from, to);
    if (promos.length > 0 && (!promotion || !PROMOTION_PIECES.has(promotion))) {
      return this.err("promotion_required", "choose a promotion piece (q, r, b, n)", 422);
    }
    const match = legal.find(
      (m) => m.from === from && m.to === to && (m.promotion || null) === promotion,
    );
    if (!match) {
      return this.err("illegal_move", "that move is not legal", 422);
    }
    const rec = moveRecord(this.board, match, role);
    this.board.move({ from, to, promotion: match.promotion });
    g.moves.push({ uci: rec.uci, san: rec.san, by: role, by_color: rec.by_color });
    const key = trimmedFen(this.board.fen());
    g.positions[key] = (g.positions[key] || 0) + 1;
    const t = terminalAndClaimable(this.board, g.positions);
    g.fen = this.board.fen();
    g.status = t.status || "active";
    g.result = t.result;
    g.result_reason = t.resultReason;
    g.claimable = t.claimable;
    g.revision += 1;
    g.updatedAt = now;
    store.insertMove(this.sql, {
      gameNo: g.gameNo,
      ply: g.moves.length,
      uci: rec.uci,
      san: rec.san,
      byRole: role,
      fenAfter: this.board.fen(),
      clientMoveId: body.client_move_id,
      now,
    });
    this.save();
    this.wakeWaiters();
    const payload = this.buildState(role, now);
    payload.duplicate = false;
    return jsonResponse(payload);
  }

  async handleAction(request, role, now) {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return this.err("invalid_request", "request body must be JSON", 422);
    }
    if (
      !body || typeof body.client_action_id !== "string" ||
      body.client_action_id.length < 1 || body.client_action_id.length > 128 ||
      !Number.isInteger(body.expected_revision) ||
      typeof body.type !== "string" || !ACTION_TYPES.includes(body.type) ||
      (body.claim !== null && body.claim !== undefined &&
        body.claim !== "threefold" && body.claim !== "fifty")
    ) {
      return this.err("invalid_request", "invalid action request", 422);
    }
    this.expireOffer(now);
    const g = this.game;
    if (store.findActionByClientId(this.sql, body.client_action_id)) {
      const payload = this.buildState(role, now);
      payload.duplicate = true;
      return jsonResponse(payload);
    }
    if (body.expected_revision !== g.revision) {
      return this.err(
        "revision_conflict",
        `expected revision ${body.expected_revision}, current is ${g.revision}`,
        409,
        this.buildState(role, now),
      );
    }
    const moves = g.moves;
    const offer = g.offer;
    const youColor = this.roleColor(role);
    const oppRole = this.opponentRole(role);
    let lastAction = null;

    if (body.type === "offer_restart" || body.type === "offer_takeback" || body.type === "offer_draw") {
      if (offer !== null) {
        return this.err("offer_pending", "an offer is already pending", 409);
      }
      if (body.type === "offer_takeback") {
        if (g.status !== "active") {
          return this.err("game_over", "takeback is only available during play", 409);
        }
        if (takebackPlies(moves, youColor) === null) {
          return this.err("takeback_unavailable", "there is no move to take back", 409);
        }
      }
      if (body.type === "offer_draw" && g.status !== "active") {
        return this.err("game_over", "the game is already over", 409);
      }
      const expiresAt = now + this.offerTtl();
      g.offer = { type: body.type, by: role, expires_at: expiresAt };
      lastAction = { type: body.type, by: role, at: now };
      this.armOfferAlarm(expiresAt);
    } else if (body.type === "accept" || body.type === "decline") {
      if (offer === null) {
        return this.err("no_offer", "there is no pending offer", 409);
      }
      if (offer.by === role) {
        return this.err("not_recipient", "only the opponent may answer an offer", 409);
      }
      const offerType = offer.type;
      if (body.type === "decline") {
        g.offer = null;
        lastAction = { type: "offer_declined", by: role, at: now };
      } else if (offerType === "offer_restart") {
        const oldGameNo = g.gameNo;
        store.clearMoves(this.sql, oldGameNo);
        // Idempotency is per-game for moves (their rows are wiped above)
        // and must be per-game for actions too: without this, a
        // client_action_id from a finished game would keep returning
        // duplicate:true forever, silently dropping a legitimate new
        // action that happened to reuse the id (e.g. a counter-based
        // client). A stale retry is still safe: it reaches the revision
        // check next and fails with revision_conflict.
        store.clearActions(this.sql);
        g.gameNo = oldGameNo + 1;
        g.fen = START_FEN;
        g.moves = [];
        g.status = "active";
        g.result = null;
        g.result_reason = null;
        g.claimable = [];
        g.offer = null;
        g.positions = initialPositionCounts();
        this.board = new Chess();
        lastAction = { type: "restart_accepted", by: role, at: now };
      } else if (offerType === "offer_takeback") {
        const plies = takebackPlies(moves, this.roleColor(offer.by));
        if (plies === null) {
          return this.err("takeback_unavailable", "there is no move to take back", 409);
        }
        const keep = Math.max(0, moves.length - plies);
        store.deleteMovesFromPly(this.sql, g.gameNo, keep);
        g.moves = moves.slice(0, keep);
        // Rebuild from the truncated history (rare op): board + counts.
        this.board = replay(g.moves.map((m) => m.uci));
        g.positions = positionCountsFor(g.moves.map((m) => m.uci));
        g.fen = this.board.fen();
        g.claimable = terminalAndClaimable(this.board, g.positions).claimable;
        g.offer = null;
        lastAction = { type: "takeback_accepted", by: role, at: now };
      } else if (offerType === "offer_draw") {
        g.status = "finished";
        g.result = "draw";
        g.result_reason = "agreement";
        g.offer = null;
        lastAction = { type: "draw_accepted", by: role, at: now };
      } else {
        return this.err("no_offer", "unknown pending offer", 409);
      }
    } else if (body.type === "resign") {
      if (g.status !== "active") {
        return this.err("game_over", "the game is already over", 409);
      }
      g.status = "finished";
      g.result = this.roleColor(oppRole);
      g.result_reason = "resign";
      g.offer = null;
      lastAction = { type: "resign", by: role, at: now };
    } else if (body.type === "claim_draw") {
      if (g.status !== "active") {
        return this.err("game_over", "the game is already over", 409);
      }
      if (body.claim == null || !g.claimable.includes(body.claim) || this.board.turn() !== youColor) {
        return this.err("invalid_claim", "that draw cannot be claimed now", 409);
      }
      g.status = "finished";
      g.result = "draw";
      g.result_reason = body.claim === "threefold" ? "threefold_claim" : "fifty_claim";
      g.offer = null;
      lastAction = { type: "claim_draw", by: role, at: now };
    } else {
      return this.err("invalid_action", "unknown action type", 422);
    }

    g.revision += 1;
    g.updatedAt = now;
    if (lastAction !== null) g.lastAction = lastAction;
    store.insertAction(this.sql, {
      clientActionId: body.client_action_id,
      type: body.type,
      actor: role,
      revision: g.revision,
      payload: body.claim ? { claim: body.claim } : {},
      now,
    });
    this.save();
    this.wakeWaiters();
    const payload = this.buildState(role, now);
    payload.duplicate = false;
    return jsonResponse(payload);
  }
}

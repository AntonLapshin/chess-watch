import { describe, it, expect } from "vitest";
import { renderBoard } from "./board.js";
import { LAYOUTS } from "./layout.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeState(overrides = {}) {
  return {
    you: { role: "p1", color: "w", name: "Dad" },
    opponent: { role: "p2", name: "Emma", color: "b", online: true },
    game: {
      status: "active", result: null, result_reason: null,
      turn: "w", fen: START_FEN, ply: 0, last_move: null,
      recent_moves: [], check: false, check_square: null,
      claimable: [],
      legal_moves: ["e2e3", "e2e4", "a2a3", "a2a4"],
      offer: null, last_action: null,
    },
    ...overrides,
  };
}

/** Stub hmUI: records every widget and its tap path. */
function stubHmUI() {
  const created = [];
  return {
    created,
    widget: { FILL_RECT: "FILL_RECT", IMG: "IMG" },
    event: { CLICK_DOWN: "CLICK_DOWN" },
    createWidget(type, props) {
      const w = {
        type, props: { ...props }, listeners: {},
        addEventListener(ev, fn) { this.listeners[ev] = fn; },
      };
      created.push(w);
      return w;
    },
  };
}

function tap(w) {
  if (w.props.click_func) return w.props.click_func();
  if (w.listeners.CLICK_DOWN) return w.listeners.CLICK_DOWN();
  throw new Error(`widget ${w.type} at ${w.props.x},${w.props.y} has no tap handler`);
}

function hasTap(w) {
  return Boolean(w.props.click_func || w.listeners.CLICK_DOWN);
}

function contains(w, x, y) {
  return x >= w.props.x && x < w.props.x + w.props.w
    && y >= w.props.y && y < w.props.y + w.props.h;
}

/** Centre of a square in display pixels (layout s, unflipped). */
function squareCentre(layout, file, rankIdx, flipped = false) {
  const col = flipped ? 7 - file : file;
  const row = flipped ? rankIdx : 7 - rankIdx;
  const { x, y, cell } = layout.board;
  return { x: x + col * cell + cell / 2, y: y + row * cell + cell / 2 };
}

describe("renderBoard taps", () => {
  it("tapping a piece image calls onSquare with that square", () => {
    const hmUI = stubHmUI();
    const seen = [];
    renderBoard(hmUI, [], {
      layout: LAYOUTS.s, state: makeState(),
      selected: null, targets: [], pendingMove: false,
      onSquare: (uci) => seen.push(uci),
    });
    // e2 pawn IMG: the topmost widget at the centre of e2.
    const c = squareCentre(LAYOUTS.s, 4, 1);
    const top = [...hmUI.created].reverse().find((w) => contains(w, c.x, c.y));
    expect(top.type).toBe("IMG");
    tap(top);
    expect(seen).toEqual(["e2"]);
  });

  it("tapping an empty square calls onSquare with that square", () => {
    const hmUI = stubHmUI();
    const seen = [];
    renderBoard(hmUI, [], {
      layout: LAYOUTS.s, state: makeState(),
      selected: null, targets: [], pendingMove: false,
      onSquare: (uci) => seen.push(uci),
    });
    const c = squareCentre(LAYOUTS.s, 4, 3); // e4, empty
    const top = [...hmUI.created].reverse().find((w) => contains(w, c.x, c.y));
    expect(top.type).toBe("FILL_RECT");
    tap(top);
    expect(seen).toEqual(["e4"]);
  });

  it("tapping a legal-move dot calls onSquare with the target square", () => {
    const hmUI = stubHmUI();
    const seen = [];
    renderBoard(hmUI, [], {
      layout: LAYOUTS.s, state: makeState(),
      selected: "e2", targets: ["e4"], pendingMove: false,
      onSquare: (uci) => seen.push(uci),
    });
    const c = squareCentre(LAYOUTS.s, 4, 3); // e4 dot
    const top = [...hmUI.created].reverse().find((w) => contains(w, c.x, c.y));
    expect(top.props.color).toBeDefined();
    tap(top);
    expect(seen).toEqual(["e4"]);
  });

  it("tapping the selection frame calls onSquare with the selected square", () => {
    const hmUI = stubHmUI();
    const seen = [];
    renderBoard(hmUI, [], {
      layout: LAYOUTS.s, state: makeState(),
      selected: "e2", targets: [], pendingMove: false,
      onSquare: (uci) => seen.push(uci),
    });
    // Top edge of the e2 frame: square e2 starts at (195, 298), so the
    // top frame rect is { x: 195, y: 298, w: 42, h: 3 }.
    const frameTop = hmUI.created.find(
      (w) => w.type === "FILL_RECT" && w.props.h === 3
        && w.props.x === 195 && w.props.y === 298,
    );
    expect(frameTop).toBeDefined();
    tap(frameTop);
    expect(seen).toEqual(["e2"]);
  });

  it("flipped (Black) view: tapping a black piece calls onSquare with its square", () => {
    const hmUI = stubHmUI();
    const seen = [];
    const blackState = makeState({
      you: { role: "p2", color: "b", name: "Emma" },
      game: { ...makeState().game, turn: "b" },
    });
    renderBoard(hmUI, [], {
      layout: LAYOUTS.s, state: blackState,
      selected: null, targets: [], pendingMove: false,
      onSquare: (uci) => seen.push(uci),
    });
    const c = squareCentre(LAYOUTS.s, 4, 6, true); // e7, flipped
    const top = [...hmUI.created].reverse().find((w) => contains(w, c.x, c.y));
    expect(top.type).toBe("IMG");
    tap(top);
    expect(seen).toEqual(["e7"]);
  });

  it("no dead widget covers any square centre (regression: every topmost widget has a tap path)", () => {
    const hmUI = stubHmUI();
    renderBoard(hmUI, [], {
      layout: LAYOUTS.s, state: makeState(),
      selected: "e2", targets: ["e4"], pendingMove: false,
      onSquare: () => {},
    });
    for (let file = 0; file < 8; file++) {
      for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
        const uci = String.fromCharCode(97 + file) + (rankIdx + 1);
        const c = squareCentre(LAYOUTS.s, file, rankIdx);
        const top = [...hmUI.created].reverse().find((w) => contains(w, c.x, c.y));
        expect(top, `no widget at centre of ${uci}`).toBeDefined();
        expect(hasTap(top), `topmost widget at ${uci} has no tap handler`).toBe(true);
      }
    }
  });
});

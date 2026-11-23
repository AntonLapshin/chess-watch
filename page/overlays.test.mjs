import { describe, it, expect } from "vitest";
import { renderMenu, renderPicker, renderResult } from "./overlays.js";
import { fakeInitialState } from "../shared/protocol.js";
import { LAYOUTS } from "./layout.js";

/** Stub hmUI modelling the device: click_func fires on BUTTON only;
 *  FILL_RECT and IMG need addEventListener(CLICK_DOWN) — click_func on
 *  them is silently ignored on the real watch (0.2.2 board bug). */
function stubHmUI() {
  const created = [];
  return {
    created,
    widget: { FILL_RECT: "FILL_RECT", IMG: "IMG", TEXT: "TEXT", BUTTON: "BUTTON" },
    align: { CENTER_H: "CENTER_H", CENTER_V: "CENTER_V" },
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
  if (w.listeners.CLICK_DOWN) return w.listeners.CLICK_DOWN();
  if (w.type === "BUTTON" && w.props.click_func) return w.props.click_func();
  throw new Error(`widget ${w.type} at ${w.props.x},${w.props.y} has no tap handler`);
}

describe("overlay backdrop", () => {
  it("tapping outside the menu panel closes the menu", () => {
    const hmUI = stubHmUI();
    const seen = [];
    renderMenu(hmUI, [], LAYOUTS.s, {
      onClose: () => seen.push("close"),
      onOfferDraw: () => {}, onTakeback: () => {}, onRestart: () => {},
      onResign: () => {}, onToggleHaptics: () => {}, onTestLink: () => {},
      onSwitchPlayer: () => {}, hapticsOn: true,
    });
    // The backdrop is the full-screen FILL_RECT, created first.
    const bg = hmUI.created[0];
    expect(bg.type).toBe("FILL_RECT");
    expect(bg.props.w).toBe(LAYOUTS.s.width);
    expect(bg.props.h).toBe(LAYOUTS.s.height);
    tap(bg);
    expect(seen).toEqual(["close"]);
  });

  it("menu buttons still work via BUTTON click_func", () => {
    const hmUI = stubHmUI();
    const seen = [];
    renderMenu(hmUI, [], LAYOUTS.s, {
      onClose: () => seen.push("close"),
      onOfferDraw: () => {}, onTakeback: () => {}, onRestart: () => seen.push("restart"),
      onResign: () => {}, onToggleHaptics: () => {}, onTestLink: () => {},
      onSwitchPlayer: () => {}, hapticsOn: true,
    });
    const btn = hmUI.created.find((w) => w.type === "BUTTON" && w.props.text === "Start over");
    expect(btn).toBeDefined();
    tap(btn);
    expect(seen).toEqual(["restart"]);
  });

  it("picker buttons work via BUTTON click_func", () => {
    const hmUI = stubHmUI();
    const seen = [];
    renderPicker(hmUI, [], LAYOUTS.s, (role) => seen.push(role));
    const btn = hmUI.created.find((w) => w.type === "BUTTON" && w.props.text === "Player 2 — Black");
    expect(btn).toBeDefined();
    tap(btn);
    expect(seen).toEqual(["p2"]);
  });
});

function menuLabels(hmUI) {
  return hmUI.created.filter((w) => w.type === "BUTTON").map((w) => w.props.text);
}

describe("menu after the game ends", () => {
  const baseOpts = {
    onClose: () => {}, onOfferDraw: () => {}, onTakeback: () => {}, onRestart: () => {},
    onResign: () => {}, onToggleHaptics: () => {}, onTestLink: () => {},
    onSwitchPlayer: () => {}, hapticsOn: true,
  };

  it("finished game: only Start over + always-available items", () => {
    const hmUI = stubHmUI();
    renderMenu(hmUI, [], LAYOUTS.s, { ...baseOpts, finished: true });
    expect(menuLabels(hmUI)).toEqual([
      "Start over", "Vibrate: on", "Test link", "Switch player", "Close",
    ]);
  });

  it("active game: the full menu, unchanged", () => {
    const hmUI = stubHmUI();
    renderMenu(hmUI, [], LAYOUTS.s, { ...baseOpts, finished: false });
    expect(menuLabels(hmUI)).toEqual([
      "Offer draw", "Take back a move", "Start over", "Resign",
      "Vibrate: on", "Test link", "Switch player", "Close",
    ]);
  });

  it("finished menu is shorter than the full menu", () => {
    const full = stubHmUI();
    renderMenu(full, [], LAYOUTS.s, { ...baseOpts, finished: false });
    const done = stubHmUI();
    renderMenu(done, [], LAYOUTS.s, { ...baseOpts, finished: true });
    const panel = (ui) => ui.created.find((w) => w.type === "FILL_RECT" && w.props.radius === 16);
    expect(panel(done).props.h).toBeLessThan(panel(full).props.h);
    expect(panel(full).props.h).toBe(384);
  });
});

describe("result dialog", () => {
  function finishedState() {
    const s = fakeInitialState("p1");
    s.game.status = "finished";
    s.game.result = "b";
    s.game.result_reason = "checkmate";
    s.game.recent_moves = [
      { ply: 1, san: "f3", by: "p1" },
      { ply: 2, san: "e5", by: "p2" },
      { ply: 3, san: "g4", by: "p1" },
      { ply: 4, san: "Qh4#", by: "p2" },
    ];
    return s;
  }

  it("shows the result with a single OK button, no Play again", () => {
    const hmUI = stubHmUI();
    const seen = [];
    renderResult(hmUI, [], LAYOUTS.s, finishedState(), "p1", { onOk: () => seen.push("ok") });
    const labels = hmUI.created.filter((w) => w.type === "BUTTON").map((w) => w.props.text);
    expect(labels).toEqual(["OK"]);
    const title = hmUI.created.find((w) => w.type === "TEXT" && w.props.text === "You lose — checkmate");
    expect(title).toBeDefined();
    const moves = hmUI.created.find((w) => w.type === "TEXT" && w.props.text === "f3 e5 g4 Qh4#");
    expect(moves).toBeDefined();
    const ok = hmUI.created.find((w) => w.type === "BUTTON" && w.props.text === "OK");
    tap(ok);
    expect(seen).toEqual(["ok"]);
  });

  it("tapping outside the result panel does not dismiss it", () => {
    const hmUI = stubHmUI();
    const seen = [];
    renderResult(hmUI, [], LAYOUTS.s, finishedState(), "p1", { onOk: () => seen.push("ok") });
    // The backdrop is the full-screen FILL_RECT, created first — unlike
    // the menu it carries no tap handler, so only OK closes the dialog.
    const bg = hmUI.created[0];
    expect(bg.type).toBe("FILL_RECT");
    expect(bg.listeners.CLICK_DOWN).toBeUndefined();
    expect(seen).toEqual([]);
  });
});

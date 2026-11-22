import { describe, it, expect } from "vitest";
import { renderMenu, renderPicker } from "./overlays.js";
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

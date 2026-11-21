import { describe, it, expect } from "vitest";
import { getLayout, displayCell, squareRect, boardCornerRadius, LAYOUTS } from "./layout.js";

describe("layouts", () => {
  it("Bip 6 matches the plan exactly", () => {
    const l = getLayout({ width: 390, height: 450, screenShape: "square" });
    expect(l.shape).toBe("s");
    expect(l.board).toEqual({ x: 27, y: 46, size: 336, cell: 42, piece: 38 });
    expect(l.status).toEqual({ x: 45, y: 8, w: 300, h: 30 });
    expect(l.menu).toEqual({ x: 115, y: 396, w: 160, h: 40 });
    // Board + menu fit inside the display.
    expect(l.board.y + l.board.size).toBeLessThanOrEqual(450);
    expect(l.menu.y + l.menu.h).toBeLessThanOrEqual(450);
  });

  it("Active 3 matches the plan exactly", () => {
    const l = getLayout({ width: 466, height: 466, screenShape: "round" });
    expect(l.shape).toBe("r");
    expect(l.board).toEqual({ x: 69, y: 69, size: 328, cell: 41, piece: 37 });
    expect(l.status).toEqual({ x: 133, y: 24, w: 200, h: 28 });
    expect(l.menu).toEqual({ x: 153, y: 398, w: 160, h: 40 });
    expect(l.board.y + l.board.size).toBeLessThanOrEqual(466);
    expect(l.menu.y + l.menu.h).toBeLessThanOrEqual(466);
  });

  it("round board corners stay inside the 233px radius", () => {
    const l = LAYOUTS.r;
    const radius = boardCornerRadius(l);
    expect(radius).toBeLessThanOrEqual(233);
    expect(radius).toBeGreaterThan(230); // ~232 by construction
  });

  it("square board corners are inside the display", () => {
    const l = LAYOUTS.s;
    expect(boardCornerRadius(l)).toBeLessThan(300);
  });

  it("orientation flips for Black", () => {
    // White view: a1 is bottom-left (col 0, row 7).
    expect(displayCell(0, 0, false)).toEqual({ col: 0, row: 7 });
    // Black view: a1 is top-right (col 7, row 0).
    expect(displayCell(0, 0, true)).toEqual({ col: 7, row: 0 });
    // e4 white view vs black view are mirrored.
    const w = displayCell(4, 3, false);
    const b = displayCell(4, 3, true);
    expect(w).toEqual({ col: 4, row: 4 });
    expect(b).toEqual({ col: 3, row: 3 });
  });

  it("squareRect places a1 and h8 at opposite corners (white view)", () => {
    const l = LAYOUTS.s;
    const a1 = squareRect(l, 0, 0, false);
    const h8 = squareRect(l, 7, 7, false);
    expect(a1).toEqual({ x: 27, y: 46 + 7 * 42, w: 42, h: 42 });
    expect(h8).toEqual({ x: 27 + 7 * 42, y: 46, w: 42, h: 42 });
  });

  it("string presets resolve", () => {
    expect(getLayout("s").shape).toBe("s");
    expect(getLayout("r").shape).toBe("r");
    expect(getLayout("nope").shape).toBe("s");
  });
});

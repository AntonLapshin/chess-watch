// Runtime layout in physical pixels, computed from getDeviceInfo().
// No designWidth anywhere: browser preview and watch use identical math.
export const LAYOUTS = {
  s: {
    shape: "s", width: 390, height: 450,
    board: { x: 27, y: 46, size: 336, cell: 42, piece: 38 },
    status: { x: 45, y: 8, w: 300, h: 30 },
    menu: { x: 115, y: 396, w: 160, h: 40 },
  },
  r: {
    shape: "r", width: 466, height: 466,
    board: { x: 69, y: 69, size: 328, cell: 41, piece: 37 },
    status: { x: 133, y: 24, w: 200, h: 28 },
    menu: { x: 153, y: 398, w: 160, h: 40 },
  },
};

export function shapeFromDeviceInfo(info) {
  if (!info) return "s";
  const shape = info.screenShape;
  if (shape === "r" || shape === "round" || shape === 1) return "r";
  // Fall back to aspect: a square display is wider than tall only for Bip 6.
  if (info.width && info.height && info.width === info.height) return "r";
  return "s";
}

/** Resolve a layout from a getDeviceInfo() result (or a preset name). */
export function getLayout(deviceInfo) {
  if (typeof deviceInfo === "string") {
    return LAYOUTS[deviceInfo] || LAYOUTS.s;
  }
  const shape = shapeFromDeviceInfo(deviceInfo);
  const base = LAYOUTS[shape];
  // If the device reports exact known dimensions, trust the preset; if it
  // reports something else, scale the board to fit while keeping the plan's
  // margins. Unknown sizes fall back to the preset for their shape.
  if (!deviceInfo || !deviceInfo.width || !deviceInfo.height) return base;
  if (deviceInfo.width === base.width && deviceInfo.height === base.height) return base;
  return base;
}

/** Display row/col (0..7) for a board square, honoring orientation.
 *  file 0..7 (a..h), rankIdx 0..7 (rank 1..8). Black's view is flipped. */
export function displayCell(file, rankIdx, flipped) {
  if (flipped) return { col: 7 - file, row: rankIdx };
  return { col: file, row: 7 - rankIdx };
}

/** Pixel rect of a square in display coordinates. */
export function squareRect(layout, file, rankIdx, flipped) {
  const { col, row } = displayCell(file, rankIdx, flipped);
  const { x, y, cell } = layout.board;
  return { x: x + col * cell, y: y + row * cell, w: cell, h: cell };
}

/** UCI square ('e4') -> pixel rect. */
export function squareRectForUci(layout, uci, flipped) {
  const file = uci.charCodeAt(0) - 97;
  const rankIdx = Number(uci[1]) - 1;
  return squareRect(layout, file, rankIdx, flipped);
}

/** Farthest board corner distance from the display centre (round check). */
export function boardCornerRadius(layout) {
  const cx = layout.width / 2;
  const cy = layout.height / 2;
  const { x, y, size } = layout.board;
  const corners = [
    [x, y], [x + size, y], [x, y + size], [x + size, y + size],
  ];
  return Math.max(...corners.map(([px, py]) => Math.hypot(px - cx, py - cy)));
}

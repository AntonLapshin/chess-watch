// High-contrast theme (plan §5). Colors are Zepp 0xRRGGBB numbers; the
// web runner converts them to CSS. Alpha tints use 0xAARRGGBB.
export const THEME = {
  background: 0x0e1116,
  lightSquare: 0xe9e3d3,
  darkSquare: 0x75836b,
  whitePiece: 0xffffff,
  whitePieceOutline: 0x101418,
  blackPiece: 0x14181c,
  blackPieceOutline: 0xffffff,
  selection: 0xffc24b,
  lastMove: 0xffc24b,
  legalDot: 0xa60b1220, // ~65% alpha dark dot
  check: 0xff5a5a,
  text: 0xf5f7fa,
  textSecondary: 0xa9b4c0,
  overlay: 0xd80e1116, // ~85% alpha backdrop
  button: 0x2a3340,
  buttonText: 0xf5f7fa,
  danger: 0xff5a5a,
  online: 0x4ade80,
  offline: 0xff5a5a,
  pending: 0xffc24b,
};

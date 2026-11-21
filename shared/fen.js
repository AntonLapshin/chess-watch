// FEN -> 8x8 board array (display only; the server enforces the rules).
// board[0] is rank 8, board[7] is rank 1. Each cell is null or
// { type: 'p'|'n'|'b'|'r'|'q'|'k', color: 'w'|'b' }.

export function parseFen(fen) {
  const placement = String(fen || "").trim().split(/\s+/)[0] || "";
  const rows = placement.split("/");
  const board = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    const part = rows[r] || "";
    for (const ch of part) {
      if (ch >= "1" && ch <= "8") {
        for (let i = 0; i < Number(ch); i++) row.push(null);
      } else if (/[pnbrqkPNBRQK]/.test(ch)) {
        row.push({
          type: ch.toLowerCase(),
          color: ch === ch.toUpperCase() ? "w" : "b",
        });
      }
    }
    while (row.length < 8) row.push(null);
    board.push(row.slice(0, 8));
  }
  while (board.length < 8) board.push([null, null, null, null, null, null, null, null]);
  return board.slice(0, 8);
}

/** Piece at a UCI square ('e4') in a parsed board. */
export function pieceAt(board, square) {
  const file = square.charCodeAt(0) - 97; // a=0
  const rank = Number(square[1]); // 1..8
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return board[8 - rank][file];
}

/** 'w' + 'n' -> 'wn'; used for piece image file names. */
export function pieceImageName(piece) {
  return `${piece.color}${piece.type}`;
}

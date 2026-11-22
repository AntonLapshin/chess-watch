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

function squareCoords(square) {
  const file = square.charCodeAt(0) - 97; // a=0
  const rank = Number(square[1]); // 1..8
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return { row: 8 - rank, col: file, rank };
}

function boardToPlacement(board) {
  const rows = [];
  for (const row of board) {
    let out = "";
    let empty = 0;
    for (const cell of row) {
      if (!cell) {
        empty++;
      } else {
        if (empty > 0) {
          out += String(empty);
          empty = 0;
        }
        out += cell.color === "w" ? cell.type.toUpperCase() : cell.type;
      }
    }
    if (empty > 0) out += String(empty);
    rows.push(out || "8");
  }
  return rows.join("/");
}

const CASTLING_SQUARES = {
  K: { row: 7, col: 7 }, Q: { row: 7, col: 0 },
  k: { row: 0, col: 7 }, q: { row: 0, col: 0 },
};

/** Apply one move to a FEN string and return the resulting FEN.
 *  Display-only (the server enforces the rules): handles normal moves,
 *  captures, castling (king + rook), en passant (removes the captured
 *  pawn), promotion, and the FEN bookkeeping (turn, castling rights,
 *  en-passant square, halfmove / fullmove clocks). Used for the optimistic
 *  board update on the watch: the piece visibly moves the moment it is
 *  tapped, ~1 s before the server state arrives. Returns null for a
 *  malformed FEN or squares (the caller then falls back to waiting for
 *  the server). Does NOT detect check, mate, or draw claims — the server
 *  state corrects those on arrival. */
export function applyMoveToFen(fen, from, to, promotion) {
  const parts = String(fen || "").trim().split(/\s+/);
  if (parts.length < 2) return null;
  const board = parseFen(fen);
  const f = squareCoords(from);
  const t = squareCoords(to);
  if (!f || !t) return null;
  const piece = board[f.row][f.col];
  if (!piece) return null;
  const turn = parts[1] === "b" ? "b" : "w";
  if (piece.color !== turn) return null;
  const target = board[t.row][t.col];
  const isCapture = Boolean(target) || false;

  // En passant: a pawn moving diagonally onto an empty square captures
  // the pawn that just double-stepped, on (to-file, from-rank).
  let epCapture = null;
  if (piece.type === "p" && f.col !== t.col && !target) {
    epCapture = { row: f.row, col: t.col };
    if (!board[epCapture.row][epCapture.col] ||
        board[epCapture.row][epCapture.col].type !== "p") {
      return null;
    }
  }

  // Castling rights: king move clears both of its color's rights; a rook
  // leaving (or being captured on) its home square clears that right.
  let rights = parts[2] && parts[2] !== "-" ? parts[2] : "";
  const dropRight = (r) => { rights = rights.replace(r, ""); };
  if (piece.type === "k") {
    if (turn === "w") { dropRight("K"); dropRight("Q"); }
    else { dropRight("k"); dropRight("q"); }
  }
  for (const [right, sq] of Object.entries(CASTLING_SQUARES)) {
    if ((f.row === sq.row && f.col === sq.col) ||
        (t.row === sq.row && t.col === sq.col)) {
      dropRight(right);
    }
  }

  // Castling: king moves two squares; the rook hops over it.
  if (piece.type === "k" && Math.abs(t.col - f.col) === 2) {
    const rookFromCol = t.col > f.col ? 7 : 0;
    const rookToCol = t.col > f.col ? 5 : 3;
    const rook = board[f.row][rookFromCol];
    if (!rook || rook.type !== "r" || rook.color !== turn) return null;
    board[f.row][rookToCol] = rook;
    board[f.row][rookFromCol] = null;
  }

  // Move the piece (promotion replaces the pawn on the last rank).
  board[f.row][f.col] = null;
  if (epCapture) board[epCapture.row][epCapture.col] = null;
  const promoted = promotion && piece.type === "p" &&
    ((turn === "w" && t.rank === 8) || (turn === "b" && t.rank === 1));
  board[t.row][t.col] = promoted
    ? { type: String(promotion).toLowerCase(), color: turn }
    : piece;

  // En-passant square: only a pawn double-step creates one — and only
  // when an enemy pawn stands beside the landing square and could
  // capture it. That is chess.js's convention (the server's FENs follow
  // it: after 1.e4 the square is "-", after ...d5 with a white pawn on
  // e5 it is "d6"), so the optimistic FEN matches the server's exactly.
  let ep = "-";
  if (piece.type === "p" && Math.abs(t.rank - f.rank) === 2) {
    const enemy = turn === "w" ? "b" : "w";
    const beside = (dc) => {
      const col = f.col + dc;
      return col >= 0 && col <= 7 && board[t.row][col] &&
        board[t.row][col].type === "p" && board[t.row][col].color === enemy;
    };
    if (beside(-1) || beside(1)) {
      ep = String.fromCharCode(97 + f.col) + (turn === "w" ? 3 : 6);
    }
  }
  const halfmove = (piece.type === "p" || isCapture || epCapture) ? 0 : (parseInt(parts[4] || "0", 10) || 0) + 1;
  const fullmove = (parseInt(parts[5] || "1", 10) || 1) + (turn === "b" ? 1 : 0);
  return [
    boardToPlacement(board),
    turn === "w" ? "b" : "w",
    rights || "-",
    ep,
    String(halfmove),
    String(fullmove),
  ].join(" ");
}
